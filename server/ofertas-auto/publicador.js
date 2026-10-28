'use strict';

const { lerArquivo, gravarArquivo, lerConfig } = require('./config-loja');
const { caixaInstagram, escalaMinima, escolherSlot, linhaPreco } = require('./regras-postagem');

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

function textoPublicacao(oferta, slot, produto, forma) {
  const partes = [oferta?.legenda, slot?.descricao, slot?.detalhe, linhaPreco(produto)];
  if (forma === 'story') partes.push(oferta?.link);
  return partes.map((v) => String(v || '').trim()).filter(Boolean).join('\n').slice(0, 2000);
}

function branco() {
  const { rgbaToInt } = require('jimp');
  return rgbaToInt(255, 255, 255, 255);
}

async function fundoBranco(img) {
  const { Jimp } = require('jimp');
  const fundo = new Jimp({ width: img.width, height: img.height, color: branco() });
  fundo.composite(img, 0, 0);
  return fundo;
}

function centralizar(img, largura, altura) {
  const { Jimp } = require('jimp');
  if (img.width === largura && img.height === altura) return img;
  const fundo = new Jimp({ width: largura, height: altura, color: branco() });
  fundo.composite(
    img,
    Math.max(0, Math.round((largura - img.width) / 2)),
    Math.max(0, Math.round((altura - img.height) / 2)),
  );
  return fundo;
}

function encaixarFeed(img) {
  let atual = img;
  const caixa = caixaInstagram(atual.width, atual.height);
  if (caixa) {
    const { Jimp } = require('jimp');
    const fundo = new Jimp({ width: caixa.fw, height: caixa.fh, color: branco() });
    fundo.composite(atual, caixa.x, caixa.y);
    atual = fundo;
  }
  let alvo = atual.width;
  if (alvo < 1080) alvo = 1080;
  if (alvo > 1440) alvo = 1440;
  if (Math.abs(atual.width - alvo) > 2) atual = atual.scale(alvo / atual.width);
  return atual;
}

function encaixarStory(img) {
  const alvoW = 1080;
  const alvoH = 1920;
  const cabe = img.width > alvoW || img.height > alvoH
    ? img.scaleToFit({ w: alvoW, h: alvoH })
    : img;
  const sobe = Math.min(alvoW / cabe.width, alvoH / cabe.height);
  const cheio = sobe > 1.01 ? cabe.scale(sobe) : cabe;
  return centralizar(cheio, alvoW, alvoH);
}

async function jpegAte(img, travarTamanho) {
  const qualidades = travarTamanho ? [90, 82, 74, 66, 58, 50] : [92, 84, 76];
  let atual = img;
  for (let volta = 0; volta < (travarTamanho ? 1 : 4); volta += 1) {
    for (const quality of qualidades) {
      const jpeg = await atual.getBuffer('image/jpeg', { quality });
      if (jpeg.length <= 1_450_000) return jpeg;
    }
    if (travarTamanho) break;
    atual = atual.scale(0.85);
  }
  throw new Error('A foto ficou maior que 1,5 MB depois de ajustar para o Instagram.');
}

function cobrir(img, alvoW, alvoH) {
  const escala = Math.max(alvoW / img.width, alvoH / img.height);
  const maior = Math.abs(escala - 1) < 0.015 ? img.clone() : img.clone().scale(escala);
  const sw = maior.width;
  const sh = maior.height;
  const cropX = Math.max(0, Math.round((sw - alvoW) / 2));
  const cropY = Math.max(0, Math.round((sh - alvoH) / 2));
  if (sw !== alvoW || sh !== alvoH) maior.crop({ x: cropX, y: cropY, w: alvoW, h: alvoH });
  return { img: maior, sw, sh, cropX, cropY };
}

function prepararBase(bannerImg, forma) {
  if (forma === 'story') return cobrir(bannerImg, 1080, 1920);
  let alvo = bannerImg.width;
  if (alvo < 1080) alvo = 1080;
  if (alvo > 1440) alvo = 1440;
  const escala = alvo / bannerImg.width;
  const maior = Math.abs(escala - 1) < 0.015 ? bannerImg.clone() : bannerImg.clone().scale(escala);
  return { img: maior, sw: maior.width, sh: maior.height, cropX: 0, cropY: 0 };
}

