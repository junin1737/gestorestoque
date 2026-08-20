'use strict';

const { withDb, query } = require('./db');

/** Códigos tPag (NF-e) → forma Clipp (SIS + NFCE). */
const TPAG_MAP = {
  '01': { id_fmapgto: 2, id_fmanfce: 1, label: 'Dinheiro / Vista' },
  '02': { id_fmapgto: 6, id_fmanfce: 2, label: 'Cheque' },
  '03': { id_fmapgto: 4, id_fmanfce: 3, label: 'Cartão de crédito' },
  '04': { id_fmapgto: 4, id_fmanfce: 4, label: 'Cartão de débito' },
  '05': { id_fmapgto: 3, id_fmanfce: 5, label: 'Crédito loja / Prazo' },
  '10': { id_fmapgto: 15, id_fmanfce: 6, label: 'Vale alimentação' },
  '11': { id_fmapgto: 16, id_fmanfce: 7, label: 'Vale refeição' },
  '13': { id_fmapgto: 18, id_fmanfce: 9, label: 'Vale combustível' },
  '15': { id_fmapgto: 3, id_fmanfce: 5, label: 'Boleto / Prazo' },
  '16': { id_fmapgto: 9, id_fmanfce: 15, label: 'Depósito bancário' },
  '17': { id_fmapgto: 10, id_fmanfce: 16, label: 'PIX' },
  '18': { id_fmapgto: 11, id_fmanfce: 17, label: 'Transferência' },
  '19': { id_fmapgto: 12, id_fmanfce: 18, label: 'Fidelidade' },
  '90': { id_fmapgto: 2, id_fmanfce: 1, label: 'Sem pagamento (vista)' },
  '99': { id_fmapgto: 3, id_fmanfce: 5, label: 'Outros / Prazo' },
};

function padTpag(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (!d) return '';
  return d.padStart(2, '0').slice(-2);
}

function extractPagFromXmlObj(xml = {}) {
  const pag = xml.pag || {};
  const dets = Array.isArray(pag.detPag) ? pag.detPag : (pag.detPag ? [pag.detPag] : []);
  const first = dets[0] || {};
  return {
    tPag: padTpag(first.tPag || pag.tPag),
    vPag: Number(first.vPag != null ? first.vPag : (pag.vPag || 0)),
    indPag: String(first.indPag != null ? first.indPag : (pag.indPag || '')).trim(),
    dets,
  };
}

async function findParcelamento(db, idFmapgto, nParcelas) {
  const fm = Number(idFmapgto) || 3;
  const n = Math.max(0, Number(nParcelas) || 0);
  const rows = await query(db, `
    SELECT FIRST 20 ID_PARCELA, DESCRICAO, N_PARCELAS, ID_FMAPGTO
    FROM TB_PARCELAMENTO
    WHERE TRIM(COALESCE(STATUS, 'A')) = 'A'
      AND ID_FMAPGTO = ?
    ORDER BY N_PARCELAS, ID_PARCELA`, [fm]);

  if (!rows.length) return null;

  if (n <= 0) {
    const vista = rows.find((r) => Number(r.N_PARCELAS || 0) === 0)
      || rows.find((r) => /vista/i.test(String(r.DESCRICAO || '')));
    return vista || rows[0];
  }

  const exact = rows.find((r) => Number(r.N_PARCELAS || 0) === n);
  if (exact) return exact;

  // 1 parcela a prazo (ex.: 30 dias)
  if (n === 1) {
    const prazo30 = rows.find((r) => /30\s*dias/i.test(String(r.DESCRICAO || '')) && Number(r.N_PARCELAS) === 1);
    if (prazo30) return prazo30;
    const one = rows.find((r) => Number(r.N_PARCELAS || 0) === 1);
    if (one) return one;
  }

  const closest = rows
    .slice()
    .sort((a, b) => Math.abs(Number(a.N_PARCELAS || 0) - n) - Math.abs(Number(b.N_PARCELAS || 0) - n))[0];
  return closest || rows[0];
}

