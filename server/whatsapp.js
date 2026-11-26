'use strict';

const { LICENCA_URL, APLICACAO, cabecalhosInstalacao } = require('./licenca');

/** O Gestor não guarda a API do WhatsApp. Pede o envio e o QR Code ao painel, que chama a Evolution. */
async function chamarPainel(caminho, body) {
  const headers = await cabecalhosInstalacao();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(`${LICENCA_URL}${caminho}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
        'X-Gestor-App': APLICACAO,
      },
      body: JSON.stringify(body || {}),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      const err = new Error(data.error || 'O painel não concluiu a chamada do WhatsApp.');
      err.code = data.code || (res.status === 404 ? 'SEM_WHATSAPP' : 'EVOLUTION');
      err.whatsapp = data.whatsapp || null;
      throw err;
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error('O painel não respondeu ao WhatsApp.');
      e.code = 'EVOLUTION';
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
}

async function enviarTexto({ numero, texto }) {
  return chamarPainel('/api/whatsapp/enviar', {
    numero: String(numero || ''),
    texto: String(texto || ''),
  });
}

async function conectar({ acao }) {
  return chamarPainel('/api/whatsapp/conectar', { acao: acao === 'estado' ? 'estado' : 'criar' });
}

module.exports = { enviarTexto, conectar };
