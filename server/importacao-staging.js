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
      cProd: 'FORN-001',
      cEAN: '7891234567890',
      xProd: 'Parafuso Sextavado 6x20 Zincado',
      NCM: '73181500',
      CFOP: '1102',
      uCom: 'UN',
      qCom: 100,
      vUnCom: 0.15,
      vDesc: 0,
      vFrete: 2.5,
      vOutro: 0,
      imposto: {
        orig: '0',
        CST: '00',
        CSOSN: '',
        vBC: 15,
        pICMS: 18,
        vICMS: 2.7,
        vBCST: 0,
        vICMSST: 0,
        CST_IPI: '53',
        vIPI: 0,
        CST_PIS: '01',
        vPIS: 0.25,
        CST_COFINS: '01',
        vCOFINS: 1.15,
      },
      match: {
        id_identificador: 4521,
        descricao: 'Parafuso Sextavado 6x20',
        cod_barras: '7891234567890',
        confianca: 98,
        origem_match: 'EAN',
      },
    },
    {
      nItem: 2,
      cProd: 'FORN-002',
      cEAN: '7899876543210',
      xProd: 'Porca Sextavada M6',
      NCM: '73181600',
      CFOP: '1102',
      uCom: 'UN',
      qCom: 200,
      vUnCom: 0.08,
      vDesc: 0,
      vFrete: 1.2,
      vOutro: 0,
      imposto: {
        orig: '0',
        CST: '00',
        CSOSN: '',
        vBC: 16,
        pICMS: 18,
        vICMS: 2.88,
        vBCST: 0,
        vICMSST: 0,
        CST_IPI: '53',
        vIPI: 0,
        CST_PIS: '01',
        vPIS: 0.26,
        CST_COFINS: '01',
        vCOFINS: 1.22,
      },
      match: {
        id_identificador: 4522,
        descricao: 'Porca Sextavada M6',
        cod_barras: '7899876543210',
        confianca: 95,
        origem_match: 'EAN',
      },
    },
    {
      nItem: 3,
      cProd: 'FORN-099',
      cEAN: '',
      xProd: 'Arruela Lisa M6 Aço',
      NCM: '73182200',
      CFOP: '1102',
      uCom: 'UN',
      qCom: 500,
      vUnCom: 0.03,
      vDesc: 0,
      vFrete: 0.8,
      vOutro: 0,
      imposto: {
        orig: '0',
        CST: '00',
        CSOSN: '',
        vBC: 15,
        pICMS: 18,
        vICMS: 2.7,
        vBCST: 0,
        vICMSST: 0,
        CST_IPI: '53',
        vIPI: 0,
        CST_PIS: '01',
        vPIS: 0.24,
        CST_COFINS: '01',
        vCOFINS: 1.1,
      },
      match: null,
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
      vNF: 46,
      vProd: 43.5,
      vDesc: 0,
      vFrete: 4.5,
      vSeg: 0,
      vOutro: 0,
    },
    cobr: {
      nFat: '123456-1',
      vOrig: 46,
      vLiq: 46,
      dup: [
        { nDup: '001', dVenc: '2026-09-20', vDup: 15.33 },
        { nDup: '002', dVenc: '2026-10-20', vDup: 15.33 },
        { nDup: '003', dVenc: '2026-11-20', vDup: 15.34 },
      ],
    },
    itens,
  };
}

function buildSistemaFromXmlItem(xmlItem, match) {
  const imp = xmlItem.imposto || {};
  return {
    id_identificador: match?.id_identificador || null,
    descricao: match?.descricao || xmlItem.xProd,
    cod_fornecedor: xmlItem.cProd,
    cod_barras: xmlItem.cEAN || '',
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
    criar_novo: !match,
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
  const itens = xml.itens.map((xi) => {
    const match = xi.match || null;
    return {
      nItem: xi.nItem,
      xml: xi,
      match,
      sistema: buildSistemaFromXmlItem(xi, match),
      conferido: false,
      observacao: '',
    };
  });

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
