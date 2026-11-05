'use strict';

const fs = require('fs');
const path = require('path');
const { getAppDataDir } = require('./config');
const { withDb, query, activeTargets } = require('./db');

const FILE = 'importacao-auto-produtos.json';

function filePath() {
  return path.join(getAppDataDir(), FILE);
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
    const produtos = raw && typeof raw.produtos === 'object' && raw.produtos ? raw.produtos : {};
    return { produtos };
  } catch {
    return { produtos: {} };
  }
}

function save(store) {
  const dir = getAppDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath(), JSON.stringify({ produtos: store.produtos || {} }), 'utf8');
}

function flag(id) {
  const item = load().produtos[String(id)] || {};
  return {
    importar: item.importar === true,
    ciencia: item.ciencia === true,
  };
}

function definir(id, patch = {}) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) {
    const e = new Error('Produto inválido.');
    e.code = 'ID';
    throw e;
  }
  const store = load();
  const atual = store.produtos[String(n)] || {};
  const prox = {
    importar: patch.importar === undefined ? atual.importar === true : patch.importar === true,
    ciencia: patch.ciencia === undefined ? atual.ciencia === true : patch.ciencia === true,
  };
  store.produtos[String(n)] = prox;
  save(store);
  return prox;
}

async function buscar(q) {
  const termo = String(q || '').trim().slice(0, 80);
  if (termo.length < 2) return [];
  const flags = load().produtos;
  return withDb(async (db, appCfg) => {
    const t = activeTargets(appCfg)[0]?.tables;
    if (!t) return [];
    const soNumero = /^\d+$/.test(termo);
    const where = soNumero
      ? `(I.ID_IDENTIFICADOR = ? OR CAST(I.ID_IDENTIFICADOR AS VARCHAR(20)) STARTING WITH ? OR TRIM(CAST(P.COD_BARRA AS VARCHAR(60))) CONTAINING ?)`
      : `(UPPER(E.DESCRICAO) CONTAINING UPPER(?) OR TRIM(CAST(P.COD_BARRA AS VARCHAR(60))) CONTAINING ? OR TRIM(CAST(P.REFERENCIA AS VARCHAR(60))) CONTAINING ?)`;
    const params = soNumero
      ? [Number(termo), termo.slice(0, 20), termo]
      : [termo, termo, termo];
    const rows = await query(db, `
      SELECT FIRST 40
        I.ID_IDENTIFICADOR,
        TRIM(E.DESCRICAO) AS DESCRICAO,
        TRIM(COALESCE(P.COD_BARRA, '')) AS COD_BARRA
      FROM ${t.identificador} I
      JOIN ${t.estoque} E ON E.ID_ESTOQUE = I.ID_ESTOQUE
      JOIN ${t.produto} P ON P.ID_IDENTIFICADOR = I.ID_IDENTIFICADOR
      WHERE (E.STATUS = 'A' OR E.STATUS IS NULL)
        AND ${where}
      ORDER BY I.ID_IDENTIFICADOR DESC`, params);
    return (rows || []).map((r) => {
      const id = Number(r.ID_IDENTIFICADOR);
      const f = flags[String(id)] || {};
      return {
        id_identificador: id,
        descricao: String(r.DESCRICAO || '').trim(),
        cod_barras: String(r.COD_BARRA || '').trim(),
        importar: f.importar === true,
        ciencia: f.ciencia === true,
      };
    });
  });
}

module.exports = {
  flag,
  definir,
  buscar,
};
