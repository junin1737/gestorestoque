'use strict';

/**
 * Garante frete/desconto/seguro/outras despesas por item iguais ao XML.
 * Se o total do cabeçalho existir e os itens vierem zerados, rateia por vProd.
 * Tributos (ICMS/ST/IPI/PIS/COFINS) nunca são recalculados — só o que veio no <det>.
 */
function round2(n) {
  return Number((Number(n || 0)).toFixed(2));
}

function sumField(itens, field) {
  return (itens || []).reduce((acc, it) => acc + Number(it[field] || 0), 0);
}

function ratearCampo(itens, headerVal, field) {
  const totalHeader = round2(headerVal);
  if (totalHeader <= 0) return;
  const somaItens = round2(sumField(itens, field));
  if (Math.abs(totalHeader - somaItens) < 0.02) return;
  if (somaItens > 0.01) return;

  const base = sumField(itens, 'vProd') || itens.length || 1;
  let acumulado = 0;
  itens.forEach((it, idx) => {
    if (idx === itens.length - 1) {
      it[field] = round2(totalHeader - acumulado);
      return;
    }
    const peso = (Number(it.vProd || 0) || (1 / itens.length)) / base;
    const v = round2(totalHeader * peso);
    it[field] = v;
    acumulado = round2(acumulado + v);
  });
}

function aplicarRateiosDoXml(xml) {
  if (!xml || !Array.isArray(xml.itens)) return xml;
  const tot = xml.total || {};
  ratearCampo(xml.itens, tot.vFrete, 'vFrete');
  ratearCampo(xml.itens, tot.vDesc, 'vDesc');
  ratearCampo(xml.itens, tot.vSeg, 'vSeg');
  ratearCampo(xml.itens, tot.vOutro, 'vOutro');
  return xml;
}

function syncSistemaComXmlItem(sistema, xmlItem) {
  if (!sistema || !xmlItem) return sistema;
  sistema.v_desc = Number(xmlItem.vDesc || 0);
  sistema.v_frete = Number(xmlItem.vFrete || 0);
  sistema.v_seguro = Number(xmlItem.vSeg || 0);
  sistema.v_outro = Number(xmlItem.vOutro || 0);
  const imp = xmlItem.imposto || {};
  const csosnEnt = String(imp.CSOSN || sistema.csosn_entrada || '').trim();
  if (csosnEnt) sistema.csosn_entrada = csosnEnt;
  sistema.tributos = {
    ...(sistema.tributos || {}),
    origem: imp.orig || sistema.tributos?.origem || '0',
    cst_icms: imp.CST || sistema.tributos?.cst_icms || '',
    csosn: csosnEnt || sistema.tributos?.csosn || '',
    v_bc_icms: Number(imp.vBC || 0),
    p_icms: Number(imp.pICMS || 0),
    v_icms: Number(imp.vICMS || 0),
    v_bc_st: Number(imp.vBCST || 0),
    v_icms_st: Number(imp.vICMSST || 0),
    p_mva_st: Number(imp.pMVAST || sistema.tributos?.p_mva_st || 0),
    p_icms_st: Number(imp.pICMSST || sistema.tributos?.p_icms_st || 0),
    p_st: Number(imp.pST || sistema.tributos?.p_st || 0),
    v_bc_st_ret: Number(imp.vBCSTRet || 0),
    v_icms_st_ret: Number(imp.vICMSSTRet || 0),
    v_icms_deson: Number(imp.vICMSDeson || 0),
    mot_des_icms: String(imp.motDesICMS || '').replace(/\D/g, '').slice(0, 2),
    v_bc_fcp: Number(imp.vBCFCP || 0),
    p_fcp: Number(imp.pFCP || 0),
    v_fcp: Number(imp.vFCP || 0),
    v_bc_fcp_st: Number(imp.vBCFCPST || 0),
    p_fcp_st: Number(imp.pFCPST || 0),
    v_fcp_st: Number(imp.vFCPST || 0),
    has_pis: !!imp.has_pis,
    has_cofins: !!imp.has_cofins,
    has_ipi: !!imp.has_ipi,
    cst_ipi: imp.CST_IPI || sistema.tributos?.cst_ipi || '',
    v_ipi: Number(imp.vIPI || 0),
    p_ipi: Number(imp.pIPI || 0),
    cst_pis: imp.CST_PIS || sistema.tributos?.cst_pis || '',
    v_pis: Number(imp.vPIS || 0),
    p_pis: Number(imp.pPIS || 0),
    v_bc_pis: Number(imp.vBCPIS || 0),
    cst_cofins: imp.CST_COFINS || sistema.tributos?.cst_cofins || '',
    v_cofins: Number(imp.vCOFINS || 0),
    p_cofins: Number(imp.pCOFINS || 0),
    v_bc_cofins: Number(imp.vBCCOFINS || 0),
  };
  if (!Array.isArray(sistema.lotes) || !sistema.lotes.length) {
    const rastros = Array.isArray(xmlItem.rastros) ? xmlItem.rastros : [];
    sistema.lotes = rastros.map((r) => ({
      num_lote: String(r.nLote || '').trim(),
      qtd_entrada: Number(r.qLote || 0),
      dt_validade: r.dVal || '',
      dt_fabricacao: r.dFab || '',
    })).filter((l) => l.num_lote);
  }
  return sistema;
}

