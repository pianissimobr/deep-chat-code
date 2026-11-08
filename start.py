#!/usr/bin/env python3
"""
start.py - Instalador e orquestrador do Construtor de Código DeepSeek para OpenChamber

Instala tudo, confere a ponte Tampermonkey e sobe o servidor. Opcoes:

    python start.py                     # instala e pergunta se inicia
    python start.py --install-only      # instala, nao inicia
    python start.py --start-only        # apenas inicia (pressupoe instalado)
    python start.py --build             # faz build de producao antes de subir
    python start.py --port 3001         # porta customizada (padrao 3000)

Passos manuais que este script NAO faz (nao e possivel automatizar sem UI):
  - Instalar a extensao Tampermonkey no navegador
  - Colar sua OPENROUTER_API_KEY no .env (e segredo, nao vai commitar)

O script apenas verifica e orienta esses passos.
"""

import argparse
import os
import platform
import shutil
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ENV_FILE = ROOT / ".env"
ENV_EXAMPLE = ROOT / ".env.example"
BRIDGE_FILE = ROOT / "userscript" / "deepseek-bridge.user.js"
BRIDGE_LEGACY = ROOT / "userscript" / "deepseek-chat.user.js"
DIST_DIR = ROOT / "packages" / "web" / "dist"

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
        # When capture=True we return stdout as text; callers expecting
        # returncode must use capture=False and read result.returncode.
        # To keep a single API, always return the CompletedProcess and let
        # callers read .stdout themselves when needed.
        return result
    except subprocess.CalledProcessError as e:
        log(f"Comando falhou com codigo {e.returncode}", "error")
        if capture and e.stdout:
            print(e.stdout)
        if capture and e.stderr:
            print(e.stderr)
        if check:
            sys.exit(1)
        return e


def check_system():
    log("Verificando dependencias do sistema...", "step")
    checks = {
        "python3": ("python3 --version", "Python 3 e necessario"),
        "bun": ("bun --version", "Bun e necessario (https://bun.sh)"),
        "git": ("git --version", "Git e necessario"),
    }
    missing = []
    for name, (cmd, msg) in checks.items():
        result = run(cmd, check=False, capture=True)
        if result.returncode == 0:
            version = result.stdout.strip() if result.stdout else "ok"
            log(f"{name}: {version}", "ok")
        else:
            log(f"{name}: NAO ENCONTRADO - {msg}", "error")
            missing.append(name)
    if missing:
        log(f"Instale as dependencias antes de continuar: {', '.join(missing)}", "error")
        sys.exit(1)
    log("Todas as dependencias do sistema estao presentes.", "ok")


def check_node_version():
    result = run("node --version", check=False, capture=True)
    if result.returncode != 0:
        log("Node.js nao encontrado (recomendado para o Bun)", "warn")
        return
    version_str = result.stdout.strip().lstrip("v")
    try:
        major = int(version_str.split(".")[0])
    except (ValueError, IndexError):
        log(f"Nao foi possivel determinar a versao do Node.js: {version_str}", "warn")
        return
    if major < 24:
        log(
            f"Node.js {version_str} detectado. O OpenChamber recomenda >= 24.14, "
            "mas o Bun possui runtime proprio e a instalacao continua.",
            "warn",
        )
    else:
        log(f"Node.js {version_str}: compativel com o OpenChamber.", "ok")


def create_env():
    if ENV_FILE.exists():
        log(".env ja existe, pulando criacao.", "ok")
        return
    if not ENV_EXAMPLE.exists():
        log(".env.example nao encontrado, criando .env vazio.", "warn")
        ENV_FILE.write_text("OPENROUTER_API_KEY=\nOPENROUTER_MODEL=cohere/north-mini-code:free\nDEEPSEEK_URL=https://chat.deepseek.com\n")
        return
    shutil.copy(ENV_EXAMPLE, ENV_FILE)
    log(".env criado a partir do .env.example.", "ok")
    log("IMPORTANTE: edite o .env e preencha sua OPENROUTER_API_KEY antes de iniciar (modelo padrao: cohere/north-mini-code:free).", "warn")


def check_env():
    # Only warns - never prints the key
    placeholder = False
    try:
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("OPENROUTER_API_KEY="):
                value = line.split("=", 1)[1].strip()
                if not value or value == "sk-sua-chave-aqui":
                    placeholder = True
                break
    except OSError:
        log(".env nao legivel.", "warn")
        return
    if placeholder:
        log("OPENROUTER_API_KEY ainda esta com placeholder. Edite o .env.", "warn")
    else:
        log("OPENROUTER_API_KEY parece definida (nao exibida). Padrao: cohere/north-mini-code:free.", "ok")


