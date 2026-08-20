'use strict';

const { withDb, query } = require('./db');
const { TABLE, GEN, ensureMtRegraTributo } = require('./importacao-mt-schema');

function str(v, max) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  return max ? s.slice(0, max) : s;
}

function mapRegra(r) {
  if (!r) return null;
  const csosnSaida = str(r.CSOSN_SAIDA) || str(r.CSOSN) || '';
  const csosnEntrada = str(r.CSOSN_ENTRADA) || '';
  const cstEntrada = str(r.CST_ENTRADA) || str(r.CST) || '';
  const cstSaida = str(r.CST_SAIDA) || '';
  const cstPisEnt = str(r.CST_PIS_ENTRADA) || str(r.CST_PIS) || '';
  const cstPisSai = str(r.CST_PIS_SAIDA) || str(r.CST_PIS) || '';
  const cstCofEnt = str(r.CST_COFINS_ENTRADA) || str(r.CST_COFINS) || '';
  const cstCofSai = str(r.CST_COFINS_SAIDA) || str(r.CST_COFINS) || '';

  return {
    id_regra: Number(r.ID_REGRA),
    id_fornec: r.ID_FORNEC != null ? Number(r.ID_FORNEC) : null,
    id_identificador: r.ID_IDENTIFICADOR != null ? Number(r.ID_IDENTIFICADOR) : null,
    cod_fornecedor: str(r.COD_FORNECEDOR) || '',
    cfop_entrada: str(r.CFOP_ENTRADA) || '',
    cfop_saida: str(r.CFOP_SAIDA) || '',
    cfop_nf: str(r.CFOP_NF) || '',
    cst: cstEntrada,
    cst_entrada: cstEntrada,
    cst_saida: cstSaida,
    cst_cfe: str(r.CST_CFE) || '',
    csosn: csosnSaida,
    csosn_entrada: csosnEntrada,
    csosn_saida: csosnSaida,
    csosn_cfe: str(r.CSOSN_CFE) || '',
    cst_pis: cstPisEnt,
    cst_pis_entrada: cstPisEnt,
    cst_pis_saida: cstPisSai,
    cst_cofins: cstCofEnt,
    cst_cofins_entrada: cstCofEnt,
    cst_cofins_saida: cstCofSai,
    pis: Number(r.PIS || 0),
    cofins: Number(r.COFINS || 0),
    id_cti: str(r.ID_CTI) || null,
    id_cti_cfe: str(r.ID_CTI_CFE) || null,
    id_class_trib: r.ID_CLASS_TRIB != null ? Number(r.ID_CLASS_TRIB) : null,
    id_class_trib_nfce: r.ID_CLASS_TRIB_NFCE != null ? Number(r.ID_CLASS_TRIB_NFCE) : null,
    aplicar_saida: String(r.APLICAR_SAIDA || 'S').trim().toUpperCase() !== 'N',
    prioridade: Number(r.PRIORIDADE != null ? r.PRIORIDADE : 100),
    status: String(r.STATUS || 'A').trim(),
    obs: str(r.OBS) || '',
  };
}

async function buscarRegra({ idFornec, idIdentificador, codFornecedor, cfopEntrada } = {}) {
  return withDb(async (db) => {
    await ensureMtRegraTributo(db);
    const params = [];
    let where = `STATUS = 'A'`;

    // Preferência: mesmo fornecedor + mesmo produto
    if (idFornec && idIdentificador) {
      const exact = await query(db, `
        SELECT FIRST 1 * FROM ${TABLE}
        WHERE STATUS = 'A' AND ID_FORNEC = ? AND ID_IDENTIFICADOR = ?
        ORDER BY PRIORIDADE ASC, ID_REGRA DESC`, [Number(idFornec), Number(idIdentificador)]);
      if (exact[0]) return mapRegra(exact[0]);
    }

    if (idFornec) {
      where += ` AND (ID_FORNEC = ? OR ID_FORNEC IS NULL)`;
      params.push(Number(idFornec));
    }
    if (idIdentificador) {
      where += ` AND (ID_IDENTIFICADOR = ? OR ID_IDENTIFICADOR IS NULL)`;
      params.push(Number(idIdentificador));
    }
    if (codFornecedor) {
      where += ` AND (COD_FORNECEDOR = ? OR COD_FORNECEDOR IS NULL OR COD_FORNECEDOR = '')`;
      params.push(String(codFornecedor).trim());
    }
    if (cfopEntrada) {
      where += ` AND (CFOP_ENTRADA = ? OR CFOP_ENTRADA IS NULL OR CFOP_ENTRADA = '')`;
      params.push(String(cfopEntrada).trim());
    }
    const rows = await query(db, `
      SELECT FIRST 20 * FROM ${TABLE}
      WHERE ${where}
      ORDER BY PRIORIDADE ASC, ID_REGRA DESC`, params);

    const score = (r) => {
      let s = 0;
      if (idFornec && Number(r.ID_FORNEC) === Number(idFornec)) s += 40;
      if (idIdentificador && Number(r.ID_IDENTIFICADOR) === Number(idIdentificador)) s += 40;
      if (codFornecedor && String(r.COD_FORNECEDOR || '').trim() === String(codFornecedor).trim()) s += 20;
      if (cfopEntrada && String(r.CFOP_ENTRADA || '').trim() === String(cfopEntrada).trim()) s += 15;
      s += Math.max(0, 200 - Number(r.PRIORIDADE || 100));
      return s;
    };
    rows.sort((a, b) => score(b) - score(a));
    return mapRegra(rows[0] || null);
  });
}

