// ==UserScript==
// @name         DeepSeek Chat no OpenChamber
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Traz o chat do DeepSeek para dentro do OpenChamber (Web/PWA) via iframe + postMessage
// @author       Você
// @match        *://localhost:*
// @match        *://127.0.0.1:*
// @match        *://*.openchamber.dev/*
// @match        *://openchamber.dev/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // CONFIGURAÇÃO: coloque aqui o link do chat do DeepSeek (ex: https://chat.deepseek.com)
    const DEEPSEEK_URL = __DEEPSEEK_URL__ || 'https://chat.deepseek.com';

    // Seletor da área onde injetar o painel (ajuste conforme o DOM do OpenChamber)
    const PAINEL_ID = 'deepseek-chat-panel';
    const BTN_ID = 'deepseek-enviar-construtor';

    let painel = null;
    let iframe = null;
    let appBridge = null; // referência para a app OpenChamber (setada via postMessage)

    function criarEstilos() {
        const css = `
            #${PAINEL_ID} {
                position: fixed;
                top: 0;
                right: 0;
                width: 420px;
                height: 100vh;
                background: #1a1a1a;
                border-left: 1px solid #333;
                z-index: 2147483647;
                display: flex;
                flex-direction: column;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                box-shadow: -4px 0 12px rgba(0,0,0,0.4);
            }
            #${PAINEL_ID} .header {
                padding: 12px 16px;
                background: #0f0f0f;
                border-bottom: 1px solid #333;
                font-weight: 700;
                color: #fff;
                font-size: 14px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            #${PAINEL_ID} .header .fechar {
                cursor: pointer;
                color: #666;
            }
            #${PAINEL_ID} iframe {
                flex: 1;
                width: 100%;
                border: none;
                background: #0f0f0f;
            }
            #${PAINEL_ID} .barra-acoes {
                padding: 10px 16px;
                background: #1a1a1a;
                border-top: 1px solid #333;
                display: flex;
                gap: 8px;
            }
            #${BTN_ID} {
                flex: 1;
                padding: 8px 12px;
                background: #2563eb;
                color: #fff;
                border: none;
                border-radius: 6px;
                font-size: 13px;
                cursor: pointer;
                font-weight: 600;
            }
            #${BTN_ID}:hover { background: #3b82f6; }
            #${BTN_ID}:disabled { background: #444; cursor: not-allowed; }
            #deepseek-toggle {
                position: fixed;
                top: 120px;
                right: 0;
                background: #2563eb;
                color: #fff;
                border: none;
                border-radius: 8px 0 0 8px;
                padding: 8px 12px;
                cursor: pointer;
                z-index: 2147483647;
                font-size: 12px;
                writing-mode: vertical-rl;
                transform: rotate(180deg);
            }
            #deepseek-toggle:hover { background: #3b82f6; }
        `;
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }

    function criarToggle() {
        const btn = document.createElement('button');
        btn.id = 'deepseek-toggle';
        btn.title = 'Abrir/fechar chat DeepSeek';
        btn.textContent = 'DeepSeek';
        btn.onclick = () => {
            if (painel) {
                painel.style.display = painel.style.display === 'none' ? 'flex' : 'none';
            } else {
                abrirPainel();
            }
        };
        document.body.appendChild(btn);
    }

    function abrirPainel() {
        if (painel) {
            painel.style.display = 'flex';
            return;
        }

        painel = document.createElement('div');
        painel.id = PAINEL_ID;
        painel.innerHTML = `
            <div class="header">
                <span>💬 DeepSeek Chat</span>
                <span class="fechar" title="Fechar">✕</span>
            </div>
            <iframe src="${DEEPSEEK_URL}" allow="clipboard-write"></iframe>
            <div class="barra-acoes">
                <button id="${BTN_ID}">Enviar para Construtor de Código</button>
            </div>
        `;

        painel.querySelector('.fechar').onclick = () => {
            painel.style.display = 'none';
        };

        document.body.appendChild(painel);
        iframe = painel.querySelector('iframe');

        const btnConstrutor = painel.querySelector(`#${BTN_ID}`);
        btnConstrutor.onclick = () => solicitarRespostaDeepSeek();
    }

    // Aguarda o iframe carregar e tenta extrair a última mensagem do DeepSeek via postMessage
    function solicitarRespostaDeepSeek() {
        const btn = painel.querySelector(`#${BTN_ID}`);
        btn.disabled = true;
        btn.textContent = 'Aguardando DeepSeek...';

        if (!iframe || !iframe.contentWindow) {
            btn.disabled = false;
            btn.textContent = 'Enviar para Construtor de Código';
            return;
        }

        // Pede ao iframe (se for mesma origem, o que não é o caso do chat.deepseek.com)
        // Como é cross-origin, não podemos ler o DOM do iframe diretamente.
        // Solução: injetar um script no iframe via src com parâmetro ou usar uma extensão
        // de mensagem. Como fallback, abrimos um prompt para o usuário colar a resposta.
        //
        // NOTA: chat.deepseek.com é cross-origin. Leitura direta do DOM é bloqueada
        // pelo navegador. Para automação real, use a API oficial do DeepSeek ou
        // uma extensão de navegador com permissões adequadas.
        btn.disabled = false;
        btn.textContent = 'Enviar para Construtor de Código';

        const resposta = prompt('Cole aqui a resposta importante do DeepSeek que deseja transformar em código:');
        if (resposta && resposta.trim()) {
            enviarParaConstrutor(resposta.trim());
        }
    }

    function enviarParaConstrutor(texto) {
        // Comunica com a app OpenChaber via window.postMessage (se a app estiver ouvindo)
        // e dispara um evento customizado no document para o botão do OpenChamber capturar.
        const evento = new CustomEvent('deepseek-resposta', {
            detail: { texto, timestamp: new Date().toISOString() }
        });
        document.dispatchEvent(evento);

        // Também tenta postMessage para a janela principal (útil se o userscript
        # ignorar
        window.parent?.postMessage?.({ tipo: 'deepseek-resposta', texto }, '*');

        alert('Resposta enviada para o Construtor de Código. Verifique o painel de construção no OpenChamber.');
    }

    // Escuta mensagens da app OpenChaber (ex: para buscar contexto do projeto)
    window.addEventListener('message', (ev) => {
        if (ev.data && ev.data.tipo === 'solicitar-contexto-projeto') {
            // Responderia com o caminho/contexto se a app expusesse
            ev.source?.postMessage({ tipo: 'contexto-projeto', origem: 'deepseek-userscript' }, '*');
        }
    }, false);

    criarEstilos();
    criarToggle();

})();

