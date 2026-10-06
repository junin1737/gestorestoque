'use strict';
/**
 * Gera os ícones do app (Windows) e do painel web a partir de build/icone-origem.jpg.
 * A origem é um quadrado arredondado sobre fundo branco: recorta e deixa o fundo transparente.
 *   node build/gerar-icones.js
 */
const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');

const root = path.resolve(__dirname, '..');
const ORIGEM = path.join(__dirname, 'icone-origem.jpg');
const SAIDA_WEB = path.join(root, 'Painel', 'icons');

const escuro = (d, i) => (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) < 150;

function caixaDoQuadrado(img) {
  const { width: w, height: h, data: d } = img.bitmap;
  const minimo = Math.round(w * 0.25);
  const linhas = [];
  const colunas = [];
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = 0; x < w; x++) if (escuro(d, (y * w + x) * 4)) n++;
    if (n >= minimo) linhas.push(y);
  }
  for (let x = 0; x < w; x++) {
    let n = 0;
    for (let y = 0; y < h; y++) if (escuro(d, (y * w + x) * 4)) n++;
    if (n >= minimo) colunas.push(x);
  }
  const top = linhas[0];
  const bottom = linhas[linhas.length - 1];
  const left = colunas[0];
  const right = colunas[colunas.length - 1];
  return { left, top, size: Math.min(right - left, bottom - top) + 1 };
}

/** Raio do canto: na diagonal, o canto arredondado começa em r·(1 − 1/√2) da borda. */
function raioDoCanto(img, caixa) {
  const { width: w, data: d } = img.bitmap;
  const raios = [];
  const cantos = [[0, 0, 1, 1], [caixa.size - 1, 0, -1, 1], [0, caixa.size - 1, 1, -1], [caixa.size - 1, caixa.size - 1, -1, -1]];
  for (const [cx, cy, dx, dy] of cantos) {
    for (let k = 0; k < caixa.size / 2; k++) {
      const x = caixa.left + cx + dx * k;
      const y = caixa.top + cy + dy * k;
      if (escuro(d, (y * w + x) * 4)) { raios.push(k / (1 - Math.SQRT1_2)); break; }
    }
  }
  raios.sort((a, b) => a - b);
  return (raios[1] + raios[2]) / 2;
}

/** Cobertura (0..1) do pixel pelo quadrado arredondado, com 4×4 amostras para suavizar a borda. */
function cobertura(x, y, n, r) {
  let dentro = 0;
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 4; sx++) {
      const px = x + (sx + 0.5) / 4;
      const py = y + (sy + 0.5) / 4;
      const qx = Math.max(r - px, 0, px - (n - r));
      const qy = Math.max(r - py, 0, py - (n - r));
      if (qx * qx + qy * qy <= r * r) dentro++;
    }
  }
  return dentro / 16;
}

function corDaBorda(img, r) {
  const { width: n, data: d } = img.bitmap;
  const soma = [0, 0, 0];
  let qtd = 0;
  const m = Math.round(n * 0.01) + 2;
  for (let t = Math.round(r); t < n - r; t += 3) {
    for (const [x, y] of [[t, m], [t, n - 1 - m], [m, t], [n - 1 - m, t]]) {
      const i = (y * n + x) * 4;
      soma[0] += d[i]; soma[1] += d[i + 1]; soma[2] += d[i + 2];
      qtd++;
    }
  }
  return soma.map((v) => Math.round(v / qtd));
}

function pngDib(img) {
  const { width: w, height: h, data: d } = img.bitmap;
  const linhaMascara = Math.ceil(w / 32) * 4;
  const buf = Buffer.alloc(40 + w * h * 4 + linhaMascara * h);
  buf.writeUInt32LE(40, 0);
  buf.writeInt32LE(w, 4);
  buf.writeInt32LE(h * 2, 8);
  buf.writeUInt16LE(1, 12);
  buf.writeUInt16LE(32, 14);
  buf.writeUInt32LE(w * h * 4 + linhaMascara * h, 20);
  let o = 40;
  for (let y = h - 1; y >= 0; y--) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      buf[o++] = d[i + 2]; buf[o++] = d[i + 1]; buf[o++] = d[i]; buf[o++] = d[i + 3];
    }
  }
  return buf;
}

