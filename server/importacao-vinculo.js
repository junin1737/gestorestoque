'use strict';

const { withDb, query, activeTargets } = require('./db');
const { getProdutoFiscal } = require('./importacao-notas');
const importacaoParams = require('./importacao-params');

function normalizeDesc(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function bigrams(s) {
  const t = ` ${normalizeDesc(s)} `;
  const out = [];
  for (let i = 0; i < t.length - 1; i += 1) out.push(t.slice(i, i + 2));
  return out;
}

function similaridade(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.length || !B.length) return 0;
  const map = new Map();
  A.forEach((g) => map.set(g, (map.get(g) || 0) + 1));
  let inter = 0;
  B.forEach((g) => {
    const n = map.get(g) || 0;
    if (n > 0) {
      inter += 1;
      map.set(g, n - 1);
    }
  });
  return (2 * inter) / (A.length + B.length);
}

function mapSugestao(r, motivo, score) {
  return {
    id_identificador: Number(r.ID_IDENTIFICADOR),
    id_estoque: r.ID_ESTOQUE != null ? Number(r.ID_ESTOQUE) : null,
    descricao: String(r.DESCRICAO || '').trim(),
    cod_barras: String(r.COD_BARRA || '').trim(),
    uni_medida: String(r.UNI_MEDIDA || '').trim(),
    prc_custo: Number(r.PRC_CUSTO || 0),
    prc_venda: Number(r.PRC_VENDA || 0),
    motivo,
    score: Number((score * 100).toFixed(1)),
  };
}

async function buscarCandidatos(db, t, { ean, descricao }) {
  const barra = String(ean || '').replace(/\D/g, '');
  const desc = String(descricao || '').trim();
  const found = [];
  const seen = new Set();

  if (barra.length >= 8) {
    const byEan = await query(db, `
      SELECT FIRST 8
        I.ID_IDENTIFICADOR, E.ID_ESTOQUE, E.DESCRICAO, E.UNI_MEDIDA,
        E.PRC_CUSTO, E.PRC_VENDA, P.COD_BARRA
      FROM ${t.produto} P
      JOIN ${t.identificador} I ON I.ID_IDENTIFICADOR = P.ID_IDENTIFICADOR
      JOIN ${t.estoque} E ON E.ID_ESTOQUE = I.ID_ESTOQUE
      WHERE TRIM(CAST(P.COD_BARRA AS VARCHAR(60))) = ?
         OR TRIM(CAST(P.COD_BARRA AS VARCHAR(60))) CONTAINING ?
      ORDER BY I.ID_IDENTIFICADOR DESC`, [barra, barra]);
    for (const r of byEan || []) {
      const id = Number(r.ID_IDENTIFICADOR);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      found.push(mapSugestao(r, 'ean', 1));
    }
  }

  const tokens = normalizeDesc(desc).split(' ').filter((w) => w.length >= 4).slice(0, 3);
  if (tokens.length) {
    const like = tokens[0].slice(0, 18);
    const byDesc = await query(db, `
      SELECT FIRST 40
        I.ID_IDENTIFICADOR, E.ID_ESTOQUE, E.DESCRICAO, E.UNI_MEDIDA,
        E.PRC_CUSTO, E.PRC_VENDA, P.COD_BARRA
      FROM ${t.estoque} E
      JOIN ${t.identificador} I ON I.ID_ESTOQUE = E.ID_ESTOQUE
      JOIN ${t.produto} P ON P.ID_IDENTIFICADOR = I.ID_IDENTIFICADOR
      WHERE UPPER(E.DESCRICAO) CONTAINING UPPER(?)
      ORDER BY I.ID_IDENTIFICADOR DESC`, [like]);
    for (const r of byDesc || []) {
      const id = Number(r.ID_IDENTIFICADOR);
      if (!id || seen.has(id)) continue;
      const score = similaridade(desc, r.DESCRICAO);
      if (score >= 0.7) {
        seen.add(id);
        found.push(mapSugestao(r, 'descricao', score));
      }
    }
  }
  found.sort((a, b) => b.score - a.score);
  return found.slice(0, 5);
}

async function buscarVinculoFornecedor(db, idFornec, cProd) {
  if (!idFornec || !cProd) return null;
  const rows = await query(db, `
    SELECT FIRST 1 ID_IDENTIFICADOR
    FROM TB_ESTOQUE_FORNECEDOR
    WHERE ID_FORNEC = ?
      AND COD_NO_FORNECEDOR = ?
      AND TRIM(COALESCE(STATUS,'A')) = 'A'
    ORDER BY ID_EST_FORNEC DESC`, [Number(idFornec), String(cProd).trim()]);
  return rows[0] ? Number(rows[0].ID_IDENTIFICADOR) : null;
}

function aplicarFiscalPreservandoSaida(sistema, f) {
  if (!f) return sistema;
  sistema.id_identificador = f.id_identificador;
  sistema.id_estoque = f.id_estoque;
  sistema.descricao = f.descricao || sistema.descricao;
  sistema.desc_cmpl = f.desc_cmpl || sistema.desc_cmpl || '';
  sistema.referencia = f.referencia || sistema.referencia || '';
  sistema.cod_barras = f.cod_barras || sistema.cod_barras || '';
  sistema.uni_medida_saida = f.uni_medida || sistema.uni_medida_saida || '';
  if (!sistema.uni_medida) sistema.uni_medida = f.uni_medida || '';
  sistema.prc_venda = f.prc_venda || sistema.prc_venda;
  sistema.margem_lb = f.margem_lb || sistema.margem_lb || 0;
  sistema.ncm = sistema.ncm || f.ncm || '';
  sistema.cest = sistema.cest || f.cest || '';
  sistema.status = f.status || sistema.status || 'A';
  sistema.criar_novo = false;
  if (!sistema.cfop_saida) sistema.cfop_saida = f.cfop || '';
  if (!sistema.cfop_nf) sistema.cfop_nf = f.cfop_nf || '';
  if (!sistema.csosn_saida) sistema.csosn_saida = f.csosn || '';
  if (!sistema.csosn_cfe) sistema.csosn_cfe = f.csosn_cfe || '';
  if (!sistema.cst_saida) sistema.cst_saida = f.cst || '';
  if (!sistema.cst_cfe) sistema.cst_cfe = f.cst_cfe || '';
  if (!sistema.id_cti) sistema.id_cti = f.id_cti || '';
  if (!sistema.id_cti_cfe) sistema.id_cti_cfe = f.id_cti_cfe || '';
  return sistema;
}

