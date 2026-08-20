'use strict';

const fs = require('fs');
const path = require('path');
const { withDb, query } = require('./db');
const { loadAppConfig, saveAppConfig, getAppDataDir } = require('./config');

function paramsFile() {
  return path.join(getAppDataDir(), 'importacao-cfop-params.json');
}

function defaultRows() {
  return [
    { cfop_origem: '5102', cfop_conv: '1102', csosn: '102', cfop_saida_nfe: '5102', csosn_saida_nfe: '102', cst_saida_nfe: '', cfop_saida_cfe: '5102', csosn_saida_cfe: '102', cst_saida_cfe: '' },
    { cfop_origem: '5405', cfop_conv: '1403', csosn: '102', cfop_saida_nfe: '5405', csosn_saida_nfe: '500', cst_saida_nfe: '', cfop_saida_cfe: '5405', csosn_saida_cfe: '500', cst_saida_cfe: '' },
    { cfop_origem: '6102', cfop_conv: '2102', csosn: '102', cfop_saida_nfe: '6102', csosn_saida_nfe: '102', cst_saida_nfe: '', cfop_saida_cfe: '6102', csosn_saida_cfe: '102', cst_saida_cfe: '' },
    { cfop_origem: '6403', cfop_conv: '2403', csosn: '102', cfop_saida_nfe: '6403', csosn_saida_nfe: '500', cst_saida_nfe: '', cfop_saida_cfe: '6403', csosn_saida_cfe: '500', cst_saida_cfe: '' },
    { cfop_origem: '5403', cfop_conv: '1403', csosn: '102', cfop_saida_nfe: '5403', csosn_saida_nfe: '500', cst_saida_nfe: '', cfop_saida_cfe: '5403', csosn_saida_cfe: '500', cst_saida_cfe: '' },
    { cfop_origem: '5101', cfop_conv: '1102', csosn: '102', cfop_saida_nfe: '5101', csosn_saida_nfe: '102', cst_saida_nfe: '', cfop_saida_cfe: '5101', csosn_saida_cfe: '102', cst_saida_cfe: '' },
    { cfop_origem: '6101', cfop_conv: '2102', csosn: '102', cfop_saida_nfe: '6101', csosn_saida_nfe: '102', cst_saida_nfe: '', cfop_saida_cfe: '6101', csosn_saida_cfe: '102', cst_saida_cfe: '' },
  ];
}

function normRow(it = {}) {
  return {
    cfop_origem: String(it.cfop_origem || '').replace(/\D/g, '').slice(0, 4),
    cfop_conv: String(it.cfop_conv || '').replace(/\D/g, '').slice(0, 4),
    csosn: String(it.csosn || '102').replace(/\D/g, '').slice(0, 3) || '102',
    cfop_saida_nfe: String(it.cfop_saida_nfe || '').replace(/\D/g, '').slice(0, 4),
    csosn_saida_nfe: String(it.csosn_saida_nfe || '').replace(/\D/g, '').slice(0, 3),
    cst_saida_nfe: String(it.cst_saida_nfe || '').replace(/\D/g, '').slice(0, 3),
    cfop_saida_cfe: String(it.cfop_saida_cfe || '').replace(/\D/g, '').slice(0, 4),
    csosn_saida_cfe: String(it.csosn_saida_cfe || '').replace(/\D/g, '').slice(0, 3),
    cst_saida_cfe: String(it.cst_saida_cfe || '').replace(/\D/g, '').slice(0, 3),
  };
}

