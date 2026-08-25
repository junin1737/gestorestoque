'use strict';

const { withDb, query } = require('./db');

function mapEstFornec(r) {
  if (!r) return null;
  return {
    id_est_fornec: Number(r.ID_EST_FORNEC),
    id_identificador: Number(r.ID_IDENTIFICADOR),
    id_fornec: Number(r.ID_FORNEC),
    cod_no_fornecedor: String(r.COD_NO_FORNECEDOR || '').trim(),
    cst: String(r.CST || '').trim(),
    csosn: String(r.CSOSN || '').trim(),
    cofins: Number(r.COFINS || 0),
    cst_cofins: String(r.CST_COFINS || '').trim(),
    pis: Number(r.PIS || 0),
    cst_pis: String(r.CST_PIS || '').trim(),
    aliq_icms: Number(r.ALIQ_ICMS || 0),
    uni_medida: String(r.UNI_MEDIDA || '').trim(),
    conversor: r.CONVERSOR != null ? Number(r.CONVERSOR) : null,
    status: String(r.STATUS || 'A').trim(),
    mva: r.MVA != null ? Number(r.MVA) : null,
    cfop: String(r.CFOP || '').trim(),
    ipi: r.IPI != null ? Number(r.IPI) : null,
    cst_ipi: String(r.CST_IPI || '').trim(),
    cod_barras: String(r.COD_BARRAS || '').trim(),
  };
}

async function lookupConversorUnidade(db, uni) {
  const u = String(uni || '').trim().toUpperCase();
  if (!u) return null;
  try {
    const rows = await query(db, `
      SELECT FIRST 1 CONVERSOR FROM TB_UNI_MEDIDA
      WHERE UPPER(TRIM(UNIDADE)) = ?
        AND (STATUS = 'A' OR STATUS IS NULL)`, [u]);
    if (!rows[0]) return null;
    const n = Number(rows[0].CONVERSOR);
    return Number.isFinite(n) && n > 0 ? n : 1;
  } catch {
    return null;
  }
}

async function buscarEstoqueFornecedor({ idFornec, idIdentificador, codFornecedor } = {}) {
  return withDb(async (db) => {
    if (!idFornec) return null;
    const params = [Number(idFornec)];
    let where = `ID_FORNEC = ? AND TRIM(COALESCE(STATUS,'A')) = 'A'`;
    if (idIdentificador) {
      where += ` AND ID_IDENTIFICADOR = ?`;
      params.push(Number(idIdentificador));
    } else if (codFornecedor) {
      where += ` AND COD_NO_FORNECEDOR = ?`;
      params.push(String(codFornecedor).trim());
    } else {
      return null;
    }
    const rows = await query(db, `
      SELECT FIRST 1 * FROM TB_ESTOQUE_FORNECEDOR
      WHERE ${where}
      ORDER BY ID_EST_FORNEC DESC`, params);
    const mapped = mapEstFornec(rows[0] || null);
    if (mapped?.uni_medida && !(mapped.conversor > 0)) {
      const conv = await lookupConversorUnidade(db, mapped.uni_medida);
      if (conv != null) mapped.conversor = conv;
    }
    return mapped;
  });
}

async function upsertEstoqueFornecedor(body = {}) {
  const idIdent = Number(body.id_identificador);
  const idFornec = Number(body.id_fornec);
  if (!idIdent || !idFornec) throw new Error('Informe id_identificador e id_fornec.');

  return withDb(async (db) => {
    const existing = await query(db, `
      SELECT FIRST 1 ID_EST_FORNEC FROM TB_ESTOQUE_FORNECEDOR
      WHERE ID_IDENTIFICADOR = ? AND ID_FORNEC = ?`, [idIdent, idFornec]);

    const cod = String(body.cod_no_fornecedor || '').trim() || null;
    const cst = String(body.cst || '').trim() || null;
    const csosn = String(body.csosn || '').trim() || null;
    const cofins = Number(body.cofins || 0);
    const cstCofins = String(body.cst_cofins || '').trim() || null;
    const pis = Number(body.pis || 0);
    const cstPis = String(body.cst_pis || '').trim() || null;
    const aliq = Number(body.aliq_icms || 0);
    const uni = String(body.uni_medida || '').trim() || null;
    const mva = body.mva != null && body.mva !== '' ? Number(body.mva) : null;
    const cfop = String(body.cfop || '').trim() || null;
    const ipi = body.ipi != null && body.ipi !== '' ? Number(body.ipi) : null;
    const cstIpi = String(body.cst_ipi || '').trim() || null;
    const barras = String(body.cod_barras || '').trim() || null;

    if (existing[0]) {
      const id = Number(existing[0].ID_EST_FORNEC);
      if (body.inativar || body.status === 'I') {
        await query(db, `UPDATE TB_ESTOQUE_FORNECEDOR SET STATUS='I' WHERE ID_EST_FORNEC=?`, [id]);
        const rows = await query(db, `SELECT * FROM TB_ESTOQUE_FORNECEDOR WHERE ID_EST_FORNEC=?`, [id]);
        return mapEstFornec(rows[0]);
      }
      await query(db, `
        UPDATE TB_ESTOQUE_FORNECEDOR SET
          COD_NO_FORNECEDOR=?, CST=?, CSOSN=?, COFINS=?, CST_COFINS=?,
          PIS=?, CST_PIS=?, ALIQ_ICMS=?, UNI_MEDIDA=?, MVA=?, CFOP=?,
          IPI=?, CST_IPI=?, COD_BARRAS=?, STATUS='A'
        WHERE ID_EST_FORNEC=?`, [
        cod, cst, csosn, cofins, cstCofins, pis, cstPis, aliq, uni, mva, cfop, ipi, cstIpi, barras, id,
      ]);
      const rows = await query(db, `SELECT * FROM TB_ESTOQUE_FORNECEDOR WHERE ID_EST_FORNEC=?`, [id]);
      return mapEstFornec(rows[0]);
    }

    let idEstFornec;
    try {
      const gen = await query(db, `SELECT GEN_ID(GEN_TB_ESTOQUE_FORNECEDOR_ID, 1) AS ID FROM RDB$DATABASE`);
      idEstFornec = Number(gen[0].ID);
    } catch {
      const max = await query(db, `SELECT COALESCE(MAX(ID_EST_FORNEC),0)+1 AS ID FROM TB_ESTOQUE_FORNECEDOR`);
      idEstFornec = Number(max[0].ID);
    }

    await query(db, `
      INSERT INTO TB_ESTOQUE_FORNECEDOR (
        ID_IDENTIFICADOR, ID_FORNEC, COD_NO_FORNECEDOR, CST, CSOSN, COFINS, CST_COFINS,
        PIS, CST_PIS, ALIQ_ICMS, UNI_MEDIDA, ID_EST_FORNEC, STATUS, MVA, CFOP, IPI, CST_IPI, COD_BARRAS
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'A', ?, ?, ?, ?, ?)`, [
      idIdent, idFornec, cod, cst, csosn, cofins, cstCofins,
      pis, cstPis, aliq, uni, idEstFornec, mva, cfop, ipi, cstIpi, barras,
    ]);
    const rows = await query(db, `SELECT * FROM TB_ESTOQUE_FORNECEDOR WHERE ID_EST_FORNEC=?`, [idEstFornec]);
    return mapEstFornec(rows[0]);
  });
}

module.exports = {
  buscarEstoqueFornecedor,
  upsertEstoqueFornecedor,
  mapEstFornec,
};
