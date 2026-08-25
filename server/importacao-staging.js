'use strict';
/**
 * Staging de importação NF-e — preparado para sync futuro com replicador.
 * Estrutura de sessão/item pensada para espelhar na nuvem (JSON document).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { getAppDataDir } = require('./config');
const importacaoParams = require('./importacao-params');
const { parseNfeXml } = require('./importacao-xml');
const { aplicarRateiosDoXml, syncSistemaComXmlItem } = require('./importacao-rateio');
const { consultarChaveSefaz, fiscalReady } = require('./importacao-sefaz');
const { getFiscalConfig } = require('./certificado');

function todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
const { gravarNfCompra } = require('./importacao-gravar');
const { sugerirFinanceiroFromXml } = require('./importacao-financeiro');

const STORE_FILE = path.join(getAppDataDir(), 'importacao-sessoes.json');

async function buildFinanceiroInicial(xml) {
  try {
    const sug = await sugerirFinanceiroFromXml(xml);
    return {
      nFat: sug.nFat || '',
      vOrig: sug.vOrig || 0,
      vLiq: sug.vLiq || 0,
      parcelas: sug.parcelas || [],
      tPag: sug.tPag || '',
      indPag: sug.indPag || '',
      vPag: sug.vPag || 0,
      id_fmapgto: sug.id_fmapgto,
      id_fmanfce: sug.id_fmanfce,
      id_parcela: sug.id_parcela,
      forma_pagto: sug.forma_pagto || '',
      parcelamento: sug.parcelamento || '',
      sugestao_label: sug.sugestao_label || '',
    };
  } catch (err) {
    console.warn('Financeiro XML:', err.message);
    const dups = xml?.cobr?.dup || [];
    return {
      ...(xml?.cobr || {}),
      parcelas: dups.map((d) => ({ ...d })),
      forma_pagto: dups.length ? 'Prazo' : 'Vista',
      id_fmapgto: dups.length ? 3 : 2,
      id_fmanfce: dups.length ? 5 : 1,
      id_parcela: dups.length ? (dups.length === 1 ? 24 : null) : 2,
      parcelamento: '',
      tPag: xml?.pag?.tPag || '',
    };
  }
}

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
      CFOP: '6102',
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
      CFOP: '6102',
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
      CFOP: '5405',
      uCom: 'UN',
      qCom: 6,
      vUnCom: 14.2,
      vDesc: 0,
      vFrete: 0,
      vOutro: 0,
      imposto: {
        orig: '0', CST: '60', CSOSN: '', vBC: 85.2, pICMS: 0, vICMS: 0,
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
      CFOP: '5405',
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
      CFOP: '6102',
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
    {
      nItem: 6,
      cProd: '22114',
      cEAN: '7896004001234',
      xProd: 'ACUCAR CRISTAL UNIAO 1KG 10X1KG',
      NCM: '17019900',
      CFOP: '6102',
      uCom: 'CX',
      qCom: 3,
      vUnCom: 32.9,
      vDesc: 0,
      vFrete: 0,
      vOutro: 0,
      imposto: {
        orig: '0', CST: '00', CSOSN: '', vBC: 98.7, pICMS: 12, vICMS: 11.84,
        vBCST: 0, vICMSST: 0, CST_IPI: '53', vIPI: 0, CST_PIS: '01', vPIS: 1.62,
        CST_COFINS: '01', vCOFINS: 7.45,
      },
    },
  ];

  return {
    chave: ch,
    ide: {
      nNF: nNfFromChave(ch) || '0',
      serie: serieFromChave(ch) || '1',
      dhEmi: new Date().toISOString(),
      natOp: 'COMPRA PARA COMERCIALIZACAO',
    },
    emit: {
      CNPJ: '38544763000176',
      xNome: 'FLORIVALDO MARTINS S/A',
      xFant: 'F MARTINS ATACADISTA',
      IE: '4316821720014',
      IM: '',
      enderEmit: {
        xLgr: 'RODOVIA MG 190 KM 29',
        nro: '0',
        xCpl: '',
        xBairro: 'LAGOINHA',
        cMun: '3143104',
        xMun: 'Monte Carmelo',
        UF: 'MG',
        CEP: '38500000',
        cPais: '1058',
        xPais: 'BRASIL',
        fone: '3438421530',
      },
      email: '',
    },
    dest: {
      CNPJ: '',
      xNome: 'EMPRESA DESTINATARIA',
      IE: '',
      enderDest: {
        xLgr: '', nro: '', xBairro: '', xMun: '', UF: 'MG', CEP: '',
      },
    },
    transp: {
      modFrete: '0',
      transporta: { xNome: '', CNPJ: '', IE: '', xEnder: '', xMun: '', UF: '' },
      vol: [{ qVol: 1, esp: 'VOLUME', marca: '', nVol: '', pesoL: 0, pesoB: 0 }],
    },
    total: {
      vNF: 681.9,
      vProd: 676.9,
      vDesc: 0,
      vFrete: 5,
      vSeg: 0,
      vOutro: 0,
      vBC: 681.9,
      vICMS: 81.84,
      vST: 0,
      vIPI: 0,
      vPIS: 11.19,
      vCOFINS: 51.46,
    },
    cobr: {
      nFat: `${nNfFromChave(ch) || '0'}-1`,
      vOrig: 681.9,
      vLiq: 681.9,
      dup: [
        { nDup: '001', dVenc: '2026-09-20', vDup: 340.95 },
        { nDup: '002', dVenc: '2026-10-20', vDup: 340.95 },
      ],
    },
    infAdic: { infCpl: 'Demonstração — dados simulados da NF-e' },
    itens,
  };
}

function emptyTribNfe() {
  return {
    id_class_trib: null,
    diferimento_cbs: 0,
    cod_cred_presu_cbs: '',
    aliq_cred_presu_cbs: 0,
    diferimento_ibs_uf: 0,
    diferimento_ibs_mun: 0,
    cod_cred_presu_ibs: '',
    aliq_cred_presu_ibs: 0,
    id_class_trib_regular: null,
    deduz_cred_presu_cbs: 'N',
    deduz_cred_presu_ibs: 'N',
    ind_bem_movel_usado: 'N',
  };
}

function emptyTribNfce() {
  return {
    id_class_trib: null,
    diferimento_cbs: 0,
    diferimento_ibs_uf: 0,
    diferimento_ibs_mun: 0,
  };
}

async function buildSistemaFromXmlItem(xmlItem, ufFornecedor) {
  const imp = xmlItem.imposto || {};
  const cfopMap = await importacaoParams.mapCfopEntrada(xmlItem.CFOP, ufFornecedor);
  const saidaPad = importacaoParams.getSaidaPadrao();
  const csosnNota = String(imp.CSOSN || '').trim();
  const csosn = csosnNota || cfopMap.csosn;
  const convSug = importacaoParams.findConversao(xmlItem.uCom);
  return {
    id_identificador: null,
    id_estoque: null,
    descricao: '',
    desc_cmpl: '',
    referencia: '',
    status: 'A',
    id_grupo: null,
    cod_fornecedor: xmlItem.cProd,
    cod_barras: xmlItem.cEAN || '',
    ncm: xmlItem.NCM,
    cest: '',
    anp: '',
    cfop_origem: cfopMap.cfop_origem,
    cfop: cfopMap.cfop_entrada,
    cfop_saida: cfopMap.cfop_saida || saidaPad.cfop_saida || '',
    cfop_nf: cfopMap.cfop_cfe || '',
    cst_icms: imp.CST || '',
    csosn: csosn,
    csosn_entrada: csosn,
    csosn_saida: cfopMap.csosn_saida || saidaPad.csosn_saida || '',
    csosn_cfe: cfopMap.csosn_cfe || '',
    cst_saida: cfopMap.cst_saida || '',
    cst_cfe: cfopMap.cst_cfe || '',
    id_cti: cfopMap.id_cti || '',
    id_cti_cfe: cfopMap.id_cti_cfe || '',
    _cti_label: cfopMap.cti_label || '',
    _cti_cfe_label: cfopMap.cti_cfe_label || '',
    margem_lb: 0,
    aplicar_saida: saidaPad.aplicar_saida || 'S',
    id_regra: null,
    uni_medida_xml: xmlItem.uCom,
    uni_medida: convSug?.uni_estoque || xmlItem.uCom,
    uni_medida_saida: '',
    conversor: convSug?.conversor || 1,
    qtd_xml: xmlItem.qCom,
    qtd: Number((Number(xmlItem.qCom || 0) * Number(convSug?.conversor || 1)).toFixed(6)),
    prc_custo: xmlItem.vUnCom,
    prc_custo_nota: xmlItem.vUnCom,
    prc_venda: Number(xmlItem.vUnCom || 0),
    v_desc: xmlItem.vDesc || 0,
    v_frete: xmlItem.vFrete || 0,
    v_seguro: xmlItem.vSeg || 0,
    v_outro: xmlItem.vOutro || 0,
    tributos: {
      origem: imp.orig || '0',
      cst_icms: imp.CST || '',
      csosn,
      v_bc_icms: imp.vBC || 0,
      p_icms: imp.pICMS || 0,
      v_icms: imp.vICMS || 0,
      v_bc_st: imp.vBCST || 0,
      v_icms_st: imp.vICMSST || 0,
      p_mva_st: imp.pMVAST || 0,
      p_icms_st: imp.pICMSST || 0,
      p_st: imp.pST || 0,
      v_bc_st_ret: imp.vBCSTRet || 0,
      v_icms_st_ret: imp.vICMSSTRet || 0,
      cst_ipi: '49',
      v_ipi: imp.vIPI || 0,
      p_ipi: imp.pIPI || 0,
      cst_pis: imp.CST_PIS || '',
      v_pis: imp.vPIS || 0,
      p_pis: imp.pPIS || 0,
      v_bc_pis: imp.vBCPIS || 0,
      cst_cofins: imp.CST_COFINS || '',
      v_cofins: imp.vCOFINS || 0,
      p_cofins: imp.pCOFINS || 0,
      v_bc_cofins: imp.vBCCOFINS || 0,
    },
    trib_nfe: emptyTribNfe(),
    trib_nfce: emptyTribNfce(),
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
  const out = {
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
  if (s.fornecedor) out.fornecedor = s.fornecedor;
  if (s.manual) out.manual = true;
  if (s.id_natope != null) out.id_natope = s.id_natope;
  if (s.natureza) out.natureza = s.natureza;
  if (s.fonte) out.fonte = s.fonte;
  if (s.id_nfcompra != null) out.id_nfcompra = s.id_nfcompra;
  if (s.editar_id_nfcompra != null) out.editar_id_nfcompra = s.editar_id_nfcompra;
  if (s.financeiro_ok) out.financeiro_ok = true;
  if (s.financeiro_bloqueado) {
    out.financeiro_bloqueado = true;
    out.financeiro_bloqueado_motivo = s.financeiro_bloqueado_motivo || '';
  }
  if (s.sefazErro) out.sefazErro = s.sefazErro;
  out.dt_entrada = s.dt_entrada || null;
  return out;
}

function setFornecedor(sessaoId, fornecedor) {
  const store = loadStore();
  const s = store.sessoes.find((x) => x.id === sessaoId);
  if (!s) return null;
  s.fornecedor = fornecedor;
  s.updatedAt = new Date().toISOString();
  s._sync = { ...(s._sync || {}), version: (s._sync?.version || 0) + 1, pendingCloud: true };
  saveStore(store);
  return mapSessaoForClient(s);
}

async function aplicarVinculosSessao(sessaoId) {
  const store = loadStore();
  const s = store.sessoes.find((x) => x.id === sessaoId);
  if (!s) return null;
  const { aplicarSugestoesVinculo } = require('./importacao-vinculo');
  await aplicarSugestoesVinculo(s);
  if (s.editar_id_nfcompra) {
    await reaplicarParamsTributoSessao(s);
  }
  s.updatedAt = new Date().toISOString();
  saveStore(store);
  return mapSessaoForClient(s);
}

async function reaplicarParamsTributoSessao(s) {
  const uf = s.xml?.emit?.enderEmit?.UF || '';
  const saidaPad = importacaoParams.getSaidaPadrao();
  for (const it of s.itens || []) {
    const conv = await importacaoParams.mapCfopEntrada(it.xml?.CFOP, uf);
    if (!it.sistema) continue;
    if (conv.cfop_entrada) it.sistema.cfop = conv.cfop_entrada;
    if (conv.csosn) it.sistema.csosn = conv.csosn;
    it.sistema.cfop_saida = conv.cfop_saida || saidaPad.cfop_saida || it.sistema.cfop_saida;
    it.sistema.csosn_saida = conv.csosn_saida || saidaPad.csosn_saida || it.sistema.csosn_saida;
    it.sistema.cst_saida = conv.cst_saida || it.sistema.cst_saida;
    it.sistema.cfop_nf = conv.cfop_cfe || it.sistema.cfop_nf;
    it.sistema.csosn_cfe = conv.csosn_cfe || it.sistema.csosn_cfe;
    it.sistema.cst_cfe = conv.cst_cfe || it.sistema.cst_cfe;
    if (saidaPad.aplicar_saida) it.sistema.aplicar_saida = saidaPad.aplicar_saida;
  }
}

function updateFornecedor(sessaoId, patch) {
  const store = loadStore();
  const s = store.sessoes.find((x) => x.id === sessaoId);
  if (!s) return { ok: false, error: 'Sessão não encontrada' };
  if (!s.fornecedor) s.fornecedor = {};
  if (patch.id_fornec !== undefined) s.fornecedor.id_fornec = patch.id_fornec;
  if (patch.criar_novo !== undefined) s.fornecedor.criar_novo = !!patch.criar_novo;
  if (patch.cadastro) {
    s.fornecedor.cadastro = { ...(s.fornecedor.cadastro || {}), ...patch.cadastro };
  }
  if (patch.origem) s.fornecedor.origem = patch.origem;
  s.updatedAt = new Date().toISOString();
  s._sync = { ...(s._sync || {}), version: (s._sync?.version || 0) + 1, pendingCloud: true };
  saveStore(store);
  return { ok: true, sessao: mapSessaoForClient(s) };
}

function updateCabecalho(sessaoId, patch = {}) {
  const store = loadStore();
  const s = store.sessoes.find((x) => x.id === sessaoId);
  if (!s) return { ok: false, error: 'Sessão não encontrada' };
  if (!s.xml) s.xml = {};
  if (!s.xml.ide) s.xml.ide = {};
  if (patch.nNF != null) s.xml.ide.nNF = String(patch.nNF);
  if (patch.serie != null) s.xml.ide.serie = String(patch.serie);
  if (patch.natOp != null) s.xml.ide.natOp = String(patch.natOp);
  if (patch.dhEmi != null) s.xml.ide.dhEmi = String(patch.dhEmi);
  if (patch.id_natope !== undefined) s.id_natope = patch.id_natope != null ? Number(patch.id_natope) : null;
  if (patch.natureza !== undefined) s.natureza = patch.natureza;
  if (patch.dt_entrada != null) {
    const dt = String(patch.dt_entrada).slice(0, 10);
    s.dt_entrada = /^\d{4}-\d{2}-\d{2}$/.test(dt) ? dt : s.dt_entrada;
  }
  s.updatedAt = new Date().toISOString();
  saveStore(store);
  return { ok: true, sessao: mapSessaoForClient(s) };
}

/** Extrai nº da NF (9 dígitos) da chave de acesso (posições 26–34). */
function nNfFromChave(chave) {
  const ch = String(chave || '').replace(/\D/g, '');
  if (ch.length !== 44) return '';
  const raw = ch.slice(25, 34);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? String(n) : raw.replace(/^0+/, '') || raw;
}

