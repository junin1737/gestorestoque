'use strict';

const { query, hasTable, refreshTables, withDb } = require('./db');

const TABLE = 'TB_MT_CONVERSAO';

async function ensureConversaoGestor(db) {
  await refreshTables(db);
  if (hasTable(TABLE)) return;
  await query(db, `
    CREATE TABLE ${TABLE} (
      ID INTEGER NOT NULL,
      ID_IDENTIFICADOR INTEGER,
      ID_FORNEC INTEGER,
      UNI_XML VARCHAR(10),
      UNI_ESTOQUE VARCHAR(10),
      CONVERSOR NUMERIC(18,6),
      UPDATED_AT TIMESTAMP,
      CONSTRAINT PK_TB_MT_CONVERSAO PRIMARY KEY (ID)
    )`);
  await refreshTables(db);
}

function normUni(v) {
  return String(v || '').trim().toUpperCase().slice(0, 10);
}

async function buscarConversaoGestor({ idIdentificador, idFornec, uniXml } = {}) {
  const idIdent = Number(idIdentificador || 0);
  const idForn = Number(idFornec || 0);
  const uni = normUni(uniXml);
  if (!idIdent) return null;
  return withDb(async (db) => {
    await ensureConversaoGestor(db);
    const params = [idIdent];
    let sql = `SELECT FIRST 1 ID, ID_IDENTIFICADOR, ID_FORNEC, UNI_XML, UNI_ESTOQUE, CONVERSOR
      FROM ${TABLE} WHERE ID_IDENTIFICADOR = ?`;
    if (idForn) {
      sql += ' AND (ID_FORNEC = ? OR ID_FORNEC IS NULL)';
      params.push(idForn);
    }
    if (uni) {
      sql += ' AND (UNI_XML = ? OR UNI_XML IS NULL OR UNI_XML = \'\')';
      params.push(uni);
    }
    sql += ' ORDER BY CASE WHEN ID_FORNEC = ? THEN 0 ELSE 1 END, CASE WHEN UNI_XML = ? THEN 0 ELSE 1 END, ID DESC';
    params.push(idForn || 0, uni);
    const rows = await query(db, sql, params);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.ID,
      id_identificador: r.ID_IDENTIFICADOR,
      id_fornec: r.ID_FORNEC,
      uni_xml: r.UNI_XML || '',
      uni_estoque: r.UNI_ESTOQUE || '',
      conversor: Number(r.CONVERSOR || 1) || 1,
      origem: 'gestor',
    };
  });
}

async function salvarConversaoGestor(dados = {}, dbExterno) {
  const idIdent = Number(dados.id_identificador || 0);
  if (!idIdent) return null;
  const idForn = Number(dados.id_fornec || 0) || null;
  const uniXml = normUni(dados.uni_xml);
  const uniEst = normUni(dados.uni_estoque) || 'UN';
  const conversor = Number(dados.conversor || 1) || 1;

  const run = async (db) => {
    await ensureConversaoGestor(db);
    const exist = await query(db, `
      SELECT FIRST 1 ID FROM ${TABLE}
      WHERE ID_IDENTIFICADOR = ?
        AND COALESCE(ID_FORNEC, 0) = ?
        AND COALESCE(UNI_XML, '') = ?`, [
      idIdent, idForn || 0, uniXml,
    ]);
    if (exist[0]) {
      await query(db, `
        UPDATE ${TABLE}
        SET UNI_ESTOQUE = ?, CONVERSOR = ?, UPDATED_AT = CURRENT_TIMESTAMP
        WHERE ID = ?`, [uniEst, conversor, exist[0].ID]);
      return { id: exist[0].ID, atualizado: true };
    }
    const next = await query(db, `SELECT COALESCE(MAX(ID), 0) + 1 AS ID FROM ${TABLE}`);
    const id = Number(next[0]?.ID || 1);
    await query(db, `
      INSERT INTO ${TABLE} (ID, ID_IDENTIFICADOR, ID_FORNEC, UNI_XML, UNI_ESTOQUE, CONVERSOR, UPDATED_AT)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`, [
      id, idIdent, idForn, uniXml || null, uniEst, conversor,
    ]);
    return { id, atualizado: false };
  };

  if (dbExterno) return run(dbExterno);
  return withDb(run);
}

module.exports = {
  ensureConversaoGestor,
  buscarConversaoGestor,
  salvarConversaoGestor,
};