/** Custo unitário líquido da nota (por unid. estoque, após conversor). */
function calcCustoUnitarioItem(sistema = {}, xmlItem = {}) {
  const trib = sistema.tributos || {};
  const imp = xmlItem.imposto || {};
  const qtdXml = Number(sistema.qtd_xml ?? xmlItem.qCom ?? 0) || 0;
  const conversor = Number(sistema.conversor ?? 1) || 1;
  // Sempre usa conversão — não confiar em sistema.qtd antigo (pode ser qtd da XML)
  const qtdEstoque = Number((qtdXml * conversor).toFixed(6)) || 0;

  const vProd = Number(
    xmlItem.vProd != null ? xmlItem.vProd : (Number(xmlItem.vUnCom || 0) * qtdXml)
  ) || 0;
  const vDesc = Number(sistema.v_desc ?? xmlItem.vDesc ?? 0) || 0;
  const vFrete = Number(sistema.v_frete ?? xmlItem.vFrete ?? 0) || 0;
  const vSeg = Number(sistema.v_seguro ?? xmlItem.vSeg ?? 0) || 0;
  const vOutro = Number(sistema.v_outro ?? xmlItem.vOutro ?? 0) || 0;
  const vIpi = Number(trib.v_ipi ?? imp.vIPI ?? 0) || 0;
  const vSt = Number(trib.v_icms_st ?? imp.vICMSST ?? 0) || 0;

  const totalItem = vProd - vDesc + vFrete + vSeg + vOutro + vIpi + vSt;
  const custoEstoque = qtdEstoque > 0
    ? totalItem / qtdEstoque
    : (qtdXml > 0 ? totalItem / qtdXml / conversor : totalItem);

  return {
    totalItem: Number(totalItem.toFixed(4)),
    custoEstoque: Number(custoEstoque.toFixed(6)),
    qtdXml,
    qtdEstoque,
    conversor,
    vProd,
    vDesc,
    vFrete,
    vSeg,
    vOutro,
    vIpi,
    vSt,
  };
}

const DIFERENCA_MAX_NF = 0.03;

function totalMercadoriaItem(xmlItem = {}, sistema = {}) {
  const vProd = Number(
    xmlItem.vProd != null ? xmlItem.vProd : (Number(xmlItem.vUnCom || 0) * Number(xmlItem.qCom || 0))
  ) || 0;
  const vDesc = Number(sistema.v_desc ?? xmlItem.vDesc ?? 0) || 0;
  const vFrete = Number(sistema.v_frete ?? xmlItem.vFrete ?? 0) || 0;
  const vSeg = Number(sistema.v_seguro ?? xmlItem.vSeg ?? 0) || 0;
  const vOutro = Number(sistema.v_outro ?? xmlItem.vOutro ?? 0) || 0;
  return round2(vProd - vDesc + vFrete + vSeg + vOutro);
}

function reconstruirVnfItens(itens = []) {
  let recon = 0;
  for (const it of itens) {
    const xml = it.xml || it;
    const sys = it.sistema || {};
    const imp = xml.imposto || {};
    const trib = sys.tributos || {};
    recon += totalMercadoriaItem(xml, sys);
    recon += Number(trib.v_ipi ?? imp.vIPI ?? 0);
    recon += Number(trib.v_icms_st ?? imp.vICMSST ?? 0);
    recon += Number(trib.v_fcp ?? imp.vFCP ?? 0);
    recon += Number(trib.v_fcp_st ?? imp.vFCPST ?? 0);
    recon -= Number(trib.v_icms_deson ?? imp.vICMSDeson ?? 0);
  }
  return round2(recon);
}

function validarTotaisNf(xml, itensSessao) {
  const tot = xml?.total || {};
  const vNf = round2(tot.vNF || 0);
  if (vNf <= 0.009) return { ok: true, vNf: 0, recon: 0, delta: 0 };
  const recon = reconstruirVnfItens(itensSessao || xml?.itens || []);
  const delta = round2(Math.abs(vNf - recon));
  if (delta > DIFERENCA_MAX_NF) {
    return {
      ok: false,
      vNf,
      recon,
      delta,
      erro: `Diferença de valor acima de 3 centavos (NF ${vNf.toFixed(2)} × conferido ${recon.toFixed(2)}, delta ${delta.toFixed(2)}). A nota não será gravada.`,
    };
  }
  return { ok: true, vNf, recon, delta };
}

function validarFinanceiroNf(xml, financeiro) {
  const vNf = round2(xml?.total?.vNF || 0);
  if (vNf <= 0.009) return { ok: true, vNf: 0, soma: 0, delta: 0 };
  const parcelas = Array.isArray(financeiro?.parcelas) ? financeiro.parcelas : [];
  if (!parcelas.length) return { ok: true, vNf, soma: vNf, delta: 0 };
  const soma = round2(parcelas.reduce((a, p) => a + Number(p.vDup || 0), 0));
  const delta = round2(Math.abs(vNf - soma));
  if (delta > DIFERENCA_MAX_NF) {
    return {
      ok: false,
      vNf,
      soma,
      delta,
      erro: `Diferença de valor acima de 3 centavos no financeiro (NF ${vNf.toFixed(2)} × parcelas ${soma.toFixed(2)}, delta ${delta.toFixed(2)}). Ajuste as parcelas antes de salvar ou gravar.`,
    };
  }
  return { ok: true, vNf, soma, delta };
}

module.exports = {
  round2,
  aplicarRateiosDoXml,
  syncSistemaComXmlItem,
  calcCustoUnitarioItem,
  totalMercadoriaItem,
  validarTotaisNf,
  validarFinanceiroNf,
  DIFERENCA_MAX_NF,
};