def verify_integration_files():
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
        log(f"Arquivos de integracao faltando: {', '.join(missing)}", "error")
        sys.exit(1)
    log("Todos os arquivos de integracao estao presentes.", "ok")


def check_bridge():
    if not BRIDGE_FILE.exists():
        log(f"Ponte Tampermonkey nao encontrada em {BRIDGE_FILE}", "error")
        log("Verifique se o userscript/deepseek-bridge.user.js existe no repo.", "error")
        sys.exit(1)
    try:
        content = BRIDGE_FILE.read_text(encoding="utf-8")
    except OSError as e:
        log(f"Nao foi possivel ler {BRIDGE_FILE}: {e}", "error")
        sys.exit(1)
    must_have = ["chat.deepseek.com", "entregar-resposta"]
    missing = [s for s in must_have if s not in content]
    if missing:
        log(f"Userscript parece desatualizado (faltam {', '.join(missing)}).", "warn")
    else:
        log("Ponte Tampermonkey (deepseek-bridge.user.js) presente.", "ok")
    if BRIDGE_LEGACY.exists():
        log("deepseek-chat.user.js (iframe antigo) ainda presente - pode remover, o bridge novo nao usa iframe.", "info")


def tampermonkey_hint(port=3000):
    print()
    print(c("=" * 60, "bold"))
    print(c("  Ponte Tampermonkey (manual, 2 minutos)", "bold"))
    print(c("=" * 60, "bold"))
    print("  1. Instale a extensao Tampermonkey no Chrome/Firefox/Edge:")
    print("     https://www.tampermonkey.net/")
    print("  2. Abra userscript/deepseek-bridge.user.js e clique em Install.")
    print(f"  3. Reinicie o navegador (ou recarregue a pagina do OpenChamber).")
    print()
    print("  Como funciona a ponte:")
    print("   - O userscript roda DENTRO de chat.deepseek.com.")
    print("   - Voce clica 'Enviar ultima resposta' na pagina do DeepSeek.")
    print("   - O script faz POST para localhost:3001/api/deepseek-construtor/entregar-resposta")
    print("     e o painel do OpenChamber pega o texto sozinho (polling 3s).")
    print()
    print(f"  Acesse: http://localhost:{port} e clique no botao azul (canto inferior direito).")
    print()


def install_bun_deps():
    log("Instalando dependencias do Bun (pode demorar alguns minutos)...", "step")
    run("bun install", check=True)
    log("Dependencias do Bun instaladas com sucesso.", "ok")
    # Construtor chama OpenRouter via lib openai (cliente OpenAI-compativel)
    try:
        result = run("python3 -c 'import openai'", check=False, capture=True)
        if result.returncode != 0:
            log("Instalando lib Python openai (cliente OpenRouter) ...", "step")
            run("python3 -m pip install --user --break-system-packages 'openai>=1.0'", check=True)
            log("lib openai instalada.", "ok")
        else:
            log("lib openai ja instalada.", "ok")
    except SystemExit:
        raise
    except Exception as e:
        log(f"Nao foi possivel verificar/instalar lib openai: {e}", "warn")


def build_prod():
    log("Fazendo build de producao (ca. 4 min)...", "step")
    result = run("bun run --cwd packages/web build", check=False)
    if result.returncode != 0:
        log("Build falhou. Veja o log acima.", "error")
        sys.exit(1)
    if not (DIST_DIR / "index.html").exists():
        log("dist/index.html nao encontrado apos build.", "error")
        sys.exit(1)
    log("Build de producao concluido - dist/ pronto.", "ok")


