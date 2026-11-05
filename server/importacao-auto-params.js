'use strict';

const fs = require('fs');
const path = require('path');
const { getAppDataDir } = require('./config');
const { withDb, query, activeTargets, hasTable } = require('./db');

const FILE = 'importacao-auto-produtos.json';

function filePath() {
  return path.join(getAppDataDir(), FILE);
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
    const produtos = raw && typeof raw.produtos === 'object' && raw.produtos ? raw.produtos : {};
    return { importarTodos: raw?.importarTodos === true, produtos };
  } catch {
    return { importarTodos: false, produtos: {} };
  }
}

function save(store) {
  const dir = getAppDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath(), JSON.stringify({
    importarTodos: store.importarTodos === true,
    produtos: store.produtos || {},
  }), 'utf8');
}

function chave(idFornec, idIdent) {
  return `${Number(idFornec)}:${Number(idIdent)}`;
}

function flag(idFornec, idIdent) {
  const store = load();
  const par = store.produtos[chave(idFornec, idIdent)];
  if (par && typeof par.importar === 'boolean') {
    return { importar: par.importar === true, ciencia: par.ciencia === true };
  }
  const legado = store.produtos[String(Number(idIdent))];
  if (legado && typeof legado.importar === 'boolean') {
    return { importar: legado.importar === true, ciencia: legado.ciencia === true };
  }
  return { importar: store.importarTodos === true, ciencia: false };
}

function definir(idFornec, idIdent, patch = {}) {
  const forn = Number(idFornec);
  const id = Number(idIdent);
  if (!Number.isInteger(forn) || forn <= 0 || !Number.isInteger(id) || id <= 0) {
    const e = new Error('Produto inválido.');
    e.code = 'ID';
    throw e;
  }
  const store = load();
  const atual = store.produtos[chave(forn, id)] || store.produtos[String(id)] || {};
  store.produtos[chave(forn, id)] = {
    importar: patch.importar === undefined ? atual.importar === true : patch.importar === true,
    ciencia: patch.ciencia === undefined ? atual.ciencia === true : patch.ciencia === true,
  };
  save(store);
  return store.produtos[chave(forn, id)];
}

function sqlBase(t) {
  return `
    FROM TB_ESTOQUE_FORNECEDOR F
    JOIN TB_MT_CONVERSAO C
      ON C.ID_IDENTIFICADOR = F.ID_IDENTIFICADOR
     AND C.ID_FORNEC = F.ID_FORNEC
    JOIN ${t.identificador} I ON I.ID_IDENTIFICADOR = F.ID_IDENTIFICADOR
    JOIN ${t.estoque} E ON E.ID_ESTOQUE = I.ID_ESTOQUE
    JOIN ${t.produto} P ON P.ID_IDENTIFICADOR = I.ID_IDENTIFICADOR
    LEFT JOIN ${t.grupo} G ON G.ID_GRUPO = E.ID_GRUPO
    LEFT JOIN TB_FORNECEDOR FN ON FN.ID_FORNEC = F.ID_FORNEC
    WHERE TRIM(COALESCE(F.STATUS, 'A')) = 'A'
      AND (E.STATUS = 'A' OR E.STATUS IS NULL)`;
}

async function comConversao(db, fn) {
  try {
    await require('./importacao-conversao-gestor').ensureConversaoGestor(db);
  } catch (e) {
    console.warn('TB_MT_CONVERSAO:', e.message);
  }
  if (!hasTable('TB_ESTOQUE_FORNECEDOR') || !hasTable('TB_MT_CONVERSAO')) return null;
  return fn();
}

function filtros(q, grupo) {
  const where = [];
  const params = [];
  const termo = String(q || '').trim().slice(0, 80);
  const idGrupo = Number(grupo);
  if (Number.isInteger(idGrupo) && idGrupo > 0) {
    where.push('E.ID_GRUPO = ?');
    params.push(idGrupo);
  }
  if (termo) {
    const soNumero = /^\d+$/.test(termo);
    if (soNumero) {
      where.push(`(
        F.ID_IDENTIFICADOR = ?
        OR CAST(F.ID_IDENTIFICADOR AS VARCHAR(20)) STARTING WITH ?
        OR TRIM(CAST(P.COD_BARRA AS VARCHAR(60))) CONTAINING ?
        OR UPPER(COALESCE(P.REFERENCIA, '')) CONTAINING UPPER(?)
        OR UPPER(COALESCE(F.COD_NO_FORNECEDOR, '')) CONTAINING UPPER(?)
      )`);
      params.push(Number(termo), termo.slice(0, 20), termo, termo, termo);
    } else {
      where.push(`(
        UPPER(E.DESCRICAO) CONTAINING UPPER(?)
        OR UPPER(COALESCE(P.REFERENCIA, '')) CONTAINING UPPER(?)
        OR UPPER(COALESCE(P.COD_BARRA, '')) CONTAINING UPPER(?)
        OR UPPER(COALESCE(F.COD_NO_FORNECEDOR, '')) CONTAINING UPPER(?)
      )`);
      params.push(termo, termo, termo, termo);
    }
  }
  return { where, params };
}

