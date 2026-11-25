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

/**
 * A unidade escrita na nota (uCom "12", "6") já tem fator em TB_UNI_MEDIDA.
 * 1 × "12" entra como 12 unidades de estoque. Não cria linha nova de conversão.
 * Uma linha já gravada para essa mesma unidade só vence a tabela quando o
 * fator dela é diferente de 1 (o usuário escolheu outro número). Fator 1 em
 * cima de uma unidade que converte foi a importação anterior e não vale.
 * Se a unidade da nota é UN e existe a linha UN × 1, ela vence uma linha
 * extra UN × 12 criada pela mesma importação.
 */
function fatorDaUnidadeDaNota({ uCom, uniEstoque, fatorUnidade, linhas } = {}) {
  const uni = normUniNota(uCom);
  const fatorUni = fatorNumero(fatorUnidade);
  if (!uni || fatorUni == null) return null;
  const exatas = (Array.isArray(linhas) ? linhas : [])
    .filter((l) => normUniNota(l.uni_xml) === uni);
  const pacote = exatas.find((l) => l.pacote);
  if (pacote) {
    return {
      origem: 'gestor',
      uni: normUniNota(pacote.uni_estoque) || normUniNota(uniEstoque) || 'UN',
      conversor: fatorNumero(pacote.conversor) || 1,
      pacote: true,
    };
  }
  const casa = (l) => fatorNumero(l.conversor);
  const bate = exatas.find((l) => fatoresIguais(casa(l), fatorUni));
  const custom = [...exatas].reverse().find((l) => {
    const f = casa(l);
    return f != null && !fatoresIguais(f, 1) && !fatoresIguais(f, fatorUni);
  });
  if (custom && !bate) {
    return {
      origem: 'gestor',
      uni: normUniNota(custom.uni_estoque) || normUniNota(uniEstoque) || 'UN',
      conversor: casa(custom),
      pacote: false,
    };
  }
  if (bate && fatoresIguais(fatorUni, 1)) {
    return {
      origem: 'gestor',
      uni: normUniNota(bate.uni_estoque) || normUniNota(uniEstoque) || uni,
      conversor: fatorUni,
      pacote: false,
    };
  }
  if (fatoresIguais(fatorUni, 1)) return null;
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
