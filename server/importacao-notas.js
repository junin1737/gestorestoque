'use strict';

const { withDb, query } = require('./db');

function toDateOnly(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d).slice(0, 10);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function mapNotaRow(r) {
  return {
    id_nfcompra: Number(r.ID_NFCOMPRA),
    nf_numero: r.NF_NUMERO,
    nf_serie: String(r.NF_SERIE || '').trim(),
    nf_modelo: String(r.NF_MODELO || '').trim(),
    dt_emissao: r.DT_EMISSAO,
    dt_entrada: r.DT_ENTRADA,
    hr_entrada: r.HR_ENTRADA,
    status: String(r.STATUS || '').trim(),
    id_fornec: r.ID_FORNEC != null ? Number(r.ID_FORNEC) : null,
    id_natope: r.ID_NATOPE != null ? Number(r.ID_NATOPE) : null,
    importado_xml: String(r.IMPORTADO_XML || '').trim() === 'S',
    nfe_origem: String(r.NFE_ORIGEM || '').trim(),
    fornecedor_nome: String(r.FORNEC_FANTA || r.FORNEC_NOME || '').trim(),
    fornecedor_cnpj: String(r.FORNEC_CNPJ || '').trim(),
    qtd_itens: Number(r.QTD_ITENS || 0),
    vlr_itens: Number(r.VLR_ITENS || 0),
    origem: 'cadastro',
  };
}

