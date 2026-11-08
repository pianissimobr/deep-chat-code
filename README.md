# DeepSeek Construtor de Código Local

Ferramenta que traz o chat do DeepSeek para dentro do OpenChamber (Web/PWA via Tampermonkey), gera uma árvore estruturada de arquivos do projeto e executa um loop: DeepSeek -> IA menor (OpenAI) escreve o código -> roda localmente -> se der erro, envia feedback de volta ao DeepSeek.

## Estrutura

```
deepseek-construtor-openchamber/
├── README.md                    # este arquivo
├── .env.example                 # variáveis de ambiente (copie para .env)
├── PLANO.md                     # plano detalhado do projeto
├── userscript/
│   └── deepseek-chat.user.js    # Tampermonkey: injeta chat do DeepSeek no OpenChamber
├── python/
│   ├── gerador_auto.py          # gera estrutura_projeto.md (árvore + conteúdo dos arquivos)
│   └── construtor.py            # loop OpenAI -> escrita -> execução -> feedback DeepSeek
├── server/
│   └── routes.js                # rotas API do OpenChamber (gerar-arvore, executar)
└── openchamber-mods/
    ├── server/index.js          # servidor OpenChamber (com registro de rotas)
    └── ui/
        ├── ChatMessage.tsx      # injeção do botão "Construir código"
        ├── useDeepSeekConstrutor.ts   # hook que chama as APIs
        └── DeepSeekConstrutorAction.tsx  # monta a ação extra da mensagem
```

## Pré-requisitos

- OpenChammer clonado (fork de `openchamber/openchamber`)
- Python 3 instalado no servidor
- Chave da OpenAI (`OPENAI_API_KEY`) para o modelo menor
- Tampermonkey instalado no navegador (Web/PWA do OpenChamber)

## 1. Variáveis de ambiente

Copie `.env.example` para `.env` e preencha:

```
OPENAI_API_KEY=sk-...
DEEPSEEK_URL=https://chat.deepseek.com
PYTHON_PATH=python3
WORKSPACE_CONSTRUTOR=./workspace_construtor
```

## 2. Aplicar mudanças no OpenChamber

### Servidor (packages/web/server/)

1. Copie `server/routes.js` para `packages/web/server/lib/deepseek-construtor/routes.js`
2. Copie `python/gerador_auto.py` e `python/construtor.py` para `packages/web/server/lib/deepseek-construtor/python/`
3. Em `packages/web/server/index.js`:
   - Adicione a importação: `import { registerDeepSeekConstrutorRoutes } from './lib/deepseek-construtor/routes.js';`
   - Após `const app = express();`, adicione: `registerDeepSeekConstrutorRoutes(app);`

### UI (packages/ui/src/components/chat/)

1. Copie `openchamber-mods/ui/useDeepSeekConstrutor.ts` para `packages/ui/src/components/chat/deepseek-construtor/useDeepSeekConstrutor.ts`
2. Copie `openchamber-mods/ui/DeepSeekConstrutorAction.tsx` para `packages/ui/src/components/chat/deepseek-construtor/DeepSeekConstrutorAction.tsx`
3. Em `packages/ui/src/components/chat/ChatMessage.tsx`:
   - Adicione as importações do hook e do `montarDeepSeekConstrutorAction`
   - Instancie `useDeepSeekConstrutor()` e monte a ação extra para mensagens do assistente
   - Passe `deepSeekConstrutorExtra` dentro de `extraActionsComConstrutor`

### i18n

Adicione as chaves a todos os arquivos de idioma em `packages/ui/src/lib/i18n/messages/`:
- `chat.messageBody.actions.construirCodigo`
- `chat.messageBody.actions.construindo`

## 3. Userscript Tampermonkey

1. Instale a extensão Tampermonkey no navegador.
2. Crie um novo userscript e cole o conteúdo de `userscript/deepseek-chat.user.js`.
3. Edite a constante `DEEPSEEK_URL` no topo do arquivo com o link do chat do DeepSeek (ex: `https://chat.deepseek.com`).
4. Acesse o OpenChamber (Web/PWA) — aparecerá um painel lateral com o chat do DeepSeek e um botão "Enviar para Construtor de Código".

## 4. Como usar

1. Abra o OpenChamber no navegador (Web/PWA).
2. No painel do DeepSeek, cole ou escreva algo importante que queira transformar em código.
3. Clique no botão do userscript para copiar a resposta do DeepSeek.
4. No OpenChamber, na mensagem do assistente, clique em "🛠️ Construir código".
5. O sistema:
   - Gera a árvore de arquivos do projeto (`estrutura_projeto.md`)
   - Envia a resposta do DeepSeek + contexto para a IA menor (OpenAI)
   - Escreve o código gerado num arquivo local
   - Executa o comando
   - Se der erro, monta feedback e pede correção ao DeepSeek (usuário reinjeta a resposta)
   - Repete até sucesso ou limite de 5 iterações

## Segurança

- Execução restrita ao diretório de `workspace` da sessão.
- Comandos perigosos bloqueados: `sudo`, `rm -rf`, `curl`, `wget`, `ssh`, `nc`, `chmod +x`, etc.
- Timeout rígido por execução.
- Nunca commite chaves de API; use `.env` local (não versionado).

## Licença

MIT