function colarFoto(base, foto, furo, mapa) {
  let x = Math.round(mapa.sw * Number(furo.x) / 100) - mapa.cropX;
  let y = Math.round(mapa.sh * Number(furo.y) / 100) - mapa.cropY;
  let w = Math.max(1, Math.round(mapa.sw * Number(furo.w) / 100));
  let h = Math.max(1, Math.round(mapa.sh * Number(furo.h) / 100));
  if (x < 0) { w += x; x = 0; }
  if (y < 0) { h += y; y = 0; }
  if (x + w > base.width) w = base.width - x;
  if (y + h > base.height) h = base.height - y;
  if (w < 8 || h < 8) return base;
  const escala = Math.max(w / foto.width, h / foto.height);
  let peca = Math.abs(escala - 1) > 0.01 ? foto.clone().scale(escala) : foto.clone();
  const corteW = Math.min(w, peca.width);
  const corteH = Math.min(h, peca.height);
  peca.crop({
    x: Math.max(0, Math.round((peca.width - corteW) / 2)),
    y: Math.max(0, Math.round((peca.height - corteH) / 2)),
    w: corteW,
    h: corteH,
  });
  base.composite(peca, x, y);
  return base;
}

async function desenharOferta(img, linhas) {
  const textos = (linhas || []).map((v) => String(v || '').trim()).filter(Boolean).slice(0, 2);
  if (!textos.length) return img;
  const { Jimp, loadFont, rgbaToInt } = require('jimp');
  const { SANS_64_BLACK, SANS_32_BLACK } = require('@jimp/plugin-print/fonts');
  const faixaH = Math.max(120, Math.round(img.height * (textos.length > 1 ? 0.18 : 0.12)));
  const faixaY = Math.max(0, img.height - faixaH - Math.round(img.height * 0.08));
  const faixa = new Jimp({ width: img.width, height: faixaH, color: rgbaToInt(255, 255, 255, 255) });
  img.composite(faixa, 0, faixaY);
  const fontePreco = await loadFont(SANS_64_BLACK);
  const fonteLink = await loadFont(SANS_32_BLACK);
  let y = faixaY + Math.round(faixaH * 0.16);
  textos.forEach((texto, i) => {
    const font = i === 0 ? fontePreco : fonteLink;
    img.print({ font, x: 36, y, text: texto, maxWidth: img.width - 72 });
    y += i === 0 ? 74 : 42;
  });
  return img;
}

async function arquivoParaGuardar(bruto, maxLado = 1920) {
  const { Jimp } = require('jimp');
  let img = await fundoBranco(await Jimp.read(bruto));
  if (Math.max(img.width, img.height) > maxLado) img = img.scaleToFit({ w: maxLado, h: maxLado });
  return jpegAte(img);
}

