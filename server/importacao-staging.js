'use strict';
/**
 * Staging de importação NF-e — preparado para sync futuro com replicador.
 * Estrutura de sessão/item pensada para espelhar na nuvem (JSON document).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getAppDataDir } = require('./config');

const STORE_FILE = path.join(getAppDataDir(), 'importacao-sessoes.json');

function ensureStore() {
  const dir = path.dirname(STORE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify({ sessoes: [] }, null, 2), 'utf8');
  }
}

function loadStore() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch {
    return { sessoes: [] };
  }
}

function saveStore(data) {
  ensureStore();
  fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function newId() {
  return crypto.randomBytes(8).toString('hex');
}

/** Dados mock para protótipo — substituir por consulta DF-e + parse XML. */
function mockXmlFromChave(chave) {
  const ch = String(chave || '').replace(/\D/g, '');
  if (ch.length !== 44) return null;
  const itens = [
    {
      nItem: 1,
      cProd: '19661',
      cEAN: '7891234567890',
      xProd: 'CHOCO.PO JUNCO 50% CACAU 200GR 1X200GR',
      NCM: '18061000',
      CFOP: '1102',
      uCom: 'UN',
      qCom: 12,
      vUnCom: 8.9,
      vDesc: 0,
      vFrete: 0,
      vOutro: 0,
      imposto: {
        orig: '0', CST: '00', CSOSN: '', vBC: 106.8, pICMS: 12, vICMS: 12.82,
        vBCST: 0, vICMSST: 0, CST_IPI: '53', vIPI: 0, CST_PIS: '01', vPIS: 1.75,
        CST_COFINS: '01', vCOFINS: 8.05,
      },
    },
    {
      nItem: 2,
      cProd: '711',
      cEAN: '7899876543210',
      xProd: 'BEB.LEITE TRIANGULO INTEGRAL 1LT 12X1LT',
      NCM: '04012010',
      CFOP: '1102',
      uCom: 'CX',
      qCom: 4,
      vUnCom: 42.5,
      vDesc: 0,
      vFrete: 5,
      vOutro: 0,
      imposto: {
        orig: '0', CST: '00', CSOSN: '', vBC: 170, pICMS: 12, vICMS: 20.4,
        vBCST: 0, vICMSST: 0, CST_IPI: '53', vIPI: 0, CST_PIS: '01', vPIS: 2.79,
        CST_COFINS: '01', vCOFINS: 12.84,
      },
    },
    {
      nItem: 3,
      cProd: '5199',
      cEAN: '',
      xProd: 'BISC.KROKERO ROSQUINHA COCO 1.5KG 1x1,5KG',
      NCM: '19053100',
      CFOP: '1102',
      uCom: 'UN',
      qCom: 6,
      vUnCom: 14.2,
      vDesc: 0,
      vFrete: 0,
      vOutro: 0,
      imposto: {
        orig: '0', CST: '00', CSOSN: '', vBC: 85.2, pICMS: 12, vICMS: 10.22,
        vBCST: 0, vICMSST: 0, CST_IPI: '53', vIPI: 0, CST_PIS: '01', vPIS: 1.4,
        CST_COFINS: '01', vCOFINS: 6.43,
      },
    },
    {
      nItem: 4,
      cProd: '5200',
      cEAN: '',
      xProd: 'BISC.KROKERO ROSQUINHA LEITE 1.5KG 1x1,5KG',
      NCM: '19053100',
      CFOP: '1102',
      uCom: 'UN',
      qCom: 6,
      vUnCom: 14.2,
      vDesc: 0,
      vFrete: 0,
      vOutro: 0,
      imposto: {
        orig: '0', CST: '00', CSOSN: '', vBC: 85.2, pICMS: 12, vICMS: 10.22,
        vBCST: 0, vICMSST: 0, CST_IPI: '53', vIPI: 0, CST_PIS: '01', vPIS: 1.4,
        CST_COFINS: '01', vCOFINS: 6.43,
      },
    },
    {
      nItem: 5,
      cProd: '18300',
      cEAN: '7891112223334',
      xProd: 'BISC.VILMA MAISENA 360GR 20X360GR',
      NCM: '19053100',
      CFOP: '1102',
      uCom: 'CX',
      qCom: 2,
      vUnCom: 68,
      vDesc: 0,
      vFrete: 0,
      vOutro: 0,
      imposto: {
        orig: '0', CST: '00', CSOSN: '', vBC: 136, pICMS: 12, vICMS: 16.32,
        vBCST: 0, vICMSST: 0, CST_IPI: '53', vIPI: 0, CST_PIS: '01', vPIS: 2.23,
        CST_COFINS: '01', vCOFINS: 10.26,
      },
    },
  ];

  return {
    chave: ch,
    ide: {
      nNF: '123456',
      serie: '1',
      dhEmi: new Date().toISOString(),
      natOp: 'COMPRA PARA COMERCIALIZACAO',
    },
    emit: {
      CNPJ: '12345678000190',
      xNome: 'FORNECEDOR XYZ LTDA',
      xFant: 'FORNECEDOR XYZ',
    },
    total: {
      vNF: 583.2,
      vProd: 578.2,
      vDesc: 0,
      vFrete: 5,
      vSeg: 0,
      vOutro: 0,
    },
    cobr: {
      nFat: '123456-1',
      vOrig: 583.2,
      vLiq: 583.2,
      dup: [
        { nDup: '001', dVenc: '2026-09-20', vDup: 291.6 },
        { nDup: '002', dVenc: '2026-10-20', vDup: 291.6 },
      ],
    },
    itens,
  };
}