function nextDay(dataAte) {
  const d = new Date(`${dataAte}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return toDateOnly(d);
}

async function listNotasCadastradas({ de, ate, nfNumero, fornecedor, dataCampo } = {}) {
  const hoje = toDateOnly(new Date());
  const dataDe = de || hoje;
  const dataAte = ate || dataDe;
  const nnf = String(nfNumero || '').replace(/\D/g, '');
  const forn = String(fornecedor || '').trim();
  const campoData = String(dataCampo || 'entrada').toLowerCase() === 'emissao' ? 'DT_EMISSAO' : 'DT_ENTRADA';
  return withDb(async (db) => {
    const params = [];
    const parts = [];
    if (nnf) {
      parts.push(`CAST(N.NF_NUMERO AS VARCHAR(20)) CONTAINING ?`);
      params.push(nnf);
    } else {
      parts.push(`N.${campoData} >= ? AND N.${campoData} < ?`);
      params.push(dataDe, nextDay(dataAte));
    }
    if (forn) {
      parts.push(`(UPPER(F.NOME) CONTAINING UPPER(?) OR UPPER(F.NOME_FANTA) CONTAINING UPPER(?) OR REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(F.CNPJ,'')),'.',''),'/',''),'-',''),' ','') CONTAINING ?)`);
      const dig = forn.replace(/\D/g, '');
      params.push(forn, forn, dig || forn);
    }
    const where = parts.join(' AND ');
    const rows = await query(db, `
      SELECT FIRST 200
        N.ID_NFCOMPRA, N.NF_NUMERO, N.NF_SERIE, N.NF_MODELO,
        N.DT_EMISSAO, N.DT_ENTRADA, N.HR_ENTRADA, N.STATUS,
        N.ID_FORNEC, N.ID_NATOPE, N.IMPORTADO_XML, N.TIPO_FRETE, N.NFE_ORIGEM,
        F.NOME AS FORNEC_NOME, F.NOME_FANTA AS FORNEC_FANTA, F.CNPJ AS FORNEC_CNPJ,
        (SELECT COUNT(*) FROM TB_NFC_ITEM I WHERE I.ID_NFCOMPRA = N.ID_NFCOMPRA) AS QTD_ITENS,
        (SELECT COALESCE(SUM(I.VLR_TOTAL), 0) FROM TB_NFC_ITEM I WHERE I.ID_NFCOMPRA = N.ID_NFCOMPRA) AS VLR_ITENS
      FROM TB_NFCOMPRA N
      LEFT JOIN TB_FORNECEDOR F ON F.ID_FORNEC = N.ID_FORNEC
      WHERE ${where}
      ORDER BY N.${campoData} DESC, N.ID_NFCOMPRA DESC`, params);
    return rows.map(mapNotaRow);
  });
}

/** NF já cadastrada (não cancelada) pela chave ou pelo nº + fornecedor. */
async function findNfDuplicada({ chave, nfNumero, serie, idFornec, cnpj } = {}) {
  const chaveDig = String(chave || '').replace(/\D/g, '');
  const nnf = Number(String(nfNumero || '').replace(/\D/g, '') || 0);
  const cnpjDig = String(cnpj || '').replace(/\D/g, '');
  const idForn = idFornec != null && idFornec !== '' ? Number(idFornec) : null;
  if (!chaveDig && !nnf) return null;

  return withDb(async (db) => {
    let rows = [];
    if (chaveDig) {
      rows = await query(db, `
        SELECT FIRST 3
          N.ID_NFCOMPRA, N.NF_NUMERO, N.NF_SERIE, N.NF_MODELO,
          N.DT_EMISSAO, N.DT_ENTRADA, N.HR_ENTRADA, N.STATUS,
          N.ID_FORNEC, N.ID_NATOPE, N.IMPORTADO_XML, N.TIPO_FRETE, N.NFE_ORIGEM,
          F.NOME AS FORNEC_NOME, F.NOME_FANTA AS FORNEC_FANTA, F.CNPJ AS FORNEC_CNPJ,
          (SELECT COUNT(*) FROM TB_NFC_ITEM I WHERE I.ID_NFCOMPRA = N.ID_NFCOMPRA) AS QTD_ITENS,
          (SELECT COALESCE(SUM(I.VLR_TOTAL), 0) FROM TB_NFC_ITEM I WHERE I.ID_NFCOMPRA = N.ID_NFCOMPRA) AS VLR_ITENS
        FROM TB_NFCOMPRA N
        LEFT JOIN TB_FORNECEDOR F ON F.ID_FORNEC = N.ID_FORNEC
        WHERE UPPER(TRIM(COALESCE(N.STATUS, ''))) <> 'C'
          AND TRIM(COALESCE(N.NFE_ORIGEM, '')) = ?
        ORDER BY N.ID_NFCOMPRA DESC`, [chaveDig]);
    }
    if (!rows.length && nnf > 0 && (idForn || cnpjDig)) {
      const params = [nnf];
      let fornClause = '';
      if (idForn) {
        fornClause = 'N.ID_FORNEC = ?';
        params.push(idForn);
      } else {
        fornClause = `REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(F.CNPJ,'')),'.',''),'/',''),'-',''),' ','') = ?`;
        params.push(cnpjDig);
      }
      rows = await query(db, `
        SELECT FIRST 3
          N.ID_NFCOMPRA, N.NF_NUMERO, N.NF_SERIE, N.NF_MODELO,
          N.DT_EMISSAO, N.DT_ENTRADA, N.HR_ENTRADA, N.STATUS,
          N.ID_FORNEC, N.ID_NATOPE, N.IMPORTADO_XML, N.TIPO_FRETE, N.NFE_ORIGEM,
          F.NOME AS FORNEC_NOME, F.NOME_FANTA AS FORNEC_FANTA, F.CNPJ AS FORNEC_CNPJ,
          (SELECT COUNT(*) FROM TB_NFC_ITEM I WHERE I.ID_NFCOMPRA = N.ID_NFCOMPRA) AS QTD_ITENS,
          (SELECT COALESCE(SUM(I.VLR_TOTAL), 0) FROM TB_NFC_ITEM I WHERE I.ID_NFCOMPRA = N.ID_NFCOMPRA) AS VLR_ITENS
        FROM TB_NFCOMPRA N
        LEFT JOIN TB_FORNECEDOR F ON F.ID_FORNEC = N.ID_FORNEC
        WHERE UPPER(TRIM(COALESCE(N.STATUS, ''))) <> 'C'
          AND N.NF_NUMERO = ?
          AND (${fornClause})
        ORDER BY N.ID_NFCOMPRA DESC`, params);
    }
    if (!rows.length) return null;
    const nota = mapNotaRow(rows[0]);
    return {
      ...nota,
      aviso: `Já existe a NF ${nota.nf_numero}/${nota.nf_serie || '—'} deste fornecedor no banco (cód. ${nota.id_nfcompra}). Evite entrada duplicada.`,
    };
  });
}

async function listFormasPagto() {
  return withDb(async (db) => {
    const rows = await query(db, `
      SELECT ID_FMAPGTO, DESCRICAO, STATUS, UTILIZACAO
      FROM TB_FORMA_PAGTO_SIS
      WHERE TRIM(COALESCE(STATUS, 'A')) = 'A'
      ORDER BY DESCRICAO`);
    return rows.map((r) => ({
      id_fmapgto: Number(r.ID_FMAPGTO),
      descricao: String(r.DESCRICAO || '').trim(),
      utilizacao: String(r.UTILIZACAO || '').trim(),
    }));
  });
}

async function listParcelamentos(idFmapgto) {
  const id = idFmapgto != null && idFmapgto !== '' ? Number(idFmapgto) : null;
  return withDb(async (db) => {
    const params = [];
    let where = `TRIM(COALESCE(STATUS, 'A')) = 'A'`;
    if (id != null && !Number.isNaN(id)) {
      where += ` AND ID_FMAPGTO = ?`;
      params.push(id);
    }
    const rows = await query(db, `
      SELECT ID_PARCELA, DESCRICAO, N_PARCELAS, INTERVALO, ENTRADA, ID_FMAPGTO, STATUS
      FROM TB_PARCELAMENTO
      WHERE ${where}
      ORDER BY N_PARCELAS, DESCRICAO`, params);
    return rows.map((r) => ({
      id_parcela: Number(r.ID_PARCELA),
      descricao: String(r.DESCRICAO || '').trim(),
      n_parcelas: Number(r.N_PARCELAS || 0),
      intervalo: Number(r.INTERVALO || 0),
      entrada: String(r.ENTRADA || '').trim(),
      id_fmapgto: r.ID_FMAPGTO != null ? Number(r.ID_FMAPGTO) : null,
    }));
  });
}

async function listUnidades(q) {
  const term = String(q || '').trim();
  return withDb(async (db) => {
    const params = [];
    let where = `(STATUS = 'A' OR STATUS IS NULL)`;
    if (term) {
      where += ` AND (UPPER(UNIDADE) CONTAINING UPPER(?) OR UPPER(DESCRICAO) CONTAINING UPPER(?))`;
      params.push(term, term);
    }
    const rows = await query(db, `
      SELECT FIRST 80 UNIDADE, DESCRICAO, CONVERSOR, STATUS, VENDA_FRACIONADA
      FROM TB_UNI_MEDIDA
      WHERE ${where}
      ORDER BY UNIDADE`, params);
    return rows.map((r) => ({
      unidade: String(r.UNIDADE || '').trim(),
      descricao: String(r.DESCRICAO || '').trim(),
      conversor: Number(r.CONVERSOR || 1),
      status: String(r.STATUS || '').trim(),
      venda_fracionada: String(r.VENDA_FRACIONADA || '').trim(),
    }));
  });
}

async function cadastrarUnidade({ unidade, descricao, conversor }) {
  const uni = String(unidade || '').trim().toUpperCase();
  if (!uni) throw new Error('Informe a unidade.');
  const desc = String(descricao || uni).trim();
  const conv = Number(conversor || 1) || 1;
  return withDb(async (db) => {
    const exists = await query(db, 'SELECT FIRST 1 UNIDADE FROM TB_UNI_MEDIDA WHERE UNIDADE = ?', [uni]);
    if (exists[0]) throw new Error(`Unidade ${uni} já existe.`);
    await query(db, `
      INSERT INTO TB_UNI_MEDIDA (UNIDADE, DESCRICAO, CONVERSOR, STATUS, VENDA_FRACIONADA, OPERACAO)
      VALUES (?, ?, ?, 'A', 'N', '*')`, [uni, desc, conv]);
    return { unidade: uni, descricao: desc, conversor: conv };
  });
}

async function listNaturezas(q) {
  const term = String(q || '').trim();
  return withDb(async (db) => {
    const params = [];
    let where = `(STATUS = 'A' OR STATUS IS NULL)`;
    if (term) {
      where += ` AND (UPPER(DESCRICAO) CONTAINING UPPER(?) OR CAST(CFOP AS VARCHAR(10)) CONTAINING ?)`;
      params.push(term, term);
    }
    const rows = await query(db, `
      SELECT FIRST 50 ID_NATOPE, DESCRICAO, CFOP, CSOSN_PADRAO, STATUS
      FROM TB_NAT_OPERACAO
      WHERE ${where}
      ORDER BY DESCRICAO`, params);
    return rows.map((r) => ({
      id_natope: Number(r.ID_NATOPE),
      descricao: String(r.DESCRICAO || '').trim(),
      cfop: String(r.CFOP || '').trim(),
      csosn_padrao: String(r.CSOSN_PADRAO || '').trim(),
    }));
  });
}

async function listClassTrib(q, id) {
  const idNum = id != null && String(id).trim() !== '' ? Number(id) : null;
  const term = String(q || '').trim();
  return withDb(async (db) => {
    const mapRow = (r) => ({
      id_class_trib: Number(r.ID_CLASS_TRIB),
      cod_class_trib: String(r.COD_CLASS_TRIB || '').trim(),
      desc_class_trib: String(r.DESC_CLASS_TRIB || '').trim(),
      percent_red_aliq_cbs: Number(r.PERCENT_RED_ALIQ_CBS || 0),
      percent_red_aliq_ibs: Number(r.PERCENT_RED_ALIQ_IBS || 0),
      cst_class_trib: String(r.CST_CLASS_TRIB || '').trim(),
      ind_nfe: String(r.IND_NFE || '').trim(),
      ind_nfce: String(r.IND_NFCE || '').trim(),
      ind_trib_regular: String(r.IND_TRIB_REGULAR || '').trim(),
      ind_cred_presumido: String(r.IND_CRED_PRESUMIDO || '').trim(),
      codigo: String(r.COD_CLASS_TRIB || '').trim(),
      descricao: String(r.DESC_CLASS_TRIB || '').trim(),
    });

    if (idNum) {
      const rows = await query(db, `
        SELECT FIRST 1
          ID_CLASS_TRIB, COD_CLASS_TRIB, DESC_CLASS_TRIB,
          PERCENT_RED_ALIQ_CBS, PERCENT_RED_ALIQ_IBS, CST_CLASS_TRIB,
          IND_NFE, IND_NFCE, IND_TRIB_REGULAR, IND_CRED_PRESUMIDO
        FROM TB_CLASS_TRIB
        WHERE ID_CLASS_TRIB = ?`, [idNum]);
      return rows.map(mapRow);
    }

    const params = [];
    let where = `(STATUS = 'A' OR STATUS IS NULL OR TRIM(STATUS) = 'A')`;
    if (term) {
      where += ` AND (
        UPPER(COD_CLASS_TRIB) CONTAINING UPPER(?)
        OR UPPER(DESC_CLASS_TRIB) CONTAINING UPPER(?)
        OR CAST(ID_CLASS_TRIB AS VARCHAR(20)) CONTAINING ?
      )`;
      params.push(term, term, term);
    }
    const rows = await query(db, `
      SELECT FIRST 80
        ID_CLASS_TRIB, COD_CLASS_TRIB, DESC_CLASS_TRIB,
        PERCENT_RED_ALIQ_CBS, PERCENT_RED_ALIQ_IBS, CST_CLASS_TRIB,
        IND_NFE, IND_NFCE, IND_TRIB_REGULAR, IND_CRED_PRESUMIDO
      FROM TB_CLASS_TRIB
      WHERE ${where}
      ORDER BY COD_CLASS_TRIB`, params);
    return rows.map(mapRow);
  });
}

async function listAnp(q) {
  const term = String(q || '').trim();
  return withDb(async (db) => {
    const params = [];
    let where = '1=1';
    if (term) {
      where = `(CAST(CODIGO AS VARCHAR(20)) CONTAINING ? OR UPPER(PRODUTO) CONTAINING UPPER(?))`;
      params.push(term, term);
    }
    const rows = await query(db, `
      SELECT FIRST 60 CODIGO, PRODUTO FROM TB_COD_PROD_ANP
      WHERE ${where}
      ORDER BY PRODUTO`, params);
    return rows.map((r) => ({
      codigo: String(r.CODIGO ?? '').trim(),
      produto: String(r.PRODUTO || '').trim(),
    }));
  });
}

async function listCfopSis(q) {
  const term = String(q || '').trim();
  return withDb(async (db) => {
    const params = [];
    let where = '1=1';
    if (term) {
      where = `(CFOP CONTAINING ? OR UPPER(DESCRICAO) CONTAINING UPPER(?) OR UPPER(RESUMO) CONTAINING UPPER(?))`;
      params.push(term, term, term);
    }
    const rows = await query(db, `
      SELECT FIRST 60 CFOP, DESCRICAO, RESUMO
      FROM TB_CFOP_SIS
      WHERE ${where}
      ORDER BY CFOP`, params);
    return rows.map((r) => ({
      cfop: String(r.CFOP || '').trim(),
      descricao: String(r.DESCRICAO || '').trim(),
      resumo: String(r.RESUMO || '').trim(),
    }));
  });
}

async function listCstTabela(table, codeCol, q) {
  const term = String(q || '').trim();
  return withDb(async (db) => {
    const params = [];
    let where = '1=1';
    if (term) {
      where = `(CAST(${codeCol} AS VARCHAR(10)) CONTAINING ? OR UPPER(DESCRICAO) CONTAINING UPPER(?))`;
      params.push(term, term);
    }
    const rows = await query(db, `
      SELECT FIRST 80 ${codeCol} AS COD, DESCRICAO
      FROM ${table}
      WHERE ${where}
      ORDER BY ${codeCol}`, params);
    return rows.map((r) => ({
      codigo: String(r.COD ?? '').trim(),
      descricao: String(r.DESCRICAO || '').trim(),
    }));
  });
}

function listCstPis(q) { return listCstTabela('TB_CST_PIS_SIS', 'CST_PIS', q); }
function listCstCofins(q) { return listCstTabela('TB_CST_COFINS_SIS', 'CST_COFINS', q); }
function listCstIpi(q) { return listCstTabela('TB_CST_IPI_SIS', 'CST_IPI', q); }
function listCstIcms(q) { return listCstTabela('TB_CST_SIS', 'CST', q); }
function listCsosn(q) { return listCstTabela('TB_CSOSN_SIS', 'CSOSN', q); }

async function listCest(q, ncm) {
  const term = String(q || '').trim();
  const ncmDigits = String(ncm || '').replace(/\D/g, '');
  return withDb(async (db) => {
    const params = [];
    const parts = ['1=1'];

    // Compatível com Clipp: CEST só dos NCMs da nota/produto
    if (ncmDigits) {
      // Match exato ou prefixo (NCM na tabela pode ser mais curto)
      parts.push(`(
        REPLACE(TRIM(NCM), '.', '') = ?
        OR ? STARTING WITH REPLACE(TRIM(NCM), '.', '')
        OR REPLACE(TRIM(NCM), '.', '') STARTING WITH ?
      )`);
      const ncm4 = ncmDigits.slice(0, 4);
      params.push(ncmDigits, ncmDigits, ncm4 || ncmDigits);
    }

    if (term) {
      parts.push(`(CEST CONTAINING ? OR NCM CONTAINING ? OR UPPER(DESCRICAO) CONTAINING UPPER(?))`);
      params.push(term, term, term);
    }

    const rows = await query(db, `
      SELECT FIRST 60 CEST, NCM, DESCRICAO FROM TB_CEST_NCM
      WHERE ${parts.join(' AND ')}
      ORDER BY CEST`, params);
    return rows.map((r) => ({
      cest: String(r.CEST || '').trim(),
      ncm: String(r.NCM || '').trim(),
      descricao: String(r.DESCRICAO || '').trim(),
    }));
  });
}

/** Busca CTI / taxa em TB_TAXA_UF — prioriza descrição (não só a sigla ID_CTI). */
async function listTaxaUf(q) {
  const term = String(q || '').trim();
  return withDb(async (db) => {
    const params = [];
    let where = '1=1';
    if (term) {
      where = `(UPPER(DESCRICAO) CONTAINING UPPER(?) OR UPPER(TRIM(ID_CTI)) CONTAINING UPPER(?))`;
      params.push(term, term);
    }
    const rows = await query(db, `
      SELECT FIRST 60 ID_CTI, DESCRICAO FROM TB_TAXA_UF
      WHERE ${where}
      ORDER BY DESCRICAO`, params);
    return rows.map((r) => ({
      id_cti: String(r.ID_CTI || '').trim(),
      descricao: String(r.DESCRICAO || '').trim(),
      codigo: String(r.ID_CTI || '').trim(),
      label: `${String(r.DESCRICAO || '').trim() || String(r.ID_CTI || '').trim()}`,
    }));
  });
}

async function getEmitenteFiscal() {
  return withDb(async (db) => {
    const rows = await query(db, `SELECT FIRST 1 SIMPLES, CNPJ, NOME_FANTA FROM TB_EMITENTE`);
    const r = rows[0] || {};
    return {
      simples: String(r.SIMPLES || '').trim().toUpperCase() === 'S',
      cnpj: String(r.CNPJ || '').trim(),
      nome: String(r.NOME_FANTA || '').trim(),
    };
  });
}

async function getProdutoFiscal(idIdentificador) {
  const id = Number(idIdentificador);
  if (!id) return null;
  return withDb(async (db, appCfg) => {
    const { activeTargets } = require('./db');
    const t = activeTargets(appCfg)[0].tables;
    const rows = await query(db, `
      SELECT FIRST 1
        E.ID_ESTOQUE, I.ID_IDENTIFICADOR, E.DESCRICAO, E.ID_GRUPO, E.ID_SUBGRUPO,
        E.UNI_MEDIDA, E.PRC_VENDA, E.PRC_CUSTO, E.MARGEM_LB, E.ID_TIPOITEM,
        E.CFOP, E.CFOP_NF, E.CST_PIS, E.CST_COFINS, E.PIS, E.COFINS,
        E.ID_CTI, E.ID_CTI_CFE, E.STATUS,
        P.COD_BARRA, P.REFERENCIA, P.DESC_CMPL, P.COD_NCM, P.COD_CEST, P.ANP,
        P.CST, P.CSOSN, P.CST_CFE, P.CSOSN_CFE, P.QTD_ATUAL
      FROM ${t.estoque} E
      JOIN ${t.identificador} I ON I.ID_ESTOQUE = E.ID_ESTOQUE
      JOIN ${t.produto} P ON P.ID_IDENTIFICADOR = I.ID_IDENTIFICADOR
      WHERE I.ID_IDENTIFICADOR = ?`, [id]);
    if (!rows[0]) return null;
    const r = rows[0];
    let tribNfe = null;
    let tribNfce = null;
    try {
      const t1 = await query(db, `
        SELECT FIRST 1 ID_CLASS_TRIB, DIFERIMENTO_CBS, COD_CRED_PRESU_CBS, ALIQ_CRED_PRESU_CBS,
               DIFERIMENTO_IBS_UF, DIFERIMENTO_IBS_MUN, COD_CRED_PRESU_IBS, ALIQ_CRED_PRESU_IBS,
               ID_CLASS_TRIB_REGULAR, DEDUZ_CRED_PRESU_CBS, DEDUZ_CRED_PRESU_IBS, IND_BEM_MOVEL_USADO
        FROM TB_EST_TRIBUTOS WHERE ID_ESTOQUE = ?`, [r.ID_ESTOQUE]);
      if (t1[0]) {
        tribNfe = {
          id_class_trib: t1[0].ID_CLASS_TRIB != null ? Number(t1[0].ID_CLASS_TRIB) : null,
          diferimento_cbs: Number(t1[0].DIFERIMENTO_CBS || 0),
          cod_cred_presu_cbs: String(t1[0].COD_CRED_PRESU_CBS || '').trim(),
          aliq_cred_presu_cbs: Number(t1[0].ALIQ_CRED_PRESU_CBS || 0),
          diferimento_ibs_uf: Number(t1[0].DIFERIMENTO_IBS_UF || 0),
          diferimento_ibs_mun: Number(t1[0].DIFERIMENTO_IBS_MUN || 0),
          cod_cred_presu_ibs: String(t1[0].COD_CRED_PRESU_IBS || '').trim(),
          aliq_cred_presu_ibs: Number(t1[0].ALIQ_CRED_PRESU_IBS || 0),
          id_class_trib_regular: t1[0].ID_CLASS_TRIB_REGULAR != null ? Number(t1[0].ID_CLASS_TRIB_REGULAR) : null,
          deduz_cred_presu_cbs: String(t1[0].DEDUZ_CRED_PRESU_CBS || 'N').slice(0, 1),
          deduz_cred_presu_ibs: String(t1[0].DEDUZ_CRED_PRESU_IBS || 'N').slice(0, 1),
          ind_bem_movel_usado: String(t1[0].IND_BEM_MOVEL_USADO || 'N').slice(0, 1),
        };
      }
      const t2 = await query(db, `
        SELECT FIRST 1 ID_CLASS_TRIB, DIFERIMENTO_CBS, DIFERIMENTO_IBS_UF, DIFERIMENTO_IBS_MUN
        FROM TB_EST_TRIBUTOS_NFCE WHERE ID_ESTOQUE = ?`, [r.ID_ESTOQUE]);
      if (t2[0]) {
        tribNfce = {
          id_class_trib: t2[0].ID_CLASS_TRIB != null ? Number(t2[0].ID_CLASS_TRIB) : null,
          diferimento_cbs: Number(t2[0].DIFERIMENTO_CBS || 0),
          diferimento_ibs_uf: Number(t2[0].DIFERIMENTO_IBS_UF || 0),
          diferimento_ibs_mun: Number(t2[0].DIFERIMENTO_IBS_MUN || 0),
        };
      }
    } catch { /* bases sem reforma */ }
    return {
      id_estoque: Number(r.ID_ESTOQUE),
      id_identificador: Number(r.ID_IDENTIFICADOR),
      descricao: String(r.DESCRICAO || '').trim(),
      id_grupo: r.ID_GRUPO != null ? Number(r.ID_GRUPO) : null,
      id_subgrupo: r.ID_SUBGRUPO != null ? Number(r.ID_SUBGRUPO) : null,
      uni_medida: String(r.UNI_MEDIDA || '').trim(),
      prc_venda: Number(r.PRC_VENDA || 0),
      prc_custo: Number(r.PRC_CUSTO || 0),
      margem_lb: Number(r.MARGEM_LB || 0),
      id_tipoitem: String(r.ID_TIPOITEM || '').trim(),
      cfop: String(r.CFOP || '').trim(),
      cfop_nf: String(r.CFOP_NF || '').trim(),
      cst_pis: String(r.CST_PIS || '').trim(),
      cst_cofins: String(r.CST_COFINS || '').trim(),
      pis: Number(r.PIS || 0),
      cofins: Number(r.COFINS || 0),
      id_cti: String(r.ID_CTI || '').trim(),
      id_cti_cfe: String(r.ID_CTI_CFE || '').trim(),
      status: String(r.STATUS || 'A').trim(),
      cod_barras: String(r.COD_BARRA || '').trim(),
      referencia: String(r.REFERENCIA || '').trim(),
      desc_cmpl: String(r.DESC_CMPL || '').trim(),
      ncm: String(r.COD_NCM || '').trim(),
      cest: String(r.COD_CEST || '').trim(),
      anp: String(r.ANP || '').trim(),
      cst: String(r.CST || '').trim(),
      csosn: String(r.CSOSN || '').trim(),
      cst_cfe: String(r.CST_CFE || '').trim(),
      csosn_cfe: String(r.CSOSN_CFE || '').trim(),
      qtd_atual: Number(r.QTD_ATUAL || 0),
      trib_nfe: tribNfe,
      trib_nfce: tribNfce,
    };
  });
}

async function getNotaById(id) {
  const idNf = Number(id);
  if (!idNf) return null;
  return withDb(async (db) => {
    const rows = await query(db, `
      SELECT FIRST 1 N.ID_NFCOMPRA, N.NF_NUMERO, N.NF_SERIE, N.NFE_ORIGEM, N.STATUS,
             F.NOME_FANTA AS FORNEC_FANTA, F.CNPJ AS FORNEC_CNPJ
      FROM TB_NFCOMPRA N
      LEFT JOIN TB_FORNECEDOR F ON F.ID_FORNEC = N.ID_FORNEC
      WHERE N.ID_NFCOMPRA = ?`, [idNf]);
    return rows[0] ? mapNotaRow(rows[0]) : null;
  });
}

async function getNotaResumo(id) {
  const idNf = Number(id);
  if (!idNf) return null;
  return withDb(async (db) => {
    const cabRows = await query(db, `
      SELECT FIRST 1 N.ID_NFCOMPRA, N.NF_NUMERO, N.NF_SERIE, N.NFE_ORIGEM, N.STATUS,
             N.DT_EMISSAO, N.DT_ENTRADA,
             F.NOME_FANTA AS FORNEC_FANTA, F.NOME AS FORNEC_NOME, F.CNPJ AS FORNEC_CNPJ
      FROM TB_NFCOMPRA N
      LEFT JOIN TB_FORNECEDOR F ON F.ID_FORNEC = N.ID_FORNEC
      WHERE N.ID_NFCOMPRA = ?`, [idNf]);
    if (!cabRows[0]) return null;
    const nota = mapNotaRow(cabRows[0]);
    let itens = [];
    try {
      const itemRows = await query(db, `
        SELECT I.NUM_ITEM, I.ID_IDENTIFICADOR, I.QTD_ITEM, I.UNI_MEDIDA,
               I.VLR_UNIT, I.VLR_TOTAL, I.CFOP, I.CSOSN,
               E.DESCRICAO
        FROM TB_NFC_ITEM I
        LEFT JOIN TB_EST_IDENTIFICADOR X ON X.ID_IDENTIFICADOR = I.ID_IDENTIFICADOR
        LEFT JOIN TB_ESTOQUE E ON E.ID_ESTOQUE = X.ID_ESTOQUE
        WHERE I.ID_NFCOMPRA = ?
        ORDER BY I.NUM_ITEM`, [idNf]);
      itens = itemRows.map((r) => ({
        num_item: Number(r.NUM_ITEM || 0),
        id_identificador: Number(r.ID_IDENTIFICADOR || 0),
        descricao: String(r.DESCRICAO || '').trim(),
        qtd: Number(r.QTD_ITEM || 0),
        uni_medida: String(r.UNI_MEDIDA || '').trim(),
        vlr_unit: Number(r.VLR_UNIT || 0),
        vlr_total: Number(r.VLR_TOTAL || 0),
        cfop: String(r.CFOP || '').trim(),
        csosn: String(r.CSOSN || '').trim(),
      }));
    } catch (err) {
      console.warn('Resumo itens NF:', err.message);
    }
    const totalItens = itens.reduce((acc, it) => acc + Number(it.vlr_total || 0), 0);
    return {
      ...nota,
      fornecedor_nome: nota.fornecedor_nome || String(cabRows[0].FORNEC_FANTA || cabRows[0].FORNEC_NOME || '').trim(),
      itens,
      qtd_itens: itens.length || nota.qtd_itens,
      vlr_itens: totalItens || nota.vlr_itens,
    };
  });
}

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function tryQueryFirst(db, sql, params) {
  try {
    const rows = await query(db, sql, params);
    return rows[0] || null;
  } catch (err) {
    console.warn('NFC última entrada:', err.message);
    return null;
  }
}

function mapUltimaNfcRow(r, extra = {}) {
  if (!r) return null;
  return {
    id_nfcitem: Number(r.ID_NFCITEM),
    id_nfcompra: Number(r.ID_NFCOMPRA),
    nf_numero: r.NF_NUMERO,
    nf_serie: String(r.NF_SERIE || '').trim(),
    dt_entrada: r.DT_ENTRADA,
    dt_emissao: r.DT_EMISSAO,
    id_fornec: r.ID_FORNEC != null ? Number(r.ID_FORNEC) : null,
    fornecedor_uf: String(extra.uf || r.FORNEC_UF || '').trim(),
    fornecedor_nome: String(extra.nome || r.FORNEC_FANTA || r.NOME_FANTA || r.FORNEC_NOME || '').trim(),
    cfop: String(r.CFOP || '').trim(),
    csosn: String(r.CSOSN || '').trim(),
    qtd: numOrNull(r.QTD_ITEM != null ? r.QTD_ITEM : r.QTD_ITEM),
    vlr_unit: numOrNull(r.VLR_UNIT != null ? r.VLR_UNIT : r.VLR_UNIT),
    cst_icms: String(extra.CST_ICMS || r.CST_ICMS || '').trim(),
    aliq_icms: numOrNull(extra.ALIQ_ICMS != null ? extra.ALIQ_ICMS : r.ALIQ_ICMS),
    vlr_bc_icms: numOrNull(extra.VLR_BC_ICMS != null ? extra.VLR_BC_ICMS : r.VLR_BC_ICMS),
    vlr_icms: numOrNull(extra.VLR_ICMS != null ? extra.VLR_ICMS : r.VLR_ICMS),
    vlr_bc_st: numOrNull(extra.VLR_BC_ICMS_ST != null ? extra.VLR_BC_ICMS_ST : r.VLR_BC_ICMS_ST),
    vlr_st: numOrNull(extra.VLR_ST != null ? extra.VLR_ST : r.VLR_ST),
    vlr_bc_st_ret: numOrNull(extra.VLR_BC_ICMS_ST_RET != null ? extra.VLR_BC_ICMS_ST_RET : r.VLR_BC_ICMS_ST_RET),
    vlr_st_ret: numOrNull(extra.VLR_ICMS_ST_RET != null ? extra.VLR_ICMS_ST_RET : r.VLR_ICMS_ST_RET),
    aliq_st: numOrNull(extra.ALIQ_ST_DEST != null ? extra.ALIQ_ST_DEST : r.ALIQ_ST_DEST),
    cst_pis: String(extra.CST_PIS || r.CST_PIS || '').trim(),
    aliq_pis: numOrNull(extra.ALIQ_PIS != null ? extra.ALIQ_PIS : r.ALIQ_PIS),
    cst_cofins: String(extra.CST_COFINS || r.CST_COFINS || '').trim(),
    aliq_cofins: numOrNull(extra.ALIQ_COFINS != null ? extra.ALIQ_COFINS : r.ALIQ_COFINS),
  };
}

async function fetchUltimaEntradaNfc(db, idIdent) {
  let row = await tryQueryFirst(db, `
    SELECT FIRST 1
      I.ID_NFCITEM, I.ID_NFCOMPRA, I.CFOP, I.CSOSN,
      N.NF_NUMERO, N.NF_SERIE, N.DT_ENTRADA, N.DT_EMISSAO, N.ID_FORNEC, N.STATUS
    FROM TB_NFC_ITEM I
    JOIN TB_NFCOMPRA N ON N.ID_NFCOMPRA = I.ID_NFCOMPRA
    WHERE I.ID_IDENTIFICADOR = ?
      AND UPPER(TRIM(COALESCE(N.STATUS, ''))) <> 'C'
    ORDER BY N.DT_ENTRADA DESC, I.ID_NFCITEM DESC`, [idIdent]);

  if (!row) {
    row = await tryQueryFirst(db, `
      SELECT FIRST 1
        I.ID_NFCITEM, I.ID_NFCOMPRA, I.CFOP, I.CSOSN, I.QTD_ITEM, I.VLR_UNIT,
        N.NF_NUMERO, N.NF_SERIE, N.DT_ENTRADA, N.DT_EMISSAO, N.ID_FORNEC, N.STATUS
      FROM TB_NFC_ITEM I
      JOIN TB_NFCOMPRA N ON N.ID_NFCOMPRA = I.ID_NFCOMPRA
      WHERE I.ID_IDENTIFICADOR = ?
        AND UPPER(TRIM(COALESCE(N.STATUS, ''))) <> 'C'
      ORDER BY N.DT_ENTRADA DESC, I.ID_NFCITEM DESC`, [idIdent]);
  }

  if (!row) {
    row = await tryQueryFirst(db, `
      SELECT FIRST 1
        I.ID_NFCITEM, I.ID_NFCOMPRA, I.CFOP, I.CSOSN, I.QTD_ITEM, I.VLR_UNIT,
        N.NF_NUMERO, N.NF_SERIE, N.DT_ENTRADA, N.DT_EMISSAO, N.ID_FORNEC, N.STATUS
      FROM TB_NFC_ITEM I
      JOIN TB_NFCOMPRA N ON N.ID_NFCOMPRA = I.ID_NFCOMPRA
      WHERE I.ID_IDENTIFICADOR = ?
        AND UPPER(TRIM(COALESCE(N.STATUS, ''))) <> 'C'
      ORDER BY N.DT_ENTRADA DESC, I.ID_NFCITEM DESC`, [idIdent]);
  }

  if (!row) {
    row = await tryQueryFirst(db, `
      SELECT FIRST 1
        I.ID_NFCITEM, I.ID_NFCOMPRA, I.CFOP, I.CSOSN, I.QTD_ITEM, I.VLR_UNIT,
        N.NF_NUMERO, N.NF_SERIE, N.DT_ENTRADA, N.DT_EMISSAO, N.ID_FORNEC, N.STATUS
      FROM TB_NFC_ITEM I
      JOIN TB_NFCOMPRA N ON N.ID_NFCOMPRA = I.ID_NFCOMPRA
      JOIN TB_EST_IDENTIFICADOR X ON X.ID_ESTOQUE = I.ID_ESTOQUE
      WHERE X.ID_IDENTIFICADOR = ?
        AND UPPER(TRIM(COALESCE(N.STATUS, ''))) <> 'C'
      ORDER BY N.DT_ENTRADA DESC, I.ID_NFCITEM DESC`, [idIdent]);
  }

  if (!row) return null;

  const extra = {};
  const idItem = Number(row.ID_NFCITEM);
  const taxTries = [
    ['SELECT FIRST 1 CST_ICMS, ALIQ_ICMS, VLR_BC_ICMS, VLR_ICMS FROM TB_NFC_ITEM_ICMS WHERE ID_NFCITEM = ?', idItem],
    ['SELECT FIRST 1 CST_ICMS, ALIQ_ICMS, VLR_BC_ICMS, VLR_ICMS FROM TB_NFC_ITEM_ICMS WHERE ID_NFCITEM = ?', idItem],
  ];
  for (const [sql, param] of taxTries) {
    const tax = await tryQueryFirst(db, sql, [param]);
    if (tax) {
      Object.assign(extra, tax);
      break;
    }
  }
  const st = await tryQueryFirst(db, `
    SELECT FIRST 1 VLR_BC_ICMS_ST, VLR_ST, VLR_BC_ICMS_ST_RET, VLR_ICMS_ST_RET, ALIQ_ST_DEST
    FROM TB_NFC_ITEM_ST WHERE ID_NFCITEM = ?`, [idItem])
    || await tryQueryFirst(db, `
    SELECT FIRST 1 VLR_BC_ICMS_ST, VLR_ST, VLR_BC_ICMS_ST_RET, VLR_ICMS_ST_RET, ALIQ_ST_DEST
    FROM TB_NFC_ITEM_ST WHERE ID_NFCITEM = ?`, [idItem]);
  if (st) Object.assign(extra, st);

  const pis = await tryQueryFirst(db, `SELECT FIRST 1 CST_PIS, ALIQ_PIS FROM TB_NFC_ITEM_PIS WHERE ID_NFCITEM = ?`, [idItem])
    || await tryQueryFirst(db, `SELECT FIRST 1 CST_PIS, ALIQ_PIS FROM TB_NFC_ITEM_PIS WHERE ID_NFCITEM = ?`, [idItem]);
  if (pis) Object.assign(extra, pis);
  const cof = await tryQueryFirst(db, `SELECT FIRST 1 CST_COFINS, ALIQ_COFINS FROM TB_NFC_ITEM_COFINS WHERE ID_NFCITEM = ?`, [idItem])
    || await tryQueryFirst(db, `SELECT FIRST 1 CST_COFINS, ALIQ_COFINS FROM TB_NFC_ITEM_COFINS WHERE ID_NFCITEM = ?`, [idItem]);
  if (cof) Object.assign(extra, cof);

  if (row.ID_FORNEC != null) {
    const forn = await tryQueryFirst(db, `
      SELECT FIRST 1 UF, NOME_FANTA, NOME FROM TB_FORNECEDOR WHERE ID_FORNEC = ?`, [row.ID_FORNEC])
      || await tryQueryFirst(db, `
      SELECT FIRST 1 UF, NOME_FANTA, NOME FROM TB_FORNECEDOR WHERE ID_FORNEC = ?`, [row.ID_FORNEC]);
    if (forn) {
      extra.uf = forn.UF;
      extra.nome = String(forn.NOME_FANTA || forn.NOME_FANTA || forn.NOME || '').trim();
    }
  }

  return mapUltimaNfcRow(row, extra);
}

/** Última entrada do identificador + sugestão pelos parâmetros (CFOP / regra tributo). */
async function getSugestaoTributoEstoque(idIdentificador) {
  const id = Number(idIdentificador);
  if (!id) return { atual: null, ultima_entrada: null, sugestao: null };
  const atual = await getProdutoFiscal(id);
  let ultima = null;
  try {
    ultima = await withDb((db) => fetchUltimaEntradaNfc(db, id));
  } catch (err) {
    console.warn('ultima entrada NFC:', err.message);
    ultima = null;
  }

  let sugestao = null;
  let regra = null;
  if (ultima?.cfop) {
    try {
      const importacaoParams = require('./importacao-params');
      const conv = await importacaoParams.mapCfopEntrada(ultima.cfop, ultima.fornecedor_uf);
      const importacaoRegra = require('./importacao-regra');
      regra = await importacaoRegra.buscarRegra({
        idFornec: ultima.id_fornec,
        idIdentificador: id,
        cfopEntrada: conv.cfop_entrada || ultima.cfop,
      });
      sugestao = {
        cfop: conv.cfop_saida || atual?.cfop || '',
        cfop_nf: conv.cfop_cfe || atual?.cfop_nf || '',
        csosn: (regra && regra.aplicar_saida ? regra.csosn_saida : null) || conv.csosn_saida || conv.csosn || atual?.csosn || '',
        cst: (regra && regra.aplicar_saida ? regra.cst_saida : null) || conv.cst_saida || atual?.cst || '',
        csosn_cfe: (regra && regra.csosn_cfe) || conv.csosn_cfe || atual?.csosn_cfe || '',
        cst_cfe: (regra && regra.cst_cfe) || conv.cst_cfe || atual?.cst_cfe || '',
        cst_pis: (regra && regra.cst_pis_saida) || atual?.cst_pis || '',
        cst_cofins: (regra && regra.cst_cofins_saida) || atual?.cst_cofins || '',
        pis: regra && regra.pis != null ? regra.pis : atual?.pis,
        cofins: regra && regra.cofins != null ? regra.cofins : atual?.cofins,
        id_cti: (regra && regra.id_cti) || conv.id_cti || atual?.id_cti || '',
        id_cti_cfe: (regra && regra.id_cti_cfe) || conv.id_cti_cfe || atual?.id_cti_cfe || '',
        origem: regra ? 'regra+parametro' : 'parametro_cfop',
      };
    } catch (err) {
      sugestao = { error: err.message };
    }
  }
  return { atual, ultima_entrada: ultima, sugestao, regra };
}

module.exports = {
  listNotasCadastradas,
  getNotaById,
  getNotaResumo,
  findNfDuplicada,
  listFormasPagto,
  listParcelamentos,
  listUnidades,
  cadastrarUnidade,
  listNaturezas,
  listClassTrib,
  listAnp,
  listCest,
  listTaxaUf,
  listCfopSis,
  listCstPis,
  listCstCofins,
  listCstIpi,
  listCstIcms,
  listCsosn,
  getEmitenteFiscal,
  getProdutoFiscal,
  getSugestaoTributoEstoque,
  toDateOnly,
};
