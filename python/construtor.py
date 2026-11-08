#!/usr/bin/env python3
"""
Construtor de Código Local — Loop OpenAI → Execução → Feedback para DeepSeek

Fluxo:
  1. Recebe o texto importante do DeepSeek (resposta da IA).
  2. Envia para um modelo menor da OpenAI (ex: gpt-4o-mini) com o contexto do
     projeto (arquivo .md gerado pelo tree-content-generator) pedindo para escrever
     o código local e informar o comando para executá-lo.
  3. Escreve o código num arquivo dentro do workspace da sessão.
  4. Executa o comando localmente (sandbox: apenas no diretório da sessão, sem rede,
     sem sudo, timeout rígido).
  5. Se der erro → envia o erro de volta ao DeepSeek (usuário copia a resposta do
     DeepSeek e reinjeta aqui) → repete até sucesso ou limite de iterações.

Requisitos:
  - OPENAI_API_KEY definida no ambiente ou .env
  - Python 3.8+

Uso:
  python construtor.py --resposta "<texto do DeepSeek>" --contexto estrutura_projeto.md --workspace ./meu-projeto
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    import openai
except ImportError:
    print("❌ Biblioteca 'openai' não instalada. Rode: pip install openai")
    sys.exit(1)

MAX_ITERACOES = 5
EXEC_TIMEOUT = 120  # segundos
WORKSPACE_DEFAULT = "./workspace_construtor"


def carregar_env():
    """Carrega variáveis de um arquivo .env se existir, sem sobrescrever as já definidas."""
    env_path = Path('.env')
    if env_path.exists():
        with open(env_path, 'r', encoding='utf-8') as f:
            for linha in f:
                linha = linha.strip()
                if not linha or linha.startswith('#') or '=' not in linha:
                    continue
                chave, valor = linha.split('=', 1)
                os.environ.setdefault(chave.strip(), valor.strip())


def obter_cliente_openai():
    carregar_env()
    api_key = os.environ.get('OPENAI_API_KEY')
    if not api_key:
        print("❌ OPENAI_API_KEY não definida. Defina no ambiente ou no arquivo .env")
        sys.exit(1)
    return openai.OpenAI(api_key=api_key)


def ler_contexto(caminho):
    if not caminho or not os.path.exists(caminho):
        return "(sem contexto de arquivos)"
    with open(caminho, 'r', encoding='utf-8') as f:
        return f.read()


def prompt_para_openai(resposta_deepseek, contexto):
    return f"""
Você é um engenheiro de software sênior. Recebeu uma resposta importante do DeepSeek
e deve converter em código LOCAL executável.

Resposta do DeepSeek (contexto da tarefa):
"""
    + resposta_deepseek + """

Contexto do projeto (árquivos da árvore):
"""
    + contexto + """

INSTRUÇÕES:
1. Escreva o código necessário para atender ao pedido do DeepSeek.
2. Informe claramente o nome do arquivo a ser criado e o comando para executá-lo.
3. Retorne APENAS um JSON válido com os campos:
   - "arquivo": caminho relativo do arquivo a criar (ex: "main.py")
   - "codigo": conteúdo completo do arquivo
   - "comando": comando para executar (ex: "python main.py" ou "node app.js")
   - "descricao": breve descrição do que o código faz

