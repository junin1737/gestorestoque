'use strict';

function inteiroClipp(valor) {
  const n = Number(valor);
  if (!(n > 0) || Math.abs(n - Math.round(n)) > 1e-6) return null;
  return Math.round(n);
}

/** Fator positivo com a mesma escala de TB_UNI_MEDIDA.CONVERSOR (4 casas). */
function fatorNumero(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n) || !(n > 0)) return null;
  return Math.round(n * 10000) / 10000;
}

function fatoresIguais(a, b) {
  const x = fatorNumero(a);
  const y = fatorNumero(b);
  return x != null && y != null && Math.abs(x - y) < 0.00005;
}

function fatorEhDoClipp(fator, conversorClipp) {
  return fatoresIguais(fator, conversorClipp);
}

/**
 * Cada item tem o seu fator. Se o Clipp e o Gestor divergem, vale o que foi
 * digitado no Gestor. Iguais (inclusive fração, como 14,5) são o mesmo número.
 * Pacote informado pelo usuário vence os dois.
 */
function decidirConversao({ clipp, gestor } = {}) {
  const convClipp = clipp && clipp.uni ? fatorNumero(clipp.conversor) : null;
  const temClipp = convClipp != null;
  const convGestor = gestor ? fatorNumero(gestor.conversor) : null;
  const temGestor = !!(gestor && (gestor.uni || convGestor != null));
  if (temGestor && gestor.pacote) {
    return {
      origem: 'gestor',
      uni: gestor.uni || (clipp && clipp.uni) || '',
      conversor: convGestor || 1,
      pacote: true,
    };
  }
  if (temGestor && (!temClipp || !fatoresIguais(convGestor, convClipp))) {
    return {
      origem: 'gestor',
      uni: gestor.uni || (temClipp ? clipp.uni : ''),
      conversor: convGestor || 1,
      pacote: false,
    };
  }
  if (temClipp) {
    return {
      origem: 'clipp',
      uni: clipp.uni,
      conversor: convClipp,
      pacote: false,
    };
  }
  return null;
}

module.exports = {
  inteiroClipp,
  fatorNumero,
  fatoresIguais,
  fatorEhDoClipp,
  decidirConversao,
};
