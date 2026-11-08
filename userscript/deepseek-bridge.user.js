// ==UserScript==
// @name         DeepSeek to OpenChamber Bridge
// @namespace    http://tampermonkey.net/
// @version      3.0.0
// @description  Roda em chat.deepseek.com: injeta perguntas do OpenChamber no DeepSeek e envia respostas de volta
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

  const API_BASE = 'http://localhost:3001/api/deepseek-construtor';
  const DELIVER_PATH = '/entregar-resposta';
  const POLL_PATH = '/ultima-pergunta';
  const CANDIDATES = ['localhost', '127.0.0.1'];

  // Seletores comuns de mensagens do DeepSeek (podem mudar).
  const MESSAGE_SELECTORS = [
    '[data-testid*="message"]',
    '[class*="message"]',
    '[class*="response"]',
    '[class*="markdown"]',
    'main div',
  ];

  // Seletores para o input do DeepSeek.
  const INPUT_SELECTORS = [
    'textarea',
    '[contenteditable="true"]',
    'input[type="text"]',
  ];

  function log(...args) {
    console.log('[deepseek-bridge]', ...args);
  }

  function gmRequest(method, path, body, onload, onerror) {
    if (typeof GM_xmlhttpRequest !== 'function') {
      onerror(new Error('GM_xmlhttpRequest indisponivel'));
      return;
    }
    let tentativas = 0;
    const tentar = () => {
      if (tentativas >= CANDIDATES.length) {
        onerror(new Error('todos hosts falharam (GM_xmlhttpRequest)'));
        return;
      }
      const host = CANDIDATES[tentativas++];
      GM_xmlhttpRequest({
        method,
        url: `http://${host}:3001${API_BASE}${path}`,
        headers: { 'Content-Type': 'application/json' },
        data: body ? JSON.stringify(body) : null,
        timeout: 8000,
        onload: (res) => {
          if (res.status >= 200 && res.status < 300) {
            try {
              onload(JSON.parse(res.responseText || '{}'));
            } catch {
              onload({});
            }
          } else {
            tentar();
          }
        },
        onerror: () => tentar(),
        ontimeout: () => tentar(),
      });
    };
    tentar();
  }

  // ---------- Direção DeepSeek -> OpenChamber ----------
  function getLastMessageText() {
    for (const sel of MESSAGE_SELECTORS) {
      const nodes = Array.from(document.querySelectorAll(sel)).filter((el) => {
        if (!(el instanceof HTMLElement)) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width < 10 || rect.height < 10) return false;
        const text = (el.innerText || el.textContent || '').trim();
        if (text.length < 20) return false;
        if (el.closest('#deepseek-bridge-ui')) return false;
        return true;
      });
      if (nodes.length) {
        const last = nodes[nodes.length - 1];
        const text = (last.innerText || last.textContent || '').trim();
        if (text) return text;
      }
    }
    const paras = Array.from(document.querySelectorAll('p, pre, code, div')).filter((el) => {
      if (!(el instanceof HTMLElement)) return false;
      const text = (el.innerText || el.textContent || '').trim();
      return text.length > 200 && !el.closest('#deepseek-bridge-ui');
    });
    if (paras.length) return (paras[paras.length - 1].innerText || paras[paras.length - 1].textContent || '').trim();
    return '';
  }

  function enviarParaOpenChamber(texto) {
    gmRequest(
      'POST',
      DELIVER_PATH,
      { text: texto },
      () => {
        log('Resposta entregue ao OpenChamber');
        toast('Resposta enviada para o OpenChamber', 'ok');
      },
      (err) => {
        log('GM_xmlhttpRequest falhou, tentando postMessage/clipboard', err);
        enviarViaPostMessage(texto);
      },
    );
  }

  function enviarViaPostMessage(texto) {
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

  // ---------- Direção OpenChamber -> DeepSeek ----------
  function findInput() {
    for (const sel of INPUT_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && el instanceof HTMLElement && !el.closest('#deepseek-bridge-ui')) {
        // Tenta pegar o maior textarea visivel
        return el;
      }
    }
    // Fallback: maior textarea na pagina
    const texts = Array.from(document.querySelectorAll('textarea')).filter((el) => !(el instanceof HTMLElement && el.closest('#deepseek-bridge-ui')));
    if (texts.length) return texts[texts.length - 1];
    return null;
  }

  function injectIntoDeepSeek(texto) {
    const input = findInput();
    if (!input) {
      log('Input do DeepSeek nao encontrado');
      toast('Nao encontrei o campo de texto do DeepSeek.', 'warn');
      return false;
    }
    input.focus();
    document.execCommand('selectAll', false, null);
    // document.execCommand funciona em textarea; para contenteditable, insere o texto
    const ok = document.execCommand('insertText', false, texto);
    if (!ok) {
      (input).value = texto;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    log('Pergunta injetada no DeepSeek input');
    toast('Pergunta do OpenChamber injetada no DeepSeek. Revise e envie.', 'ok');
    return true;
  }

  function pollPerguntas() {
    gmRequest(
      'GET',
      POLL_PATH,
      null,
      (json) => {
        if (!json.ok || !json.text || json.ts === pollPerguntas.lastTs) {
          return;
        }
        pollPerguntas.lastTs = json.ts;
        log('Nova pergunta do OpenChamber recebida', json.ts);
        injectIntoDeepSeek(json.text);
      },
      () => {
        // Servidor indisponivel — silencioso para nao spammar
      },
    );
  }
  pollPerguntas.lastTs = null;

  // ---------- UI ----------
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
      <div class="hint">Ponte DeepSeek <-> OpenChamber ativa.<br/>Perguntas do OpenChamber entram sozinhas aqui. Clique em <b>Enviar última resposta</b> apos o DeepSeek responder.</div>
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
      GM_registerMenuCommand('DeepSeek: buscar pergunta do OpenChamber agora', () => {
        pollPerguntas();
      });
    }

    // Poll continuo para receber perguntas do OpenChamber
    pollPerguntas();
    setInterval(pollPerguntas, 3000);
  }

  if (document.body) {
    criarUI();
  } else {
    document.addEventListener('DOMContentLoaded', criarUI, { once: true });
  }
  new MutationObserver(() => {
    if (!document.getElementById('deepseek-bridge-ui')) criarUI();
  }).observe(document.documentElement, { childList: true, subtree: true });

  log('bridge bidirecional iniciada em', location.hostname);
})();