Não inclua texto fora do JSON.
"""


def chamar_openai(cliente, resposta_deepseek, contexto, modelo="gpt-4o-mini"):
    prompt = prompt_para_openai(resposta_deepseek, contexto)
    resp = cliente.chat.completions.create(
        model=modelo,
        messages=[
            {"role": "system", "content": "Você escreve código local limpo e seguro. Retorne apenas JSON."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.2,
    )
    texto = resp.choices[0].message.content.strip()
    # Remove possíveis marcadores de código ```json ... ```
    if texto.startswith("```"):
        texto = texto.split("```", 2)[1] if "```" in texto[3:] else texto
        if texto.startswith("json"):
            texto = texto[4:].strip()
    return json.loads(texto)


def escrever_arquivo(workspace, caminho_rel, codigo):
    caminho = Path(workspace) / caminho_rel
    caminho.parent.mkdir(parents=True, exist_ok=True)
    caminho.write_text(codigo, encoding='utf-8')
    return str(caminho)


def executar_comando(workspace, comando, timeout=EXEC_TIMEOUT):
    """
    Executa comando restrito ao workspace. Bloqueia comandos perigosos.
    """
    proibidos = ['sudo', 'rm -rf', 'curl', 'wget', 'nc ', 'netcat', 'chmod +x', 'ssh', '> /dev/', 'format', 'mkfs']
    cmd_lower = comando.lower()
    for p in proibidos:
        if p in cmd_lower:
            return "", f"❌ Comando bloqueado por segurança: {p}", 1

    try:
        resultado = subprocess.run(
            comando,
            shell=True,
            cwd=workspace,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return resultado.stdout, resultado.stderr, resultado.returncode
    except subprocess.TimeoutExpired:
        return "", f"❌ Timeout após {timeout}s", 124
    except Exception as e:
        return "", f"❌ Erro ao executar: {e}", 1


def loop_construcao(cliente, resposta_inicial, contexto, workspace, modelo="gpt-4o-mini"):
    resposta_atual = resposta_inicial
    for iteracao in range(1, MAX_ITERACOES + 1):
        print(f"\n🔄 Iteração {iteracao}/{MAX_ITERACOES}")
        try:
            plano = chamar_openai(cliente, resposta_atual, contexto, modelo=modelo)
        except Exception as e:
            print(f"❌ Erro na OpenAI: {e}")
            return False

        arquivo = plano.get('arquivo', 'main.py')
        codigo = plano.get('codigo', '')
        comando = plano.get('comando', f'python {arquivo}')
        descricao = plano.get('descricao', '')

        print(f"📝 Arquivo: {arquivo}")
        print(f"📋 Descrição: {descricao}")
        print(f"▶️ Comando: {comando}")

        caminho = escrever_arquivo(workspace, arquivo, codigo)
        print(f"💾 Escrito em: {caminho}")

        stdout, stderr, rc = executar_comando(workspace, comando)
        if stdout:
            print("📤 STDOUT:\n", stdout[:4000])
        if stderr:
            print("📥 STDERR:\n", stderr[:4000])

        if rc == 0:
            print("✅ Execução concluída com sucesso!")
            return True

        # Erro → monta feedback para o DeepSeek
        erro = stderr or stdout or "Erro desconhecido"
        resposta_atual = (
            f"O código gerado na iteração anterior falhou.\n"
            f"Arquivo: {arquivo}\n"
            f"Comando: {comando}\n"
            f"Código de saída: {rc}\n"
            f"Erro:\n{erro}\n\n"
            f"Por favor, corrija o código e envie uma resposta atualizada."
        )
        print(f"⚠️ Erro na execução. Enviando feedback para o DeepSeek (iteração {iteracao}).")

    print(f"❌ Limite de {MAX_ITERACOES} iterações atingido sem sucesso.")
    return False


def main():
    parser = argparse.ArgumentParser(description="Construtor de Código Local (OpenAI → exec → DeepSeek)")
    parser.add_argument('--resposta', required=True, help="Texto importante do DeepSeek")
    parser.add_argument('--contexto', default=None, help="Caminho do .md do tree-content-generator")
    parser.add_argument('--workspace', default=WORKSPACE_DEFAULT, help="Diretório de trabalho local")
    parser.add_argument('--modelo', default='gpt-4o-mini', help="Modelo OpenAI (ex: gpt-4o-mini)")
    args = parser.parse_args()

    os.makedirs(args.workspace, exist_ok=True)
    cliente = obter_cliente_openai()
    contexto = ler_contexto(args.contexto)

    sucesso = loop_construcao(cliente, args.resposta, contexto, args.workspace, modelo=args.modelo)
    sys.exit(0 if sucesso else 1)


if __name__ == '__main__':
    main()
