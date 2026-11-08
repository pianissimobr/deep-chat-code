#!/usr/bin/env python3
"""
tree-content-generator - WRAPPER NÃO INTERATIVO
Gera um arquivo Markdown com a árvore de diretórios e transcrição dos arquivos
de um diretório, pronto para ser consumido pelo Construtor de Código do OpenChamber.

Uso:
    python gerador_auto.py <diretorio> [saida.md] [--max-lines N] [--max-size MB]

Este wrapper remove todas as perguntas interativas do gerador original e roda em modo lote.
"""

import io
import os
import sys
import stat
import zipfile
import tarfile
import gzip
import bz2
import lzma
from datetime import datetime

# =========================
# CONFIGURAÇÕES (ajuste aqui)
# =========================
MAX_FILE_SIZE = 5 * 1024 * 1024          # 5 MB por arquivo de texto
MAX_TREE_DEPTH = None                    # None = ilimitado
INCLUDE_HIDDEN = False                   # pular arquivos/pastas ocultas (.git, etc.)
DEFAULT_OUTPUT = "estrutura_projeto.md"

TEXT_EXTENSIONS = {
    '.py', '.pyw', '.pyi', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
    '.rb', '.go', '.rs', '.java', '.kt', '.kts', '.scala',
    '.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx',
    '.cs', '.swift', '.php', '.pl', '.pm', '.t', '.pod', '.raku',
    '.lua', '.r', '.rmd', '.rnw', '.rprofile', '.jl', '.ipynb',
    '.dart', '.groovy', '.gradle', '.m',
    '.lisp', '.cl', '.el', '.rkt', '.scm',
    '.clj', '.cljs', '.cljc', '.ex', '.exs',
    '.vhd', '.vhdl', '.v', '.sv', '.svh', '.vlog',
    '.tcl', '.tk', '.expect',
    '.html', '.htm', '.xhtml', '.xml', '.svg', '.vue', '.svelte',
    '.css', '.scss', '.sass', '.less', '.styl',
    '.json', '.json5', '.hjson', '.yaml', '.yml', '.toml',
    '.ini', '.cfg', '.conf', '.config', '.properties',
    '.csv', '.tsv', '.tab', '.psv',
    '.sql', '.ddl', '.dml',
    '.log', '.out', '.err',
    '.txt', '.md', '.markdown', '.rst', '.adoc', '.asciidoc',
    '.org', '.wiki', '.tex', '.bib', '.sty', '.cls', '.ltx',
    '.sh', '.bash', '.zsh', '.fish', '.ksh', '.csh',
    '.gitignore', '.gitattributes', '.dockerignore',
    '.eslintignore', '.prettierignore',
    '.env', '.editorconfig', '.bashrc', '.zshrc', '.vimrc', '.inputrc',
}

SKIP_DIRS = {'.git', '.svn', '.hg', 'node_modules', '__pycache__', '.next', 'dist', 'build', '.turbo', '.vercel'}


def eh_oculto(caminho):
    base = os.path.basename(caminho)
    return base.startswith('.')


def eh_diretorio_ignorado(nome):
    return nome in SKIP_DIRS


def eh_texto(path):
    if not os.path.isfile(path):
        return False
    ext = os.path.splitext(path)[1].lower()
    if ext in TEXT_EXTENSIONS:
        return True
    try:
        with open(path, 'rb') as f:
            chunk = f.read(1024)
        try:
            chunk.decode('utf-8')
            return True
        except UnicodeDecodeError:
            return b'\0' not in chunk
    except OSError:
        return False


def ler_conteudo(path, max_lines=None, max_size=MAX_FILE_SIZE):
    try:
        tam = os.path.getsize(path)
        if tam > max_size:
            return f"[⚠️ Arquivo grande ({tam / 1024:.1f} KB) — não transcrito]"
        with open(path, 'rb') as fb:
            if b'\0' in fb.read(2048):
                return "[⚠️ Conteúdo binário — não transcrito]"
        for enc in ('utf-8', 'latin-1', 'cp1252'):
            try:
                with open(path, 'r', encoding=enc) as f:
                    if max_lines:
                        linhas = []
                        for i, ln in enumerate(f):
                            if i >= max_lines:
                                linhas.append(f"... ({max_lines} linhas mostradas)")
                                break
                            linhas.append(ln.rstrip('\n'))
                        return '\n'.join(linhas)
                    return f.read()
            except UnicodeDecodeError:
                continue
        return "[⚠️ Não foi possível decodificar]"
    except PermissionError:
        return "[⚠️ Sem permissão]"
    except OSError as e:
        return f"[❌ Erro: {e}]"