function buildSistemaFromXmlItem(xmlItem) {
  const imp = xmlItem.imposto || {};
  return {
    id_identificador: null,
    descricao: '',
    cod_fornecedor: xmlItem.cProd,
    cod_barras: '',
    ncm: xmlItem.NCM,
    cfop: xmlItem.CFOP,
    uni_medida: xmlItem.uCom,
    qtd: xmlItem.qCom,
    prc_custo: xmlItem.vUnCom,
    prc_venda: Number((xmlItem.vUnCom * 1.45).toFixed(4)),
    v_desc: xmlItem.vDesc || 0,
    v_frete: xmlItem.vFrete || 0,
    v_outro: xmlItem.vOutro || 0,
    tributos: {
      origem: imp.orig || '0',
      cst_icms: imp.CST || '',
      csosn: imp.CSOSN || '102',
      v_bc_icms: imp.vBC || 0,
      p_icms: imp.pICMS || 0,
      v_icms: imp.vICMS || 0,
      v_bc_st: imp.vBCST || 0,
      v_icms_st: imp.vICMSST || 0,
      cst_ipi: imp.CST_IPI || '',
      v_ipi: imp.vIPI || 0,
      cst_pis: imp.CST_PIS || '',
      v_pis: imp.vPIS || 0,
      cst_cofins: imp.CST_COFINS || '',
      v_cofins: imp.vCOFINS || 0,
    },
    criar_novo: false,
  };
}

function itemStatus(item) {
  if (item.conferido) return 'conferido';
  if (item.sistema?.id_identificador || item.sistema?.criar_novo) return 'vinculado';
  return 'pendente';
}

function mapItemForClient(item) {
  return {
    ...item,
    status: itemStatus(item),
  };
}

function mapSessaoForClient(s) {
  const itens = (s.itens || []).map(mapItemForClient);
  return {
    id: s.id,
    chave: s.chave,
    status: s.status,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    xml: s.xml,
    financeiro: s.financeiro,
    itens,
    resumo: {
      total: itens.length,
      conferidos: itens.filter((i) => i.status === 'conferido').length,
      pendentes: itens.filter((i) => i.status === 'pendente').length,
    },
  };
}

function createSessao(chave) {
  const xml = mockXmlFromChave(chave);
  if (!xml) return { ok: false, error: 'Chave inválida. Informe 44 dígitos.' };

  const store = loadStore();
  const dup = store.sessoes.find((s) => s.chave === xml.chave && s.status === 'confirmada');
  if (dup) {
    return { ok: false, error: 'Esta NF-e já foi importada anteriormente.', code: 'DUPLICADA' };
  }

  const now = new Date().toISOString();
  const itens = xml.itens.map((xi) => ({
    nItem: xi.nItem,
    xml: xi,
    match: null,
    sistema: buildSistemaFromXmlItem(xi),
    conferido: false,
    observacao: '',
  }));

  const sessao = {
    id: newId(),
    chave: xml.chave,
    status: 'em_conferencia',
    createdAt: now,
    updatedAt: now,
    xml: {
      ide: xml.ide,
      emit: xml.emit,
      total: xml.total,
    },
    financeiro: {
      ...xml.cobr,
      forma_pagto: 'Duplicata',
      parcelas: (xml.cobr.dup || []).map((d) => ({ ...d })),
    },
    itens,
    _sync: { version: 1, pendingCloud: true },
  };

  store.sessoes.unshift(sessao);
  saveStore(store);
  return { ok: true, sessao: mapSessaoForClient(sessao) };
}

