'use strict';
/**
 * Decodifica chave NF-e (44 dígitos) a partir de foto — usado pelo iPhone/navegador.
 * O PC tem mais CPU e a imagem em resolução completa; ZXing no Safari costuma falhar.
 */
const {
  MultiFormatReader,
  BarcodeFormat,
  DecodeHintType,
  RGBLuminanceSource,
  BinaryBitmap,
  HybridBinarizer,
} = require('@zxing/library');
const { Jimp } = require('jimp');
const { chaveValida, chaveEmDigitos, chaveEmTextoOcr } = require('./chave-nfe');
const { ocrLinhas } = require('./ocr-windows');

const LIMITE_DECODE_MS = 25000;

function extractChave44(raw) {
  const text = String(raw || '');
  if (!text) return '';
  const fromQuery = text.match(/(?:chNFe|chave|chAce|chaveAcesso)=(\d{44})/i)
    || text.match(/[?&]p=(\d{44})(?:\||&|$)/i);
  if (fromQuery && chaveValida(fromQuery[1])) return fromQuery[1];
  return chaveEmDigitos(text.replace(/\D/g, ''));
}

/** Lê os 44 dígitos impressos (OCR do Windows); tenta também a foto girada. */
async function chavePorOcr(img, fim) {
  const giros = [0, 90, 270];
  for (const g of giros) {
    if (Date.now() > fim) break;
    const alvo = g ? img.clone().rotate(g) : img;
    const buf = await alvo.getBuffer('image/jpeg', { quality: 92 });
    const chave = chaveEmTextoOcr(await ocrLinhas(buf, { timeoutMs: Math.max(3000, fim - Date.now()) }));
    if (chave) return chave;
  }
  return '';
}

function decodeBitmap(bitmap, hints) {
  const reader = new MultiFormatReader();
  reader.setHints(hints);
  try {
    const result = reader.decode(bitmap);
    return result?.getText?.() || result?.text || '';
  } catch {
    try {
      reader.reset();
      const result = reader.decode(bitmap);
      return result?.getText?.() || result?.text || '';
    } catch {
      return '';
    }
  } finally {
    try { reader.reset(); } catch { /* ignore */ }
  }
}

function rgbaToBitmap(rgba, width, height) {
  const luminances = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < rgba.length && j < luminances.length; i += 4, j += 1) {
    luminances[j] = (rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114) | 0;
  }
  const source = new RGBLuminanceSource(luminances, width, height);
  return new BinaryBitmap(new HybridBinarizer(source));
}

function buildHints() {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.CODE_128,
    BarcodeFormat.ITF,
    BarcodeFormat.QR_CODE,
    BarcodeFormat.CODE_39,
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return hints;
}

function tryDecodeImage(img, hints) {
  const { data, width, height } = img.bitmap;
  const bitmap = rgbaToBitmap(data, width, height);
  const text = decodeBitmap(bitmap, hints);
  return extractChave44(text) ? { chave: extractChave44(text), raw: text } : null;
}

async function decodeChaveFromBuffer(buf) {
  let img = await Jimp.read(buf);
  const maxEdge = 2200;
  if (Math.max(img.width, img.height) > maxEdge) {
    img = img.scaleToFit({ w: maxEdge, h: maxEdge });
  }

  const hints = buildHints();
  const fim = Date.now() + LIMITE_DECODE_MS;

  // Geradores preguiçosos: cada tentativa só é montada se as anteriores falharem.
  function* tentativas() {
    yield () => img.clone();
    yield () => img.clone().greyscale().contrast(0.35);
    yield* faixas(img);
    yield () => img.clone().scaleToFit({ w: 1400, h: 1400 }).greyscale().contrast(0.35);
    yield () => img.clone().greyscale().contrast(0.55);
    yield () => img.clone().rotate(90);
    yield () => img.clone().rotate(-90);
    yield () => img.clone().rotate(180);
    const girada = img.clone().rotate(90);
    yield* faixas(girada);
  }

  /** Faixas horizontais sobrepostas cobrindo a foto inteira: a barra pode estar em qualquer altura. */
  function* faixas(base) {
    const w = base.width;
    const h = base.height;
    const altura = Math.max(40, Math.round(h * 0.22));
    const passo = Math.max(20, Math.round(h * 0.11));
    for (let y = 0; y < h - 20; y += passo) {
      yield () => base.clone()
        .crop({ x: 0, y, w, h: Math.min(altura, h - y) })
        .greyscale()
        .contrast(0.4);
    }
  }

  // OCR roda em outro processo enquanto a barra é procurada aqui; vale o que achar primeiro.
  let chaveOcr = '';
  let ocrTerminou = false;
  const ocr = chavePorOcr(img.clone(), fim)
    .then((c) => { chaveOcr = c; })
    .catch(() => {})
    .finally(() => { ocrTerminou = true; });

  for (const montar of tentativas()) {
    if (Date.now() > fim) break;
    await new Promise((r) => setImmediate(r));
    if (chaveOcr) return { ok: true, chave: chaveOcr, raw: chaveOcr, fonte: 'ocr' };
    let attempt;
    try {
      attempt = montar();
    } catch {
      continue;
    }
    const hit = tryDecodeImage(attempt, hints);
    if (hit) return { ok: true, chave: hit.chave, raw: hit.raw, fonte: 'barra' };
  }

  if (!ocrTerminou) await ocr;
  if (chaveOcr) return { ok: true, chave: chaveOcr, raw: chaveOcr, fonte: 'ocr' };

  return {
    ok: false,
    error: 'Não encontrei os 44 dígitos da chave na imagem. Fotografe só a faixa do código (ou o QR), bem perto e nítida.',
  };
}

async function decodeChaveFromDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:image\/[a-zA-Z0-9+.-]+;base64,(.+)$/);
  if (!m) return { ok: false, error: 'Imagem inválida' };
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length < 100) return { ok: false, error: 'Imagem vazia' };
  if (buf.length > 12 * 1024 * 1024) return { ok: false, error: 'Imagem muito grande' };
  return decodeChaveFromBuffer(buf);
}

module.exports = { decodeChaveFromDataUrl, decodeChaveFromBuffer, extractChave44 };