function loadLocalParams() {
  const p = paramsFile();
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function saveLocalParams(data) {
  fs.writeFileSync(paramsFile(), JSON.stringify(data, null, 2), 'utf8');
}

async function listCfopConv() {
  const local = loadLocalParams();
  if (local?.itens?.length) {
    return local.itens.map((r, i) => ({ id: i + 1, ...normRow(r) }));
  }

  try {
    const rows = await withDb(async (db) => query(db, `
      SELECT ID, CFOP_ORIGEM, CFOP_CONV
      FROM TB_CFOP_CONV
      ORDER BY CFOP_ORIGEM`));
    const itens = rows.map((r) => normRow({
      cfop_origem: r.CFOP_ORIGEM,
      cfop_conv: r.CFOP_CONV,
      csosn: '102',
    }));
    if (itens.length) return itens.map((r, i) => ({ id: i + 1, ...r }));
  } catch {
    /* ignore */
  }
  return defaultRows().map((r, i) => ({ id: i + 1, ...normRow(r) }));
}

async function saveCfopConv(itens) {
  const list = (Array.isArray(itens) ? itens : [])
    .map((it) => normRow(it))
    .filter((it) => it.cfop_origem.length === 4 && it.cfop_conv.length === 4);

  const local = loadLocalParams() || {};
  saveLocalParams({ ...local, itens: list });

  try {
    await withDb(async (db) => {
      await query(db, 'DELETE FROM TB_CFOP_CONV');
      let id = 0;
      for (const it of list) {
        id += 1;
        await query(db, `
          INSERT INTO TB_CFOP_CONV (ID, CFOP_ORIGEM, CFOP_CONV)
          VALUES (?, ?, ?)`, [id, it.cfop_origem, it.cfop_conv]);
      }
    });
  } catch (err) {
    console.warn('Falha ao sincronizar TB_CFOP_CONV:', err.message);
  }

  return listCfopConv();
}

function getSaidaPadrao() {
  const local = loadLocalParams();
  const s = local?.saida || {};
  return {
    cfop_saida: String(s.cfop_saida || '').trim(),
    csosn_saida: String(s.csosn_saida || '').trim(),
    aplicar_saida: (s.aplicar_saida === false || s.aplicar_saida === 'N') ? 'N' : 'S',
  };
}

function setSaidaPadrao(saida) {
  const local = loadLocalParams() || { itens: [] };
  local.saida = {
    cfop_saida: String(saida?.cfop_saida || '').replace(/\D/g, '').slice(0, 4),
    csosn_saida: String(saida?.csosn_saida || '').replace(/\D/g, '').slice(0, 3),
    aplicar_saida: (saida?.aplicar_saida === false || saida?.aplicar_saida === 'N') ? 'N' : 'S',
  };
  saveLocalParams(local);
  return local.saida;
}

function getCsosnPadrao() {
  const local = loadLocalParams();
  if (local?.csosn_padrao) return String(local.csosn_padrao).trim();
  const cfg = loadAppConfig();
  return String(cfg.importacao?.csosn_padrao || '102').trim();
}

function setCsosnPadrao(csosn) {
  const val = String(csosn || '102').replace(/\D/g, '').slice(0, 3) || '102';
  const local = loadLocalParams() || { itens: [] };
  local.csosn_padrao = val;
  saveLocalParams(local);
  const cfg = loadAppConfig();
  cfg.importacao = { ...(cfg.importacao || {}), csosn_padrao: val };
  saveAppConfig(cfg);
  return val;
}

async function getEmitenteUf() {
  return withDb(async (db) => {
    const rows = await query(db, `
      SELECT FIRST 1 C.SIGLA_UF AS UF
      FROM TB_EMITENTE E
      LEFT JOIN TB_CIDADE_SIS C ON C.ID_CIDADE = E.ID_CIDADE`);
    return String(rows[0]?.UF || '').trim().toUpperCase();
  });
}

function applyUfDigit(cfopConv, sameState) {
  const digits = String(cfopConv || '').replace(/\D/g, '').padStart(4, '0').slice(-4);
  const first = sameState ? '1' : '2';
  return `${first}${digits.slice(1)}`;
}

async function mapCfopEntrada(cfopOrigem, ufFornecedor) {
  const origem = String(cfopOrigem || '').replace(/\D/g, '').slice(0, 4);
  const ufForn = String(ufFornecedor || '').trim().toUpperCase();
  let emitUf = '';
  try {
    emitUf = await getEmitenteUf();
  } catch {
    emitUf = '';
  }
  const sameState = !!(emitUf && ufForn && emitUf === ufForn);
  const inferredSame = origem.startsWith('5') ? true : origem.startsWith('6') ? false : sameState;
  const useSame = emitUf && ufForn ? sameState : inferredSame;

  const rows = await listCfopConv();
  const found = rows.find((r) => r.cfop_origem === origem);
  const baseConv = found?.cfop_conv || (origem ? applyUfDigit(origem, useSame) : '');
  const cfopEntrada = baseConv ? applyUfDigit(baseConv, useSame) : '';
  const csosn = found?.csosn || getCsosnPadrao();
  const saidaPad = getSaidaPadrao();

  return {
    cfop_origem: origem,
    cfop_entrada: cfopEntrada,
    csosn,
    cfop_saida: found?.cfop_saida_nfe || saidaPad.cfop_saida || '',
    csosn_saida: found?.csosn_saida_nfe || saidaPad.csosn_saida || '',
    cst_saida: found?.cst_saida_nfe || '',
    cfop_cfe: found?.cfop_saida_cfe || found?.cfop_saida_nfe || '',
    csosn_cfe: found?.csosn_saida_cfe || found?.csosn_saida_nfe || '',
    cst_cfe: found?.cst_saida_cfe || '',
    uf_fornecedor: ufForn,
    uf_emitente: emitUf,
    same_state: useSame,
  };
}

module.exports = {
  listCfopConv,
  saveCfopConv,
  getCsosnPadrao,
  setCsosnPadrao,
  getSaidaPadrao,
  setSaidaPadrao,
  mapCfopEntrada,
  getEmitenteUf,
  applyUfDigit,
};
