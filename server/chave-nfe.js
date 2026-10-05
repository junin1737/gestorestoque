'use strict';
/** Validação estrutural da chave de acesso NF-e/NFC-e (44 dígitos). */

const UFS = new Set([11, 12, 13, 14, 15, 16, 17, 21, 22, 23, 24, 25, 26, 27, 28, 29,
  31, 32, 33, 35, 41, 42, 43, 50, 51, 52, 53]);

function dvChave(base43) {
  let soma = 0;
  let peso = 2;
  for (let i = base43.length - 1; i >= 0; i -= 1) {
    soma += Number(base43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const r = soma % 11;
  return r < 2 ? 0 : 11 - r;
}

function chaveValida(chave) {
  const c = String(chave || '');
  if (!/^\d{44}$/.test(c)) return false;
  if (!UFS.has(Number(c.slice(0, 2)))) return false;
  const mes = Number(c.slice(4, 6));
  if (mes < 1 || mes > 12) return false;
  const modelo = c.slice(20, 22);
  if (modelo !== '55' && modelo !== '65') return false;
  return dvChave(c.slice(0, 43)) === Number(c[43]);
}

/** Procura uma chave válida em qualquer janela de 44 dígitos seguidos. */
function chaveEmDigitos(digitos) {
  const d = String(digitos || '');
  for (let i = 0; i + 44 <= d.length; i += 1) {
    const c = d.slice(i, i + 44);
    if (chaveValida(c)) return c;
  }
  return '';
}

const PARECIDOS = { O: '0', o: '0', D: '0', Q: '0', I: '1', l: '1', '|': '1', i: '1', S: '5', s: '5', B: '8', Z: '2', z: '2', G: '6', b: '6', g: '9', q: '9' };

/** Texto de OCR (linhas) → chave válida. Junta linhas vizinhas se a chave quebrou em duas. */
function chaveEmTextoOcr(linhas) {
  const digitosDe = (txt) => String(txt || '')
    .replace(/[OoDQIl|iSsBZzGbgq]/g, (ch) => PARECIDOS[ch] || ch)
    .replace(/\D/g, '');
  const ds = (linhas || []).map(digitosDe);
  for (const d of ds) {
    const c = chaveEmDigitos(d);
    if (c) return c;
  }
  for (let i = 0; i + 1 < ds.length; i += 1) {
    const c = chaveEmDigitos(ds[i] + ds[i + 1]);
    if (c) return c;
  }
  return '';
}

module.exports = { chaveValida, chaveEmDigitos, chaveEmTextoOcr, dvChave };
