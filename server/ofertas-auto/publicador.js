'use strict';

const { lerArquivo, gravarArquivo, lerConfig } = require('./config-loja');
const { caixaInstagram, escalaMinima, escolherSlot } = require('./regras-postagem');

const ESPERA_FALHA_MS = 10 * 60 * 1000;
let fila = Promise.resolve();

function emFila(fn) {
  const run = fila.then(fn, fn);
  fila = run.catch(() => {});
  return run;
}

function fotoDoSlot(dados, oferta, slot) {
  const id = String(slot?.produto_id || '');
  const produto = (oferta?.produtos || []).find((p) => String(p.id) === id);
  return String(slot?.foto_url || produto?.foto_url || dados?.produtos?.[id]?.foto_url || '').trim();
}

function legendaDoSlot(slot) {
  return [slot?.descricao, slot?.detalhe].map((v) => String(v || '').trim()).filter(Boolean).join('\n').slice(0, 2000);
}

async function enquadrarJpeg(bruto) {
  const { Jimp } = require('jimp');
  let img = await Jimp.read(bruto);
  const escala = escalaMinima(img.width, img.height);
  if (escala > 1) img = img.scale(escala);
  if (Math.max(img.width, img.height) > 1080) img = img.scaleToFit({ w: 1080, h: 1080 });
  const caixa = caixaInstagram(img.width, img.height);
  let saida = img;
  if (caixa) {
    const fundo = new Jimp({ width: caixa.fw, height: caixa.fh, color: 0xffffffff });
    fundo.composite(img, caixa.x, caixa.y);
    saida = fundo;
  }
  const jpeg = await saida.getBuffer('image/jpeg');
  if (jpeg.length > 1_500_000) {
    throw new Error('A foto ficou maior que 1,5 MB depois de ajustar para o Instagram.');
  }
  return { jpeg, mudou: escala > 1 || !!caixa, largura: saida.width, altura: saida.height };
}

async function chamarWorker(corpo) {
  const { LICENCA_URL, cabecalhosInstalacao } = require('../licenca');
  const remoto = await fetch(`${LICENCA_URL}/api/ofertas/publicar`, {
    method: 'POST',
    headers: { ...(await cabecalhosInstalacao()), 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(25000),
  });
  const data = await remoto.json().catch(() => ({}));
  if (!remoto.ok || data.ok === false) {
    const erro = new Error(data.error || 'O Instagram não publicou.');
    erro.recusou = /expirou|recusou/i.test(erro.message);
    throw erro;
  }
  return data;
}

async function enviarJpeg(produtoId, ean, jpeg) {
  const { LICENCA_URL, cabecalhosInstalacao } = require('../licenca');
  const remoto = await fetch(`${LICENCA_URL}/api/ofertas/foto`, {
    method: 'POST',
    headers: { ...(await cabecalhosInstalacao()), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      produto_id: produtoId,
      ean,
      tipo: 'image/jpeg',
      base64: jpeg.toString('base64'),
    }),
    signal: AbortSignal.timeout(25000),
  });
  const data = await remoto.json().catch(() => ({}));
  if (!remoto.ok || data.ok === false || !data.url) {
    throw new Error(data.error || 'O R2 não recebeu a foto ajustada.');
  }
  return { url: String(data.url), chave: String(data.chave || '') };
}

