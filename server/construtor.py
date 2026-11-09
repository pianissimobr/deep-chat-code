#!/usr/bin/env python3
"""
Construtor de Código Local — Loop OpenRouter → Execução → Feedback para DeepSeek

Fluxo:
  1. Recebe o texto importante do DeepSeek (resposta da IA).
  2. Envia para um modelo via OpenRouter (ex: cohere/north-mini-code:free) com o
     contexto do projeto (arquivo .md gerado pelo tree-content-generator) pedindo
     para identificar a árvore, criar pastas/arquivos e informar o comando.
  3. Escreve os arquivos num workspace com mkdir -p (cria pastas automaticamente).
  4. Executa o comando localmente (sandbox: apenas no diretório da sessão, sem rede,
     sem sudo, timeout rígido).
  5. Se der erro → envia o erro de volta ao DeepSeek (usuário copia a resposta do
     DeepSeek e reinjeta aqui) → repete até sucesso ou limite de iterações.

Requisitos:
  - OPENROUTER_API_KEY definida no ambiente ou .env (alimenta o provedor OpenRouter)
  - lib "openai" do Python instalada (usada como cliente OpenAI-compatível)
  - Python 3.8+

Uso:
  python construtor.py --resposta "<texto do DeepSeek>" --contexto estrutura_projeto.md --workspace ./meu-projeto
  python construtor.py --resposta "<texto>" --modelo "cohere/north-mini-code:free"
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

try:
    import openai
except ImportError:
    print("❌ Biblioteca 'openai' não instalada. Rode: pip install openai")
    sys.exit(1)

MAX_ITERACOES = 5
EXEC_TIMEOUT = 120  # segundos
WORKSPACE_DEFAULT = "./workspace_construtor"

# OpenRouter — API compatível com OpenAI
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
# Modelo padrão pedido na configuração (gratuito no OpenRouter)
DEFAULT_MODEL = "cohere/north-mini-code:free"


def carregar_env():
    """Carrega variáveis de um arquivo .env se existir, sem sobrescrever as já definidas.
    Tenta cwd e, depois, o diretório do script; útil quando o servidor chama o Python com cwd diferente."""
    for base in (Path.cwd(), Path(__file__).resolve().parent):
        env_path = base / ".env"
        if not env_path.exists():
            continue
        try:
            lines = env_path.read_text(encoding="utf-8").splitlines()
        except OSError:
            continue
        for linha in lines:
            linha = linha.strip()
            if not linha or linha.startswith("#") or "=" not in linha:
                continue
            chave, valor = linha.split("=", 1)
            os.environ.setdefault(chave.strip(), valor.strip())


def obter_cliente_openai():
    """Cria o cliente apontando para o OpenRouter."""
    carregar_env()
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        print("❌ OPENROUTER_API_KEY não definida. Defina no ambiente ou no arquivo .env")
        sys.exit(1)
    # HTTP-Referer / X-Title são recomendados pelo OpenRouter para analytics
    extra_headers = {}
    if os.environ.get("OPENROUTER_HTTP_REFERER"):
        extra_headers["HTTP-Referer"] = os.environ["OPENROUTER_HTTP_REFERER"]
    if os.environ.get("OPENROUTER_APP_TITLE"):
        extra_headers["X-Title"] = os.environ["OPENROUTER_APP_TITLE"]
    return openai.OpenAI(
        api_key=api_key,
        base_url=OPENROUTER_BASE_URL,
        default_headers=extra_headers or None,
    )


def ler_contexto(caminho):
    if not caminho or not os.path.exists(caminho):
        return "(sem contexto de arquivos)"
    with open(caminho, "r", encoding="utf-8") as f:
        return f.read()


def prompt_para_openai(resposta_deepseek, contexto):
    return (
        f"""
Você é um engenheiro de software sênior. Recebeu uma resposta importante do DeepSeek
e deve converter em código LOCAL executável.

Resposta do DeepSeek (contexto da tarefa):
"""
        + resposta_deepseek
        + """

