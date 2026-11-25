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

function normUniNota(v) {
  return String(v || '').trim().toUpperCase();
}

function momentoConversao(linha) {
  const v = linha?.updated_at;
  if (v instanceof Date) return v.getTime();
  const n = Date.parse(v || '');
  return Number.isFinite(n) ? n : 0;
}

/** A edição mais recente daquela unidade da nota. */
function conversaoEditada(linhas) {
  return [...linhas].sort((a, b) => {
    const d = momentoConversao(a) - momentoConversao(b);
    if (d) return d;
    return Number(a.id || 0) - Number(b.id || 0);
  }).pop();
}

/**
 * A linha salva na aba Importação do produto vence, inclusive fator 1.
 * Se o cliente editar o fator, a próxima nota usa essa edição.
 * Sem linha para a unidade da nota, vale o fator da unidade no Clipp
 * (1 da unidade "12" entra como 12). Essa sugestão não grava linha nova.
 */
function fatorDaUnidadeDaNota({ uCom, uniEstoque, fatorUnidade, linhas } = {}) {
  const uni = normUniNota(uCom);
  const fatorUni = fatorNumero(fatorUnidade);
  if (!uni) return null;
  const exatas = (Array.isArray(linhas) ? linhas : [])
    .filter((l) => normUniNota(l.uni_xml) === uni);
  const salva = conversaoEditada(exatas);
  if (salva) {
    return {
      origem: 'gestor',
      uni: normUniNota(salva.uni_estoque) || normUniNota(uniEstoque) || 'UN',
      conversor: fatorNumero(salva.conversor) || 1,
      pacote: !!salva.pacote,
    };
  }
  if (fatorUni == null || fatoresIguais(fatorUni, 1)) return null;
  return {
    origem: 'unidade',
    uni: normUniNota(uniEstoque) || 'UN',
    conversor: fatorUni,
    pacote: false,
  };
}

module.exports = {
  inteiroClipp,
  fatorNumero,
  fatoresIguais,
  fatorEhDoClipp,
  decidirConversao,
  fatorDaUnidadeDaNota,
};
