// ==UserScript==
// @name         OpenChamber to DeepSeek Bridge
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Roda em localhost (OpenChamber): envia perguntas do painel para o DeepSeek via fila do servidor
// @author       local
// @match        *://localhost:*/*
// @match        *://127.0.0.1:*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
//
// Este script fica noOpenChamber. Ele:
//
// 1. Escuta o evento customizado "deepseek-enviar-pergunta" disparado pelo DeepSeekPanel.
// 2. Faz POST /api/deepseek-construtor/enviar-pergunta { text } para o servidor.
// 3. O servidor grava a pergunta em .openchamber/deepseek-bridge/ultima-pergunta.json
//    e o userscript do DeepSeek (deepseek-bridge.user.js) faz polling desse
//    arquivo via GET /ultima-pergunta e injeta no input do DeepSeek.
//
// Se o fetch falhar (servidor fora do ar), ele cai para localStorage para que o
// painel consiga ler depois via polling local.

(function () {
  'use strict';

  const API = 'http://localhost:3001/api/deepseek-construtor/enviar/pergunta';
  const STORAGE_KEY = 'openchamber-deepseek-bridge:pending-prompt';

  function log(...args) {
    console.log('[openchamber-bridge]', ...args);
  }

  async function enviarPergunta(texto) {
    const trimmed = (texto ?? '').trim();
    if (!trimmed) return;

    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      log('Pergunta enviada ao servidor para o DeepSeek');
      return true;
    } catch (e) {
      log('Falha no fetch, usando localStorage como fallback', e);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ text: trimmed, ts: new Date().toISOString() }));
      } catch {}
      const ev = new CustomEvent('deepseek-pergunta-enviada', { detail: { ok: false, fallback: true } });
      window.dispatchEvent(ev);
      return false;
    }
  }

  window.addEventListener('deepseek-enviar-pergunta', (ev) => {
    const detail = ev.detail;
    const texto = typeof detail === 'string' ? detail : detail?.text;
    if (!texto) return;
    void enviarPergunta(texto);
  });

  log('bridge OpenChamber pronta (localhost).');
})();
