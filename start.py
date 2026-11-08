#!/usr/bin/env python3
"""
start.py - Instalador automático do Construtor de Código DeepSeek para OpenChamber

Este script configura tudo automaticamente:
1. Verifica dependências do sistema (Python, Bun, Node, Git)
2. Instala dependências do Bun (openchamber)
3. Cria arquivo .env a partir do .env.example
4. Inicia o servidor OpenChamber com o Construtor de Código DeepSeek ativo

Uso:
    python start.py          # instala e inicia
    python start.py --install-only   # apenas instala, não inicia
    python start.py --start-only     # apenas inicia (pressupõe instalação feita)
"""

import os
import sys
import subprocess
import shutil
import platform
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ENV_FILE = ROOT / ".env"
ENV_EXAMPLE = ROOT / ".env.example"

COLORS = {
    "reset": "\033[0m",
    "bold": "\033[1m",
    "green": "\033[92m",
    "yellow": "\033[93m",
    "red": "\033[91m",
    "blue": "\033[94m",
    "cyan": "\033[96m",
}

def c(text, color):
    return f"{COLORS.get(color, '')}{text}{COLORS['reset']}"

def log(msg, color="info"):
    color_map = {"info": "blue", "ok": "green", "warn": "yellow", "error": "red", "step": "cyan"}
    print(f"[{color_map.get(color, 'info')}*{COLORS['reset']}] {msg}")

def run(cmd, check=True, capture=False, cwd=None):
    """Executa um comando no shell."""
    log(f"Executando: {cmd}", "step")
    try:
        result = subprocess.run(
            cmd,
            shell=True,
            check=check,
            capture_output=capture,
            text=True,
            cwd=cwd or ROOT,
        )
        if capture and result.stdout:
            return result.stdout.strip()
        return result
    except subprocess.CalledProcessError as e:
        log(f"Comando falhou com código {e.returncode}", "error")
        if capture and e.stdout:
            print(e.stdout)
        if capture and e.stderr:
            print(e.stderr)
        if check:
            sys.exit(1)
        return e


def check_system():
    """Verifica se as dependências do sistema estão instaladas."""
    log("Verificando dependências do sistema...", "step")

    checks = {
        "python3": ("python3 --version", "Python 3 é necessário"),
        "bun": ("bun --version", "Bun é necessário (https://bun.sh)"),
        "git": ("git --version", "Git é necessário"),
    }

    missing = []
    for name, (cmd, msg) in checks.items():
        result = run(cmd, check=False, capture=True)
        if result.returncode == 0:
            version = result.stdout.strip() if result.stdout else "ok"
            log(f"{name}: {version}", "ok")
        else:
            log(f"{name}: NÃO ENCONTRADO - {msg}", "error")
            missing.append(name)

    if missing:
        log(f"Instale as seguintes dependências antes de continuar: {', '.join(missing)}", "error")
        sys.exit(1)

    log("Todas as dependências do sistema estão presentes.", "ok")


def check_node_version():
    """Verifica a versão do Node.js e avisa sobre compatibilidade com o OpenChamber.

    O OpenChamber requer Node.js >= 24.14, mas o Bun possui seu próprio runtime
    e pode funcionar com versões mais antigas do Node.js. A instalação não é
    bloqueada, apenas um aviso é exibido.
    """
    result = run("node --version", check=False, capture=True)
    if result.returncode != 0:
        log("Node.js não encontrado (recomendado para o Bun)", "warn")
        return

    version_str = result.stdout.strip().lstrip("v")
    try:
        major = int(version_str.split(".")[0])
    except (ValueError, IndexError):
        log(f"Não foi possível determinar a versão do Node.js: {version_str}", "warn")
        return

    if major < 24:
        log(
            f"Node.js {version_str} detectado. "
            f"O OpenChamber recomenda Node.js >= 24.14, mas o Bun possui runtime próprio "
            f"e a instalação continuará mesmo assim.",
            "warn",
        )
        log("Se encontrar erros durante o build, considere atualizar o Node.js.", "warn")
    else:
        log(f"Node.js {version_str}: compatível com o OpenChamber.", "ok")