/** ICO com BMP nos tamanhos pequenos (compatível com o NSIS) e PNG no 256. */
async function gravarIco(base, tamanhos, destino) {
  const imagens = [];
  for (const t of tamanhos) {
    const img = base.clone().resize({ w: t, h: t });
    imagens.push({ t, dados: t >= 256 ? await img.getBuffer('image/png') : pngDib(img) });
  }
  const cab = Buffer.alloc(6 + 16 * imagens.length);
  cab.writeUInt16LE(0, 0);
  cab.writeUInt16LE(1, 2);
  cab.writeUInt16LE(imagens.length, 4);
  let deslocamento = cab.length;
  imagens.forEach(({ t, dados }, k) => {
    const o = 6 + 16 * k;
    cab[o] = t >= 256 ? 0 : t;
    cab[o + 1] = t >= 256 ? 0 : t;
    cab.writeUInt16LE(1, o + 4);
    cab.writeUInt16LE(32, o + 6);
    cab.writeUInt32LE(dados.length, o + 8);
    cab.writeUInt32LE(deslocamento, o + 12);
    deslocamento += dados.length;
  });
  fs.writeFileSync(destino, Buffer.concat([cab, ...imagens.map((i) => i.dados)]));
}

async function main() {
  const origem = await Jimp.read(ORIGEM);
  const caixa = caixaDoQuadrado(origem);
  const quadrado = origem.clone().crop({ x: caixa.left, y: caixa.top, w: caixa.size, h: caixa.size });
  const n = caixa.size;
  const r = raioDoCanto(origem, caixa);
  // 1,5 px para dentro: evita o halo branco do fundo na borda.
  const inset = 1.5;
  const recorte = new Jimp({ width: n, height: n, color: 0x00000000 });
  const src = quadrado.bitmap.data;
  const dst = recorte.bitmap.data;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const a = cobertura(x - inset, y - inset, n - inset * 2, r - inset);
      if (!a) continue;
      const i = (y * n + x) * 4;
      dst[i] = src[i]; dst[i + 1] = src[i + 1]; dst[i + 2] = src[i + 2];
      dst[i + 3] = Math.round(a * 255);
    }
  }
  console.log(`Quadrado ${n}px em (${caixa.left},${caixa.top}), raio ${r.toFixed(1)}px`);

  const base = recorte.clone().resize({ w: 1024, h: 1024 });
  // Tela inicial do iPhone: sem transparência (o iOS arredonda sozinho); cantos com a cor da borda.
  const [cr, cg, cb] = corDaBorda(recorte, r);
  const cheio = new Jimp({ width: n, height: n, color: ((cr << 24) | (cg << 16) | (cb << 8) | 0xff) >>> 0 });
  cheio.composite(recorte, 0, 0);

  fs.mkdirSync(SAIDA_WEB, { recursive: true });
  const web = async (img, t, nome) => img.clone().resize({ w: t, h: t }).write(path.join(SAIDA_WEB, nome));
  await web(base, 512, 'icon-512.png');
  await web(base, 192, 'icon-192.png');
  await web(base, 32, 'favicon-32.png');
  await web(cheio, 180, 'apple-touch-icon.png');
  await web(cheio, 512, 'icon-maskable-512.png');
  await gravarIco(base, [16, 32, 48], path.join(SAIDA_WEB, 'favicon.ico'));

  await base.clone().resize({ w: 512, h: 512 }).write(path.join(__dirname, 'icon.png'));
  await gravarIco(base, [16, 24, 32, 48, 64, 128, 256], path.join(__dirname, 'icon.ico'));
  console.log('Ícones gerados em Painel/icons e build/.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
