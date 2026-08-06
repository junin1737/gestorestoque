'use strict';
const { query, hasTable, columnExists, refreshTables, refreshGenerators } = require('./db');
const { localNow } = require('./datetime');

const AUDIT_TABLE = 'GESTOR_EST_ALTERACAO';
const AUDIT_GEN = 'GEN_GESTOR_EST_ALTERACAO_ID';

const FIELD_META = {
  descricao: { tipo: 'ficha', label: 'Descrição' },
  id_grupo: { tipo: 'ficha', label: 'Grupo' },
  uni_medida: { tipo: 'ficha', label: 'Unidade' },
  cod_barras: { tipo: 'ficha', label: 'Cód. barras' },
  referencia: { tipo: 'ficha', label: 'Referência' },
  desc_cmpl: { tipo: 'ficha', label: 'Compl.' },
  grade_serie: { tipo: 'ficha', label: 'Grade/Série' },
  id_nivel1: { tipo: 'ficha', label: 'Cor' },
  id_nivel2: { tipo: 'ficha', label: 'Tamanho' },
  controla_lote: { tipo: 'ficha', label: 'Controla lote' },
  status: { tipo: 'ficha', label: 'Status' },
  prc_venda: { tipo: 'precos', label: 'Preço venda' },
  prc_custo: { tipo: 'precos', label: 'Preço custo' },
  qtd_atual: { tipo: 'quantidade', label: 'Quantidade' },
};

function fmtAuditVal(v, campo) {
  if (campo === 'status') {
    const s = String(v || 'A').trim().toUpperCase();
    return s === 'I' ? 'Inativo' : 'Ativo';
  }
  if (v == null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (typeof v === 'number' && Number.isFinite(v)) {
    return String(Number(v));
  }
  return String(v).trim() || '—';
}

function sameVal(a, b) {
  if (a == null && (b == null || b === '')) return true;
  if (b == null && (a == null || a === '')) return true;
  if (typeof a === 'number' || typeof b === 'number') {
    return Number(a || 0) === Number(b || 0);
  }
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    return !!a === !!b;
  }
  return String(a ?? '').trim() === String(b ?? '').trim();
}

async function ensureAuditSchema(db) {
  await refreshTables(db);
  await refreshGenerators(db);

  if (!hasTable(AUDIT_TABLE)) {
    await query(
      db,
      `CREATE TABLE ${AUDIT_TABLE} (
        ID INTEGER NOT NULL,
        DATA DATE,
        HORA TIME,
        ID_IDENTIFICADOR INTEGER,
        ID_ESTOQUE INTEGER,
        TIPO VARCHAR(20),
        RESUMO VARCHAR(300),
        DETALHE VARCHAR(1000),
        ID_FUNCIONARIO INTEGER,
        USUARIO VARCHAR(80),
        OBSERVACAO VARCHAR(200),
        CONSTRAINT PK_GESTOR_EST_ALTERACAO PRIMARY KEY (ID)
      )`
    );
  }

  const gens = await query(
    db,
    `SELECT 1 AS OK FROM RDB$GENERATORS WHERE TRIM(RDB$GENERATOR_NAME) = ?`,
    [AUDIT_GEN]
  );
  if (!gens.length) {
    await query(db, `CREATE GENERATOR ${AUDIT_GEN}`);
    await query(db, `SET GENERATOR ${AUDIT_GEN} TO 0`);
  }

  await refreshTables(db);
  await refreshGenerators(db);
}

async function nextAuditId(db) {
  try {
    const rows = await query(db, `SELECT GEN_ID(${AUDIT_GEN}, 1) AS ID FROM RDB$DATABASE`);
    return Number(rows[0].ID);
  } catch {
    const max = await query(db, `SELECT COALESCE(MAX(ID),0)+1 AS ID FROM ${AUDIT_TABLE}`);
    return Number(max[0].ID);
  }
}

async function insertAudit(db, entry) {
  if (!hasTable(AUDIT_TABLE)) await ensureAuditSchema(db);
  const id = await nextAuditId(db);
  const agora = localNow();
  await query(
    db,
    `INSERT INTO ${AUDIT_TABLE}
      (ID, DATA, HORA, ID_IDENTIFICADOR, ID_ESTOQUE, TIPO, RESUMO, DETALHE, ID_FUNCIONARIO, USUARIO, OBSERVACAO)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      agora.dataSql,
      agora.horaSql,
      Number(entry.id_identificador) || 0,
      Number(entry.id_estoque) || 0,
      String(entry.tipo || 'ficha').slice(0, 20),
      String(entry.resumo || '').slice(0, 300),
      String(entry.detalhe || '').slice(0, 1000),
      Number(entry.id_funcionario) || 0,
      String(entry.usuario || '').slice(0, 80),
      String(entry.observacao || '').slice(0, 200),
    ]
  );
  return id;
}

function collectChanges(antes, depois) {
  const byTipo = { ficha: [], precos: [], quantidade: [] };
  for (const [campo, meta] of Object.entries(FIELD_META)) {
    if (!(campo in depois)) continue;
    const antigo = antes[campo];
    const novo = depois[campo];
    if (sameVal(antigo, novo)) continue;
    byTipo[meta.tipo].push({
      campo,
      label: meta.label,
      antigo: fmtAuditVal(antigo, campo),
      novo: fmtAuditVal(novo, campo),
    });
  }
  return byTipo;
}

async function logProductChanges(db, { antes, depois, id_identificador, id_estoque, id_funcionario, usuario }) {
  const byTipo = collectChanges(antes, depois);
  const obs = `Alterado via painel - ${usuario || 'usuário'}`;
  const ids = [];
  // quantidade continua em TB_EST_SALDO_ALTERADO (ERP); aqui só ficha/preços
  for (const tipo of ['ficha', 'precos']) {
    const list = byTipo[tipo];
    if (!list.length) continue;
    const resumo = list.map((c) => c.label).join(', ');
    const detalhe = list.map((c) => `${c.label}: ${c.antigo} → ${c.novo}`).join(' | ');
    const id = await insertAudit(db, {
      id_identificador,
      id_estoque,
      tipo,
      resumo,
      detalhe,
      id_funcionario,
      usuario,
      observacao: obs,
    });
    ids.push(id);
  }
  return ids;
}

async function logProductCreate(db, { id_identificador, id_estoque, descricao, id_funcionario, usuario, detalhe }) {
  return insertAudit(db, {
    id_identificador,
    id_estoque,
    tipo: 'cadastro',
    resumo: 'Produto cadastrado',
    detalhe: detalhe || `Descrição: ${descricao || '—'}`,
    id_funcionario,
    usuario,
    observacao: `Cadastrado via painel - ${usuario || 'usuário'}`,
  });
}

module.exports = {
  AUDIT_TABLE,
  FIELD_META,
  ensureAuditSchema,
  insertAudit,
  collectChanges,
  logProductChanges,
  logProductCreate,
  fmtAuditVal,
  hasAuditTable: () => hasTable(AUDIT_TABLE),
  columnExists,
};
