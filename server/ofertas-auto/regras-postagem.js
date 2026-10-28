'use strict';

/** Instagram aceita foto entre 4:5 e 1,91:1. Fora disso, devolve a moldura que enquadra a imagem. */
function caixaInstagram(largura, altura) {
  const w = Number(largura);
  const h = Number(altura);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return null;
  const razao = w / h;
  if (razao < 0.8) {
    const fw = Math.round(h * 0.8);
    return { fw, fh: h, x: Math.max(0, Math.round((fw - w) / 2)), y: 0 };
  }
  if (razao > 1.91) {
    const fh = Math.round(w / 1.91);
    return { fw: w, fh, x: 0, y: Math.max(0, Math.round((fh - h) / 2)) };
  }
  return null;
}

function escalaMinima(largura, altura) {
  const curto = Math.min(Number(largura) || 0, Number(altura) || 0);
  if (curto >= 320 || curto < 1) return 1;
  return 320 / curto;
}

function quandoSlot(slot) {
  const data = String(slot?.data || '');
  const hora = String(slot?.hora || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return null;
  const m = hora.match(/^(\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(Number(data.slice(0, 4)), Number(data.slice(5, 7)) - 1, Number(data.slice(8, 10)), Number(m[1]), Number(m[2]), 0, 0);
}

function esperaCumprida(slot, agora, esperaMs) {
  if (!slot?.erro) return true;
  const em = Date.parse(String(slot.tentativa_em || ''));
  if (!Number.isFinite(em)) return true;
  return agora.getTime() - em >= esperaMs;
}

/** O horário vencido mais antigo de uma campanha ativa, pulando falha recente. */
function escolherSlot(ofertas, agora, esperaMs = 10 * 60 * 1000) {
  let melhor = null;
  for (const oferta of ofertas || []) {
    if (!oferta || oferta.ativa === false) continue;
    for (const slot of oferta.rotina || []) {
      if (!slot || slot.publicado || !slot.produto_id) continue;
      const quando = quandoSlot(slot);
      if (!quando || quando.getTime() > agora.getTime()) continue;
      if (!esperaCumprida(slot, agora, esperaMs)) continue;
      if (!melhor || quando.getTime() < melhor.quando.getTime()) melhor = { oferta, slot, quando };
    }
  }
  return melhor;
}

module.exports = { caixaInstagram, escalaMinima, quandoSlot, escolherSlot };
