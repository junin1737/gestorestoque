'use strict';

const { query, hasTable, refreshTables, withDb, columnExists } = require('./db');
const { sqlTimestamp } = require('./datetime');
const { garantirUnidadeParaFator } = require('./importacao-unidade-conversao');

const TABLE = 'TB_MT_CONVERSAO';

async function ensureConversaoGestor(db) {
  await refreshTables(db);
  if (!hasTable(TABLE)) {
    await query(db, `
      CREATE TABLE ${TABLE} (
        ID INTEGER NOT NULL,
        ID_IDENTIFICADOR INTEGER,
        ID_FORNEC INTEGER,
        UNI_XML VARCHAR(10),
        UNI_ESTOQUE VARCHAR(10),
        CONVERSOR NUMERIC(18,6),
        UPDATED_AT TIMESTAMP,
        PACOTE CHAR(1),
        CONSTRAINT PK_TB_MT_CONVERSAO PRIMARY KEY (ID)
      )`);
    await refreshTables(db);
    return;
  }
  // "Vender por pacote": o CONVERSOR guarda pacotes por unidade da nota.
  if (!(await columnExists(db, TABLE, 'PACOTE'))) {
    await query(db, `ALTER TABLE ${TABLE} ADD PACOTE CHAR(1)`);
  }
}

function normUni(v) {
  return String(v || '').trim().toUpperCase().slice(0, 10);
}

async function buscarConversaoGestor({ idIdentificador, idFornec } = {}) {
  const idIdent = Number(idIdentificador || 0);
  const idForn = Number(idFornec || 0);
  if (!idIdent) return null;
  return withDb(async (db) => {
    await ensureConversaoGestor(db);
    const livre = [idIdent];
    let sql = `SELECT ID, ID_IDENTIFICADOR, ID_FORNEC, UNI_XML, UNI_ESTOQUE, CONVERSOR, PACOTE, UPDATED_AT
      FROM ${TABLE} WHERE ID_IDENTIFICADOR = ?`;
    if (idForn) {
      sql += ' AND (ID_FORNEC = ? OR ID_FORNEC IS NULL)';
      livre.push(idForn);
    }
    const todas = await query(db, sql, livre);
    const { fatorSalvoDoProduto } = require('./importacao-conversao-decisao');
    const lista = (todas || []).map((item) => ({
      id: Number(item.ID),
      uni_xml: item.UNI_XML || '',
      uni_estoque: item.UNI_ESTOQUE || '',
      conversor: Number(item.CONVERSOR || 1) || 1,
      updated_at: item.UPDATED_AT || null,
    }));
    const salva = fatorSalvoDoProduto({ linhas: lista });
    const linha = salva && lista.find((item) => Math.abs(item.conversor - salva.conversor) < 0.00005);
    const r = linha && (todas || []).find((item) => Number(item.ID) === linha.id);
    if (!r) return null;
    return {
      id: r.ID,
      id_identificador: r.ID_IDENTIFICADOR,
      id_fornec: r.ID_FORNEC,
      uni_xml: r.UNI_XML || '',
      uni_estoque: r.UNI_ESTOQUE || '',
      conversor: Number(r.CONVERSOR || 1) || 1,
      pacote: String(r.PACOTE || '').trim() === 'S',
      origem: 'gestor',
    };
  });
}

async function listarConversoesExatas({ idIdentificador, idFornec, uniXml } = {}) {
  const idIdent = Number(idIdentificador || 0);
  const uni = normUni(uniXml);
  if (!idIdent || !uni) return [];
  const idForn = Number(idFornec || 0);
  return withDb(async (db) => {
    await ensureConversaoGestor(db);
    const params = [idIdent, uni];
    let sql = `SELECT ID, UNI_XML, UNI_ESTOQUE, CONVERSOR, PACOTE, UPDATED_AT
      FROM ${TABLE}
      WHERE ID_IDENTIFICADOR = ?
        AND UPPER(TRIM(COALESCE(UNI_XML, ''))) = ?`;
    if (idForn) {
      sql += ' AND (ID_FORNEC = ? OR ID_FORNEC IS NULL)';
      params.push(idForn);
    }
    sql += ' ORDER BY ID';
    const rows = await query(db, sql, params);
    return (rows || []).map((r) => ({
      id: Number(r.ID),
      uni_xml: r.UNI_XML || '',
      uni_estoque: r.UNI_ESTOQUE || '',
      conversor: Number(r.CONVERSOR || 1) || 1,
      pacote: String(r.PACOTE || '').trim() === 'S',
      updated_at: r.UPDATED_AT || null,
    }));
  });
}

