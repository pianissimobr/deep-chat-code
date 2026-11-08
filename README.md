# DeepSeek Construtor de Código Local

Ferramenta que traz o chat do DeepSeek para dentro do OpenChamber (injetado nativamente na UI, sem extensões externas), gera uma árvore estruturada de arquivos do projeto e executa um loop: DeepSeek → IA menor (OpenAI) escreve o código → roda localmente → se der erro, envia feedback de volta ao DeepSeek.

## Estrutura

```
deepseek-construtor-openchamber/
├── README.md                    # este arquivo
├── .env.example                 # variáveis de ambiente (copie para .env)
├── PLANO.md                     # plano detalhado do projeto
├── userscript/
│   └── deepseek-chat.user.js    # Tampermonkey: alternativa legacy (não obrigatório)
├── python/
│   ├── gerador_auto.py          # gera estrutura_projeto.md (árvore + conteúdo dos arquivos)
│   └── construtor.py            # loop OpenAI → escrita → execução → feedback DeepSeek
├── server/
│   └── routes.js                # rotas API do OpenChamber (gerar-arvore, executar)
└── openchamber-mods/
    ├── server/index.js          # servidor OpenChamber (com registro de rotas)
    └── ui/
        ├── ChatMessage.tsx      # injeção do botão "Construir código"
        ├── useDeepSeekConstrutor.ts   # hook que chama as APIs
        ├── DeepSeekConstrutorAction.tsx  # monta a ação extra da mensagem
        └── DeepSeekPanel.tsx    # painel nativo com iframe do chat do DeepSeek
```

## Pré-requisitos

- OpenChamber clonado (fork de `openchamber/openchamber`)
- Python 3 instalado no servidor
- Chave da OpenAI (`OPENAI_API_KEY`) para o modelo menor
- Navegador (Web/PWA do OpenChamber) — **não é necessário instalar Tampermonkey**

## 1. Variáveis de ambiente

Copie `.env.example` para `.env` e preencha:

```
OPENAI_API_KEY=sk-...
DEEPSEEK_URL=https://chat.deepseek.com
PYTHON_PATH=python3
WORKSPACE_CONSTRUTOR=./workspace_construtor
```

## 2. Aplicar mudanças no OpenChamber

### Servidor (`packages/web/server/`)

1. Copie `server/routes.js` para `packages/web/server/lib/deepseek-construtor/routes.js`
2. Copie `python/gerador_auto.py` e `python/construtor.py` para `packages/web/server/lib/deepseek-construtor/python/`
3. Em `packages/web/server/index.js`:
   - Adicione a importação: `import { registerDeepSeekConstrutorRoutes } from './lib/deepseek-construtor/routes.js';`
   - Após `const app = express();`, adicione: `registerDeepSeekConstrutorRoutes(app);`

### UI (`packages/ui/src/components/`)

1. Copie os arquivos para `packages/ui/src/components/chat/deepseek-construtor/`:
   - `useDeepSeekConstrutor.ts`
   - `DeepSeekConstrutorAction.tsx`
   - `DeepSeekPanel.tsx`
2. Copie `openchamber-mods/ui/ChatMessage.tsx` para `packages/ui/src/components/chat/ChatMessage.tsx`
3. Copie `openchamber-mods/ui/MainLayout.tsx` para `packages/ui/src/components/layout/MainLayout.tsx`

   Em `MainLayout.tsx`, o `<DeepSeekPanel />` já está renderizado dentro do `<main>`, ao lado do `<ChatView />`.

### i18n

Adicione as chaves a todos os arquivos de idioma em `packages/ui/src/lib/i18n/messages/`:
- `chat.messageBody.actions.construirCodigo`
- `chat.messageBody.actions.construindo`
- `chat.deepseekPanel.toggleTitle`
- `chat.deepseekPanel.closePanel`
- `chat.deepseekPanel.pin`
- `chat.deepseekPanel.unpin`
- `chat.deepseekPanel.close`
- `chat.deepseekPanel.copyResponse`

## 3. Como usar

1. Abra o OpenChamber no navegador (Web/PWA).
2. Aparecerá um botão flutuante azul com ícone de código no canto inferior direito. Clique para abrir o painel do chat do DeepSeek.
3. Converse com o DeepSeek normalmente dentro do painel.
4. Quando o DeepSeek enviar algo importante, clique em **"🛠️ Construir código"** na mensagem do assistente.
5. O sistema:
   - Gera a árvore de arquivos do projeto (`estrutura_projeto.md`)
   - Envia a resposta do DeepSeek + contexto para a IA menor (OpenAI)
   - Escreve o código gerado num arquivo local
   - Executa o comando
   - Se der erro, monta feedback e pede correção ao DeepSeek (usuário reinjeta a resposta)
   - Repete até sucesso ou limite de 5 iterações

### Alternativa: Userscript Tampermonkey (legacy)

Se preferir não usar o painel nativo, pode instalar o userscript em `userscript/deepseek-chat.user.js` via Tampermonkey. Isso injeta o chat do DeepSeek via iframe externo. **Não é necessário se você já aplicou o `DeepSeekPanel` acima.**

## Segurança

- Execução restrita ao diretório de `workspace` da sessão.
- Comandos perigosos bloqueados: `sudo`, `rm -rf`, `curl`, `wget`, `ssh`, `nc`, `chmod +x`, etc.
- Timeout rígido por execução.
- Nunca commite chaves de API; use `.env` local (não versionado).

## Licença

MIT
