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

function extractChave44(raw) {
  const text = String(raw || '');
  if (!text) return '';
  const fromQuery = text.match(/(?:chNFe|chave|chAce|chaveAcesso)=(\d{44})/i)
    || text.match(/[?&]p=(\d{44})(?:\||&|$)/i);
  if (fromQuery) return fromQuery[1];
  const digits = text.replace(/\D/g, '');
  if (digits.length === 44) return digits;
  const run = digits.match(/\d{44}/);
  return run ? run[0] : '';
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
  const attempts = [];

  const add = (factory) => {
    try {
      attempts.push(factory());
    } catch { /* ignore */ }
  };

  add(() => img.clone());
  add(() => img.clone().greyscale().contrast(0.35));
  add(() => img.clone().greyscale().contrast(0.55));
  add(() => img.clone().rotate(90));
  add(() => img.clone().rotate(-90));
  add(() => img.clone().rotate(180));

  const w = img.width;
  const h = img.height;
  const strips = [
    [0, 0, w, Math.max(40, Math.round(h * 0.22))],
    [0, Math.round(h * 0.08), w, Math.max(40, Math.round(h * 0.25))],
    [0, Math.round(h * 0.28), w, Math.max(40, Math.round(h * 0.3))],
    [0, Math.round(h * 0.55), w, Math.max(40, Math.round(h * 0.3))],
  ];
  for (const [x, y, sw, sh] of strips) {
    add(() => {
      const crop = img.clone().crop({
        x,
        y: Math.min(y, h - 2),
        w: Math.min(sw, w - x),
        h: Math.min(sh, h - y),
      });
      const targetW = Math.min(2200, Math.max(crop.width * 2, crop.width));
      return crop.resize({ w: targetW, h: Math.max(1, Math.round(crop.height * (targetW / crop.width))) })
        .greyscale()
        .contrast(0.4);
    });
  }

  for (const attempt of attempts) {
    const hit = tryDecodeImage(attempt, hints);
    if (hit) return { ok: true, chave: hit.chave, raw: hit.raw };
  }

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