async function enquadrarJpeg(bruto) {
  const { Jimp } = require('jimp');
  let img = await fundoBranco(await Jimp.read(bruto));
  const escala = escalaMinima(img.width, img.height);
  if (escala > 1) img = img.scale(escala);
  if (Math.max(img.width, img.height) > 1440) img = img.scaleToFit({ w: 1440, h: 1440 });
  const caixa = caixaInstagram(img.width, img.height);
  let saida = img;
  if (caixa) {
    const fundo = new Jimp({ width: caixa.fw, height: caixa.fh, color: branco() });
    fundo.composite(img, caixa.x, caixa.y);
    saida = fundo;
  }
  const jpeg = await jpegAte(saida);
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

async function prepararFoto(dados, oferta, slot, forma) {
  const url = fotoDoSlot(dados, oferta, slot);
  if (!/^https:\/\//.test(url)) throw new Error('Anexe a foto deste produto antes de postar.');
  let resposta;
  try {
    resposta = await fetch(url, { signal: AbortSignal.timeout(20000) });
  } catch {
    throw new Error('Não foi possível ler a foto do produto.');
  }
  if (!resposta.ok) throw new Error('Não foi possível ler a foto do produto.');
  const bruto = Buffer.from(await resposta.arrayBuffer());
  if (!bruto.length || bruto.length > 8_000_000) throw new Error('A foto do produto não pôde ser lida.');
  const produto = (oferta.produtos || []).find((p) => String(p.id) === String(slot.produto_id));
  const linhas = [linhaPreco(produto)];
  if (forma === 'story') linhas.push(oferta?.link);
  const montada = await montarPublicacao(bruto, lerConfig().banner, forma, linhas);
  const jpeg = await jpegAte(montada, forma === 'story');
  const ean = String(produto?.ean || dados.produtos?.[String(slot.produto_id)]?.ean || '').replace(/\D/g, '').slice(0, 20);
  return enviarJpeg(`m${Date.now().toString(36)}`, ean, jpeg);
}

async function lerBanner(banner) {
  if (!banner || !/^https:\/\//.test(String(banner.url || ''))) return null;
  let resposta;
  try { resposta = await fetch(banner.url, { signal: AbortSignal.timeout(20000) }); }
  catch { return null; }
  if (!resposta.ok) return null;
  const { Jimp } = require('jimp');
  return fundoBranco(await Jimp.read(Buffer.from(await resposta.arrayBuffer())));
}

async function comporArte(foto, arte, furo, forma, linhas) {
  let base;
  if (arte) {
    const mapa = prepararBase(arte, forma);
    base = colarFoto(mapa.img, foto, furo || {}, mapa);
    if (forma !== 'story') base = encaixarFeed(base);
  } else {
    base = forma === 'story' ? encaixarStory(foto) : encaixarFeed(foto);
  }
  return desenharOferta(base, linhas);
}

async function montarPublicacao(fotoBuf, banner, forma, linhas) {
  const { Jimp } = require('jimp');
  const foto = await fundoBranco(await Jimp.read(fotoBuf));
  const arte = await lerBanner(banner);
  return comporArte(foto, arte, banner, forma, linhas);
}

async function cicloInstagram(url, legenda, forma, link) {
  let etapa = 'criar';
  let creationId = '';
  let ultimo = null;
  let linkEnvio = forma === 'story' ? String(link || '').trim() : '';
  let legendaEnvio = legenda;
  for (let i = 0; i < 12; i += 1) {
    try {
      ultimo = await chamarWorker({
        image_url: url,
        caption: legendaEnvio,
        etapa,
        creation_id: creationId,
        forma: forma === 'story' ? 'story' : 'post',
        link: linkEnvio,
      });
    } catch (err) {
      if (etapa === 'criar' && linkEnvio && /link|sticker|param/i.test(err.message || '')) {
        linkEnvio = '';
        if (link && !String(legendaEnvio).includes(link)) legendaEnvio = `${legendaEnvio}\n${link}`.trim().slice(0, 2000);
        continue;
      }
      throw err;
    }
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

function gravarResultado(ofertaId, chave, patch) {
  const dados = lerArquivo();
  const oferta = (dados.ofertas || []).find((o) => o.id === ofertaId);
  if (!oferta) return null;
  const slot = (oferta.rotina || []).find((s) => String(s.produto_id) === String(chave.produto_id)
    && s.data === chave.data && s.hora === chave.hora && !s.publicado);
  if (!slot) return oferta;
  Object.assign(slot, patch);
  if ('aviso' in patch) oferta.aviso = patch.aviso || '';
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
  const forma = viva.forma === 'story' || viva.forma === 'ambos' ? viva.forma : 'post';
  const tipos = forma === 'ambos' ? ['post', 'story'] : [forma];
  const ids = { post_id: String(alvo.post_id || ''), story_id: String(alvo.story_id || '') };
  try {
    for (const tipo of tipos) {
      if (tipo === 'post' && ids.post_id) continue;
      if (tipo === 'story' && ids.story_id) continue;
      const foto = await prepararFoto(dados, viva, alvo, tipo);
      const produto = (viva.produtos || []).find((p) => String(p.id) === String(alvo.produto_id));
      const publicado = await cicloInstagram(foto.url, textoPublicacao(viva, alvo, produto, tipo), tipo, tipo === 'story' ? viva.link : '');
      if (tipo === 'story') ids.story_id = String(publicado.post_id || '');
      else ids.post_id = String(publicado.post_id || '');
      gravarResultado(viva.id, alvo, { post_id: ids.post_id, story_id: ids.story_id, creation_id: '', erro: '', tentativa_em: '' });
    }
    const aviso = textoProxima(viva, alvo);
    const salva = gravarResultado(viva.id, alvo, {
      publicado: true,
      publicado_em: new Date().toISOString(),
      post_id: ids.post_id,
      story_id: ids.story_id,
      creation_id: '',
      erro: '',
      tentativa_em: '',
      aviso,
    });
    return { ok: true, etapa: 'publicado', mensagem: aviso, oferta: salva, post_id: ids.post_id || ids.story_id };
  } catch (err) {
    const aviso = err.message || 'Falha ao postar.';
    const salva = gravarResultado(viva.id, alvo, {
      post_id: ids.post_id,
      story_id: ids.story_id,
      creation_id: err.recusou ? '' : (err.creationId || alvo.creation_id || ''),
      erro: aviso.slice(0, 180),
      tentativa_em: new Date().toISOString(),
      aviso,
    });
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

module.exports = { enquadrarJpeg, arquivoParaGuardar, fundoBranco, comporArte, publicarOferta, pulso };