function mapLinha(r, flags) {
  const id = Number(r.ID_IDENTIFICADOR);
  const idFornec = Number(r.ID_FORNEC);
  const f = flags(idFornec, id);
  return {
    id_identificador: id,
    id_fornec: idFornec,
    descricao: String(r.DESCRICAO || '').trim(),
    cod_barras: String(r.COD_BARRA || '').trim(),
    referencia: String(r.REFERENCIA || '').trim(),
    cod_fornecedor: String(r.COD_FORNECEDOR || '').trim(),
    id_grupo: r.ID_GRUPO == null ? null : Number(r.ID_GRUPO),
    grupo: String(r.GRUPO || '').trim(),
    fornecedor: String(r.FORNECEDOR || '').trim(),
    importar: f.importar === true,
  };
}

async function buscar(q, grupo) {
  const { where, params } = filtros(q, grupo);
  const extra = where.length ? ` AND ${where.join(' AND ')}` : '';
  return withDb(async (db, appCfg) => {
    const t = activeTargets(appCfg)[0]?.tables;
    if (!t) return { produtos: [], grupos: [], importarTodos: load().importarTodos === true };
    const out = await comConversao(db, async () => {
      const rows = await query(db, `
        SELECT FIRST 80 DISTINCT
          F.ID_IDENTIFICADOR,
          F.ID_FORNEC,
          TRIM(E.DESCRICAO) AS DESCRICAO,
          TRIM(COALESCE(P.COD_BARRA, '')) AS COD_BARRA,
          TRIM(COALESCE(P.REFERENCIA, '')) AS REFERENCIA,
          TRIM(COALESCE(F.COD_NO_FORNECEDOR, '')) AS COD_FORNECEDOR,
          E.ID_GRUPO,
          TRIM(COALESCE(G.DESCRICAO, '')) AS GRUPO,
          TRIM(COALESCE(NULLIF(TRIM(FN.NOME_FANTA), ''), FN.NOME, '')) AS FORNECEDOR
        ${sqlBase(t)}
        ${extra}
        ORDER BY 3, 2`, params);
      const gruposRows = await query(db, `
        SELECT DISTINCT E.ID_GRUPO, TRIM(COALESCE(G.DESCRICAO, '')) AS GRUPO
        ${sqlBase(t)}
          AND E.ID_GRUPO IS NOT NULL
        ORDER BY 2`, []);
      const f = (idFornec, id) => flag(idFornec, id);
      return {
        produtos: (rows || []).map((r) => mapLinha(r, f)),
        grupos: (gruposRows || [])
          .filter((g) => Number(g.ID_GRUPO) > 0)
          .map((g) => ({ id_grupo: Number(g.ID_GRUPO), descricao: String(g.GRUPO || '').trim() })),
        importarTodos: load().importarTodos === true,
      };
    });
    return out || { produtos: [], grupos: [], importarTodos: load().importarTodos === true };
  });
}

async function parametrizado(idFornec, idIdent) {
  const forn = Number(idFornec);
  const id = Number(idIdent);
  if (!forn || !id) return false;
  const achou = await withDb(async (db) => comConversao(db, async () => {
    const rows = await query(db, `
      SELECT FIRST 1 F.ID_IDENTIFICADOR
      FROM TB_ESTOQUE_FORNECEDOR F
      JOIN TB_MT_CONVERSAO C
        ON C.ID_IDENTIFICADOR = F.ID_IDENTIFICADOR
       AND C.ID_FORNEC = F.ID_FORNEC
      WHERE F.ID_FORNEC = ?
        AND F.ID_IDENTIFICADOR = ?
        AND TRIM(COALESCE(F.STATUS, 'A')) = 'A'`, [forn, id]);
    return !!rows[0];
  }));
  return achou === true;
}

async function aplicarTodos(marcar) {
  const ligado = marcar === true;
  const store = load();
  store.importarTodos = ligado;
  if (ligado) {
    const pares = await withDb(async (db, appCfg) => {
      const t = activeTargets(appCfg)[0]?.tables;
      if (!t) return [];
      const rows = await comConversao(db, async () => {
        const lista = await query(db, `
          SELECT DISTINCT F.ID_IDENTIFICADOR, F.ID_FORNEC
          ${sqlBase(t)}`, []);
        return lista || [];
      });
      return rows || [];
    });
    for (const r of pares) {
      const id = Number(r.ID_IDENTIFICADOR);
      const forn = Number(r.ID_FORNEC);
      if (!id || !forn) continue;
      const atual = store.produtos[chave(forn, id)] || {};
      store.produtos[chave(forn, id)] = {
        importar: true,
        ciencia: atual.ciencia === true,
      };
    }
  }
  save(store);
  return { importarTodos: store.importarTodos === true };
}

module.exports = {
  flag,
  definir,
  buscar,
  parametrizado,
  aplicarTodos,
  load,
};
