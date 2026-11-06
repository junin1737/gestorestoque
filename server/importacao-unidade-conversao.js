'use strict';

const { query } = require('./db');
const { fatorNumero, fatoresIguais } = require('./importacao-conversao-decisao');

function textoFator(valor) {
  const f = fatorNumero(valor);
  if (f == null) return '';
  return f.toFixed(4).replace(/\.?0+$/, '').replace('.', ',');
}

function codigoInteiro(fator) {
  const f = fatorNumero(fator);
  if (f == null || Math.abs(f - Math.round(f)) > 1e-6) return '';
  const n = Math.round(f);
  if (n < 1 || n > 999) return '';
  return String(n);
}

async function listarUnidades(db) {
  const rows = await query(db, `
    SELECT TRIM(UNIDADE) AS UNIDADE, CONVERSOR,
           TRIM(COALESCE(DESCRICAO, '')) AS DESCRICAO,
           TRIM(COALESCE(STATUS, '')) AS STATUS
    FROM TB_UNI_MEDIDA`);
  return rows || [];
}

/**
 * Acha ou cria a unidade cujo CONVERSOR é o fator deste item.
 * Nunca altera o CONVERSOR de uma unidade que já existe: a unidade "12"
 * é compartilhada por vários produtos. Fator novo ganha um código de 3
 * dígitos ainda não usado, descrição "converte 14,5" e venda fracionada.
 * Se a unidade atual do item já tem esse fator, ela permanece.
 */
async function garantirUnidadeParaFator(db, fator, uniAtual) {
  const f = fatorNumero(fator);
  if (f == null) return null;
  const atual = String(uniAtual || '').trim().toUpperCase();
  const rows = await listarUnidades(db);

  if (atual) {
    const row = rows.find((r) => String(r.UNIDADE || '').trim().toUpperCase() === atual);
    if (row && fatoresIguais(row.CONVERSOR, f)) {
      return { unidade: atual, conversor: f, criada: false };
    }
  }

  const codeInt = codigoInteiro(f);
  if (codeInt) {
    const row = rows.find((r) => String(r.UNIDADE || '').trim() === codeInt && fatoresIguais(r.CONVERSOR, f));
    if (row) return { unidade: codeInt, conversor: f, criada: false };
  }

  const reuso = rows.find((r) => {
    const desc = String(r.DESCRICAO || '').trim().toLowerCase();
    const ativa = String(r.STATUS || 'A').trim().toUpperCase() !== 'I';
    return ativa && desc.startsWith('converte ') && fatoresIguais(r.CONVERSOR, f);
  });
  if (reuso) {
    return { unidade: String(reuso.UNIDADE).trim(), conversor: f, criada: false };
  }

  if (fatoresIguais(f, 1)) {
    const un = rows.find((r) => String(r.UNIDADE || '').trim().toUpperCase() === 'UN');
    if (un) return { unidade: 'UN', conversor: 1, criada: false };
  }

  const usados = new Set(rows.map((r) => String(r.UNIDADE || '').trim()));
  let codigo = '';
  for (let n = 100; n <= 999; n += 1) {
    const c = String(n);
    if (!usados.has(c)) {
      codigo = c;
      break;
    }
  }
  if (!codigo) throw new Error('Não há código livre de 3 dígitos em TB_UNI_MEDIDA.');

  const descricao = `converte ${textoFator(f)}`.slice(0, 30);
  await query(db, `
    INSERT INTO TB_UNI_MEDIDA (UNIDADE, DESCRICAO, CONVERSOR, STATUS, VENDA_FRACIONADA, OPERACAO)
    VALUES (?, ?, ?, 'A', 'S', 0)`, [codigo, descricao, f]);
  return { unidade: codigo, conversor: f, criada: true, descricao };
}

module.exports = {
  textoFator,
  garantirUnidadeParaFator,
};