def create_env():
    """Cria o arquivo .env a partir do .env.example se não existir."""
    if ENV_FILE.exists():
        log(f".env já existe, pulando criação.", "ok")
        return

    if not ENV_EXAMPLE.exists():
        log(".env.example não encontrado, criando .env vazio.", "warn")
        ENV_FILE.write_text("OPENAI_API_KEY=\nDEEPSEEK_URL=https://chat.deepseek.com\n")
        return

    shutil.copy(ENV_EXAMPLE, ENV_FILE)
    log(f".env criado a partir do .env.example.", "ok")
    log("IMPORTANTE: Edite o arquivo .env e preencha sua OPENAI_API_KEY antes de iniciar.", "warn")


def install_bun_deps():
    """Instala dependências do Bun."""
    log("Instalando dependências do Bun (pode demorar alguns minutos)...", "step")
    run("bun install", check=True)
    log("Dependências do Bun instaladas com sucesso.", "ok")


def verify_integration_files():
    """Verifica se os arquivos de integração estão no lugar."""
    required = [
        "packages/web/server/lib/deepseek-construtor/routes.js",
        "packages/web/server/lib/deepseek-construtor/python/gerador_auto.py",
        "packages/web/server/lib/deepseek-construtor/python/construtor.py",
        "packages/web/server/index.js",
        "packages/ui/src/components/chat/deepseek-construtor/DeepSeekPanel.tsx",
        "packages/ui/src/components/chat/deepseek-construtor/useDeepSeekConstrutor.ts",
        "packages/ui/src/components/chat/deepseek-construtor/DeepSeekConstrutorAction.tsx",
        "packages/ui/src/components/chat/ChatMessage.tsx",
        "packages/ui/src/components/layout/MainLayout.tsx",
    ]

    missing = [f for f in required if not (ROOT / f).exists()]
    if missing:
        log(f"Arquivos de integração faltando: {', '.join(missing)}", "error")
        log("Verifique se o repositório foi clonado corretamente.", "error")
        sys.exit(1)

    log("Todos os arquivos de integração estão presentes.", "ok")


def start_server():
    """Inicia o servidor OpenChamber."""
    log("Iniciando o servidor OpenChamber...", "step")
    log("Acesse: http://localhost:3000 (ou a porta configurada)", "info")
    log("Pressione Ctrl+C para parar.", "info")
    try:
        run("bun run --cwd packages/web dev", check=True)
    except KeyboardInterrupt:
        log("Servidor parado pelo usuário.", "info")


def main():
    parser = argparse.ArgumentParser(description="Instalador automático do Construtor de Código DeepSeek para OpenChamber")
    parser.add_argument("--install-only", action="store_true", help="Apenas instala dependências, não inicia o servidor")
    parser.add_argument("--start-only", action="store_true", help="Apenas inicia o servidor (pressupõe instalação feita)")
    args = parser.parse_args()

    print(f"\n{c('═' * 60, 'bold')}")
    print(f"{c('  DeepSeek Construtor de Código Local - Instalador', 'bold')}")
    print(f"{c('═' * 60, 'bold')}\n")

    if args.start_only:
        start_server()
        return

    check_system()
    check_node_version()
    create_env()
    verify_integration_files()
    install_bun_deps()

    print(f"\n{c('═' * 60, 'bold')}")
    print(f"{c('  Instalação concluída com sucesso!', 'green')}")
    print(f"{c('═' * 60, 'bold')}\n")

    log("Próximos passos manuais:", "step")
    print(f"  1. Edite o arquivo {c('.env', 'bold')} e preencha sua {c('OPENAI_API_KEY', 'bold')}")
    print(f"  2. Rode: {c('python start.py --start-only', 'bold')} para iniciar o servidor")
    print(f"  3. Acesse: {c('http://localhost:3000', 'bold')}")
    print(f"  4. Clique no botão flutuante azul (canto inferior direito) para abrir o chat do DeepSeek")
    print(f"  5. Na mensagem do assistente, clique em '{c('🛠️ Construir código', 'bold')}'")
    print()

    if not args.install_only:
        try:
            resposta = input("Deseja iniciar o servidor agora? (s/n): ").strip().lower()
        except EOFError:
            resposta = "n"
        if resposta in ("s", "sim", "y", "yes", ""):
            start_server()
        else:
            log("Servidor não iniciado. Rode 'python start.py --start-only' quando estiver pronto.", "info")


if __name__ == "__main__":
    main()
