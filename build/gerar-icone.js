'use strict';
// Gera build/icon.ico (16–256 px, entradas PNG) a partir de build/icon.png: node build/gerar-icone.js
const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');

const TAMANHOS = [16, 24, 32, 48, 64, 128, 256];

async function main() {
  const origem = await Jimp.read(path.join(__dirname, 'icon.png'));
  const imagens = [];
  for (const t of TAMANHOS) {
    imagens.push(await origem.clone().resize({ w: t, h: t }).getBuffer('image/png'));
  }
  const cabecalho = Buffer.alloc(6);
  cabecalho.writeUInt16LE(0, 0);
  cabecalho.writeUInt16LE(1, 2);
  cabecalho.writeUInt16LE(TAMANHOS.length, 4);
  const entradas = [];
  let deslocamento = 6 + 16 * TAMANHOS.length;
  TAMANHOS.forEach((t, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(t >= 256 ? 0 : t, 0);
    e.writeUInt8(t >= 256 ? 0 : t, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(imagens[i].length, 8);
    e.writeUInt32LE(deslocamento, 12);
    deslocamento += imagens[i].length;
    entradas.push(e);
  });
  fs.writeFileSync(path.join(__dirname, 'icon.ico'), Buffer.concat([cabecalho, ...entradas, ...imagens]));
  console.log('build/icon.ico gerado');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