function listSessoes() {
  const store = loadStore();
  return store.sessoes
    .filter((s) => s.status !== 'confirmada')
    .map(mapSessaoForClient);
}

function getSessao(id) {
  const store = loadStore();
  const s = store.sessoes.find((x) => x.id === id);
  if (!s) return null;
  return mapSessaoForClient(s);
}

function updateItem(sessaoId, nItem, patch) {
  const store = loadStore();
  const s = store.sessoes.find((x) => x.id === sessaoId);
  if (!s) return { ok: false, error: 'Sessão não encontrada' };
  const item = s.itens.find((i) => Number(i.nItem) === Number(nItem));
  if (!item) return { ok: false, error: 'Item não encontrado' };

  if (patch.sistema) {
    item.sistema = { ...item.sistema, ...patch.sistema };
    if (patch.sistema.tributos) {
      item.sistema.tributos = { ...item.sistema.tributos, ...patch.sistema.tributos };
    }
  }
  if (patch.match !== undefined) item.match = patch.match;
  if (patch.conferido !== undefined) item.conferido = !!patch.conferido;
  if (patch.observacao !== undefined) item.observacao = String(patch.observacao || '');

  s.updatedAt = new Date().toISOString();
  s._sync = { ...(s._sync || {}), version: (s._sync?.version || 0) + 1, pendingCloud: true };
  saveStore(store);
  return { ok: true, item: mapItemForClient(item), sessao: mapSessaoForClient(s) };
}

function updateFinanceiro(sessaoId, financeiro) {
  const store = loadStore();
  const s = store.sessoes.find((x) => x.id === sessaoId);
  if (!s) return { ok: false, error: 'Sessão não encontrada' };
  s.financeiro = { ...s.financeiro, ...financeiro };
  if (financeiro.parcelas) s.financeiro.parcelas = financeiro.parcelas;
  s.updatedAt = new Date().toISOString();
  s._sync = { ...(s._sync || {}), version: (s._sync?.version || 0) + 1, pendingCloud: true };
  saveStore(store);
  return { ok: true, sessao: mapSessaoForClient(s) };
}

function confirmarSessao(sessaoId) {
  const store = loadStore();
  const s = store.sessoes.find((x) => x.id === sessaoId);
  if (!s) return { ok: false, error: 'Sessão não encontrada' };
  const pend = s.itens.filter((i) => !i.conferido && itemStatus(i) === 'pendente');
  if (pend.length) {
    return { ok: false, error: `${pend.length} item(ns) sem vinculação. Conferir antes de gravar.` };
  }
  const naoConf = s.itens.filter((i) => !i.conferido);
  if (naoConf.length) {
    return { ok: false, error: `${naoConf.length} item(ns) ainda não conferidos.` };
  }
  s.status = 'confirmada';
  s.updatedAt = new Date().toISOString();
  s._sync = { ...(s._sync || {}), version: (s._sync?.version || 0) + 1, pendingCloud: true };
  saveStore(store);
  return {
    ok: true,
    message: 'Protótipo: gravação simulada. Integração com rotina nativa de entrada na próxima fase.',
    sessao: mapSessaoForClient(s),
  };
}

function buscarProdutos(q) {
  const term = String(q || '').trim().toLowerCase();
  const mock = [
    { id_identificador: 4521, descricao: 'Parafuso Sextavado 6x20', cod_barras: '7891234567890', referencia: 'PAR-620' },
    { id_identificador: 4522, descricao: 'Porca Sextavada M6', cod_barras: '7899876543210', referencia: 'POR-M6' },
    { id_identificador: 4523, descricao: 'Arruela Lisa M6', cod_barras: '7891112223334', referencia: 'ARR-M6' },
    { id_identificador: 4600, descricao: 'Parafuso Allen 8x30', cod_barras: '7895556667778', referencia: 'ALL-830' },
  ];
  if (!term) return mock;
  return mock.filter(
    (p) =>
      p.descricao.toLowerCase().includes(term)
      || String(p.cod_barras).includes(term)
      || p.referencia.toLowerCase().includes(term)
      || String(p.id_identificador).includes(term)
  );
}

module.exports = {
  createSessao,
  listSessoes,
  getSessao,
  updateItem,
  updateFinanceiro,
  confirmarSessao,
  buscarProdutos,
};