def smoke_test(port=3000):
    log(f"Smoke test em http://localhost:{port}/health ...", "step")
    import urllib.request
    import urllib.error
    import json

    target = f"http://localhost:{port}"

    # 1. Health
    try:
        with urllib.request.urlopen(target + "/health", timeout=5) as r:
            body = r.read()
            log(f"  /health -> HTTP {r.status} ({len(body)} bytes)", "ok")
    except Exception as e:
        log(f"  /health falhou: {e}", "error")
        return False

    # 2. Bridge endpoints exist (body parsing etc) - do not need a real subscription here
    # POST entrega -> GET ultima-resposta roundtrip with a test token
    payload = json.dumps({"text": "smoke-test-ponte"}).encode()
    req = urllib.request.Request(
        target + "/api/deepseek-construtor/entregar-resposta",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            if r.status == 404:
                log("  rota /entregar-resposta nao encontrada (roteacao nao registrada?)", "warn")
            else:
                log(f"  POST /entregar-resposta -> HTTP {r.status}", "ok")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            log("  rota /entregar-resposta nao encontrada - o routes.js nao foi registrado?", "warn")
        else:
            log(f"  POST /entregar-resposta -> HTTP {e.code} ({e.read()[:200]})", "warn")
    except Exception as e:
        log(f"  POST /entregar-resposta falhou: {e}", "warn")

    try:
        with urllib.request.urlopen(target + "/api/deepseek-construtor/ultima-resposta", timeout=5) as r:
            if r.status == 404:
                log("  GET /ultima-resposta nao encontrada.", "warn")
            else:
                log(f"  GET /ultima-resposta -> HTTP {r.status}", "ok")
    except Exception as e:
        log(f"  GET /ultima-resposta falhou: {e}", "warn")

    return True


def open_browser(port=3000):
    url = f"http://localhost:{port}"
    log(f"Abrindo {url} ...", "info")
    try:
        webbrowser.open(url)
    except Exception:
        log("Nao foi possivel abrir o navegador automaticamente. Abra manualmente.", "warn")


def start_server(port=3000, do_build=False, open_after=True):
    if do_build:
        build_prod()
    log("Iniciando o servidor OpenChamber...", "step")
    log(f"Acesse: http://localhost:{port}", "info")
    print("Pressione Ctrl+C para parar.")
    # Start server in a child process so we can run smoke test while it runs
    env = dict(os.environ)
    env.setdefault("OPENCODE_SKIP_START", "true")
    cmd = ["bun", "packages/web/server/index.js", "--port", str(port)]
    try:
        proc = subprocess.Popen(cmd, cwd=ROOT, env=env)
    except Exception as e:
        log(f"Nao foi possivel iniciar o servidor: {e}", "error")
        sys.exit(1)

    # Wait for health
    for attempt in range(12):
        time.sleep(1)
        try:
            import urllib.request
            with urllib.request.urlopen(f"http://localhost:{port}/health", timeout=2) as r:
                if r.status == 200:
                    break
        except Exception:
            continue
    else:
        log("Servidor nao respondeu em 12s. Veja o log do processo.", "warn")

    smoke_test(port)
    if open_after:
        open_browser(port)

    print()
    log("Servidor rodando. Para parar, pressione Ctrl+C aqui.", "info")
    try:
        proc.wait()
    except KeyboardInterrupt:
        log("Servidor parado pelo usuario.", "info")
        try:
            proc.terminate()
        except Exception:
            pass


def main():
    parser = argparse.ArgumentParser(
        description="Instalador e orquestrador do Construtor de Codigo DeepSeek para OpenChamber"
    )
    parser.add_argument("--install-only", action="store_true", help="Apenas instala, nao inicia")
    parser.add_argument("--start-only", action="store_true", help="Apenas inicia")
    parser.add_argument("--build", action="store_true", help="Faz build de producao antes de iniciar")
    parser.add_argument("--port", type=int, default=3000, help="Porta do servidor (padrao 3000)")
    parser.add_argument("--no-open", action="store_true", help="Nao abre o navegador automaticamente")
    args = parser.parse_args()

    print(f"\n{c('=' * 60, 'bold')}")
    print(f"{c('  DeepSeek Construtor de Codigo Local - Instalador', 'bold')}")
    print(f"{c('=' * 60, 'bold')}\n")

    if args.start_only:
        check_system()
        verify_integration_files()
        check_bridge()
        check_env()
        start_server(port=args.port, do_build=args.build, open_after=not args.no_open)
        return

    check_system()
    check_node_version()
    create_env()
    verify_integration_files()
    check_bridge()
    install_bun_deps()
    check_env()

    print(f"\n{c('=' * 60, 'bold')}")
    print(f"{c('  Instalacao concluida com sucesso!', 'green')}")
    print(f"{c('=' * 60, 'bold')}\n")

    log("Proximos passos:", "step")
    print("  1. Edite o .env e preencha sua OPENROUTER_API_KEY (modelo padrao: cohere/north-mini-code:free)")
    print(f"  2. Rode: python start.py --start-only --build (opcional) --port {args.port}")
    print(f"  3. Instale o userscript Tampermonkey (veja abaixo)")
    print(f"  4. Acesse: http://localhost:{args.port}")
    print()

    tampermonkey_hint(port=args.port)

    if not args.install_only:
        try:
            resp = input("Deseja iniciar o servidor agora? (s/n): ").strip().lower()
        except EOFError:
            resp = "n"
        if resp in ("s", "sim", "y", "yes", ""):
            start_server(port=args.port, do_build=args.build, open_after=not args.no_open)
        else:
            log("Servidor nao iniciado. Rode quando estiver pronto.", "info")


if __name__ == "__main__":
    main()
