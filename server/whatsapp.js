'use strict';

const { LICENCA_URL, APLICACAO, cabecalhosInstalacao } = require('./licenca');

/** O Gestor não guarda a API do WhatsApp. Pede o envio ao painel, que chama a Evolution. */
async function enviarTexto({ numero, texto }) {
  const headers = await cabecalhosInstalacao();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`${LICENCA_URL}/api/whatsapp/enviar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
        'X-Gestor-App': APLICACAO,
      },
      body: JSON.stringify({
        numero: String(numero || ''),
        texto: String(texto || ''),
      }),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      const err = new Error(data.error || 'Não foi possível enviar pelo WhatsApp da loja.');
      err.code = data.code || (res.status === 404 ? 'SEM_WHATSAPP' : 'EVOLUTION');
      throw err;
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error('O painel não respondeu ao envio do WhatsApp.');
      e.code = 'EVOLUTION';
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
}

module.exports = { enviarTexto };