async function prepararFoto(dados, oferta, slot) {
  const url = fotoDoSlot(dados, oferta, slot);
  if (!/^https:\/\//.test(url)) throw new Error('Anexe a foto deste produto antes de postar.');
  let resposta;
  try {
    resposta = await fetch(url, { signal: AbortSignal.timeout(20000) });
  } catch {
    return { url, chave: '' };
  }
  if (!resposta.ok) return { url, chave: '' };
  const bruto = Buffer.from(await resposta.arrayBuffer());
  if (!bruto.length || bruto.length > 8_000_000) return { url, chave: '' };
  const banner = lerConfig().banner;
  const composto = await montarComBanner(bruto, banner);
  const quadro = await enquadrarJpeg(composto || bruto);
  if (!quadro.mudou && !composto) return { url, chave: '' };
  const produto = (oferta.produtos || []).find((p) => String(p.id) === String(slot.produto_id));
  const ean = String(produto?.ean || dados.produtos?.[String(slot.produto_id)]?.ean || '').replace(/\D/g, '').slice(0, 20);
  return enviarJpeg(String(slot.produto_id), ean, quadro.jpeg);
}

async function montarComBanner(fotoBuf, banner) {
  if (!banner || !/^https:\/\//.test(String(banner.url || ''))) return null;
  let resposta;
  try { resposta = await fetch(banner.url, { signal: AbortSignal.timeout(20000) }); }
  catch { return null; }
  if (!resposta.ok) return null;
  const { Jimp } = require('jimp');
  const base = await Jimp.read(Buffer.from(await resposta.arrayBuffer()));
  let foto = await Jimp.read(fotoBuf);
  const x = Math.round(base.width * Number(banner.x) / 100);
  const y = Math.round(base.height * Number(banner.y) / 100);
  const w = Math.max(1, Math.round(base.width * Number(banner.w) / 100));
  const h = Math.max(1, Math.round(base.height * Number(banner.h) / 100));
  const escala = Math.max(w / foto.width, h / foto.height);
  if (escala !== 1) foto = foto.scale(escala);
  const corteW = Math.min(w, foto.width);
  const corteH = Math.min(h, foto.height);
  foto.crop({
    x: Math.max(0, Math.round((foto.width - corteW) / 2)),
    y: Math.max(0, Math.round((foto.height - corteH) / 2)),
    w: corteW,
    h: corteH,
  });
  base.composite(foto, x, y);
  const jpeg = await base.getBuffer('image/jpeg');
  if (!jpeg.length || jpeg.length > 1_500_000) return null;
  return jpeg;
}

async function cicloInstagram(url, legenda) {
  let etapa = 'criar';
  let creationId = '';
  let ultimo = null;
  for (let i = 0; i < 12; i += 1) {
    ultimo = await chamarWorker({ image_url: url, caption: legenda, etapa, creation_id: creationId });
    if (ultimo.creation_id) creationId = String(ultimo.creation_id);
    if (ultimo.etapa === 'publicado') return ultimo;
    etapa = 'consultar';
    const espera = Math.min(15000, Number(ultimo.espera_ms) || 4000);
    await new Promise((resolver) => setTimeout(resolver, espera));
  }
  const erro = new Error(ultimo?.mensagem || 'O Instagram ainda está preparando a imagem. Tente de novo em instantes.');
  erro.creationId = creationId;
  throw erro;
}

function gravarResultado(ofertaId, chave, patch, foto) {
  const dados = lerArquivo();
  const oferta = (dados.ofertas || []).find((o) => o.id === ofertaId);
  if (!oferta) return null;
  const slot = (oferta.rotina || []).find((s) => String(s.produto_id) === String(chave.produto_id)
    && s.data === chave.data && s.hora === chave.hora && !s.publicado);
  if (!slot) return oferta;
  if (foto?.url) {
    slot.foto_url = foto.url;
    dados.produtos = dados.produtos || {};
    dados.produtos[String(chave.produto_id)] = {
      ...(dados.produtos[String(chave.produto_id)] || {}),
      foto_url: foto.url,
      foto_chave: foto.chave || dados.produtos[String(chave.produto_id)]?.foto_chave || '',
    };
    const produto = (oferta.produtos || []).find((p) => String(p.id) === String(chave.produto_id));
    if (produto) produto.foto_url = foto.url;
  }
  Object.assign(slot, patch);
  oferta.aviso = patch.aviso || '';
  dados.ofertas = dados.ofertas;
  gravarArquivo(dados);
  return oferta;
}

function textoProxima(oferta, atual) {
  const prox = (oferta?.rotina || []).find((s) => !s.publicado
    && !(String(s.produto_id) === String(atual.produto_id) && s.data === atual.data && s.hora === atual.hora));
  if (!prox) return 'Publicado no Instagram.';
  return `Publicado. A próxima é ${prox.data} ${String(prox.hora || '').slice(0, 5)}.`;
}

async function executar(oferta, slot) {
  const dados = lerArquivo();
  const viva = (dados.ofertas || []).find((o) => o.id === oferta.id) || oferta;
  const alvo = (viva.rotina || []).find((s) => String(s.produto_id) === String(slot.produto_id) && s.data === slot.data && s.hora === slot.hora) || slot;
  if (alvo.publicado) return { ok: true, etapa: 'publicado', mensagem: 'Este horário já foi publicado.', oferta: viva };
  let foto = null;
  try {
    foto = await prepararFoto(dados, viva, alvo);
    const publicado = await cicloInstagram(foto.url, legendaDoSlot(alvo));
    const aviso = textoProxima(viva, alvo);
    const salva = gravarResultado(viva.id, alvo, {
      publicado: true,
      publicado_em: new Date().toISOString(),
      post_id: String(publicado.post_id || ''),
      creation_id: '',
      erro: '',
      tentativa_em: '',
      aviso,
    }, foto);
    return { ok: true, etapa: 'publicado', mensagem: aviso, oferta: salva, post_id: String(publicado.post_id || '') };
  } catch (err) {
    const aviso = err.message || 'Falha ao postar.';
    const salva = gravarResultado(viva.id, alvo, {
      creation_id: err.recusou ? '' : (err.creationId || alvo.creation_id || ''),
      erro: aviso.slice(0, 180),
      tentativa_em: new Date().toISOString(),
      aviso,
    }, foto && foto.url !== alvo.foto_url ? foto : null);
    err.oferta = salva;
    throw err;
  }
}

function publicarOferta(ofertaId) {
  return emFila(async () => {
    const dados = lerArquivo();
    const oferta = (dados.ofertas || []).find((o) => o.id === ofertaId);
    if (!oferta) throw new Error('Oferta não encontrada.');
    const slot = (oferta.rotina || []).find((s) => !s.publicado && s.produto_id);
    if (!slot) {
      const erro = new Error((oferta.rotina || []).some((s) => s.publicado)
        ? 'Esta postagem já saiu no Instagram.'
        : 'Não há postagem pendente nesta oferta.');
      erro.oferta = oferta;
      throw erro;
    }
    return executar(oferta, slot);
  });
}

function pulso() {
  return emFila(async () => {
    const dados = lerArquivo();
    const alvo = escolherSlot(dados.ofertas, new Date(), ESPERA_FALHA_MS);
    if (!alvo) return null;
    try {
      return await executar(alvo.oferta, alvo.slot);
    } catch (err) {
      console.warn('Publicação da oferta:', err.message);
      return null;
    }
  });
}

module.exports = { enquadrarJpeg, publicarOferta, pulso };
