'use strict';

const { lerArquivo, gravarArquivo } = require('./config-loja');
const { quandoSlot } = require('./regras-postagem');

const ESPERA_ERRO_MS = 10 * 60 * 1000;

async function chamar(path, options = {}) {
  const { LICENCA_URL, cabecalhosInstalacao } = require('../licenca');
  const res = await fetch(`${LICENCA_URL}${path}`, {
    method: options.method || 'GET',
    headers: { ...(await cabecalhosInstalacao()), 'Content-Type': 'application/json' },
    body: options.body,
    signal: AbortSignal.timeout(25000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || 'A fila na nuvem não respondeu.');
  return data;
}

function slotId(slot) {
  if (slot?.id) return String(slot.id);
  return `${slot?.data || ''}|${slot?.hora || ''}|${slot?.produto_id || ''}`;
}

function proximoLocal(dados) {
  let escolhida = null;
  for (const oferta of dados.ofertas || []) {
    if (!oferta || oferta.ativa === false) continue;
    for (const item of oferta.rotina || []) {
      if (!item || item.publicado || item.nuvem || !item.produto_id) continue;
      const quando = quandoSlot(item);
      if (!quando) continue;
      const falha = Date.parse(String(item.fila_em || ''));
      if (item.fila_erro && Number.isFinite(falha) && Date.now() - falha < ESPERA_ERRO_MS) continue;
      if (!escolhida || quando.getTime() < escolhida.quando.getTime()) escolhida = { oferta, item, quando };
    }
  }
  return escolhida;
}

/** Sobe a próxima arte ainda presa neste computador. Uma por vez, para não travar o painel. */
async function subirProxima() {
  const dados = lerArquivo();
  const alvo = proximoLocal(dados);
  if (!alvo) return null;
  const id = slotId(alvo.item);
  if (!alvo.item.id) alvo.item.id = id;
  try {
    const artes = await require('./publicador').prepararArtes(alvo.oferta, alvo.item);
    await chamar('/api/ofertas/agenda', {
      method: 'POST',
      body: JSON.stringify({
        oferta_id: alvo.oferta.id,
        manter: true,
        itens: artes.map((arte) => ({
          slot_id: id,
          forma: arte.forma,
          quando: alvo.quando.toISOString(),
          image_url: arte.image_url,
          caption: arte.caption,
          link: arte.link || '',
        })),
      }),
    });
    alvo.item.nuvem = true;
    alvo.item.fila_erro = '';
    alvo.item.fila_em = new Date().toISOString();
    gravarArquivo(dados);
    return id;
  } catch (err) {
    alvo.item.fila_erro = String(err.message || 'A nuvem não recebeu este horário.').slice(0, 180);
    alvo.item.fila_em = new Date().toISOString();
    gravarArquivo(dados);
    throw err;
  }
}

async function cancelarOferta(ofertaId) {
  await chamar('/api/ofertas/agenda', {
    method: 'POST',
    body: JSON.stringify({ oferta_id: ofertaId, manter: false, itens: [] }),
  });
}

async function retirarSlot(ofertaId, id) {
  await chamar('/api/ofertas/agenda', {
    method: 'POST',
    body: JSON.stringify({ oferta_id: ofertaId, manter: true, itens: [], retirar: [id] }),
  });
}

async function atualizarStatus() {
  const data = await chamar('/api/ofertas/agenda');
  const dados = lerArquivo();
  const porOferta = new Map();
  for (const item of data.itens || []) {
    if (!porOferta.has(item.oferta_id)) porOferta.set(item.oferta_id, []);
    porOferta.get(item.oferta_id).push(item);
  }
  let mudou = false;
  for (const oferta of dados.ofertas || []) {
    const linhas = porOferta.get(oferta.id);
    if (!linhas) continue;
    for (const slot of oferta.rotina || []) {
      const id = slotId(slot);
      const delas = linhas.filter((l) => l.slot_id === id && l.status !== 'cancelado');
      if (!delas.length) continue;
      if (!slot.nuvem) {
        slot.nuvem = true;
        mudou = true;
      }
      const erro = delas.find((l) => l.status === 'erro' && l.erro);
      if (erro && slot.erro !== erro.erro) {
        slot.erro = String(erro.erro).slice(0, 180);
        mudou = true;
      }
      if (delas.every((l) => l.status === 'publicado') && !slot.publicado) {
        slot.publicado = true;
        slot.publicado_em = new Date().toISOString();
        slot.post_id = delas.find((l) => l.forma === 'post')?.post_id || slot.post_id || '';
        slot.story_id = delas.find((l) => l.forma === 'story')?.post_id || slot.story_id || '';
        slot.erro = '';
        slot.aviso = 'Publicado pela fila na nuvem.';
        mudou = true;
      }
    }
  }
  if (mudou) gravarArquivo(dados);
}

module.exports = { subirProxima, cancelarOferta, retirarSlot, atualizarStatus, slotId };