async function aplicarSugestoesVinculo(sessao) {
  if (!sessao || !Array.isArray(sessao.itens)) return sessao;
  try {
    const idFornec = Number(sessao.fornecedor?.id_fornec || 0) || null;
  const pendentes = [];
  await withDb(async (db, appCfg) => {
    const t = activeTargets(appCfg)[0]?.tables;
    if (!t) return;
    for (const it of sessao.itens) {
      const xml = it.xml || {};
      const sys = it.sistema || {};
      const ean = xml.cEAN || xml.cEANTrib || sys.cod_barras || '';
      const cProd = xml.cProd || sys.cod_fornecedor || '';
      const xProd = xml.xProd || '';

      let idLigado = null;
      let origem = '';
      if (idFornec && cProd) {
        try {
          idLigado = await buscarVinculoFornecedor(db, idFornec, cProd);
          if (idLigado) origem = 'fornecedor';
        } catch (_) { /* ignore */ }
      }

      const sugestoes = await buscarCandidatos(db, t, { ean, descricao: xProd });
      it.sugestoes_vinculo = sugestoes;

      if (!idLigado && sugestoes[0]?.motivo === 'ean') {
        idLigado = sugestoes[0].id_identificador;
        origem = 'ean';
      }

      if (idLigado && !sys.id_identificador && !sys.desvinculado) {
        pendentes.push({ it, idLigado, origem, score: sugestoes[0]?.score || 100 });
      } else if (!sys.id_identificador && sugestoes[0]) {
        it.match = {
          id_identificador: null,
          descricao: sugestoes[0].descricao,
          origem_match: 'sugestao',
          confianca: sugestoes[0].score,
        };
      }
    }
  });

  for (const p of pendentes) {
    const f = await getProdutoFiscal(p.idLigado);
    aplicarFiscalPreservandoSaida(p.it.sistema, f);
    const xmlItem = p.it.xml || {};
    const conv = importacaoParams.findConversao(xmlItem.uCom, p.idLigado);
    if (conv) {
      p.it.sistema.uni_medida = conv.uni_estoque || p.it.sistema.uni_medida;
      p.it.sistema.conversor = conv.conversor;
      const qtdXml = Number(p.it.sistema.qtd_xml ?? xmlItem.qCom ?? 0);
      p.it.sistema.qtd = Number((qtdXml * Number(conv.conversor || 1)).toFixed(6));
    }
    // Parametrização prévia em TB_ESTOQUE_FORNECEDOR (unidade + conversor TB_UNI_MEDIDA)
    try {
      const idFornec = Number(sessao?.fornecedor?.id_fornec || 0);
      if (idFornec && p.idLigado) {
        const { buscarEstoqueFornecedor } = require('./importacao-estoque-fornec');
        const { calcCustoUnitarioItem } = require('./importacao-rateio');
        const ef = await buscarEstoqueFornecedor({
          idFornec,
          idIdentificador: p.idLigado,
          codFornecedor: xmlItem.cProd || p.it.sistema?.cod_fornecedor,
        });
        if (ef?.uni_medida && !p.it.sistema.conversor_manual) {
          if (!p.it.sistema.uni_medida_saida) p.it.sistema.uni_medida_saida = ef.uni_medida;
          p.it.sistema.uni_medida = ef.uni_medida;
          if (ef.conversor > 0) p.it.sistema.conversor = ef.conversor;
          const qtdXml = Number(p.it.sistema.qtd_xml ?? xmlItem.qCom ?? 0);
          p.it.sistema.qtd = Number((qtdXml * Number(p.it.sistema.conversor || 1)).toFixed(6));
          const custoInfo = calcCustoUnitarioItem(p.it.sistema, xmlItem);
          if (custoInfo.custoEstoque > 0) p.it.sistema.prc_custo = custoInfo.custoEstoque;
        }
      }
    } catch (e) {
      console.warn('Conversão estoque-fornecedor:', e.message);
    }
    if (conv || Number(p.it.sistema.conversor || 1) !== 1) {
      try {
        const { calcCustoUnitarioItem } = require('./importacao-rateio');
        const custoInfo = calcCustoUnitarioItem(p.it.sistema, xmlItem);
        if (custoInfo.custoEstoque > 0) p.it.sistema.prc_custo = custoInfo.custoEstoque;
      } catch { /* ignore */ }
    }
    p.it.match = {
      id_identificador: p.idLigado,
      id_estoque: p.it.sistema.id_estoque,
      descricao: p.it.sistema.descricao,
      origem_match: p.origem,
      confianca: p.origem === 'fornecedor' ? 100 : p.score,
    };
  }
  } catch (err) {
    console.warn('Sugestões de vínculo:', err.message);
  }
  return sessao;
}

module.exports = {
  similaridade,
  aplicarSugestoesVinculo,
  aplicarFiscalPreservandoSaida,
};
