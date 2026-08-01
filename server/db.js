'use strict';
const Firebird = require('node-firebird');
const { loadAppConfig } = require('./config');

let tableCache = { checkedAt: 0, names: new Set() };
let schemaReady = false;

function buildFbOptions(appCfg, versionHint) {
  const opts = {
    host: appCfg.host || '127.0.0.1',
    port: Number(appCfg.port) || 3050,
    database: appCfg.database,
    user: appCfg.user || 'SYSDBA',
    password: appCfg.password || 'masterkey',
    lowercase_keys: false,
    charset: 'UTF8',
    pageSize: 4096,
  };
  if (versionHint === '5' || versionHint === 5) {
    opts.wireCrypt = 'Enabled';
  }
  return opts;
}

function attach(appCfg, versionHint) {
  return new Promise((resolve, reject) => {
    Firebird.attach(buildFbOptions(appCfg, versionHint), (err, db) => {
      if (err) reject(err);
      else resolve(db);
    });
  });
}

async function connectSmart(appCfg) {
  try {
    const db = await attach(appCfg, '2.5');
    return { db, fbVersion: '2.5' };
  } catch (err25) {
    try {
      const db = await attach(appCfg, '5');
      return { db, fbVersion: '5.0' };
    } catch (err5) {
      const msg = [err25.message, err5.message].filter(Boolean).join(' | ');
      throw new Error(msg || 'Falha ao conectar no Firebird');
    }
  }
}

function query(db, sql, params) {
  return new Promise((resolve, reject) => {
    const cb = (err, rows) => (err ? reject(err) : resolve(rows || []));
    if (params && params.length) db.query(sql, params, cb);
    else db.query(sql, cb);
  });
}

function detach(db) {
  return new Promise((resolve) => {
    try {
      db.detach(() => resolve());
    } catch {
      resolve();
    }
  });
}

async function withDb(fn) {
  const appCfg = loadAppConfig();
  const { db, fbVersion } = await connectSmart(appCfg);
  try {
    await ensureSchema(db);
    return await fn(db, appCfg, fbVersion);
  } finally {
    await detach(db);
  }
}

async function refreshTables(db) {
  const rows = await query(
    db,
    `SELECT TRIM(RDB$RELATION_NAME) AS NOME
     FROM RDB$RELATIONS
     WHERE RDB$SYSTEM_FLAG = 0`
  );
  tableCache = {
    checkedAt: Date.now(),
    names: new Set(rows.map((r) => String(r.NOME || '').trim().toUpperCase())),
  };
}

function hasTable(name) {
  return tableCache.names.has(String(name).toUpperCase());
}

async function columnExists(db, table, column) {
  const rows = await query(
    db,
    `SELECT 1 AS OK FROM RDB$RELATION_FIELDS
     WHERE TRIM(RDB$RELATION_NAME) = ?
       AND TRIM(RDB$FIELD_NAME) = ?`,
    [String(table).toUpperCase(), String(column).toUpperCase()]
  );
  return rows.length > 0;
}

async function ensureSchema(db) {
  if (schemaReady && Date.now() - tableCache.checkedAt < 60000) return;
  await refreshTables(db);
  await refreshGenerators(db);

  const targets = ['TB_EST_SALDO_ALTERADO'];
  if (hasTable('TB_EST_SALDO_ALTERADO_2')) targets.push('TB_EST_SALDO_ALTERADO_2');

  for (const table of targets) {
    if (!hasTable(table)) continue;
    const exists = await columnExists(db, table, 'OBSERVACAO');
    if (!exists) {
      await query(db, `ALTER TABLE ${table} ADD OBSERVACAO VARCHAR(200)`);
    }
  }

  try {
    const { ensureAuditSchema } = require('./audit');
    await ensureAuditSchema(db);
  } catch (err) {
    console.warn('Auditoria GESTOR_EST_ALTERACAO:', err.message);
  }

  schemaReady = true;
  await refreshTables(db);
}

function targetsForSistema(sistema) {
  const mode = String(sistema || 'clipp').toLowerCase();
  if (mode === 'managepro') return { clipp: false, manage: true };
  if (mode === 'ambos' || mode === 'clipp+managepro') return { clipp: true, manage: true };
  return { clipp: true, manage: false };
}

