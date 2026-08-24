'use strict';

const { withDb, query, activeTargets, hasTable } = require('./db');
const { findNfDuplicada } = require('./importacao-notas');
const { round2, calcCustoUnitarioItem } = require('./importacao-rateio');
const { ensureContaMovtos } = require('./importacao-cancel');

function localNow() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return {
    dataSql: `${y}-${m}-${day}`,
    horaSql: `${hh}:${mm}:${ss}`,
    dataBr: `${day}/${m}/${y}`,
  };
}

function toDateSql(v) {
  if (!v) return localNow().dataSql;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return localNow().dataSql;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function nextId(db, generatorName, tableName, idColumn) {
  if (generatorName) {
    try {
      const rows = await query(db, `SELECT GEN_ID(${generatorName}, 1) AS ID FROM RDB$DATABASE`);
      const id = Number(rows[0].ID);
      if (Number.isFinite(id) && id > 0) return id;
    } catch {
      /* fallback */
    }
  }
  const max = await query(db, `SELECT COALESCE(MAX(${idColumn}), 0) + 1 AS ID FROM ${tableName}`);
  return Number(max[0].ID);
}

async function criarProdutoBasico(db, appCfg, sistema, xmlItem) {
  const targets = activeTargets(appCfg);
  if (!targets.length) throw new Error('Tabelas de estoque não encontradas.');
  const tPrimary = targets[0].tables;
  const idEstoque = await nextId(db, tPrimary.genEstoque, tPrimary.estoque, 'ID_ESTOQUE');
  const idIdentificador = await nextId(db, tPrimary.genIdentificador, tPrimary.identificador, 'ID_IDENTIFICADOR');
  const descricao = String(sistema.descricao || xmlItem?.xProd || 'PRODUTO NF-e').trim().slice(0, 120);
  const uni = String(sistema.uni_medida_saida || sistema.uni_medida || xmlItem?.uCom || 'UN').trim().slice(0, 6) || 'UN';
  const margem = Number(sistema.margem_lb || 0) || 0;
  const custoCalc = calcCustoUnitarioItem(sistema, xmlItem);
  let prcCusto = Number(sistema.prc_custo);
  if (!Number.isFinite(prcCusto) || prcCusto <= 0) {
    prcCusto = custoCalc.custoEstoque > 0
      ? custoCalc.custoEstoque
      : Number(xmlItem?.vUnCom || 0);
  }
  if (!Number.isFinite(prcCusto)) prcCusto = 0;
  let prcVenda = Number(sistema.prc_venda || 0);
  if (margem > 0 && prcCusto > 0) {
    prcVenda = Number((prcCusto * (1 + margem / 100)).toFixed(4));
  }
  if (!(prcVenda > 0)) prcVenda = prcCusto > 0 ? prcCusto : 0.01;
  const eanXml = String(xmlItem?.cEAN || '').trim();
  const barras = sistema.ean_em_referencia
    ? (String(sistema.cod_barras || '').trim() || null)
    : (String(sistema.cod_barras || eanXml).trim() || null);
  const ref = sistema.ean_em_referencia
    ? (String(sistema.referencia || eanXml || xmlItem?.cProd || '').trim() || null)
    : (String(sistema.referencia || xmlItem?.cProd || '').trim() || null);
  const descCmpl = String(sistema.desc_cmpl || '').trim() || null;
  const ncm = String(sistema.ncm || xmlItem?.NCM || '').trim() || null;
  const cest = String(sistema.cest || '').trim() || null;
  const anp = String(sistema.anp || '').trim() || null;
  const aplicarSaida = String(sistema.aplicar_saida || 'S').toUpperCase() !== 'N';
  const cfopSaida = aplicarSaida ? (String(sistema.cfop_saida || '').trim() || null) : null;
  const cfopNf = aplicarSaida ? (String(sistema.cfop_nf || '').trim() || null) : null;
  const idCti = aplicarSaida ? (String(sistema.id_cti || '').trim() || null) : null;
  const idCtiCfe = aplicarSaida ? (String(sistema.id_cti_cfe || '').trim() || null) : null;
  const cst = aplicarSaida
    ? (String(sistema.cst_saida || sistema.tributos?.cst_icms || sistema.cst_icms || '').trim() || null)
    : null;
  const csosn = aplicarSaida
    ? (String(sistema.csosn_saida || sistema.tributos?.csosn_saida || '').trim() || null)
    : null;
  const cstCfe = aplicarSaida ? (String(sistema.cst_cfe || '').trim() || null) : null;
  const csosnCfe = aplicarSaida ? (String(sistema.csosn_cfe || '').trim() || null) : null;

  for (const target of targets) {
    const t = target.tables;
    await query(db, `
      INSERT INTO ${t.estoque}
        (ID_ESTOQUE, DESCRICAO, STATUS, ID_GRUPO, UNI_MEDIDA, PRC_VENDA, PRC_CUSTO, GRADE_SERIE, ID_TIPOITEM, FRACIONADO)
      VALUES (?, ?, 'A', NULL, ?, ?, ?, 'N', '0', 'N')`, [
      idEstoque, descricao, uni, prcVenda, prcCusto,
    ]);
    try {
      await query(db, `
        UPDATE ${t.estoque}
        SET MARGEM_LB = ?, CFOP = ?, CFOP_NF = ?, ID_CTI = ?, ID_CTI_CFE = ?
        WHERE ID_ESTOQUE = ?`, [
        margem || null, cfopSaida, cfopNf, idCti, idCtiCfe, idEstoque,
      ]);
    } catch (e) {
      try {
        await query(db, `
          UPDATE ${t.estoque} SET MARGEM_LB = ?, CFOP = ?, CFOP_NF = ?
          WHERE ID_ESTOQUE = ?`, [margem || null, cfopSaida, cfopNf, idEstoque]);
      } catch (e2) {
        console.warn('Atualizar margem/CFOP estoque:', e2.message);
      }
    }
    await query(db, `INSERT INTO ${t.identificador} (ID_IDENTIFICADOR, ID_ESTOQUE) VALUES (?, ?)`, [
      idIdentificador, idEstoque,
    ]);
    await query(db, `
      INSERT INTO ${t.produto}
        (ID_IDENTIFICADOR, QTD_ATUAL, COD_BARRA, REFERENCIA, DESC_CMPL, CONTROLA_LOTE_VENDA, STATUS)
      VALUES (?, 0, ?, ?, ?, 'N', 'A')`, [
      idIdentificador, barras, ref, descCmpl,
    ]);
    try {
      await query(db, `
        UPDATE ${t.produto}
        SET COD_NCM = ?, COD_CEST = ?, ANP = ?, CST = ?, CSOSN = ?, CST_CFE = ?, CSOSN_CFE = ?
        WHERE ID_IDENTIFICADOR = ?`, [
        ncm, cest, anp, cst, csosn, cstCfe, csosnCfe, idIdentificador,
      ]);
    } catch (e) {
      try {
        await query(db, `
          UPDATE ${t.produto}
          SET COD_NCM = ?, COD_CEST = ?, ANP = ?, CST = ?, CSOSN = ?
          WHERE ID_IDENTIFICADOR = ?`, [ncm, cest, anp, cst, csosn, idIdentificador]);
      } catch (e2) {
        console.warn('Atualizar NCM/CEST/ANP produto:', e2.message);
      }
    }
  }
  return { id_identificador: idIdentificador, id_estoque: idEstoque };
}

async function entradaEstoque(db, appCfg, {
  idIdentificador, qtd, prcCusto, usuario, idFuncionario, nfLabel,
}) {
  const targets = activeTargets(appCfg);
  const agora = localNow();
  const obs = `Entrada NF ${nfLabel} - ${usuario}`.slice(0, 200);

  for (const target of targets) {
    const t = target.tables;
    const prodRows = await query(db, `
      SELECT FIRST 1 QTD_ATUAL, PRC_MEDIO FROM ${t.produto} WHERE ID_IDENTIFICADOR = ?`, [idIdentificador]);
    if (!prodRows[0]) continue;
    const qtdAtual = Number(prodRows[0].QTD_ATUAL || 0);
    const prcMedio = Number(prodRows[0].PRC_MEDIO || prcCusto || 0);
    const nova = qtdAtual + Number(qtd || 0);
    await query(db, `UPDATE ${t.produto} SET QTD_ATUAL = ? WHERE ID_IDENTIFICADOR = ?`, [nova, idIdentificador]);
    if (hasTable(t.saldo)) {
      const nextSaldo = await nextId(db, t.genSaldo, t.saldo, 'ID');
      try {
        await query(db, `
          INSERT INTO ${t.saldo}
            (ID, DATA, ID_IDENTIFICADOR, SALDO_ANTIGO, SALDO_NOVO, PRC_MEDIO, HORA, ID_FUNCIONARIO, OBSERVACAO)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
          nextSaldo, agora.dataSql, idIdentificador, qtdAtual, nova, prcMedio || prcCusto || 0,
          agora.horaSql, idFuncionario || 0, obs,
        ]);
      } catch (e) {
        if (String(e.message || '').includes('OBSERVACAO')) {
          await query(db, `
            INSERT INTO ${t.saldo}
              (ID, DATA, ID_IDENTIFICADOR, SALDO_ANTIGO, SALDO_NOVO, PRC_MEDIO, HORA, ID_FUNCIONARIO)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
            nextSaldo, agora.dataSql, idIdentificador, qtdAtual, nova, prcMedio || prcCusto || 0,
            agora.horaSql, idFuncionario || 0,
          ]);
        } else {
          console.warn('Saldo entrada NF:', e.message);
        }
      }
    }
  }
}

