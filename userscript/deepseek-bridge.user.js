// ==UserScript==
// @name         DeepSeek to OpenChamber Bridge
// @namespace    http://tampermonkey.net/
// @version      2.0.0
// @description  Roda em chat.deepseek.com: detecta a ultima resposta e envia para o painel do OpenChamber
// @author       local
// @match        https://chat.deepseek.com/*
// @connect      localhost
// @connect      127.0.0.1
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const PANEL_PATHS = ['/api/deepseek-construtor/entregar-resposta'];

  const CANDIDATES = ['localhost', '127.0.0.1'];

  // Seletores comuns de mensagens do DeepSeek (podem mudar).
  // A estrategia: tentar varios seletores e, se nao achar, usar a ultima area de texto visivel.
  const MESSAGE_SELECTORS = [
    '[data-testid*="message"]',
    '[class*="message"]',
    '[class*="response"]',
    '[class*="markdown"]',
    'main div',
  ];

  function log(...args) {
    console.log('[deepseek-bridge]', ...args);
  }

  function getLastMessageText() {
    for (const sel of MESSAGE_SELECTORS) {
      const nodes = Array.from(document.querySelectorAll(sel)).filter((el) => {
        if (!(el instanceof HTMLElement)) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width < 10 || rect.height < 10) return false;
        const text = (el.innerText || el.textContent || '').trim();
        if (text.length < 20) return false;
        // Ignora inputs e o proprio botao
        if (el.closest('#deepseek-bridge-ui')) return false;
        return true;
      });
      if (nodes.length) {
        const last = nodes[nodes.length - 1];
        const text = (last.innerText || last.textContent || '').trim();
        if (text) return text;
      }
    }
    // Fallback: ultima area longa de texto na pagina
    const paras = Array.from(document.querySelectorAll('p, pre, code, div')).filter((el) => {
      if (!(el instanceof HTMLElement)) return false;
      const text = (el.innerText || el.textContent || '').trim();
      return text.length > 200 && !el.closest('#deepseek-bridge-ui');
    });
    if (paras.length) return (paras[paras.length - 1].innerText || paras[paras.length - 1].textContent || '').trim();
    return '';
  }

  function enviarParaOpenChamber(texto) {
    const payload = JSON.stringify({ text: texto });
    const headers = { 'Content-Type': 'application/json' };

    // 1) GM_xmlhttpRequest — funciona mesmo com CORS, se @connect estiver liberado.
    if (typeof GM_xmlhttpRequest === 'function') {
      let tentativas = 0;
      const tentar = () => {
        if (tentativas >= CANDIDATES.length) {
          log('GM_xmlhttpRequest falhou em todos os hosts, tentando postMessage e clipboard');
          enviarViaPostMessage(texto);
          return;
        }
        const host = CANDIDATES[tentativas++];
        GM_xmlhttpRequest({
          method: 'POST',
          url: `http://${host}:3001${PANEL_PATHS[0]}`,
          headers,
          data: payload,
          timeout: 8000,
          onload: (res) => {
            if (res.status >= 200 && res.status < 300) {
              log('Entrega com sucesso em', host);
              toast('Resposta enviada para o OpenChamber', 'ok');
            } else {
              log('Falha em', host, res.status, res.responseText);
              tentar();
            }
          },
          onerror: (err) => {
            log('Erro GM_xmlhttpRequest em', host, err);
            tentar();
          },
          ontimeout: () => {
            log('Timeout em', host);
            tentar();
          },
        });
      };
      tentar();
      return;
    }

    enviarViaPostMessage(texto);
  }

  function enviarViaPostMessage(texto) {
    // Fallback: tenta postMessage para opener (quando o DeepSeek foi aberto
    // em nova guia a partir do painel do OpenChamber). O painel escuta
    // `message` events com { tipo: 'deepseek-resposta', text }.
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ tipo: 'deepseek-resposta', text: texto }, '*');
        log('postMessage enviado para opener');
        toast('Resposta enviada via postMessage', 'ok');
        return;
      }
    } catch (e) {
      log('postMessage falhou', e);
    }
    // 2) Grava no clipboard para cola manual no painel do OpenChamber.
    try {
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(texto, { type: 'text', mimetype: 'text/plain' });
      } else if (navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(texto);
      }
    } catch (e) {
      log('clipboard falhou', e);
    }
    toast('Copiado. Cole no painel do OpenChamber (DeepSeek Construtor).', 'warn');
  }

  function toast(msg, kind) {
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = [
      'position:fixed', 'left:16px', 'bottom:16px', 'z-index:2147483647',
      'background:' + (kind === 'ok' ? '#14532d' : '#713f12'),
      'color:#fff', 'padding:10px 14px', 'border-radius:10px',
      'font:13px/1.4 system-ui,sans-serif', 'box-shadow:0 6px 24px rgba(0,0,0,.35)',
    ].join(';');
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  function criarUI() {
    if (document.getElementById('deepseek-bridge-ui')) return;

    const style = document.createElement('style');
    style.textContent = `
      #deepseek-bridge-ui {
        position: fixed; right: 16px; bottom: 16px; z-index: 2147483646;
        display:flex; flex-direction:column; gap:8px;
        font: 13px/1.35 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      }
      #deepseek-bridge-ui .row { display:flex; gap:8px; }
      #deepseek-bridge-ui button {
        background:#2563eb; color:#fff; border:none; border-radius:8px;
        padding:9px 12px; cursor:pointer; font-weight:600; font-size:13px;
      }
      #deepseek-bridge-ui button.sec { background:#1f2937; }
      #deepseek-bridge-ui button:hover { background:#3b82f6; }
      #deepseek-bridge-ui button.sec:hover { background:#111827; }
      #deepseek-bridge-ui .hint {
        background: rgba(17,24,39,.92); color:#e5e7eb; border-radius:8px;
        padding:8px 10px; font-size:12px; max-width:320px;
      }
    `;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'deepseek-bridge-ui';
    root.innerHTML = `
      <div class="hint">Ponte DeepSeek → OpenChamber ativa.<br/>Clique em <b>Enviar última resposta</b> após o DeepSeek responder.</div>
      <div class="row">
        <button id="deepseek-bridge-send">Enviar última resposta</button>
        <button id="deepseek-bridge-copy" class="sec">Copiar</button>
      </div>
    `;
    document.body.appendChild(root);

    document.getElementById('deepseek-bridge-send').addEventListener('click', () => {
      const texto = getLastMessageText();
      if (!texto) {
        toast('Nenhuma resposta encontrada. Gere uma resposta no DeepSeek primeiro.', 'warn');
        return;
      }
      enviarParaOpenChamber(texto);
    });

    document.getElementById('deepseek-bridge-copy').addEventListener('click', () => {
      const texto = getLastMessageText();
      if (!texto) {
        toast('Nenhuma resposta encontrada.', 'warn');
        return;
      }
      try {
        if (typeof GM_setClipboard === 'function') {
          GM_setClipboard(texto, { type: 'text', mimetype: 'text/plain' });
        } else {
          void navigator.clipboard.writeText(texto);
        }
        toast('Resposta copiada. Cole no painel do OpenChamber.', 'ok');
      } catch (e) {
        log('copy falhou', e);
      }
    });

    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('DeepSeek: enviar última resposta ao OpenChamber', () => {
        const texto = getLastMessageText();
        if (texto) enviarParaOpenChamber(texto);
      });
    }
  }

  // Injeta quando a pagina carregar (document-idle ja chega pronto, mas reforca).
  if (document.body) {
    criarUI();
  } else {
    document.addEventListener('DOMContentLoaded', criarUI, { once: true });
  }
  new MutationObserver(() => {
    if (!document.getElementById('deepseek-bridge-ui')) criarUI();
  }).observe(document.documentElement, { childList: true, subtree: true });

  log('bridge iniciada em', location.hostname);
})();
