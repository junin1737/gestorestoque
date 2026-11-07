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

function textoNumero(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return n.toFixed(4).replace(/\.?0+$/, '').replace('.', ',');
}

function textoPreenchido(v) {
  return String(v == null ? '' : v).trim();
}

function mapLinha(r, flags, conversoes) {
  const id = Number(r.ID_IDENTIFICADOR);
  const idFornec = Number(r.ID_FORNEC);
  const f = flags(idFornec, id);
  const fatores = conversoes.get(`${idFornec}:${id}`) || [];
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
    cfop: textoPreenchido(r.CFOP),
    cst: textoPreenchido(r.CST),
    csosn: textoPreenchido(r.CSOSN),
    aliq_icms: Number(r.ALIQ_ICMS) > 0 ? textoNumero(r.ALIQ_ICMS) : '',
    uni_medida: textoPreenchido(r.UNI_MEDIDA),
    conversor_clipp: Number(r.CONVERSOR) > 0 ? textoNumero(r.CONVERSOR) : '',
    cst_ipi: textoPreenchido(r.CST_IPI),
    ipi: Number(r.IPI) > 0 ? textoNumero(r.IPI) : '',
    cst_pis: textoPreenchido(r.CST_PIS),
    pis: Number(r.PIS) > 0 ? textoNumero(r.PIS) : '',
    cst_cofins: textoPreenchido(r.CST_COFINS),
    cofins: Number(r.COFINS) > 0 ? textoNumero(r.COFINS) : '',
    mva: Number(r.MVA) > 0 ? textoNumero(r.MVA) : '',
    conversoes: fatores,
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
          TRIM(COALESCE(NULLIF(TRIM(FN.NOME_FANTA), ''), FN.NOME, '')) AS FORNECEDOR,
          TRIM(COALESCE(F.CFOP, '')) AS CFOP,
          TRIM(COALESCE(F.CST, '')) AS CST,
          TRIM(COALESCE(F.CSOSN, '')) AS CSOSN,
          F.ALIQ_ICMS,
          TRIM(COALESCE(F.UNI_MEDIDA, '')) AS UNI_MEDIDA,
          ${hasTable('TB_UNI_MEDIDA')
            ? `(SELECT FIRST 1 U.CONVERSOR FROM TB_UNI_MEDIDA U
                WHERE UPPER(TRIM(U.UNIDADE)) = UPPER(TRIM(F.UNI_MEDIDA)))`
            : 'CAST(NULL AS NUMERIC(18,4))'} AS CONVERSOR,
          TRIM(COALESCE(F.CST_IPI, '')) AS CST_IPI,
          F.IPI,
          TRIM(COALESCE(F.CST_PIS, '')) AS CST_PIS,
          F.PIS,
          TRIM(COALESCE(F.CST_COFINS, '')) AS CST_COFINS,
          F.COFINS,
          F.MVA
        ${sqlBase(t)}
        ${extra}
        ORDER BY 3, 2`, params);
      const gruposRows = await query(db, `
        SELECT DISTINCT E.ID_GRUPO, TRIM(COALESCE(G.DESCRICAO, '')) AS GRUPO
        ${sqlBase(t)}
          AND E.ID_GRUPO IS NOT NULL
        ORDER BY 2`, []);
      const ids = [...new Set((rows || []).map((r) => Number(r.ID_IDENTIFICADOR)).filter((n) => n > 0))];
      const conversoes = new Map();
      if (ids.length) {
        const fatores = await query(db, `
          SELECT ID_IDENTIFICADOR, ID_FORNEC,
                 TRIM(COALESCE(UNI_XML, '')) AS UNI_XML,
                 TRIM(COALESCE(UNI_ESTOQUE, '')) AS UNI_ESTOQUE,
                 CONVERSOR, TRIM(COALESCE(PACOTE, '')) AS PACOTE
          FROM TB_MT_CONVERSAO
          WHERE ID_IDENTIFICADOR IN (${ids.join(',')})`, []);
        for (const c of fatores || []) {
          const chaveConv = `${Number(c.ID_FORNEC)}:${Number(c.ID_IDENTIFICADOR)}`;
          const lista = conversoes.get(chaveConv) || [];
          const pacote = String(c.PACOTE || '').trim().toUpperCase() === 'S';
          const fator = Number(c.CONVERSOR);
          const uniXml = String(c.UNI_XML || '').trim();
          const uniEst = String(c.UNI_ESTOQUE || '').trim();
          const texto = pacote
            ? `${textoNumero(fator) || '1'} pacote(s)`
            : [uniXml, fator > 0 ? `× ${textoNumero(fator)}` : '', uniEst].filter(Boolean).join(' ');
          if (texto && !lista.includes(texto)) lista.push(texto);
          conversoes.set(chaveConv, lista);
        }
      }
      const f = (idFornec, id) => flag(idFornec, id);
      return {
        produtos: (rows || []).map((r) => mapLinha(r, f, conversoes)),
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