/**
 * Atualiza cadastro do produto/estoque com os dados conferidos na importação.
 * NCM: se estiver em branco no produto, preenche com o da nota.
 */
async function atualizarCadastroProduto(db, appCfg, sistema = {}, xmlItem = {}) {
  const idIdent = Number(sistema.id_identificador);
  if (!idIdent) return;

  const aplicarSaida = String(sistema.aplicar_saida || 'S').toUpperCase() !== 'N';
  const margem = Number(sistema.margem_lb);
  const custo = Number(sistema.prc_custo);
  let venda = Number(sistema.prc_venda);
  if (Number.isFinite(margem) && margem > 0 && Number.isFinite(custo) && custo > 0) {
    venda = Number((custo * (1 + margem / 100)).toFixed(4));
  }

  const ncmForm = String(sistema.ncm || '').trim();
  const ncmXml = String(xmlItem?.NCM || '').trim();
  const cest = String(sistema.cest || '').trim() || null;
  const eanXml = String(xmlItem?.cEAN || '').trim();
  const barras = sistema.ean_em_referencia
    ? (String(sistema.cod_barras || '').trim() || null)
    : (String(sistema.cod_barras || eanXml).trim() || null);
  const uni = String(sistema.uni_medida_saida || sistema.uni_medida || xmlItem?.uCom || '').trim().slice(0, 6) || null;
  const descricao = String(sistema.descricao || '').trim();
  const referencia = sistema.referencia != null ? String(sistema.referencia).trim() : null;
  const descCmpl = sistema.desc_cmpl != null ? String(sistema.desc_cmpl).trim() : null;
  const statusProd = String(sistema.status || '').trim().slice(0, 1) || null;
  const anp = String(sistema.anp || '').trim() || null;

  const cfopSaida = aplicarSaida ? (String(sistema.cfop_saida || '').trim().slice(0, 4) || null) : null;
  const cfopNf = aplicarSaida ? (String(sistema.cfop_nf || '').trim().slice(0, 4) || null) : null;
  const idCti = aplicarSaida ? (String(sistema.id_cti || '').trim().slice(0, 10) || null) : null;
  const idCtiCfe = aplicarSaida ? (String(sistema.id_cti_cfe || '').trim().slice(0, 10) || null) : null;
  const cst = aplicarSaida
    ? (String(sistema.cst_saida || sistema.tributos?.cst_icms || sistema.cst_icms || '').trim().slice(0, 3) || null)
    : null;
  const csosn = aplicarSaida
    ? (String(sistema.csosn_saida || '').trim().slice(0, 3) || null)
    : null;
  const cstCfe = aplicarSaida
    ? (String(sistema.cst_cfe || '').trim().slice(0, 3) || null)
    : null;
  const csosnCfe = aplicarSaida
    ? (String(sistema.csosn_cfe || '').trim().slice(0, 3) || null)
    : null;

  const targets = activeTargets(appCfg);
  for (const target of targets) {
    const t = target.tables;

    // NCM: tela tem prioridade; se produto em branco, preenche com o da nota
    try {
      const curNcm = await query(db, `
        SELECT FIRST 1 COD_NCM FROM ${t.produto} WHERE ID_IDENTIFICADOR = ?`, [idIdent]);
      const ncmAtual = String(curNcm[0]?.COD_NCM || '').trim();
      const ncmFinal = ncmForm || (!ncmAtual ? ncmXml : '') || null;
      if (ncmFinal && (ncmForm || !ncmAtual)) {
        await query(db, `
          UPDATE ${t.produto} SET COD_NCM = ? WHERE ID_IDENTIFICADOR = ?`, [
          ncmFinal, idIdent,
        ]);
      }
    } catch (e) {
      console.warn('Atualizar NCM:', e.message);
    }

    try {
      await query(db, `
        UPDATE ${t.produto} SET
          COD_CEST = COALESCE(?, COD_CEST),
          COD_BARRA = COALESCE(?, COD_BARRA),
          REFERENCIA = COALESCE(?, REFERENCIA),
          DESC_CMPL = COALESCE(?, DESC_CMPL),
          ANP = COALESCE(?, ANP),
          CST = COALESCE(?, CST),
          CSOSN = COALESCE(?, CSOSN),
          CST_CFE = COALESCE(?, CST_CFE),
          CSOSN_CFE = COALESCE(?, CSOSN_CFE)
        WHERE ID_IDENTIFICADOR = ?`, [
        cest, barras, referencia, descCmpl, anp, cst, csosn, cstCfe, csosnCfe, idIdent,
      ]);
    } catch (e) {
      try {
        await query(db, `
          UPDATE ${t.produto} SET
            COD_CEST = COALESCE(?, COD_CEST),
            COD_BARRA = COALESCE(?, COD_BARRA),
            REFERENCIA = COALESCE(?, REFERENCIA),
            DESC_CMPL = COALESCE(?, DESC_CMPL),
            CST = COALESCE(?, CST),
            CSOSN = COALESCE(?, CSOSN)
          WHERE ID_IDENTIFICADOR = ?`, [
          cest, barras, referencia, descCmpl, cst, csosn, idIdent,
        ]);
      } catch (e2) {
        console.warn('Atualizar tributos produto:', e2.message);
      }
    }

    const sets = [];
    const vals = [];
    if (descricao) {
      sets.push('DESCRICAO = ?');
      vals.push(descricao.slice(0, 120));
    }
    if (statusProd) {
      sets.push('STATUS = ?');
      vals.push(statusProd);
    }
    if (Number.isFinite(custo) && custo > 0) {
      sets.push('PRC_CUSTO = ?');
      vals.push(custo);
    }
    if (Number.isFinite(venda) && venda > 0) {
      sets.push('PRC_VENDA = ?');
      vals.push(venda);
    }
    if (Number.isFinite(margem)) {
      sets.push('MARGEM_LB = ?');
      vals.push(margem);
    }
    if (uni) {
      sets.push('UNI_MEDIDA = ?');
      vals.push(uni);
    }
    if (aplicarSaida) {
      if (cfopSaida) { sets.push('CFOP = ?'); vals.push(cfopSaida); }
      if (cfopNf) { sets.push('CFOP_NF = ?'); vals.push(cfopNf); }
      if (idCti) { sets.push('ID_CTI = ?'); vals.push(idCti); }
      if (idCtiCfe) { sets.push('ID_CTI_CFE = ?'); vals.push(idCtiCfe); }
    }
    if (sets.length) {
      try {
        await query(db, `
          UPDATE ${t.estoque} SET ${sets.join(', ')}
          WHERE ID_ESTOQUE = (
            SELECT FIRST 1 ID_ESTOQUE FROM ${t.identificador} WHERE ID_IDENTIFICADOR = ?
          )`, [...vals, idIdent]);
      } catch (e) {
        console.warn('Atualizar estoque fiscal/preço:', e.message);
      }
    }
  }

  await upsertEstTributosReforma(db, idIdent, sistema);
}

