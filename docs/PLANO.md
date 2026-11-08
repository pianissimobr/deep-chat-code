# Plano — Construtor de Código Local (DeepSeek + OpenChamber)

## Status das etapas (todas concluídas)

- [x] 1. Repositório base clonado: `openchamber/openchamber` em `/home/kombi/projetos/deepseek-web-local/openchamber`. Fork a ser feito manualmente no GitHub.
- [x] 2. Tampermonkey: userscript `deepseek-construtor/userscript/deepseek-chat.user.js` criado. Injeta iframe do chat do DeepSeek + painel lateral com botão "Enviar para Construtor de Código". Usa apenas o site (sem API oficial). Campo `DEEPSEEK_URL` no topo para colocar o link.
- [x] 3. Gerador de árvore em Python: `packages/web/server/lib/deepseek-construtor/python/gerador_auto.py` (versão não interativa do tree-content-generator). Gera `estrutura_projeto.md` com árvore + transcrição dos arquivos de texto.
- [x] 4. Loop IA: `packages/web/server/lib/deepseek-construtor/python/construtor.py`. Fluxo: DeepSeek (usuário cola resposta) → OpenAI modelo menor (gpt-4o-mini padrão, campo aberto) → escreve código local → executa (sandbox, timeout 600s na rota, 120s por comando) → se erro, monta feedback e pede correção ao DeepSeek → repete até sucesso ou limite de 5 iterações.
- [x] 5. Integração OpenChamber implementada diretamente no clone:
  - `packages/web/server/lib/deepseek-construtor/routes.js` — rotas `POST /api/deepseek-construtor/gerar-arvore` e `POST /api/deepseek-construtor/executar`.
  - `packages/web/server/index.js` — import + `registerDeepSeekConstrutorRoutes(app)` após `const app = express()`.
  - `packages/ui/src/components/chat/deepseek-construtor/useDeepSeekConstrutor.ts` — hook que chama as APIs via `runtimeFetch`.
  - `packages/ui/src/components/chat/deepseek-construtor/DeepSeekConstrutorAction.tsx` — monta `MessageExtraAction` "Construir código".
  - `packages/ui/src/components/chat/ChatMessage.tsx` — injeta a ação extra em mensagens do assistente.
  - `packages/ui/src/lib/i18n/messages/*.ts` — strings `construirCodigo` / `construindo` adicionadas a en + todos os idiomas (es, ja, ko, pl, pt-BR, uk, zh-CN, zh-TW, he).
- [x] Build do pacote web: `bun run --cwd packages/web build` passou com sucesso (sem erros de compilação).
- [x] `node --check` nas rotas do servidor: OK.

## Arquivos criados/modificados no clone do OpenChamber

```
packages/web/server/lib/deepseek-construtor/
├── routes.js                  # Rotas da API (gerar-arvore, executar)
├── python/
│   ├── gerador_auto.py        # Wrapper não interativo do tree-content-generator
│   └── construtor.py          # Loop OpenAI → execução → feedback DeepSeek
packages/web/server/index.js   # + import e registerDeepSeekConstrutorRoutes(app)
packages/ui/src/components/chat/deepseek-construtor/
├── useDeepSeekConstrutor.ts   # Hook runtimeFetch das APIs
└── DeepSeekConstrutorAction.tsx  # Monta MessageExtraAction
packages/ui/src/components/chat/ChatMessage.tsx   # + injeção da ação extra
packages/ui/src/lib/i18n/messages/en.ts + 9 idiomas  # strings i18n
```

## Arquivos de suporte (fora do clone, em deepseek-construtor/)

```
deepseek-construtor/
├── userscript/deepseek-chat.user.js   # Tampermonkey (site DeepSeek via iframe)
├── .env.example                       # Variáveis de ambiente
└── PLANO.md                           # Este arquivo
```

## Como usar (resumo)

1. Faça fork do `openchamber/openchamber` no GitHub e aplique as mudanças acima ao seu fork.
2. Instale o userscript `deepseek-chat.user.js` no Tampermonkey (Web/PWA do OpenChamber).
3. Edite `DEEPSEEK_URL` no userscript com o link do chat do DeepSeek.
4. Defina `OPENAI_API_KEY` no ambiente ou `.env` do servidor OpenChamber.
5. No chat do DeepSeek, copie a resposta importante, clique no botão do userscript, cole a resposta.
6. No OpenChamber, clique em "🛠️ Construir código" na mensagem do assistente → gera a árvore do projeto → roda o loop OpenAI → executa localmente → exibe o resultado.

## Segurança

- Execução restrita ao diretório de `workspace` da sessão.
- Comandos perigosos bloqueados (sudo, rm -rf, curl, wget, ssh, nc, chmod +x, etc.).
- Timeout rígido de execução.
- Nunca commite chaves de API; use `.env` local (não versionado).
