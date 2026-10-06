'use strict';
/**
 * Gera o ícone fixo do APK (MT Automações) a partir de android-app/scripts/icone-origem.jpg.
 * A origem é um quadrado arredondado sobre fundo branco (mesma detecção de build/gerar-icones.js).
 *   node android-app/scripts/gerar-icone-fixo.js
 * Prévia com as máscaras dos launchers: android-app/scripts/.cache/preview.png
 */
const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');
const { caixaDoQuadrado, raioDoCanto, cobertura, corDaBorda } = require('../../build/gerar-icones');

const ORIGEM = path.join(__dirname, 'icone-origem.jpg');
const RES = path.join(__dirname, '..', 'app', 'src', 'main', 'res');
const CACHE = path.join(__dirname, '.cache');

const DENSIDADES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
// Ícone adaptativo: camada de 108dp, o launcher mostra só os 72dp centrais.
const ADAPTATIVO = 432;
const VISIVEL = ADAPTATIVO * 72 / 108;

const rgba = ([r, g, b], a = 0xff) => ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();

/** Aplica uma máscara de cobertura (0..1 por pixel, com 4×4 amostras) ao canal alfa. */
function mascarar(img, dentro) {
  const { width: n, data: d } = img.bitmap;
  const out = img.clone();
  const o = out.bitmap.data;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let c = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) if (dentro(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4, n)) c++;
      }
      const i = (y * n + x) * 4;
      o[i + 3] = Math.round((d[i + 3] * c) / 16);
    }
  }
  return out;
}

const circulo = (px, py, n) => (px - n / 2) ** 2 + (py - n / 2) ** 2 <= (n / 2) ** 2;
const squircle = (px, py, n) => Math.abs((px - n / 2) / (n / 2)) ** 4 + Math.abs((py - n / 2) / (n / 2)) ** 4 <= 1;
const arredondado = (r) => (px, py, n) => {
  const q = r * n;
  const qx = Math.max(q - px, 0, px - (n - q));
  const qy = Math.max(q - py, 0, py - (n - q));
  return qx * qx + qy * qy <= q * q;
};

async function main() {
  const origem = await Jimp.read(ORIGEM);
  const caixa = caixaDoQuadrado(origem);
  const n = caixa.size;
  const r = raioDoCanto(origem, caixa);
  const quadrado = origem.clone().crop({ x: caixa.left, y: caixa.top, w: n, h: n });

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
  const borda = corDaBorda(recorte, r);
  // Quadrado cheio: cantos com a cor da borda (sem branco) para as máscaras do launcher.
  const cheio = new Jimp({ width: n, height: n, color: rgba(borda) });
  cheio.composite(recorte, 0, 0);
  console.log(`Quadrado ${n}px em (${caixa.left},${caixa.top}), raio ${r.toFixed(1)}px, borda ${hex(borda)}`);

  const legado = recorte.clone().resize({ w: 512, h: 512 });
  const redondo = mascarar(cheio.clone().resize({ w: 512, h: 512 }), circulo);
  for (const [dens, t] of Object.entries(DENSIDADES)) {
    const dir = path.join(RES, `mipmap-${dens}`);
    fs.mkdirSync(dir, { recursive: true });
    await legado.clone().resize({ w: t, h: t }).write(path.join(dir, 'ic_launcher.png'));
    await redondo.clone().resize({ w: t, h: t }).write(path.join(dir, 'ic_launcher_round.png'));
  }

  const frente = new Jimp({ width: ADAPTATIVO, height: ADAPTATIVO, color: 0x00000000 });
  const off = Math.round((ADAPTATIVO - VISIVEL) / 2);
  frente.composite(cheio.clone().resize({ w: VISIVEL, h: VISIVEL }), off, off);
  await frente.write(path.join(RES, 'drawable-nodpi', 'ic_launcher_foreground.png'));

  const cores = path.join(RES, 'values', 'colors.xml');
  const xml = fs.readFileSync(cores, 'utf8')
    .replace(/(<color name="ic_launcher_background">)[^<]*(<\/color>)/, `$1${hex(borda)}$2`);
  fs.writeFileSync(cores, xml, 'utf8');

  // Prévia: legado, redondo e adaptativo com máscaras círculo / squircle / quadrado arredondado.
  const T = 192;
  const camada = new Jimp({ width: ADAPTATIVO, height: ADAPTATIVO, color: rgba(borda) });
  camada.composite(frente, 0, 0);
  const visivel = camada.clone().crop({ x: off, y: off, w: VISIVEL, h: VISIVEL }).resize({ w: T, h: T });
  const icones = [
    legado.clone().resize({ w: T, h: T }),
    redondo.clone().resize({ w: T, h: T }),
    mascarar(visivel, circulo),
    mascarar(visivel, squircle),
    mascarar(visivel, arredondado(0.18)),
  ];
  const pad = 24;
  const largura = icones.length * (T + pad) + pad;
  const preview = new Jimp({ width: largura, height: 2 * (T + pad) + pad, color: 0xffffffff });
  const fundoEscuro = new Jimp({ width: largura, height: T + 2 * pad, color: 0x202124ff });
  preview.composite(fundoEscuro, 0, T + pad);
  icones.forEach((img, k) => {
    preview.composite(img, pad + k * (T + pad), pad);
    preview.composite(img, pad + k * (T + pad), T + 2 * pad);
  });
  fs.mkdirSync(CACHE, { recursive: true });
  await preview.write(path.join(CACHE, 'preview.png'));
  console.log('Ícones gerados em android-app/app/src/main/res (prévia em android-app/scripts/.cache/preview.png).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