async function resolveIdFmanfce(db, preferredId, tPag) {
  const pref = preferredId != null ? Number(preferredId) : null;
  if (pref) {
    const ok = await query(db, `
      SELECT FIRST 1 ID_FMANFCE FROM TB_FORMA_PAGTO_NFCE
      WHERE ID_FMANFCE = ? AND TRIM(COALESCE(STATUS, 'A')) = 'A'`, [pref]);
    if (ok[0]) return Number(ok[0].ID_FMANFCE);
  }
  const code = padTpag(tPag);
  if (code) {
    const byCode = await query(db, `
      SELECT FIRST 1 ID_FMANFCE FROM TB_FORMA_PAGTO_NFCE
      WHERE TRIM(ID_NFCE) = ? AND TRIM(COALESCE(STATUS, 'A')) = 'A'
      ORDER BY ID_FMANFCE`, [code]);
    if (byCode[0]) return Number(byCode[0].ID_FMANFCE);
  }
  // Prazo padrão (não usar Nenhum)
  const prazo = await query(db, `
    SELECT FIRST 1 ID_FMANFCE FROM TB_FORMA_PAGTO_NFCE
    WHERE UPPER(DESCRICAO) CONTAINING 'PRAZO' AND TRIM(COALESCE(STATUS, 'A')) = 'A'
    ORDER BY ID_FMANFCE`);
  if (prazo[0]) return Number(prazo[0].ID_FMANFCE);
  return 5;
}

/**
 * Monta financeiro sugerido a partir do XML (pag + cobr/dup).
 * Nunca retorna forma "Nenhum" (id 1) quando há indício de pagamento/fatura.
 */
async function sugerirFinanceiroFromXml(xml = {}) {
  return withDb(async (db) => {
    const cobr = xml.cobr || {};
    const dups = Array.isArray(cobr.dup) ? cobr.dup : [];
    const pagInfo = extractPagFromXmlObj(xml);
    const tPag = pagInfo.tPag;
    const mapped = TPAG_MAP[tPag] || null;

    let idFmapgto = mapped ? mapped.id_fmapgto : null;
    let idFmanfcePref = mapped ? mapped.id_fmanfce : null;
    let label = mapped ? mapped.label : '';

    // Duplicatas / fatura → faturamento a prazo
    if (dups.length > 0) {
      idFmapgto = 3;
      idFmanfcePref = 5;
      label = label || `Faturamento a prazo (${dups.length} parcela${dups.length > 1 ? 's' : ''})`;
    } else if (!idFmapgto) {
      // indPag 1 = à prazo na NF-e antiga
      if (String(pagInfo.indPag) === '1') {
        idFmapgto = 3;
        idFmanfcePref = 5;
        label = 'Prazo (indPag)';
      } else if (tPag) {
        idFmapgto = 3;
        idFmanfcePref = 5;
        label = `tPag ${tPag}`;
      } else {
        idFmapgto = 2;
        idFmanfcePref = 1;
        label = 'Vista (sem pag/cobr no XML)';
      }
    }

    // Nunca gravar "Nenhum"
    if (Number(idFmapgto) === 1) idFmapgto = dups.length ? 3 : 2;

    const nParc = dups.length > 0 ? dups.length : (Number(idFmapgto) === 2 ? 0 : 1);
    const parcRow = await findParcelamento(db, idFmapgto, nParc);
    const idParcela = parcRow ? Number(parcRow.ID_PARCELA) : (Number(idFmapgto) === 2 ? 2 : 24);
    const idFmanfce = await resolveIdFmanfce(db, idFmanfcePref, tPag);

    const formaRows = await query(db, `
      SELECT FIRST 1 DESCRICAO FROM TB_FORMA_PAGTO_SIS WHERE ID_FMAPGTO = ?`, [idFmapgto]);
    const formaDesc = String(formaRows[0]?.DESCRICAO || label || '').trim();

    return {
      nFat: cobr.nFat || '',
      vOrig: cobr.vOrig || 0,
      vLiq: cobr.vLiq || 0,
      parcelas: dups.map((d) => ({ ...d })),
      tPag: tPag || '',
      indPag: pagInfo.indPag || '',
      vPag: pagInfo.vPag || 0,
      id_fmapgto: idFmapgto,
      id_fmanfce: idFmanfce,
      id_parcela: idParcela,
      forma_pagto: formaDesc,
      parcelamento: parcRow ? String(parcRow.DESCRICAO || '').trim() : '',
      sugestao_label: label,
    };
  });
}

module.exports = {
  TPAG_MAP,
  padTpag,
  extractPagFromXmlObj,
  sugerirFinanceiroFromXml,
  resolveIdFmanfce,
  findParcelamento,
};