function stockTables(useManage) {
  const s = useManage ? '_2' : '';
  const estoque = `TB_ESTOQUE${s}`;
  const identificador = `TB_EST_IDENTIFICADOR${s}`;
  const produto = `TB_EST_PRODUTO${s}`;
  const saldo = `TB_EST_SALDO_ALTERADO${s}`;
  // Grupo costuma ser compartilhado (sem _2) no espelho ManagePro.
  const grupo = useManage && hasTable('TB_EST_GRUPO_2') ? 'TB_EST_GRUPO_2' : 'TB_EST_GRUPO';
  const lote = useManage && hasTable('TB_LOTE_2') ? 'TB_LOTE_2' : 'TB_LOTE';
  const serial = useManage && hasTable('TB_EST_SERIAL_2') ? 'TB_EST_SERIAL_2' : 'TB_EST_SERIAL';
  const nivel1 = useManage && hasTable('TB_EST_PROD_NIVEL1_2') ? 'TB_EST_PROD_NIVEL1_2' : 'TB_EST_PROD_NIVEL1';
  const nivel2 = useManage && hasTable('TB_EST_PROD_NIVEL2_2') ? 'TB_EST_PROD_NIVEL2_2' : 'TB_EST_PROD_NIVEL2';
  const genSaldo = useManage && generatorExists('GEN_TB_EST_SALDO_ALTERADO_2_ID')
    ? 'GEN_TB_EST_SALDO_ALTERADO_2_ID'
    : 'GEN_TB_EST_SALDO_ALTERADO_ID';
  const genGrupo = useManage && generatorExists('GEN_TB_EST_GRUPO_2_ID')
    ? 'GEN_TB_EST_GRUPO_2_ID'
    : 'GEN_TB_EST_GRUPO_ID';
  const genEstoque = useManage && generatorExists('GEN_TB_ESTOQUE_2_ID')
    ? 'GEN_TB_ESTOQUE_2_ID'
    : 'GEN_TB_ESTOQUE_ID';
  const genIdentificador = useManage && generatorExists('GEN_TB_EST_IDENTIFICADOR_2_ID')
    ? 'GEN_TB_EST_IDENTIFICADOR_2_ID'
    : 'GEN_TB_EST_IDENTIFICADOR_ID';
  return {
    estoque,
    identificador,
    produto,
    grupo,
    saldo,
    lote,
    serial,
    nivel1,
    nivel2,
    genSaldo,
    genGrupo,
    genEstoque,
    genIdentificador,
  };
}

let generatorCache = new Set();

function generatorExists(name) {
  return generatorCache.has(String(name).toUpperCase());
}

async function refreshGenerators(db) {
  const rows = await query(
    db,
    `SELECT TRIM(RDB$GENERATOR_NAME) AS NOME
     FROM RDB$GENERATORS
     WHERE RDB$SYSTEM_FLAG = 0`
  );
  generatorCache = new Set(rows.map((r) => String(r.NOME || '').trim().toUpperCase()));
}

function activeTargets(appCfg) {
  const flags = targetsForSistema(appCfg.sistema);
  const list = [];
  if (flags.clipp && hasTable('TB_ESTOQUE')) list.push({ manage: false, tables: stockTables(false) });
  if (flags.manage && hasTable('TB_ESTOQUE_2')) list.push({ manage: true, tables: stockTables(true) });
  if (!list.length && hasTable('TB_ESTOQUE')) list.push({ manage: false, tables: stockTables(false) });
  return list;
}

function detectImageMime(buf) {
  if (!buf || buf.length < 4) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return 'image/webp';
  return 'image/jpeg';
}

function readBlobBuffer(blob) {
  return new Promise((resolve, reject) => {
    if (!blob) return resolve(null);
    if (Buffer.isBuffer(blob)) return resolve(blob);
    if (blob.type === 'Buffer' && Array.isArray(blob.data)) {
      return resolve(Buffer.from(blob.data));
    }
    if (typeof blob !== 'function') return resolve(null);

    // node-firebird: LOGO chega como função async de leitura do blob
    blob((err, _name, event) => {
      if (err) return reject(err);
      const chunks = [];
      event.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'binary'));
      });
      event.on('end', () => resolve(Buffer.concat(chunks)));
      event.on('error', reject);
    });
  });
}

async function blobToDataUrl(blob) {
  try {
    const buf = await readBlobBuffer(blob);
    if (!buf || !buf.length) return null;
    const mime = detectImageMime(buf);
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

module.exports = {
  withDb,
  query,
  connectSmart,
  detach,
  hasTable,
  columnExists,
  ensureSchema,
  refreshTables,
  refreshGenerators,
  activeTargets,
  stockTables,
  targetsForSistema,
  blobToDataUrl,
  buildFbOptions,
};