async function findIdByNaturalKey(db, idFornec, idIdentificador) {
  if (!idFornec || !idIdentificador) return null;
  const rows = await query(db, `
    SELECT FIRST 1 ID_REGRA FROM ${TABLE}
    WHERE ID_FORNEC = ? AND ID_IDENTIFICADOR = ?
    ORDER BY ID_REGRA DESC`, [Number(idFornec), Number(idIdentificador)]);
  return rows[0] ? Number(rows[0].ID_REGRA) : null;
}

async function salvarRegra(body = {}) {
  return withDb(async (db) => {
    await ensureMtRegraTributo(db);
    const now = new Date();
    const aplicar = body.aplicar_saida === false || body.aplicar_saida === 'N' ? 'N' : 'S';

    const idFornec = body.id_fornec != null && body.id_fornec !== '' ? Number(body.id_fornec) : null;
    const idIdent = body.id_identificador != null && body.id_identificador !== ''
      ? Number(body.id_identificador) : null;

    let idExistente = body.id_regra ? Number(body.id_regra) : null;
    if (!idExistente) {
      idExistente = await findIdByNaturalKey(db, idFornec, idIdent);
    }

    const cstEntrada = str(body.cst_entrada || body.cst, 3);
    const cstSaida = str(body.cst_saida, 3);
    const csosnEntrada = str(body.csosn_entrada, 3);
    const csosnSaida = str(body.csosn_saida || body.csosn, 3);
    const cstPisEnt = str(body.cst_pis_entrada || body.cst_pis, 2);
    const cstPisSai = str(body.cst_pis_saida || body.cst_pis, 2);
    const cstCofEnt = str(body.cst_cofins_entrada || body.cst_cofins, 2);
    const cstCofSai = str(body.cst_cofins_saida || body.cst_cofins, 2);
    const cstCfe = str(body.cst_cfe, 3);
    const csosnCfe = str(body.csosn_cfe, 3);

    const vals = [
      idFornec,
      idIdent,
      str(body.cod_fornecedor, 60),
      str(body.cfop_entrada, 4),
      str(body.cfop_saida, 4),
      str(body.cfop_nf, 4),
      cstEntrada,
      csosnSaida,
      cstPisEnt,
      cstCofEnt,
      csosnEntrada,
      csosnSaida,
      cstEntrada,
      cstSaida,
      cstCfe,
      csosnCfe,
      cstPisEnt,
      cstPisSai,
      cstCofEnt,
      cstCofSai,
      Number(body.pis || 0),
      Number(body.cofins || 0),
      str(body.id_cti, 10),
      str(body.id_cti_cfe, 10),
      body.id_class_trib != null && body.id_class_trib !== '' ? Number(body.id_class_trib) : null,
      body.id_class_trib_nfce != null && body.id_class_trib_nfce !== '' ? Number(body.id_class_trib_nfce) : null,
      aplicar,
      Number(body.prioridade != null ? body.prioridade : 100),
      str(body.obs, 200),
      now,
    ];

    const updateSql = `
      UPDATE ${TABLE} SET
        ID_FORNEC=?, ID_IDENTIFICADOR=?, COD_FORNECEDOR=?, CFOP_ENTRADA=?,
        CFOP_SAIDA=?, CFOP_NF=?, CST=?, CSOSN=?, CST_PIS=?, CST_COFINS=?,
        CSOSN_ENTRADA=?, CSOSN_SAIDA=?, CST_ENTRADA=?, CST_SAIDA=?, CST_CFE=?, CSOSN_CFE=?,
        CST_PIS_ENTRADA=?, CST_PIS_SAIDA=?, CST_COFINS_ENTRADA=?, CST_COFINS_SAIDA=?,
        PIS=?, COFINS=?, ID_CTI=?, ID_CTI_CFE=?, ID_CLASS_TRIB=?, ID_CLASS_TRIB_NFCE=?,
        APLICAR_SAIDA=?, PRIORIDADE=?, OBS=?, UPDATED_AT=?, STATUS='A'
      WHERE ID_REGRA=?`;

    if (idExistente) {
      await query(db, updateSql, [...vals, idExistente]);
      const rows = await query(db, `SELECT * FROM ${TABLE} WHERE ID_REGRA=?`, [idExistente]);
      return mapRegra(rows[0]);
    }

    const gen = await query(db, `SELECT GEN_ID(${GEN}, 1) AS ID FROM RDB$DATABASE`);
    const id = Number(gen[0].ID);
    await query(db, `
      INSERT INTO ${TABLE} (
        ID_REGRA, ID_FORNEC, ID_IDENTIFICADOR, COD_FORNECEDOR, CFOP_ENTRADA,
        CFOP_SAIDA, CFOP_NF, CST, CSOSN, CST_PIS, CST_COFINS,
        CSOSN_ENTRADA, CSOSN_SAIDA, CST_ENTRADA, CST_SAIDA, CST_CFE, CSOSN_CFE,
        CST_PIS_ENTRADA, CST_PIS_SAIDA, CST_COFINS_ENTRADA, CST_COFINS_SAIDA,
        PIS, COFINS, ID_CTI, ID_CTI_CFE, ID_CLASS_TRIB, ID_CLASS_TRIB_NFCE,
        APLICAR_SAIDA, PRIORIDADE, STATUS, OBS, CREATED_AT, UPDATED_AT
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, 'A', ?, ?, ?
      )`, [
      id, ...vals.slice(0, -1), now, now,
    ]);
    const rows = await query(db, `SELECT * FROM ${TABLE} WHERE ID_REGRA=?`, [id]);
    return mapRegra(rows[0]);
  });
}

module.exports = { buscarRegra, salvarRegra, mapRegra };
