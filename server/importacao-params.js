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

function ynFlag(v, def = 'S') {
  if (v === true || v === 'S' || v === 's' || v === 1 || v === '1') return 'S';
  if (v === false || v === 'N' || v === 'n' || v === 0 || v === '0') return 'N';
  return def;
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
    id_cti: String(it.id_cti || '').trim().slice(0, 10),
    id_cti_cfe: String(it.id_cti_cfe || '').trim().slice(0, 10),
    cti_label: String(it.cti_label || '').trim().slice(0, 120),
    cti_cfe_label: String(it.cti_cfe_label || '').trim().slice(0, 120),
    gera_estoque: ynFlag(it.gera_estoque, 'S'),
    gera_financeiro: ynFlag(it.gera_financeiro, 'S'),
  };
}

function findCfopConvByEntrada(cfopEntrada) {
  const cfop = String(cfopEntrada || '').replace(/\D/g, '').slice(0, 4);
  if (!cfop) return null;
  const rows = (() => {
    try {
      const local = loadLocalParams();
      if (local?.itens?.length) return local.itens.map(normRow);
    } catch { /* ignore */ }
    return [];
  })();
  return rows.find((r) => r.cfop_conv === cfop)
    || rows.find((r) => r.cfop_origem === cfop)
    || null;
}

/**
 * Resolve se o CFOP/item gera estoque e financeiro.
 * Prioridade: flags do item → linha dos parâmetros → padrão S.
 */
function resolveMovimentoFlags({ cfop, sistema } = {}) {
  const sys = sistema || {};
  const row = findCfopConvByEntrada(cfop || sys.cfop);
  const geraEstoque = (sys.gera_estoque === 'S' || sys.gera_estoque === 'N')
    ? sys.gera_estoque
    : (row ? row.gera_estoque : 'S');
  const geraFinanceiro = (sys.gera_financeiro === 'S' || sys.gera_financeiro === 'N')
    ? sys.gera_financeiro
    : (row ? row.gera_financeiro : 'S');
  return {
    gera_estoque: ynFlag(geraEstoque, 'S'),
    gera_financeiro: ynFlag(geraFinanceiro, 'S'),
    origem: (sys.gera_estoque === 'S' || sys.gera_estoque === 'N' || sys.gera_financeiro === 'S' || sys.gera_financeiro === 'N')
      ? 'item'
      : (row ? 'params' : 'padrao'),
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
    obrigar_financeiro: (s.obrigar_financeiro === false || s.obrigar_financeiro === 'N') ? 'N' : 'S',
    zerar_negativo: (s.zerar_negativo === true || s.zerar_negativo === 'S') ? 'S' : 'N',
    // S = só avança de etapa da conferência do item ao confirmar
    conferir_etapas: (s.conferir_etapas === true || s.conferir_etapas === 'S') ? 'S' : 'N',
  };
}

function setSaidaPadrao(saida) {
  const local = loadLocalParams() || { itens: [] };
  const prev = local.saida || {};
  local.saida = {
    cfop_saida: String(saida?.cfop_saida || '').replace(/\D/g, '').slice(0, 4),
    csosn_saida: String(saida?.csosn_saida || '').replace(/\D/g, '').slice(0, 3),
    aplicar_saida: (saida?.aplicar_saida === false || saida?.aplicar_saida === 'N') ? 'N' : 'S',
    obrigar_financeiro: (saida?.obrigar_financeiro === false || saida?.obrigar_financeiro === 'N') ? 'N' : 'S',
    zerar_negativo: (saida?.zerar_negativo === true || saida?.zerar_negativo === 'S')
      ? 'S'
      : (saida?.zerar_negativo === false || saida?.zerar_negativo === 'N')
        ? 'N'
        : ((prev.zerar_negativo === true || prev.zerar_negativo === 'S') ? 'S' : 'N'),
    conferir_etapas: (saida?.conferir_etapas === true || saida?.conferir_etapas === 'S')
      ? 'S'
      : (saida?.conferir_etapas === false || saida?.conferir_etapas === 'N')
        ? 'N'
        : ((prev.conferir_etapas === true || prev.conferir_etapas === 'S') ? 'S' : 'N'),
  };
  saveLocalParams(local);
  return local.saida;
}

function normConversao(it = {}) {
  return {
    uni_xml: String(it.uni_xml || '').trim().toUpperCase().slice(0, 10),
    uni_estoque: String(it.uni_estoque || '').trim().toUpperCase().slice(0, 10),
    conversor: Number(it.conversor || 1) || 1,
    updatedAt: it.updatedAt || new Date().toISOString(),
  };
}

function listConversoes() {
  const local = loadLocalParams();
  const list = Array.isArray(local?.conversoes) ? local.conversoes.map(normConversao) : [];
  return list
    .filter((c) => c.uni_xml && c.uni_estoque)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function saveConversoes(itens) {
  const local = loadLocalParams() || { itens: [] };
  local.conversoes = (Array.isArray(itens) ? itens : [])
    .map(normConversao)
    .filter((c) => c.uni_xml && c.uni_estoque);
  saveLocalParams(local);
  return listConversoes();
}

function upsertConversao({ uni_xml, uni_estoque, conversor, id_identificador }) {
  const row = normConversao({ uni_xml, uni_estoque, conversor, updatedAt: new Date().toISOString() });
  if (!row.uni_xml || !row.uni_estoque) return listConversoes();
  const local = loadLocalParams() || { itens: [] };
  const rest = (Array.isArray(local.conversoes) ? local.conversoes : [])
    .map(normConversao)
    .filter((c) => c.uni_xml !== row.uni_xml);
  rest.push(row);
  local.conversoes = rest.slice(-80);
  const id = Number(id_identificador || 0);
  if (id) {
    const prod = Array.isArray(local.conversoes_produto) ? local.conversoes_produto : [];
    local.conversoes_produto = prod
      .filter((c) => Number(c.id_identificador) !== id)
      .concat([{ ...row, id_identificador: id }])
      .slice(-200);
  }
  saveLocalParams(local);
  return row;
}

function findConversao(uniXml, idIdentificador) {
  const local = loadLocalParams();
  const id = Number(idIdentificador || 0);
  if (id) {
    const prod = Array.isArray(local?.conversoes_produto) ? local.conversoes_produto : [];
    const found = prod.find((c) => Number(c.id_identificador) === id);
    if (found) return normConversao(found);
  }
  const xml = String(uniXml || '').trim().toUpperCase();
  if (!xml) return null;
  return listConversoes().find((c) => c.uni_xml === xml) || null;
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
    id_cti: found?.id_cti || '',
    id_cti_cfe: found?.id_cti_cfe || '',
    cti_label: found?.cti_label || '',
    cti_cfe_label: found?.cti_cfe_label || '',
    gera_estoque: found ? ynFlag(found.gera_estoque, 'S') : 'S',
    gera_financeiro: found ? ynFlag(found.gera_financeiro, 'S') : 'S',
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
  listConversoes,
  saveConversoes,
  upsertConversao,
  findConversao,
  findCfopConvByEntrada,
  resolveMovimentoFlags,
  ynFlag,
  mapCfopEntrada,
  getEmitenteUf,
  applyUfDigit,
};