def linguagem(ext):
    mapa = {
        'py': 'python', 'js': 'javascript', 'ts': 'typescript', 'tsx': 'tsx',
        'jsx': 'jsx', 'json': 'json', 'yaml': 'yaml', 'yml': 'yaml', 'toml': 'toml',
        'md': 'markdown', 'html': 'html', 'css': 'css', 'scss': 'scss',
        'sh': 'bash', 'bash': 'bash', 'c': 'c', 'cpp': 'cpp', 'h': 'c',
        'rs': 'rust', 'go': 'go', 'java': 'java', 'rb': 'ruby', 'php': 'php',
        'sql': 'sql', 'xml': 'xml', 'vue': 'vue', 'svelte': 'svelte',
        'txt': 'text', 'log': 'log', 'ini': 'ini', 'cfg': 'ini',
    }
    return mapa.get(ext.lstrip('.').lower(), 'text')


def gerar_arvore(root, prefix="", profundidade=0, linhas=None):
    if linhas is None:
        linhas = []
    if MAX_TREE_DEPTH is not None and profundidade > MAX_TREE_DEPTH:
        return linhas
    try:
        entradas = sorted(os.listdir(root))
    except OSError:
        return linhas
    entradas = [e for e in entradas if not (eh_oculto(e) and not INCLUDE_HIDDEN)
                and not eh_diretorio_ignorado(e)]
    for i, nome in enumerate(entradas):
        caminho = os.path.join(root, nome)
        ultimo = (i == len(entradas) - 1)
        conector = "└── " if ultimo else "├── "
        if os.path.isdir(caminho):
            linhas.append(f"{prefix}{conector}📁 {nome}/")
            ext_prefix = prefix + ("    " if ultimo else "│   ")
            gerar_arvore(caminho, ext_prefix, profundidade + 1, linhas)
        else:
            linhas.append(f"{prefix}{conector}📄 {nome}")
    return linhas


def gerar_md(root, saida, max_lines=None):
    root = os.path.abspath(root)
    nome_projeto = os.path.basename(root) or root
    agora = datetime.now().astimezone().strftime("%a %d %b %Y %H:%M:%S %z")

    linhas = []
    linhas.append(f"# 📁 Estrutura do Projeto: `{nome_projeto}`")
    linhas.append(f"_Gerado em: {agora}_\n")
    linhas.append("## Árvore de Diretórios")
    linhas.append("```")
    linhas.extend(gerar_arvore(root))
    linhas.append("```\n")

    linhas.append("## Conteúdo dos Arquivos")

    # Coleta arquivos
    arquivos = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if not eh_diretorio_ignorado(d)
                       and not (eh_oculto(d) and not INCLUDE_HIDDEN)]
        for fn in filenames:
            if eh_oculto(fn) and not INCLUDE_HIDDEN:
                continue
            caminho = os.path.join(dirpath, fn)
            if eh_texto(caminho):
                arquivos.append(caminho)
    arquivos.sort()

    for caminho in arquivos:
        rel = os.path.relpath(caminho, root)
        conteudo = ler_conteudo(caminho, max_lines=max_lines)
        ext = os.path.splitext(caminho)[1]
        lang = linguagem(ext)
        linhas.append(f"### 📄 `{rel}`")
        linhas.append(f"```{lang}")
        linhas.append(conteudo)
        linhas.append("```\n")

    saida = os.path.abspath(saida)
    with open(saida, 'w', encoding='utf-8') as f:
        f.write('\n'.join(linhas))
    return saida, len(arquivos)


def main():
    if len(sys.argv) < 2:
        print("Uso: python gerador_auto.py <diretorio> [saida.md] [--max-lines N]")
        sys.exit(1)

    diretorio = sys.argv[1]
    if not os.path.isdir(diretorio):
        print(f"❌ Diretório não encontrado: {diretorio}")
        sys.exit(1)

    saida = DEFAULT_OUTPUT
    max_lines = None
    args = sys.argv[2:]
    i = 0
    while i < len(args):
        if args[i] == '--max-lines' and i + 1 < len(args):
            max_lines = int(args[i + 1])
            i += 2
        else:
            saida = args[i]
            i += 1

    try:
        caminho_saida, total = gerar_md(diretorio, saida, max_lines=max_lines)
        print(f"✅ Gerado: {caminho_saida}")
        print(f"📄 Arquivos transcritos: {total}")
    except Exception as e:
        print(f"❌ Erro ao gerar: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