async function salvarConversaoGestor(dados = {}, dbExterno) {
  const idIdent = Number(dados.id_identificador || 0);
  if (!idIdent) return null;
  const idForn = Number(dados.id_fornec || 0) || null;
  const uniXml = normUni(dados.uni_xml);
  let uniEst = normUni(dados.uni_estoque) || 'UN';
  let conversor = Number(dados.conversor || 1) || 1;
  const pacote = dados.pacote ? 'S' : 'N';

  const run = async (db) => {
    await ensureConversaoGestor(db);
    let criada = false;
    if (pacote !== 'S') {
      const uni = await garantirUnidadeParaFator(db, conversor, uniEst);
      if (uni?.unidade) {
        uniEst = normUni(uni.unidade) || uniEst;
        conversor = Number(uni.conversor) || conversor;
        criada = !!uni.criada;
      }
      if (idForn && uniEst) {
        await query(db, `
          UPDATE TB_ESTOQUE_FORNECEDOR
          SET UNI_MEDIDA = ?
          WHERE ID_IDENTIFICADOR = ? AND ID_FORNEC = ?`, [uniEst, idIdent, idForn]);
      }
    }
    const exist = await query(db, `
      SELECT FIRST 1 ID FROM ${TABLE}
      WHERE ID_IDENTIFICADOR = ?
        AND COALESCE(ID_FORNEC, 0) = ?
        AND UPPER(TRIM(COALESCE(UNI_XML, ''))) = ?`, [
      idIdent, idForn || 0, uniXml,
    ]);
    if (exist[0]) {
      await query(db, `
        UPDATE ${TABLE}
        SET UNI_ESTOQUE = ?, CONVERSOR = ?, PACOTE = ?, UPDATED_AT = ${sqlTimestamp()}
        WHERE ID = ?`, [uniEst, conversor, pacote, exist[0].ID]);
      return { id: exist[0].ID, atualizado: true, unidade: uniEst, conversor, criada };
    }
    const next = await query(db, `SELECT COALESCE(MAX(ID), 0) + 1 AS ID FROM ${TABLE}`);
    const id = Number(next[0]?.ID || 1);
    await query(db, `
      INSERT INTO ${TABLE} (ID, ID_IDENTIFICADOR, ID_FORNEC, UNI_XML, UNI_ESTOQUE, CONVERSOR, PACOTE, UPDATED_AT)
      VALUES (?, ?, ?, ?, ?, ?, ?, ${sqlTimestamp()})`, [
      id, idIdent, idForn, uniXml || null, uniEst, conversor, pacote,
    ]);
    return { id, atualizado: false, unidade: uniEst, conversor, criada };
  };

  if (dbExterno) return run(dbExterno);
  return withDb(run);
}

async function listarConversoesProduto({ idIdentificador, idFornec } = {}) {
  const idIdent = Number(idIdentificador || 0);
  if (!idIdent) return [];
  const idForn = Number(idFornec || 0);
  return withDb(async (db) => {
    await ensureConversaoGestor(db);
    const params = [idIdent];
    let sql = `SELECT ID, UNI_XML, UNI_ESTOQUE, CONVERSOR, PACOTE, UPDATED_AT
      FROM ${TABLE} WHERE ID_IDENTIFICADOR = ?`;
    if (idForn) {
      sql += ' AND (ID_FORNEC = ? OR ID_FORNEC IS NULL)';
      params.push(idForn);
    }
    sql += ' ORDER BY ID';
    const rows = await query(db, sql, params);
    return (rows || []).map((r) => ({
      id: Number(r.ID),
      uni_xml: r.UNI_XML || '',
      uni_estoque: r.UNI_ESTOQUE || '',
      conversor: Number(r.CONVERSOR || 1) || 1,
      pacote: String(r.PACOTE || '').trim() === 'S',
      updated_at: r.UPDATED_AT || null,
    }));
  });
}

/** Um fator por produto. A quantidade da nota multiplica por ele. */
async function definirFatorProduto(dados = {}, dbExterno) {
  const idIdent = Number(dados.id_identificador || 0);
  if (!idIdent) return null;
  const idForn = Number(dados.id_fornec || 0) || null;
  const fator = Number(dados.conversor || 1) || 1;
  if (!(fator > 0)) return null;
  const uniEst = normUni(dados.uni_estoque) || 'UN';
  const run = async (db) => {
    await ensureConversaoGestor(db);
    const rows = await query(db, `
      SELECT ID FROM ${TABLE}
      WHERE ID_IDENTIFICADOR = ? AND COALESCE(ID_FORNEC, 0) = ?
      ORDER BY ID`, [idIdent, idForn || 0]);
    const ids = (rows || []).map((r) => Number(r.ID)).filter((n) => n > 0);
    let id = ids[0];
    if (id) {
      await query(db, `
        UPDATE ${TABLE}
        SET UNI_XML = NULL, UNI_ESTOQUE = ?, CONVERSOR = ?, PACOTE = 'N', UPDATED_AT = ${sqlTimestamp()}
        WHERE ID = ?`, [uniEst, fator, id]);
      for (const outro of ids.slice(1)) {
        await query(db, `DELETE FROM ${TABLE} WHERE ID = ?`, [outro]);
      }
      return { id, atualizado: true, unidade: uniEst, conversor: fator };
    }
    const next = await query(db, `SELECT COALESCE(MAX(ID), 0) + 1 AS ID FROM ${TABLE}`);
    id = Number(next[0]?.ID || 1);
    await query(db, `
      INSERT INTO ${TABLE} (ID, ID_IDENTIFICADOR, ID_FORNEC, UNI_XML, UNI_ESTOQUE, CONVERSOR, PACOTE, UPDATED_AT)
      VALUES (?, ?, ?, NULL, ?, ?, 'N', ${sqlTimestamp()})`, [
      id, idIdent, idForn, uniEst, fator,
    ]);
    return { id, atualizado: false, unidade: uniEst, conversor: fator };
  };
  if (dbExterno) return run(dbExterno);
  return withDb(run);
}

module.exports = {
  ensureConversaoGestor,
  buscarConversaoGestor,
  listarConversoesExatas,
  listarConversoesProduto,
  definirFatorProduto,
  salvarConversaoGestor,
};