function serieFromChave(chave) {
  const ch = String(chave || '').replace(/\D/g, '');
  if (ch.length !== 44) return '';
  const raw = ch.slice(22, 25);
  const n = Number(raw);
  return Number.isFinite(n) ? String(n) : raw;
}

function downloadsDirs() {
  const dirs = [];
  const push = (p) => {
    if (p && !dirs.includes(p)) dirs.push(p);
  };
  push(path.join(os.homedir(), 'Downloads'));
  push(path.join(os.homedir(), 'Download'));
  if (process.env.USERPROFILE) {
    push(path.join(process.env.USERPROFILE, 'Downloads'));
    push(path.join(process.env.USERPROFILE, 'Download'));
  }
  if (process.env.OneDrive) {
    push(path.join(process.env.OneDrive, 'Downloads'));
  }
  return dirs;
}

function findXmlFileByChave(chave) {
  const ch = String(chave || '').replace(/\D/g, '');
  if (ch.length !== 44) return null;

  const exactNames = [`${ch}.xml`, `${ch}-nfe.xml`, `NFe${ch}.xml`, `${ch}.XML`];
  const candidates = [];
  for (const dir of [
    ...downloadsDirs(),
    path.join(getAppDataDir(), 'xml'),
    path.join(process.cwd(), 'xml'),
  ]) {
    for (const name of exactNames) {
      candidates.push(path.join(dir, name));
    }
  }
  for (const p of candidates) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch {
      /* ignore */
    }
  }

  // Varredura rápida nas pastas Downloads: arquivo cujo nome contém a chave
  for (const dir of downloadsDirs()) {
    try {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir);
      const hit = files.find((f) => {
        const lower = String(f).toLowerCase();
        return lower.endsWith('.xml') && lower.includes(ch.toLowerCase());
      });
      if (hit) {
        const full = path.join(dir, hit);
        if (fs.statSync(full).isFile()) return full;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

function cacheXmlLocal(chave, raw) {
  try {
    const ch = String(chave || '').replace(/\D/g, '');
    if (ch.length !== 44 || !raw) return;
    const dir = path.join(getAppDataDir(), 'xml');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${ch}.xml`), raw, 'utf8');
  } catch {
    /* ignore */
  }
}

async function resolveXmlPayload({ chave, xmlText, xmlPath, allowDemo, preferSefaz = true } = {}) {
  let raw = xmlText ? String(xmlText) : '';
  let fonteOrigem = raw ? 'xml' : null;
  if (!raw && xmlPath && fs.existsSync(xmlPath)) {
    raw = fs.readFileSync(xmlPath, 'utf8');
    fonteOrigem = 'xml';
  }
  const ch = String(chave || '').replace(/\D/g, '');

  // 1) SEFAZ (quando certificado configurado)
  let sefazErro = null;
  if (!raw && preferSefaz && ch.length === 44 && fiscalReady(getFiscalConfig())) {
    try {
      const sefaz = await consultarChaveSefaz(ch);
      if (sefaz?.xmlText) {
        raw = sefaz.xmlText;
        fonteOrigem = 'sefaz';
      }
    } catch (err) {
      sefazErro = err;
      console.warn('Consulta SEFAZ:', err.message);
    }
  }

  // 2) Arquivo local / anexado
  if (!raw && ch.length === 44) {
    const found = findXmlFileByChave(ch);
    if (found) {
      raw = fs.readFileSync(found, 'utf8');
      fonteOrigem = 'xml';
      cacheXmlLocal(ch, raw);
    }
  }

  if (raw) {
    let parsed = parseNfeXml(raw);
    parsed = aplicarRateiosDoXml(parsed);
    const chaveXml = String(parsed.chave || '').replace(/\D/g, '');
    if (ch.length === 44 && chaveXml && chaveXml !== ch) {
      throw new Error(`Chave do XML (${chaveXml}) difere da informada (${ch}).`);
    }
    if (!parsed.ide?.nNF && ch.length === 44) {
      parsed.ide = parsed.ide || {};
      parsed.ide.nNF = nNfFromChave(ch);
      if (!parsed.ide.serie) parsed.ide.serie = serieFromChave(ch);
    }
    if (!parsed.chave && ch.length === 44) parsed.chave = ch;
    cacheXmlLocal(parsed.chave || ch, raw);
    return {
      xml: parsed,
      fonte: fonteOrigem || 'xml',
      sefazErro: sefazErro ? String(sefazErro.message || sefazErro) : null,
    };
  }

  if (allowDemo && ch.length === 44) {
    const mock = mockXmlFromChave(ch);
    if (!mock) throw new Error('Chave inválida. Informe 44 dígitos.');
    return { xml: aplicarRateiosDoXml(mock), fonte: 'demo' };
  }

  if (ch.length === 44) {
    const partes = [
      'Não foi possível obter o XML da NF-e.',
    ];
    if (sefazErro) {
      partes.push(`SEFAZ: ${sefazErro.message || sefazErro}`);
    } else if (!fiscalReady(getFiscalConfig())) {
      partes.push('Certificado fiscal não configurado (Serviço → Certificado NF-e).');
    }
    partes.push('Anexe o XML ou salve-o em Downloads com o nome da chave.');
    throw new Error(partes.join(' '));
  }
  throw new Error('Informe a chave (44 dígitos) ou envie o XML da NF-e.');
}

async function createSessao(opts = {}) {
  const chaveIn = typeof opts === 'string' ? opts : opts.chave;
  const allowDemo = typeof opts === 'object' && !!opts.allowDemo;
  const { xml, fonte, sefazErro } = await resolveXmlPayload({
    chave: chaveIn,
    xmlText: typeof opts === 'object' ? opts.xmlText : null,
    xmlPath: typeof opts === 'object' ? opts.xmlPath : null,
    allowDemo,
    preferSefaz: typeof opts === 'object' ? opts.preferSefaz !== false : true,
  });

  const editarId = typeof opts === 'object' ? Number(opts.editarIdNfcompra || 0) : 0;

  const store = loadStore();
  const chave = xml.chave || String(chaveIn || '').replace(/\D/g, '');

  // Sessão JSON "confirmada" não pode bloquear se a NF já foi cancelada no Clipp
  const dupConfirmada = !editarId && store.sessoes.find((s) => s.chave === chave && s.status === 'confirmada');
  if (dupConfirmada) {
    const { findNfDuplicada } = require('./importacao-notas');
    const dupDb = await findNfDuplicada({
      chave,
      nfNumero: xml.ide?.nNF,
      serie: xml.ide?.serie,
      cnpj: xml.emit?.CNPJ,
    });
    if (dupDb) {
      return {
        ok: false,
        error: dupDb.aviso || 'Esta NF-e já foi importada/confirmada. Cancele a anterior no Clipp se precisar reimportar.',
        code: 'DUPLICADA',
      };
    }
    // Só existia cancelada no banco (ou nada ativo) → libera reimportação
    for (const s of store.sessoes) {
      if (s.chave === chave && s.status === 'confirmada') {
        s.status = 'cancelada';
        s.canceledAt = new Date().toISOString();
        s.updatedAt = s.canceledAt;
      }
    }
  }

  // Um único registro em conferência por chave
  store.sessoes = store.sessoes.filter(
    (s) => !(s.chave === chave && s.status === 'em_conferencia')
  );

  const ufForn = xml.emit?.enderEmit?.UF || '';
  const now = new Date().toISOString();
  const itens = [];
  for (const xi of xml.itens) {
    const sistema = await buildSistemaFromXmlItem(xi, ufForn);
    syncSistemaComXmlItem(sistema, xi);
    itens.push({
      nItem: xi.nItem,
      xml: xi,
      match: null,
      sistema,
      conferido: false,
      observacao: '',
    });
  }

  let idNatope = null;
  let natureza = null;
  try {
    const { listNaturezas } = require('./importacao-notas');
    const natOpTxt = String(xml.ide?.natOp || '').trim();
    if (natOpTxt) {
      const candidatos = await listNaturezas(natOpTxt);
      const upper = natOpTxt.toUpperCase();
      natureza = candidatos.find((n) => String(n.descricao || '').toUpperCase() === upper)
        || candidatos.find((n) => String(n.descricao || '').toUpperCase().includes(upper)
          || upper.includes(String(n.descricao || '').toUpperCase()))
        || candidatos[0]
        || null;
      if (natureza) idNatope = natureza.id_natope;
    }
  } catch (_) { /* ignore */ }

  const sessao = {
    id: newId(),
    chave,
    status: 'em_conferencia',
    createdAt: now,
    updatedAt: now,
    manual: false,
    fonte,
    sefazErro: sefazErro || null,
    editar_id_nfcompra: editarId || undefined,
    id_natope: idNatope,
    natureza,
    dt_entrada: todayYmd(),
    xml: {
      ide: xml.ide,
      emit: xml.emit,
      dest: xml.dest,
      transp: xml.transp,
      total: xml.total,
      cobr: xml.cobr,
      pag: xml.pag,
      infAdic: xml.infAdic,
    },
    financeiro: await buildFinanceiroInicial(xml),
    itens,
    _sync: { version: 1, pendingCloud: true },
  };

  store.sessoes.unshift(sessao);
  if (editarId) {
    try {
      const { nfFinanceiroBloqueado } = require('./importacao-gravar');
      const { withDb } = require('./db');
      const lock = await withDb((db) => nfFinanceiroBloqueado(db, editarId));
      if (lock.bloqueado) {
        sessao.financeiro_bloqueado = true;
        sessao.financeiro_bloqueado_motivo = lock.motivo;
        saveStore(store);
      }
    } catch (e) {
      console.warn('Financeiro bloqueado (edição):', e.message);
    }
  }
  saveStore(store);
  return { ok: true, sessao: mapSessaoForClient(sessao), fonte, sefazErro: sefazErro || null };
}

function deleteSessao(sessaoId) {
  const store = loadStore();
  const s = store.sessoes.find((x) => x.id === sessaoId);
  if (!s) return { ok: false, error: 'Sessão não encontrada' };
  if (s.status === 'confirmada') {
    return { ok: false, error: 'Nota confirmada. Use cancelar para estornar.' };
  }
  store.sessoes = store.sessoes.filter((x) => x.id !== sessaoId);
  saveStore(store);
  return { ok: true };
}

function cancelarSessaoConfirmada(sessaoId) {
  const store = loadStore();
  const s = store.sessoes.find((x) => x.id === sessaoId);
  if (!s) return { ok: false, error: 'Sessão não encontrada' };
  if (s.status !== 'confirmada') {
    return { ok: false, error: 'Somente notas finalizadas podem ser canceladas por esta opção.' };
  }
  s.status = 'cancelada';
  s.canceledAt = new Date().toISOString();
  s.updatedAt = s.canceledAt;
  s._sync = { ...(s._sync || {}), version: (s._sync?.version || 0) + 1, pendingCloud: true, estorno: true };
  saveStore(store);
  return {
    ok: true,
    message: 'Nota cancelada na sessão. Use Cancelar na lista de notas cadastradas para estornar estoque e contas a pagar.',
    sessao: mapSessaoForClient(s),
  };
}

/** Marca sessões JSON como canceladas após cancelar a NF no Firebird. */
function marcarSessoesCanceladasPorNf({ idNfcompra, chave } = {}) {
  const store = loadStore();
  const id = idNfcompra != null ? Number(idNfcompra) : null;
  const ch = String(chave || '').replace(/\D/g, '');
  let n = 0;
  const now = new Date().toISOString();
  for (const s of store.sessoes) {
    const matchId = id && Number(s.id_nfcompra) === id;
    const matchCh = ch.length === 44 && String(s.chave || '').replace(/\D/g, '') === ch;
    if ((matchId || matchCh) && s.status === 'confirmada') {
      s.status = 'cancelada';
      s.canceledAt = now;
      s.updatedAt = now;
      n += 1;
    }
  }
  if (n) saveStore(store);
  return n;
}

async function createSessaoManual(body = {}) {
  const now = new Date().toISOString();
  const store = loadStore();
  const nNF = String(body.nNF || '').trim() || 'MANUAL';
  const serie = String(body.serie || '1').trim();
  const sessao = {
    id: newId(),
    chave: body.chave || `MANUAL-${Date.now()}`,
    status: 'em_conferencia',
    createdAt: now,
    updatedAt: now,
    manual: true,
    id_natope: body.id_natope != null ? Number(body.id_natope) : null,
    natureza: body.natureza || null,
    dt_entrada: String(body.dt_entrada || todayYmd()).slice(0, 10),
    xml: {
      ide: {
        nNF,
        serie,
        dhEmi: body.dhEmi || now,
        natOp: body.natOp || 'COMPRA PARA COMERCIALIZACAO',
        modelo: body.modelo || '55',
      },
      emit: body.emit || { CNPJ: '', xNome: '', xFant: '', IE: '', enderEmit: {} },
      dest: body.dest || {},
      transp: body.transp || { modFrete: '0', vol: [] },
      total: body.total || { vNF: 0, vProd: 0, vDesc: 0, vFrete: 0, vSeg: 0, vOutro: 0 },
      infAdic: body.infAdic || {},
    },
    financeiro: {
      forma_pagto: body.forma_pagto || 'Duplicata',
      nFat: '',
      parcelas: body.parcelas || [],
    },
    itens: [],
    fornecedor: body.fornecedor || null,
    _sync: { version: 1, pendingCloud: true },
  };
  store.sessoes.unshift(sessao);
  saveStore(store);
  return { ok: true, sessao: mapSessaoForClient(sessao) };
}

async function addItemManual(sessaoId, itemPatch = {}) {
  const store = loadStore();
  const s = store.sessoes.find((x) => x.id === sessaoId);
  if (!s) return { ok: false, error: 'Sessão não encontrada' };
  const nItem = (s.itens?.length || 0) + 1;
  const xmlItem = {
    nItem,
    cProd: itemPatch.cProd || '',
    cEAN: itemPatch.cEAN || '',
    xProd: itemPatch.xProd || 'NOVO ITEM',
    NCM: itemPatch.NCM || '',
    CFOP: itemPatch.CFOP || '1102',
    uCom: itemPatch.uCom || 'UN',
    qCom: Number(itemPatch.qCom || 1),
    vUnCom: Number(itemPatch.vUnCom || 0),
    vDesc: 0,
    vFrete: 0,
    vOutro: 0,
    imposto: itemPatch.imposto || { orig: '0', CST: '00', CSOSN: '' },
  };
  const item = {
    nItem,
    xml: xmlItem,
    match: null,
    sistema: await buildSistemaFromXmlItem(xmlItem, s.xml?.emit?.enderEmit?.UF || ''),
    conferido: false,
    observacao: '',
  };
  if (itemPatch.sistema) item.sistema = { ...item.sistema, ...itemPatch.sistema };
  s.itens.push(item);
  s.updatedAt = new Date().toISOString();
  saveStore(store);
  return { ok: true, item: mapItemForClient(item), sessao: mapSessaoForClient(s) };
}

function listSessoes() {
  const store = loadStore();
  return store.sessoes
    .filter((s) => s.status === 'em_conferencia')
    .map(mapSessaoForClient);
}

function listSessoesConfirmadas() {
  const store = loadStore();
  return store.sessoes
    .filter((s) => s.status === 'confirmada')
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
    if (patch.sistema.trib_nfe) {
      item.sistema.trib_nfe = { ...(item.sistema.trib_nfe || {}), ...patch.sistema.trib_nfe };
    }
    if (patch.sistema.trib_nfce) {
      item.sistema.trib_nfce = { ...(item.sistema.trib_nfce || {}), ...patch.sistema.trib_nfce };
    }
  }
  if (patch.match !== undefined) item.match = patch.match;
  if (patch.conferido !== undefined) item.conferido = !!patch.conferido;
  if (patch.observacao !== undefined) item.observacao = String(patch.observacao || '');

  try {
    const sys = item.sistema || {};
    if (sys.uni_medida_xml && sys.uni_medida) {
      importacaoParams.upsertConversao({
        uni_xml: sys.uni_medida_xml,
        uni_estoque: sys.uni_medida,
        conversor: sys.conversor,
        id_identificador: sys.id_identificador,
      });
    }
  } catch (_) { /* ignore */ }

  s.updatedAt = new Date().toISOString();
  s._sync = { ...(s._sync || {}), version: (s._sync?.version || 0) + 1, pendingCloud: true };
  saveStore(store);
  return { ok: true, item: mapItemForClient(item), sessao: mapSessaoForClient(s) };
}

function conferirTodosItens(sessaoId) {
  const store = loadStore();
  const s = store.sessoes.find((x) => x.id === sessaoId);
  if (!s) return { ok: false, error: 'Sessão não encontrada' };
  if (s.status === 'confirmada') return { ok: false, error: 'Nota já confirmada.' };
  let conferidos = 0;
  const pendentes = [];
  for (const it of s.itens || []) {
    const sys = it.sistema || {};
    if (sys.id_identificador || sys.criar_novo) {
      const xmlItem = it.xml || {};
      const conv = importacaoParams.findConversao(sys.uni_medida_xml || xmlItem.uCom, sys.id_identificador);
      if (conv && !sys.conversor_manual) {
        sys.uni_medida = conv.uni_estoque || sys.uni_medida;
        sys.conversor = conv.conversor;
        const qtdXml = Number(sys.qtd_xml ?? xmlItem.qCom ?? 0);
        sys.qtd = Number((qtdXml * Number(sys.conversor || 1)).toFixed(6));
      }
      it.conferido = true;
      conferidos += 1;
    } else {
      pendentes.push(it.nItem);
    }
  }
  s.updatedAt = new Date().toISOString();
  s._sync = { ...(s._sync || {}), version: (s._sync?.version || 0) + 1, pendingCloud: true };
  saveStore(store);
  return {
    ok: true,
    conferidos,
    pendentes,
    message: pendentes.length
      ? `${conferidos} item(ns) conferido(s). ${pendentes.length} ainda sem vínculo.`
      : `${conferidos} item(ns) conferido(s).`,
    sessao: mapSessaoForClient(s),
  };
}

function updateFinanceiro(sessaoId, financeiro) {
  const store = loadStore();
  const s = store.sessoes.find((x) => x.id === sessaoId);
  if (!s) return { ok: false, error: 'Sessão não encontrada' };
  s.financeiro = { ...s.financeiro, ...financeiro };
  if (financeiro.parcelas) s.financeiro.parcelas = financeiro.parcelas;
  // Evita persistir "Nenhum" se o cliente mandar id 1 por engano
  if (Number(s.financeiro.id_fmapgto) === 1) s.financeiro.id_fmapgto = 3;
  if (Number(s.financeiro.id_parcela) === 1) s.financeiro.id_parcela = 24;
  s.financeiro_ok = true;
  s.updatedAt = new Date().toISOString();
  s._sync = { ...(s._sync || {}), version: (s._sync?.version || 0) + 1, pendingCloud: true };
  saveStore(store);
  return { ok: true, sessao: mapSessaoForClient(s) };
}

async function sugerirFinanceiroSessao(sessaoId) {
  const store = loadStore();
  const s = store.sessoes.find((x) => x.id === sessaoId);
  if (!s) return { ok: false, error: 'Sessão não encontrada' };
  const xml = {
    cobr: s.xml?.cobr || {
      nFat: s.financeiro?.nFat,
      dup: s.financeiro?.parcelas || [],
    },
    pag: s.xml?.pag || {
      tPag: s.financeiro?.tPag,
      detPag: s.financeiro?.tPag
        ? [{ tPag: s.financeiro.tPag, vPag: s.financeiro.vPag, indPag: s.financeiro.indPag }]
        : [],
    },
  };
  const sug = await buildFinanceiroInicial(xml);
  const prev = s.financeiro || {};
  s.financeiro = {
    ...prev,
    ...sug,
    parcelas: (prev.parcelas && prev.parcelas.length) ? prev.parcelas : sug.parcelas,
    nFat: prev.nFat || sug.nFat,
  };
  s.updatedAt = new Date().toISOString();
  s._sync = { ...(s._sync || {}), version: (s._sync?.version || 0) + 1, pendingCloud: true };
  saveStore(store);
  return { ok: true, sessao: mapSessaoForClient(s) };
}

async function confirmarSessao(sessaoId, opts = {}) {
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
  if (!s.fornecedor?.id_fornec) {
    return { ok: false, error: 'Fornecedor não vinculado. Vincule ou cadastre o emitente da NF-e.' };
  }

  // Reaplica valores de tributos/rateios do XML nos itens antes de gravar
  for (const it of s.itens) {
    if (it.xml && it.sistema) syncSistemaComXmlItem(it.sistema, it.xml);
  }

  // Garante faturamento a partir do XML se ainda estiver vazio / Nenhum
  const fin = s.financeiro || {};
  const precisaFin = fin.id_fmapgto == null
    || Number(fin.id_fmapgto) === 1
    || fin.id_parcela == null
    || Number(fin.id_parcela) === 1
    || fin.id_fmanfce == null;
  if (precisaFin) {
    try {
      const xmlFin = {
        cobr: s.xml?.cobr || fin,
        pag: s.xml?.pag || { tPag: fin.tPag, detPag: fin.tPag ? [{ tPag: fin.tPag, vPag: fin.vPag, indPag: fin.indPag }] : [] },
      };
      if (!xmlFin.cobr.dup && fin.parcelas) xmlFin.cobr = { ...xmlFin.cobr, dup: fin.parcelas };
      const sug = await buildFinanceiroInicial({ ...s.xml, cobr: xmlFin.cobr, pag: xmlFin.pag });
      s.financeiro = {
        ...fin,
        ...sug,
        parcelas: (fin.parcelas && fin.parcelas.length) ? fin.parcelas : sug.parcelas,
        nFat: fin.nFat || sug.nFat,
      };
    } catch (e) {
      console.warn('Reaplicar financeiro:', e.message);
    }
  }

  let gravacao;
  try {
    gravacao = await gravarNfCompra(s, {
      usuario: opts.usuario || 'Supervisor',
      idFuncionario: Number(opts.idFuncionario || 0),
    });
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }

  s.status = 'confirmada';
  s.id_nfcompra = gravacao.id_nfcompra;
  s.updatedAt = new Date().toISOString();
  s._sync = { ...(s._sync || {}), version: (s._sync?.version || 0) + 1, pendingCloud: true };
  saveStore(store);
  return {
    ok: true,
    message: `NF ${gravacao.nf_numero}/${gravacao.nf_serie} gravada (cód. ${gravacao.id_nfcompra}) com ${gravacao.itens_gravados} itens e estoque atualizado.`,
    gravacao,
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
  createSessaoManual,
  addItemManual,
  listSessoes,
  listSessoesConfirmadas,
  getSessao,
  updateItem,
  conferirTodosItens,
  updateFinanceiro,
  sugerirFinanceiroSessao,
  confirmarSessao,
  buscarProdutos,
  setFornecedor,
  updateFornecedor,
  aplicarVinculosSessao,
  updateCabecalho,
  deleteSessao,
  cancelarSessaoConfirmada,
  marcarSessoesCanceladasPorNf,
  findXmlFileByChave,
  resolveXmlPayload,
};
