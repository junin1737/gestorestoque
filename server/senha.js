'use strict';
const crypto = require('crypto');

const N = 16384;
const R = 8;
const P = 1;
const TAM = 32;

/** scrypt$N$r$p$salt$hash (base64). */
function gerarHashSenha(senha) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(senha), salt, TAM, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function conferirHashSenha(senha, armazenado) {
  const partes = String(armazenado || '').split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = partes;
  const esperado = Buffer.from(hashB64, 'base64');
  let calc;
  try {
    calc = crypto.scryptSync(String(senha ?? ''), Buffer.from(saltB64, 'base64'), esperado.length, {
      N: Number(n), r: Number(r), p: Number(p),
    });
  } catch {
    return false;
  }
  return calc.length === esperado.length && crypto.timingSafeEqual(calc, esperado);
}

module.exports = { gerarHashSenha, conferirHashSenha };
