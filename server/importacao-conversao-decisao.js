'use strict';

function inteiroClipp(valor) {
  const n = Number(valor);
  if (!(n > 0) || Math.abs(n - Math.round(n)) > 1e-6) return null;
  return Math.round(n);
}

function fatorEhDoClipp(fator, conversorClipp) {
  const pedido = inteiroClipp(fator);
  const cadastro = inteiroClipp(conversorClipp);
  return pedido != null && cadastro != null && pedido === cadastro;
}

/**
 * Unidade que existe em TB_UNI_MEDIDA: o fator da nota é o inteiro dessa unidade.
 * Fator que o Clipp não tem (fração, pacote ou número diferente): só TB_MT_CONVERSAO.
 */
function decidirConversao({ clipp, gestor } = {}) {
  const temClipp = !!(clipp && clipp.uni && inteiroClipp(clipp.conversor) != null);
  const temGestor = !!(gestor && (gestor.uni || Number(gestor.conversor) > 0));
  if (temGestor && gestor.pacote) {
    return {
      origem: 'gestor',
      uni: gestor.uni || (clipp && clipp.uni) || '',
      conversor: Number(gestor.conversor) || 1,
      pacote: true,
    };
  }
  if (temGestor && (!temClipp || !fatorEhDoClipp(gestor.conversor, clipp.conversor))) {
    return {
      origem: 'gestor',
      uni: gestor.uni || (temClipp ? clipp.uni : ''),
      conversor: Number(gestor.conversor) || 1,
      pacote: false,
    };
  }
  if (temClipp) {
    return {
      origem: 'clipp',
      uni: clipp.uni,
      conversor: inteiroClipp(clipp.conversor),
      pacote: false,
    };
  }
  return null;
}

module.exports = {
  inteiroClipp,
  fatorEhDoClipp,
  decidirConversao,
};