Contexto do projeto (árvores de arquivos):
"""
        + contexto
        + """

INSTRUÇÕES:
Você precisa identificar duas coisas na resposta do DeepSeek:
  A) A árvore/pastas que precisam ser criadas (ex: "src/utils", "src/views").
  B) O código com nome do arquivo e onde ele deve ser colocado (ex: "src/utils/ajuda.py").

1. Para cada arquivo de código que o DeepSeek manda, crie uma entrada no campo "arquivos".
   Cada entrada tem:
   - "arquivo": caminho relativo do arquivo a criar (ex: "src/utils/ajuda.py", "main.py")
   - "codigo": conteúdo completo do arquivo
   - "descricao": breve descrição do que o arquivo faz

2. Informe "comando": o comando para executar (ex: "python3 src/utils/ajuda.py" ou "node app.js").
   Use "python3" (não "python") para scripts Python.

3. Retorne APENAS um JSON válido com os campos:
   - "arquivos": lista de objetos {arquivo, codigo, descricao} — um por arquivo de código
   - "comando": comando para executar (ex: "python3 main.py")
   - "descricao": breve descrição geral do que o código faz

Não inclua texto fora do JSON.

Regras:
- Pastas intermediárias são criadas automaticamente pelo executor (mkdir -p).
- Se o DeepSeek manda apenas um arquivo, "arquivos" terá 1 item.
- Se manda árvore com múltiplos arquivos, liste todos (cada um com caminho completo).
- Nunca deixe "codigo" vazio; se não houver código, explique em "descricao".
"""
    )


def chamar_openai(cliente, resposta_deepseek, contexto, modelo=DEFAULT_MODEL, tentativas=3):
    prompt = prompt_para_openai(resposta_deepseek, contexto)
    ultimo_erro = None
    for tentativa in range(tentativas):
        resp = cliente.chat.completions.create(
            model=modelo,
            messages=[
                {"role": "system", "content": "Você escreve código local limpo e seguro. Retorne apenas JSON."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
            max_tokens=1200,
        )
        texto = (resp.choices[0].message.content or "").strip()
        if not texto:
            print(f"⚠️ Tentativa {tentativa + 1}/{tentativas}: resposta vazia do modelo, repetindo...")
            continue
        if texto.startswith("```"):
            texto = texto.split("```", 2)[1] if "```" in texto[3:] else texto
            if texto.startswith("json"):
                texto = texto[4:].strip()
        try:
            return json.loads(texto)
        except json.JSONDecodeError as e:
            ultimo_erro = e
            inicio = texto.find("{")
            fim = texto.rfind("}")
            if inicio != -1 and fim != -1 and fim > inicio:
                try:
                    return json.loads(texto[inicio : fim + 1])
                except json.JSONDecodeError:
                    pass
            print(f"⚠️ Tentativa {tentativa + 1}/{tentativas}: JSON inválido ({e}), repetindo...")
            continue
    raise RuntimeError(f"Não foi possível obter JSON válido após {tentativas} tentativas: {ultimo_erro}")


def escrever_arquivo(workspace, caminho_rel, codigo):
    caminho = Path(workspace) / caminho_rel
    caminho.parent.mkdir(parents=True, exist_ok=True)
    caminho.write_text(codigo, encoding="utf-8")
    return str(caminho)


def executar_comando(workspace, comando, timeout=EXEC_TIMEOUT):
    """
    Executa comando restrito ao workspace. Bloqueia comandos perigosos.
    """
    proibidos = ["sudo", "rm -rf", "curl", "wget", "nc ", "netcat", "chmod +x", "ssh", "> /dev/", "format", "mkfs"]
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


def normalizar_plano(plano):
    """Aceita tanto o novo formato {arquivos:[{arquivo,codigo,descricao}], comando, descricao}
    quanto o legado {arquivo, codigo, comando, descricao}, retornando um dict uniforme."""
    arquivos = []
    if isinstance(plano.get("arquivos"), list):
        for item in plano["arquivos"]:
            if not isinstance(item, dict):
                continue
            arq = item.get("arquivo") or item.get("path") or ""
            cod = item.get("codigo") or item.get("code") or item.get("content") or ""
            desc = item.get("descricao") or item.get("description") or ""
            if arq:
                arquivos.append({"arquivo": arq, "codigo": cod, "descricao": desc})
    if not arquivos:
        arq = plano.get("arquivo") or plano.get("path") or ""
        cod = plano.get("codigo") or plano.get("code") or plano.get("content") or plano.get("code_content") or ""
        desc = plano.get("descricao") or plano.get("description") or ""
        if arq:
            arquivos.append({"arquivo": arq, "codigo": cod, "descricao": desc})
    comando = plano.get("comando") or plano.get("command") or (f"python3 {arquivos[0]['arquivo']}" if arquivos else "python3 main.py")
    descricao = plano.get("descricao") or plano.get("description") or ""
    return {"arquivos": arquivos, "comando": comando, "descricao": descricao}


def loop_construcao(cliente, resposta_inicial, contexto, workspace, modelo=DEFAULT_MODEL):
    resposta_atual = resposta_inicial
    for iteracao in range(1, MAX_ITERACOES + 1):
        print(f"\n🔄 Iteração {iteracao}/{MAX_ITERACOES} (modelo: {modelo})")
        try:
            plano = normalizar_plano(chamar_openai(cliente, resposta_atual, contexto, modelo=modelo))
        except Exception as e:
            print(f"❌ Erro no OpenRouter: {e}")
            return False

        descricao_geral = plano.get("descricao", "")
        comando = plano.get("comando", "python3 main.py")
        print(f"📋 Descrição geral: {descricao_geral}")
        print(f"▶️ Comando: {comando}")

        for item in plano.get("arquivos", []):
            arquivo = item.get("arquivo", "main.py")
            codigo = item.get("codigo", "")
            descricao = item.get("descricao", "")
            print(f"📝 Arquivo: {arquivo} — {descricao}")
            if not codigo:
                print(f"⚠️ arquivo sem código, pulando escrita: {arquivo}")
                continue
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

        # Erro -> monta feedback para o DeepSeek (com os arquivos envolvidos)
        erro = stderr or stdout or "Erro desconhecido"
        arquivos_afetados = ", ".join(item.get("arquivo", "?") for item in plano.get("arquivos", [])) or "(desconhecido)"
        resposta_atual = (
            f"O código gerado na iteração anterior falhou.\n"
            f"Arquivos: {arquivos_afetados}\n"
            f"Comando: {comando}\n"
            f"Código de saída: {rc}\n"
            f"Erro:\n{erro}\n\n"
            f"Por favor, corrija o código e envie uma resposta atualizada."
        )
        print(f"⚠️ Erro na execução. Enviando feedback para o DeepSeek (iteração {iteracao}).")

    print(f"❌ Limite de {MAX_ITERACOES} iterações atingido sem sucesso.")
    return False


def main():
    parser = argparse.ArgumentParser(description="Construtor de Código Local (OpenRouter -> exec -> DeepSeek)")
    parser.add_argument("--resposta", required=True, help="Texto importante do DeepSeek")
    parser.add_argument("--contexto", default=None, help="Caminho do .md do tree-content-generator")
    parser.add_argument("--workspace", default=WORKSPACE_DEFAULT, help="Diretório de trabalho local")
    parser.add_argument("--modelo", default=DEFAULT_MODEL, help="Modelo no OpenRouter (ex: cohere/north-mini-code:free)")
    args = parser.parse_args()

    os.makedirs(args.workspace, exist_ok=True)
    cliente = obter_cliente_openai()
    contexto = ler_contexto(args.contexto)

    sucesso = loop_construcao(cliente, args.resposta, contexto, args.workspace, modelo=args.modelo)
    sys.exit(0 if sucesso else 1)


if __name__ == "__main__":
    main()