/** Reforma tributária do cadastro: TB_EST_TRIBUTOS / TB_EST_TRIBUTOS_NFCE (por ID_ESTOQUE). */
async function upsertEstTributosReforma(db, idIdent, sistema = {}) {
  const nfe = sistema.trib_nfe || sistema.trib_nfe || {};
  const nfce = sistema.trib_nfce || {};
  const idClassNfe = nfe.id_class_trib != null && nfe.id_class_trib !== '' ? Number(nfe.id_class_trib) : null;
  const idClassNfce = nfce.id_class_trib != null && nfce.id_class_trib !== ''
    ? Number(nfce.id_class_trib)
    : idClassNfe;
  if (!idClassNfe && !idClassNfce) return;

  try {
    const row = (await query(db, `
      SELECT FIRST 1 ID_ESTOQUE FROM TB_EST_IDENTIFICADOR WHERE ID_IDENTIFICADOR = ?`, [idIdent]))[0];
    const idEst = Number(row?.ID_ESTOQUE);
    if (!idEst) return;

    if (idClassNfe) {
      const exists = await query(db, `SELECT FIRST 1 ID_ESTOQUE FROM TB_EST_TRIBUTOS WHERE ID_ESTOQUE = ?`, [idEst]);
      const payload = [
        idClassNfe,
        Number(nfe.diferimento_cbs || 0),
        String(nfe.cod_cred_presu_cbs || '').trim() || null,
        Number(nfe.aliq_cred_presu_cbs || 0),
        Number(nfe.diferimento_ibs_uf || 0),
        Number(nfe.diferimento_ibs_mun || 0),
        String(nfe.cod_cred_presu_ibs || '').trim() || null,
        Number(nfe.aliq_cred_presu_ibs || 0),
        nfe.id_class_trib_regular != null && nfe.id_class_trib_regular !== ''
          ? Number(nfe.id_class_trib_regular)
          : null,
        String(nfe.deduz_cred_presu_cbs || 'N').slice(0, 1) || 'N',
        String(nfe.deduz_cred_presu_ibs || 'N').slice(0, 1) || 'N',
        String(nfe.ind_bem_movel_usado || 'N').slice(0, 1) || 'N',
      ];
      if (exists.length) {
        await query(db, `
          UPDATE TB_EST_TRIBUTOS SET
            ID_CLASS_TRIB=?, DIFERIMENTO_CBS=?, COD_CRED_PRESU_CBS=?, ALIQ_CRED_PRESU_CBS=?,
            DIFERIMENTO_IBS_UF=?, DIFERIMENTO_IBS_MUN=?, COD_CRED_PRESU_IBS=?, ALIQ_CRED_PRESU_IBS=?,
            ID_CLASS_TRIB_REGULAR=?, DEDUZ_CRED_PRESU_CBS=?, DEDUZ_CRED_PRESU_IBS=?, IND_BEM_MOVEL_USADO=?
          WHERE ID_ESTOQUE=?`, [...payload, idEst]);
      } else {
        await query(db, `
          INSERT INTO TB_EST_TRIBUTOS (
            ID_ESTOQUE, ID_CLASS_TRIB, DIFERIMENTO_CBS, COD_CRED_PRESU_CBS, ALIQ_CRED_PRESU_CBS,
            DIFERIMENTO_IBS_UF, DIFERIMENTO_IBS_MUN, COD_CRED_PRESU_IBS, ALIQ_CRED_PRESU_IBS,
            ID_CLASS_TRIB_REGULAR, DEDUZ_CRED_PRESU_CBS, DEDUZ_CRED_PRESU_IBS, IND_BEM_MOVEL_USADO
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [idEst, ...payload]);
      }
    }

    if (idClassNfce) {
      const existsN = await query(db, `SELECT FIRST 1 ID_ESTOQUE FROM TB_EST_TRIBUTOS_NFCE WHERE ID_ESTOQUE = ?`, [idEst]);
      const nfceVals = [
        idClassNfce,
        Number(nfce.diferimento_cbs || nfe.diferimento_cbs || 0),
        Number(nfce.diferimento_ibs_uf || nfe.diferimento_ibs_uf || 0),
        Number(nfce.diferimento_ibs_mun || nfe.diferimento_ibs_mun || 0),
      ];
      if (existsN.length) {
        await query(db, `
          UPDATE TB_EST_TRIBUTOS_NFCE SET
            ID_CLASS_TRIB=?, DIFERIMENTO_CBS=?, DIFERIMENTO_IBS_UF=?, DIFERIMENTO_IBS_MUN=?
          WHERE ID_ESTOQUE=?`, [...nfceVals, idEst]);
      } else {
        await query(db, `
          INSERT INTO TB_EST_TRIBUTOS_NFCE (
            ID_ESTOQUE, ID_CLASS_TRIB, DIFERIMENTO_CBS, DIFERIMENTO_IBS_UF, DIFERIMENTO_IBS_MUN
          ) VALUES (?, ?, ?, ?, ?)`, [idEst, ...nfceVals]);
      }
    }
  } catch (e) {
    console.warn('TB_EST_TRIBUTOS:', e.message);
  }
}

function tribReformaNfe(sistema = {}) {
  return sistema.trib_nfe || {};
}

async function insertTributosItem(db, idNfcItem, trib = {}, xmlImp = {}, tribNfe = {}, extra = {}) {
  const cstIcms = String(trib.cst_icms || xmlImp.CST || '').trim().padStart(3, '0').slice(-3);
  const aliq = Number(trib.p_icms || xmlImp.pICMS || 0);
  const vBc = Number(trib.v_bc_icms || xmlImp.vBC || 0);
  const vIcms = Number(trib.v_icms || xmlImp.vICMS || 0);

  try {
    await query(db, `
      INSERT INTO TB_NFC_ITEM_ICMS
        (ID_NFCITEM, CST_ICMS, ALIQ_ICMS, VLR_BC_ICMS, POR_BC_ICMS, VLR_ICMS, VLR_BC_ICMS_DG, VLR_ICMS_DIF_XML)
      VALUES (?, ?, ?, ?, 100, ?, 'N', 0)`, [
      idNfcItem, cstIcms || '000', aliq, vBc, vIcms,
    ]);
  } catch (e) {
    console.warn('ICMS item:', e.message);
  }

  const vBcSt = Number(trib.v_bc_st || xmlImp.vBCST || 0);
  const vSt = Number(trib.v_icms_st || xmlImp.vICMSST || 0);
  const vBcStRet = Number(trib.v_bc_st_ret || xmlImp.vBCSTRet || 0);
  const vStRet = Number(trib.v_icms_st_ret || xmlImp.vICMSSTRet || 0);
  const mva = Number(trib.p_mva_st || xmlImp.pMVAST || 0);
  const aliqDest = Number(trib.p_st || xmlImp.pST || 0);
  const aliqOrig = Number(trib.p_icms_st || xmlImp.pICMSST || aliqDest);
  const cstSt = String(cstIcms || '').replace(/\D/g, '').padStart(3, '0');
  const csosnSt = String(trib.csosn || xmlImp.CSOSN || '').replace(/\D/g, '');
  const stCst = /^(010|030|060|070|090)$/.test(cstSt) || /^(201|202|203|500)$/.test(csosnSt);
  if (vBcSt > 0 || vSt > 0 || vBcStRet > 0 || vStRet > 0 || stCst) {
    const informa = (vBcSt > 0 || vSt > 0) ? 'S' : 'N';
    try {
      await query(db, `
        INSERT INTO TB_NFC_ITEM_ST (
          ID_NFCITEM, POR_BC_ICMS_ST, VLR_BC_ICMS_ST, MVA, VLR_ST,
          ALIQ_ST_DEST, ALIQ_ST_ORIG, INFORMA_ST, ICMS_EFETIVO,
          VLR_BC_ICMS_ST_RET, VLR_ICMS_ST_RET
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'N', ?, ?)`, [
        idNfcItem,
        vBcSt > 0 ? 100 : 0,
        vBcSt,
        mva,
        vSt,
        aliqDest,
        aliqOrig || aliqDest,
        informa,
        vBcStRet,
        vStRet,
      ]);
    } catch (e) {
      console.warn('ST item:', e.message);
    }
  }

  try {
    await query(db, `
      INSERT INTO TB_NFC_ITEM_PIS
        (ID_NFCITEM, CST_PIS, ALIQ_PIS, POR_BC_PIS, VLR_PIS, VLR_BC_PIS)
      VALUES (?, ?, ?, 100, ?, ?)`, [
      idNfcItem,
      String(trib.cst_pis || xmlImp.CST_PIS || '01').trim().slice(0, 2),
      Number(trib.p_pis || xmlImp.pPIS || 0),
      Number(trib.v_pis || xmlImp.vPIS || 0),
      Number(trib.v_bc_pis || xmlImp.vBCPIS || 0),
    ]);
  } catch (e) { console.warn('PIS:', e.message); }

  try {
    await query(db, `
      INSERT INTO TB_NFC_ITEM_COFINS
        (ID_NFCITEM, CST_COFINS, ALIQ_COFINS, POR_BC_COFINS, VLR_COFINS, VLR_BC_COFINS)
      VALUES (?, ?, ?, 100, ?, ?)`, [
      idNfcItem,
      String(trib.cst_cofins || xmlImp.CST_COFINS || '01').trim().slice(0, 2),
      Number(trib.p_cofins || xmlImp.pCOFINS || 0),
      Number(trib.v_cofins || xmlImp.vCOFINS || 0),
      Number(trib.v_bc_cofins || xmlImp.vBCCOFINS || 0),
    ]);
  } catch (e) { console.warn('COFINS:', e.message); }

  try {
    await query(db, `
      INSERT INTO TB_NFC_ITEM_IPI
        (ID_NFCITEM, CST_IPI, ALIQ_IPI, VLR_IPI, CENQ, IPI_VBC)
      VALUES (?, ?, ?, ?, '999', 0)`, [
      idNfcItem,
      String(trib.cst_ipi || xmlImp.CST_IPI || '49').trim().slice(0, 2),
      Number(trib.p_ipi || xmlImp.pIPI || 0),
      Number(trib.v_ipi || xmlImp.vIPI || 0),
    ]);
  } catch (e) { console.warn('IPI:', e.message); }

  const tn = tribNfe || {};
  const aplicarReforma = String(extra.aplicarSaida || extra.aplicar_saida || 'S').toUpperCase() !== 'N';
  if (aplicarReforma || tn.id_class_trib || tn.vlr_cbs != null || tn.vlr_cbs != null || tn.aliq_cbs != null || tn.aliq_cbs != null) {
    try {
      const classRow = tn.id_class_trib
        ? (await query(db, `
            SELECT FIRST 1 COD_CLASS_TRIB, CST_CLASS_TRIB, PERCENT_RED_ALIQ_CBS, PERCENT_RED_ALIQ_IBS
            FROM TB_CLASS_TRIB WHERE ID_CLASS_TRIB = ?`, [Number(tn.id_class_trib)]))[0]
        : null;
      const codClass = String(tn._class_cod || classRow?.COD_CLASS_TRIB || '').trim().slice(0, 10);
      const cstClass = String(tn.cst_class_trib || tn.cst_class_trib || classRow?.CST_CLASS_TRIB || '').trim().slice(0, 3);
      const redCbs = Number(tn.percent_red_aliq_cbs ?? classRow?.PERCENT_RED_ALIQ_CBS ?? 0);
      const redIbs = Number(tn.percent_red_aliq_ibs ?? classRow?.PERCENT_RED_ALIQ_IBS ?? 0);
      const aliqCbs = Number(tn.aliq_cbs ?? tn.aliq_cbs ?? 0.9);
      const aliqIbsUf = Number(tn.aliq_ibs_uf ?? tn.aliq_ibs_uf ?? 0.1);
      const aliqIbsMun = Number(tn.aliq_ibs_mun ?? tn.aliq_ibs_mun ?? 0);
      const bc = Number(tn.vlr_bc_cbs ?? tn.vlr_bc_cbs ?? extra.prcVenda ?? extra.prc_venda ?? 0);
      const efetCbs = Number(tn.aliq_efetiva_cbs ?? tn.aliq_efetiva_cbs ?? (aliqCbs * (1 - redCbs / 100)));
      const efetIbsUf = Number(tn.aliq_efetiva_ibs_uf ?? tn.aliq_efetiva_ibs_uf ?? (aliqIbsUf * (1 - redIbs / 100)));
      const efetIbsMun = Number(tn.aliq_efetiva_ibs_mun ?? tn.aliq_efetiva_ibs_mun ?? (aliqIbsMun * (1 - redIbs / 100)));
      const vlrCbs = Number(tn.vlr_cbs ?? tn.vlr_cbs ?? (bc * efetCbs / 100));
      const vlrIbsUf = Number(tn.vlr_ibs_uf ?? tn.vlr_ibs_uf ?? (bc * efetIbsUf / 100));
      const vlrIbsMun = Number(tn.vlr_ibs_mun ?? tn.vlr_ibs_mun ?? (bc * efetIbsMun / 100));
      const gen = await query(db, `SELECT GEN_ID(GEN_TB_NFC_ITEM_CBS_IBS_ID, 1) AS ID FROM RDB$DATABASE`);
      const idCbs = Number(gen[0].ID);
      await query(db, `
        INSERT INTO TB_NFC_ITEM_CBS_IBS (
          ID_CBS_IBS, ID_NFCITEM, VLR_BC_CBS, VLR_BC_IBS,
          ALIQ_CBS, ALIQ_IBS_UF, ALIQ_IBS_MUN,
          VLR_CBS, VLR_IBS_UF, VLR_IBS_MUN,
          CLASS_TRIB, CST_CLASS_TRIB,
          PERCENT_RED_ALIQ_CBS, PERCENT_RED_ALI_IBS,
          ALIQ_EFETIVA_CBS, ALIQ_EFETIVA_IBS_UF, ALIQ_EFETIVA_IBS_MUN,
          ENVIAR_IBSCBS, ENVIAR_DIFERIMENTO, DIFERIMENTO_CBS, VLR_DIFERIMENTO_CBS,
          DIFERIMENTO_IBS_UF, VLR_DIFERIMENTO_IBS_UF, DIFERIMENTO_IBS_MUN, VLR_DIFERIMENTO_IBS_MUN,
          ENVIAR_CREDITO_PRESUMIDO, ALIQ_CRED_PRESU_CBS, VLR_CRED_PRESU_CBS,
          ALIQ_CRED_PRESU_IBS, VLR_CRED_PRESU_IBS,
          DEDUZ_CRED_PRESU_CBS, DEDUZ_CRED_PRESU_IBS, VLR_IBS_TOT, VLR_BC_CRED_PRESU
        ) VALUES (
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?,
          ?, ?,
          ?, ?, ?,
          'S', 'N', ?, 0,
          ?, 0, ?, 0,
          'N', ?, 0,
          ?, 0,
          ?, ?, ?, 0
        )`, [
        idCbs, idNfcItem, bc, bc,
        aliqCbs, aliqIbsUf, aliqIbsMun,
        round2(vlrCbs), round2(vlrIbsUf), round2(vlrIbsMun),
        codClass || null, cstClass || null,
        redCbs, redIbs,
        efetCbs, efetIbsUf, efetIbsMun,
        Number(tn.diferimento_cbs || 0),
        Number(tn.diferimento_ibs_uf || 0),
        Number(tn.diferimento_ibs_mun || 0),
        Number(tn.aliq_cred_presu_cbs || 0),
        Number(tn.aliq_cred_presu_ibs || 0),
        String(tn.deduz_cred_presu_cbs || 'N').slice(0, 1),
        String(tn.deduz_cred_presu_ibs || 'N').slice(0, 1),
        round2(vlrIbsUf + vlrIbsMun),
      ]);
    } catch (e) {
      console.warn('CBS/IBS:', e.message);
    }
  }
}

/**
 * Grava a sessão de importação nas tabelas nativas do Clipp.
 */
async function gravarNfCompra(sessao, {
  usuario = 'Supervisor',
  idFuncionario = 0,
} = {}) {
  if (!sessao) throw new Error('Sessão inválida.');
  if (!sessao.fornecedor?.id_fornec) {
    throw new Error('Fornecedor não vinculado.');
  }
  const itens = sessao.itens || [];
  if (!itens.length) throw new Error('Nota sem itens.');

  for (const it of itens) {
    if (!it.conferido) throw new Error(`Item ${it.nItem} ainda não conferido.`);
    if (!it.sistema?.id_identificador && !it.sistema?.criar_novo) {
      throw new Error(`Item ${it.nItem} sem produto vinculado.`);
    }
  }

  const ide = sessao.xml?.ide || {};
  const emit = sessao.xml?.emit || {};
  const tot = sessao.xml?.total || {};
  const transp = sessao.xml?.transp || {};
  const vols = Array.isArray(transp.vol) ? transp.vol : (transp.vol ? [transp.vol] : []);
  const vol0 = vols[0] || {};
  const fin = sessao.financeiro || {};
  const chave = String(sessao.chave || '').replace(/\D/g, '');
  const nfNumero = Number(String(ide.nNF || '').replace(/\D/g, '') || 0);
  const serie = String(ide.serie || '1').trim().slice(0, 3);
  const modelo = String(ide.modelo || '55').trim().slice(0, 2);

  const dup = Number(sessao.editar_id_nfcompra)
    ? null
    : await findNfDuplicada({
    chave,
    nfNumero,
    serie,
    idFornec: sessao.fornecedor.id_fornec,
    cnpj: emit.CNPJ || sessao.fornecedor?.cadastro?.cnpj,
  });
  if (dup) {
    throw new Error(dup.aviso || `NF ${nfNumero} já cadastrada (cód. ${dup.id_nfcompra}).`);
  }

  if (Number(sessao.editar_id_nfcompra)) {
    const idNf = Number(sessao.editar_id_nfcompra);
    return withDb(async (db, appCfg) => {
      const parcelasXml = Array.isArray(fin.parcelas) && fin.parcelas.length
        ? fin.parcelas
        : [];
      if (parcelasXml.length) {
        try {
          const contas = await query(db, `
            SELECT C.ID_CTAPAG
            FROM TB_NFC_CTAPAG L
            JOIN TB_CONTA_PAGAR C ON C.ID_CTAPAG = L.ID_CTAPAG
            WHERE L.ID_NFCOMPRA = ?
            ORDER BY C.DT_VENCTO, C.ID_CTAPAG`, [idNf]);
          const n = Math.min(contas.length, parcelasXml.length);
          for (let i = 0; i < n; i++) {
            const p = parcelasXml[i];
            await query(db, `
              UPDATE TB_CONTA_PAGAR SET VLR_CTAPAG = ?, DT_VENCTO = ?
              WHERE ID_CTAPAG = ?`, [
              round2(p.vDup || 0),
              toDateSql(p.dVenc),
              Number(contas[i].ID_CTAPAG),
            ]);
          }
        } catch (e) {
          console.warn('Atualizar parcelas (edição):', e.message);
        }
      }
      for (const it of itens) {
        await atualizarCadastroProduto(db, appCfg, it.sistema || {}, it.xml || {});
      }
      try {
        const dtEntrada = toDateSql(sessao.dt_entrada);
        if (dtEntrada) {
          await query(db, `UPDATE TB_NFCOMPRA SET DT_ENTRADA = ? WHERE ID_NFCOMPRA = ?`, [
            dtEntrada, idNf,
          ]);
        }
      } catch (e) {
        console.warn('Atualizar data de entrada (edição):', e.message);
      }
      return {
        id_nfcompra: idNf,
        nf_numero: nfNumero,
        nf_serie: serie,
        itens_gravados: itens.length,
        parcelas: parcelasXml.length,
        editado: true,
      };
    });
  }

  return withDb(async (db, appCfg) => {
    const agora = localNow();
    const dtEmissao = toDateSql(ide.dhEmi);
    const dtEntrada = toDateSql(sessao.dt_entrada) || agora.dataSql;
    const idNf = await nextId(db, 'GEN_TB_NFCOMPRA_ID', 'TB_NFCOMPRA', 'ID_NFCOMPRA');
    const idFmapgtoRaw = fin.id_fmapgto != null ? Number(fin.id_fmapgto) : 3;
    const idFmapgto = idFmapgtoRaw === 1 ? 3 : (idFmapgtoRaw || 3);
    const idParcelaRaw = fin.id_parcela != null ? Number(fin.id_parcela) : 24;
    const idParcela = idParcelaRaw === 1 ? 24 : (idParcelaRaw || 24);
    const idFmanfce = fin.id_fmanfce != null ? Number(fin.id_fmanfce) : 5;
    const idNatope = sessao.id_natope != null ? Number(sessao.id_natope) : 9;

    await query(db, `
      INSERT INTO TB_NFCOMPRA (
        ID_NFCOMPRA, ID_COMPRADOR, ID_FORNEC, NF_NUMERO, NF_SERIE, NF_MODELO,
        DT_EMISSAO, DT_ENTRADA, HR_ENTRADA,
        VLR_BC_FRETE, VLR_BC_SEGURO, VLR_BC_DESPESA,
        ESPECIE, TIPO_FRETE, PES_LIQUID, PES_BRUTO, STATUS, ID_NATOPE,
        MARCA, QTD_VOLUM, ID_PARCELA, ID_FMAPGTO, SOMA_FRETE, NUM_VOLUM,
        NFE_ORIGEM, PROD_REV, CODIGO_BASE, CODIGO_BASE_IPI,
        SUBTRAI_ICMS_DESON, IMPORTADO_XML, IND_PRES, IND_INTERMED, ENDERECO_ENTREGA
      ) VALUES (
        ?, 0, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, 'E', ?,
        ?, ?, ?, ?, NULL, ?,
        ?, 'N', 1, 1,
        'S', 'S', '1', '0', 'N'
      )`, [
      idNf,
      Number(sessao.fornecedor.id_fornec),
      nfNumero,
      serie,
      modelo.padEnd(2).slice(0, 2),
      dtEmissao,
      dtEntrada,
      agora.horaSql,
      Number(tot.vFrete || 0),
      Number(tot.vSeg || 0),
      Number(tot.vOutro || 0),
      String(vol0.esp || '').slice(0, 30) || null,
      String(transp.modFrete || '9').trim().slice(0, 1) || '9',
      Number(vol0.pesoL || 0),
      Number(vol0.pesoB || 0),
      idNatope,
      String(vol0.marca || '').slice(0, 30) || null,
      Number(vol0.qVol || itens.length || 0),
      idParcela,
      idFmapgto,
      vol0.nVol ? String(vol0.nVol).slice(0, 30) : null,
      chave || null,
    ]);

    const idNumPag = await nextId(db, 'GEN_TB_NFCOMPRA_FMAPAGTO_ID', 'TB_NFCOMPRA_FMAPAGTO', 'ID_NUMPAG');
    await query(db, `
      INSERT INTO TB_NFCOMPRA_FMAPAGTO (ID_NUMPAG, VLR_PAGTO, ID_NFCOMPRA, ID_FMANFCE, ID_PARCELA)
      VALUES (?, ?, ?, ?, ?)`, [
      idNumPag,
      round2(tot.vNF || 0),
      idNf,
      idFmanfce || 5,
      idParcela,
    ]);

    const parcelasXml = Array.isArray(fin.parcelas) && fin.parcelas.length
      ? fin.parcelas
      : [{ nDup: '001', dVenc: agora.dataSql, vDup: tot.vNF || 0 }];

    for (let i = 0; i < parcelasXml.length; i++) {
      const p = parcelasXml[i];
      const idCta = await nextId(db, 'GEN_TB_CTAPAG_ID', 'TB_CONTA_PAGAR', 'ID_CTAPAG');
      const doc = `${String(nfNumero).padStart(9, '0')}-${String(i + 1).padStart(2, '0')}`;
      await query(db, `
        INSERT INTO TB_CONTA_PAGAR (
          ID_CTAPAG, DOCUMENTO, HISTORICO, DT_EMISSAO, DT_VENCTO, VLR_CTAPAG,
          TIP_CTAPAG, ID_PORTADOR, ID_FORNEC, CTA_MANUAL, OBSERVACAO
        ) VALUES (?, ?, ?, ?, ?, ?, 'N', 1, ?, 'N', ?)`, [
        idCta,
        doc.slice(0, 20),
        `Compra NF ${String(nfNumero).padStart(9, '0')}/${serie}/${modelo}`.slice(0, 80),
        agora.dataSql,
        toDateSql(p.dVenc) || agora.dataSql,
        round2(p.vDup || 0),
        Number(sessao.fornecedor.id_fornec),
        `Importado via Gestor Estoque — chave ${chave}`.slice(0, 200),
      ]);
      await ensureContaMovtos(db, idCta, {
        vlr: round2(p.vDup || 0),
        historico: `Compra NF ${String(nfNumero).padStart(9, '0')}/${serie}/${modelo}`,
        dataSql: agora.dataSql,
        horaSql: agora.horaSql,
      });
      await query(db, `
        INSERT INTO TB_NFC_CTAPAG (ID_NFCOMPRA, ID_CTAPAG, ID_NUMPAG)
        VALUES (?, ?, ?)`, [idNf, idCta, idNumPag]);
    }

    const nfLabel = `${nfNumero}/${serie}`;
    let itensGravados = 0;

    for (const it of itens) {
      let idIdent = it.sistema?.id_identificador ? Number(it.sistema.id_identificador) : null;
      if (!idIdent && it.sistema?.criar_novo) {
        const created = await criarProdutoBasico(db, appCfg, it.sistema, it.xml);
        idIdent = created.id_identificador;
        it.sistema.id_identificador = idIdent;
        it.sistema.id_estoque = created.id_estoque;
        it.sistema.criar_novo = false;
      }
      if (!idIdent) throw new Error(`Item ${it.nItem}: produto inválido.`);

      try {
        const idFornec = sessao.fornecedor?.id_fornec ? Number(sessao.fornecedor.id_fornec) : null;
        if (idFornec) {
          const { upsertEstoqueFornecedor } = require('./importacao-estoque-fornec');
          const trib = it.sistema.tributos || {};
          await upsertEstoqueFornecedor({
            id_identificador: idIdent,
            id_fornec: idFornec,
            cod_no_fornecedor: it.sistema.cod_fornecedor || it.xml?.cProd || '',
            cst: trib.cst_icms || it.sistema.cst_icms || '',
            csosn: it.sistema.csosn_saida || trib.csosn || '',
            cofins: trib.p_cofins || 0,
            cst_cofins: trib.cst_cofins || '',
            pis: trib.p_pis || 0,
            cst_pis: trib.cst_pis || '',
            aliq_icms: trib.p_icms || 0,
            uni_medida: it.sistema.uni_medida || '',
            cfop: it.sistema.cfop || '',
            ipi: trib.p_ipi || null,
            cst_ipi: trib.cst_ipi || '',
            cod_barras: it.sistema.cod_barras || '',
          });
        }
      } catch (e) {
        console.warn('TB_ESTOQUE_FORNECEDOR:', e.message);
      }

      try {
        const { salvarRegra } = require('./importacao-regra');
        const trib = it.sistema.tributos || {};
        await salvarRegra({
          id_regra: it.sistema.id_regra || undefined,
          id_fornec: sessao.fornecedor?.id_fornec || null,
          id_identificador: idIdent,
          cod_fornecedor: it.sistema.cod_fornecedor || it.xml?.cProd || '',
          cfop_entrada: it.sistema.cfop || '',
          cfop_saida: it.sistema.cfop_saida || '',
          cfop_nf: it.sistema.cfop_nf || '',
          cst_entrada: trib.cst_icms || it.sistema.cst_icms || '',
          cst_saida: it.sistema.cst_saida || '',
          cst_cfe: it.sistema.cst_cfe || trib.cst_cfe || '',
          csosn_entrada: it.sistema.csosn_entrada || trib.csosn || '',
          csosn_saida: it.sistema.csosn_saida || '',
          cst_pis_entrada: trib.cst_pis || '',
          cst_pis_saida: it.sistema.cst_pis_saida || trib.cst_pis_saida || trib.cst_pis || '',
          cst_cofins_entrada: trib.cst_cofins || '',
          cst_cofins_saida: it.sistema.cst_cofins_saida || trib.cst_cofins_saida || trib.cst_cofins || '',
          pis: trib.p_pis || 0,
          cofins: trib.p_cofins || 0,
          id_cti: it.sistema.id_cti || '',
          id_cti_cfe: it.sistema.id_cti_cfe || '',
          id_class_trib: tribReformaNfe(it.sistema).id_class_trib ?? null,
          id_class_trib_nfce: it.sistema.trib_nfce?.id_class_trib ?? null,
          aplicar_saida: it.sistema.aplicar_saida || 'S',
        });
      } catch (e) {
        console.warn('TB_MT_REGRA_TRIBUTO:', e.message);
      }

      const conversor = Number(it.sistema.conversor ?? 1) || 1;
      const qtdXml = Number(it.sistema.qtd_xml ?? it.xml?.qCom ?? 0) || 0;
      const qtd = Number((qtdXml * conversor).toFixed(6));
      it.sistema.qtd = qtd;
      it.sistema.conversor = conversor;
      it.sistema.qtd_xml = qtdXml;

      const custoInfo = calcCustoUnitarioItem(it.sistema || {}, it.xml || {});
      let vUnit = Number(it.sistema.prc_custo);
      if (!Number.isFinite(vUnit) || vUnit <= 0) {
        vUnit = custoInfo.custoEstoque > 0
          ? custoInfo.custoEstoque
          : (conversor > 0 ? Number(it.xml?.vUnCom || 0) / conversor : Number(it.xml?.vUnCom || 0));
      }
      if (!Number.isFinite(vUnit)) vUnit = 0;
      // Garante custo unitário (já / conversor) no estoque
      it.sistema.prc_custo = vUnit;
      const vDesc = Number(it.sistema.v_desc ?? it.xml?.vDesc ?? 0);
      const vFrete = Number(it.sistema.v_frete ?? it.xml?.vFrete ?? 0);
      const vSeg = Number(it.sistema.v_seguro ?? it.xml?.vSeg ?? 0);
      const vOutro = Number(it.sistema.v_outro ?? it.xml?.vOutro ?? 0);
      const vTotal = round2((qtd * vUnit) - vDesc + vFrete + vSeg + vOutro);
      const uni = String(it.sistema.uni_medida || it.xml?.uCom || 'UN').slice(0, 6);
      const cfop = String(it.sistema.cfop || it.xml?.CFOP || '').slice(0, 4);
      const csosn = String(
        it.sistema.csosn_entrada || it.sistema.csosn || it.sistema.tributos?.csosn || ''
      ).slice(0, 3);

      const idItem = await nextId(db, 'GEN_TB_NFC_ITEM_ID', 'TB_NFC_ITEM', 'ID_NFCITEM');
      await query(db, `
        INSERT INTO TB_NFC_ITEM (
          ID_NFCITEM, ID_IDENTIFICADOR, ID_NFCOMPRA, NUM_ITEM, QTD_ITEM, UNI_MEDIDA,
          VLR_TOTAL, VLR_DESC, VLR_FRETE, VLR_SEGURO, VLR_DESPESA,
          CFOP, CSOSN, EST_BX, VLR_UNIT, PRC_MEDIO, ID_KIT
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'S', ?, ?, 0)`, [
        idItem, idIdent, idNf, Number(it.nItem), qtd, uni,
        vTotal, vDesc, vFrete, vSeg, vOutro,
        cfop || null, csosn || null, vUnit, vUnit,
      ]);

      await insertTributosItem(
        db,
        idItem,
        it.sistema.tributos || {},
        it.xml?.imposto || {},
        tribReformaNfe(it.sistema),
        {
          aplicarSaida: it.sistema.aplicar_saida,
          prcVenda: Number(it.sistema.prc_venda || it.sistema.prc_venda || 0),
        },
      );
      await atualizarCadastroProduto(db, appCfg, it.sistema || {}, it.xml || {});
      await entradaEstoque(db, appCfg, {
        idIdentificador: idIdent,
        qtd,
        prcCusto: vUnit,
        usuario,
        idFuncionario,
        nfLabel,
      });
      itensGravados += 1;
    }

    return {
      id_nfcompra: idNf,
      nf_numero: nfNumero,
      nf_serie: serie,
      itens_gravados: itensGravados,
      parcelas: parcelasXml.length,
    };
  });
}

module.exports = { gravarNfCompra };
