'use strict';

const { query } = require('./db');
const { lerUsaManage, loadAppConfig } = require('./config');

/**
 * Camada única dos dashboards. Tela, PDF e Excel devem chamar só daqui.
 *
 * Mapeado na base C:\Work\MT\Cliente\Clipp\Base\CLIPP.FDB:
 * - Venda Clipp: TB_NFVENDA + TB_NFV_ITEM. Data: DT_EMISSAO. Status E = emitida.
 * - Valor do item: VLR_TOTAL - VLR_DESC + frete + seguro + despesa + ST + IPI + FCP ST.
 *   ST, IPI e FCP ST vêm das filhas (TB_NFV_ITEM_ST/IPI/FCP e TB_NFC_ITEM_*). No Manage, a filha
 *   prevalece e, se não houver linha, usa VLR_ST/VLR_IPI do próprio item.
 * - Venda Manage: TB_NFVENDA_2 + TB_NFV_ITEM_2. Serviço: TB_NFVENDA_3 + TB_NFV_ITEM_3.
 * - Compra: TB_NFCOMPRA + TB_NFC_ITEM. Manage: TB_NFCOMPRA_2 + TB_NFC_ITEM_2. Data: DT_ENTRADA.
 * - Nota válida: STATUS = 'E'. Cancelada = 'C'. Demais status (A, X) ficam de fora.
 * - GR convertida: TB_GR_CONVERTIDO.ID_NFVENDA. A conversão substitui a gerencial: some na aba NFe+NFCe e sai da primeira aba.
 * - NCM e tipo vêm do cadastro (TB_EST_PRODUTO.COD_NCM, TB_ESTOQUE.ID_TIPOITEM). A base não tem descrição de NCM.
 * - Grupo: TB_ESTOQUE.ID_GRUPO + TB_EST_GRUPO. No Manage, identificador/estoque/produto são *_2; o grupo é compartilhado.
 * - Forma de pagamento: detalhe em TB_NFVENDA_FMAPAGTO_NFCE + TB_FORMA_PAGTO_NFCE; senão TB_NFVENDA.ID_FMAPGTO + TB_FORMA_PAGTO_SIS.
 * - Clipp e Manage não compartilham ID_NFVENDA nesta base (não há soma dupla por id).
 */

const CFOP_EXCLUIR = ['910', '529', '929'];
const CFOP_DEVOLUCAO = ['201', '202', '411'];
const CFOP_COMPRA = ['101', '102', '111', '113', '116', '117', '118', '120', '121', '122', '124', '125', '401', '403', '406', '407', '551', '556'];
const MODELOS_FISCAIS = ['55', '65'];
const MODELOS_VENDA = ['55', '65', 'GR'];

const INDICES_SUGERIDOS = [
  'TB_NFVENDA (DT_EMISSAO, STATUS, NF_MODELO)',
  'TB_NFVENDA_2 (DT_EMISSAO, STATUS, NF_MODELO)',
  'TB_NFVENDA_3 (DT_EMISSAO, STATUS, NF_MODELO)',
  'TB_NFV_ITEM (ID_NFVENDA, CFOP)',
  'TB_NFV_ITEM_2 (ID_NFVENDA, CFOP)',
  'TB_NFV_ITEM_3 (ID_NFVENDA, CFOP)',
  'TB_NFCOMPRA (DT_ENTRADA, STATUS, NF_MODELO)',
  'TB_NFCOMPRA_2 (DT_ENTRADA, STATUS, NF_MODELO)',
  'TB_NFC_ITEM (ID_NFCOMPRA, CFOP)',
  'TB_NFC_ITEM_2 (ID_NFCOMPRA, CFOP)',
  'TB_GR_CONVERTIDO (ID_NFVENDA)',
  'TB_NFVENDA_FMAPAGTO_NFCE (ID_NFVENDA)',
  'TB_EST_PRODUTO (ID_IDENTIFICADOR, COD_NCM)',
  'TB_ESTOQUE (ID_ESTOQUE, ID_GRUPO, ID_TIPOITEM)',
];

const FONTES_VENDA = [
  { manage: false, nota: 'TB_NFVENDA', item: 'TB_NFV_ITEM', id: 'ID_NFVENDA', idItem: 'ID_NFVITEM', ident: 'TB_EST_IDENTIFICADOR', estoque: 'TB_ESTOQUE', produto: 'TB_EST_PRODUTO', pagamentoDetalhe: true, st: 'TB_NFV_ITEM_ST', ipi: 'TB_NFV_ITEM_IPI', fcp: 'TB_NFV_ITEM_FCP' },
  { manage: true, nota: 'TB_NFVENDA_2', item: 'TB_NFV_ITEM_2', id: 'ID_NFVENDA', idItem: 'ID_NFVITEM', ident: 'TB_EST_IDENTIFICADOR_2', estoque: 'TB_ESTOQUE_2', produto: 'TB_EST_PRODUTO_2', pagamentoDetalhe: false, st: 'TB_NFV_ITEM_ST_2', ipi: 'TB_NFV_ITEM_IPI_2', stNoItem: true, ipiNoItem: true },
  { manage: true, nota: 'TB_NFVENDA_3', item: 'TB_NFV_ITEM_3', id: 'ID_NFVENDA', idItem: 'ID_NFVITEM', ident: 'TB_EST_IDENTIFICADOR_2', estoque: 'TB_ESTOQUE_2', produto: 'TB_EST_PRODUTO_2', pagamentoDetalhe: false, st: 'TB_NFV_ITEM_ST_3', ipi: 'TB_NFV_ITEM_IPI_3', stNoItem: true, ipiNoItem: true },
];

const FONTES_COMPRA = [
  { manage: false, nota: 'TB_NFCOMPRA', item: 'TB_NFC_ITEM', id: 'ID_NFCOMPRA', idItem: 'ID_NFCITEM', ident: 'TB_EST_IDENTIFICADOR', estoque: 'TB_ESTOQUE', produto: 'TB_EST_PRODUTO', st: 'TB_NFC_ITEM_ST', ipi: 'TB_NFC_ITEM_IPI', fcp: 'TB_NFC_ITEM_FCP' },
  { manage: true, nota: 'TB_NFCOMPRA_2', item: 'TB_NFC_ITEM_2', id: 'ID_NFCOMPRA', idItem: 'ID_NFCITEM', ident: 'TB_EST_IDENTIFICADOR_2', estoque: 'TB_ESTOQUE_2', produto: 'TB_EST_PRODUTO_2', stNoItem: true, ipiNoItem: true },
];

function fontesVenda(usaManage) {
  return usaManage ? FONTES_VENDA : FONTES_VENDA.filter((f) => !f.manage);
}

function fontesVendaEscopo(usaManage, filtros) {
  const lista = fontesVenda(usaManage);
  if (filtros?.escopoVenda === 'manage') return lista.filter((f) => f.manage);
  if (filtros?.escopoVenda === 'clipp') return lista.filter((f) => !f.manage);
  return lista;
}

function fontesCompra(usaManage, filtros) {
  const lista = usaManage ? FONTES_COMPRA : FONTES_COMPRA.filter((f) => !f.manage);
  if (filtros?.escopoCompra === 'manage') return lista.filter((f) => f.manage);
  if (filtros?.escopoCompra === 'clipp') return lista.filter((f) => !f.manage);
  return lista;
}

function somaFilha(tabela, coluna, idItem) {
  return `(SELECT SUM(${coluna}) FROM ${tabela} X WHERE X.${idItem} = I.${idItem})`;
}

function sqlValor(fonte) {
  let st = '0';
  if (fonte.st && fonte.stNoItem) st = `COALESCE(${somaFilha(fonte.st, 'X.VLR_ST', fonte.idItem)}, I.VLR_ST, 0)`;
  else if (fonte.st) st = `COALESCE(${somaFilha(fonte.st, 'X.VLR_ST', fonte.idItem)}, 0)`;
  else if (fonte.stNoItem) st = 'COALESCE(I.VLR_ST, 0)';
  let ipi = '0';
  if (fonte.ipi && fonte.ipiNoItem) ipi = `COALESCE(${somaFilha(fonte.ipi, 'X.VLR_IPI', fonte.idItem)}, I.VLR_IPI, 0)`;
  else if (fonte.ipi) ipi = `COALESCE(${somaFilha(fonte.ipi, 'X.VLR_IPI', fonte.idItem)}, 0)`;
  else if (fonte.ipiNoItem) ipi = 'COALESCE(I.VLR_IPI, 0)';
  const fcp = fonte.fcp ? `COALESCE(${somaFilha(fonte.fcp, 'X.VLR_FCP_ST', fonte.idItem)}, 0)` : '0';
  return `(COALESCE(I.VLR_TOTAL, 0) - COALESCE(I.VLR_DESC, 0) + COALESCE(I.VLR_FRETE, 0) + COALESCE(I.VLR_SEGURO, 0) + COALESCE(I.VLR_DESPESA, 0) + ${st} + ${ipi} + ${fcp})`;
}

function sqlComFrete() {
  return '(COALESCE(I.VLR_TOTAL, 0) + COALESCE(I.VLR_FRETE, 0))';
}

function sqlCustoLinha(fonte) {
  const qtd = 'COALESCE(I.QTD_ITEM, 0)';
  const cadastro = `COALESCE(EST.PRC_CUSTO, 0) * ${qtd}`;
  if (fonte.item !== 'TB_NFV_ITEM') return cadastro;
  return `COALESCE(NULLIF(I.VLR_CUSTO, 0), EST.PRC_CUSTO, 0) * ${qtd}`;
}

function filtroCartao(coluna, ignorar) {
  if (!ignorar) return '';
  return ` AND NOT (UPPER(COALESCE(${coluna}, '')) CONTAINING 'CARTAO' OR UPPER(COALESCE(${coluna}, '')) CONTAINING 'CARTÃO' OR UPPER(COALESCE(${coluna}, '')) CONTAINING 'CARTÕES')`;
}

function fonteSemFilhas(fonte) {
  return { ...fonte, st: null, ipi: null, fcp: null };
}

async function lerFonte(db, fonte, sqlDe) {
  const lista = await ler(db, sqlDe(fonte));
  if (lista || (!fonte.st && !fonte.ipi && !fonte.fcp)) return lista;
  return ler(db, sqlDe(fonteSemFilhas(fonte)));
}

function sufixoCfop(col) {
  return `RIGHT(REPLACE(COALESCE(${col}, ''), '.', ''), 3)`;
}

function listaSql(codigos) {
  return codigos.map((c) => `'${c}'`).join(', ');
}

function predItem(modo) {
  const s = sufixoCfop('I.CFOP');
  const exc = `${s} IN (${listaSql(CFOP_EXCLUIR)})`;
  const dev = `${s} IN (${listaSql(CFOP_DEVOLUCAO)})`;
  const compra = `${s} IN (${listaSql(CFOP_COMPRA)})`;
  if (modo === 'venda') return `NOT (${exc}) AND NOT (${dev})`;
  if (modo === 'devolucao_compra') return `(${dev}) AND NOT (${exc})`;
  if (modo === 'compra') return `(${compra}) AND NOT (${exc})`;
  if (modo === 'devolucao_venda') return `(${dev}) AND NOT (${exc})`;
  throw new Error(`Modo de item desconhecido: ${modo}`);
}

function isoHoje() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dia}`;
}

function parseIso(valor) {
  const s = String(valor || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('Data inválida');
  return s;
}

function addDias(iso, dias) {
  const [y, m, d] = parseIso(iso).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + dias);
  return dt.toISOString().slice(0, 10);
}

function periodoAnterior(inicio, fim) {
  const a = parseIso(inicio);
  const b = parseIso(fim);
  const dias = Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;
  const fimAnt = addDias(a, -1);
  const iniAnt = addDias(fimAnt, -(dias - 1));
  return { inicio: iniAnt, fim: fimAnt };
}

function centavos(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function reais(cents) {
  return cents / 100;
}

function inteiro(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function diaIso(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  return String(v || '').slice(0, 10);
}

function tabelaAusente(err) {
  return /table unknown/i.test(String(err && err.message || ''));
}

async function ler(db, sql) {
  try {
    return await query(db, sql);
  } catch (err) {
    if (tabelaAusente(err)) return null;
    throw err;
  }
}

function limparGrupo(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error('Grupo inválido');
  return n;
}

function limparNcm(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (!/^[0-9.]{1,12}$/.test(s)) throw new Error('NCM inválido');
  return s;
}

function limparTipo(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return '';
  if (!['produto', 'servico', 'outros'].includes(s)) throw new Error('Tipo de item inválido');
  return s;
}

function limparModelo(v) {
  const s = String(v || '').trim().toUpperCase();
  if (!s) return '';
  if (!MODELOS_VENDA.includes(s)) throw new Error('Modelo inválido');
  return s;
}

function sqlClassificacao(fonte, filtros, sempre) {
  const precisa = sempre || filtros.grupoId != null || filtros.tipoItem || filtros.ncm;
  if (!precisa) return { join: '', where: '' };
  const join = `
    LEFT JOIN ${fonte.ident} IDF ON IDF.ID_IDENTIFICADOR = I.ID_IDENTIFICADOR
    LEFT JOIN ${fonte.estoque} EST ON EST.ID_ESTOQUE = IDF.ID_ESTOQUE
    LEFT JOIN ${fonte.produto} PRD ON PRD.ID_IDENTIFICADOR = I.ID_IDENTIFICADOR
    LEFT JOIN TB_EST_GRUPO GRP ON GRP.ID_GRUPO = EST.ID_GRUPO`;
  const extra = [];
  if (filtros.grupoId != null) extra.push(`EST.ID_GRUPO = ${filtros.grupoId}`);
  if (filtros.ncm) extra.push(`TRIM(COALESCE(PRD.COD_NCM, '')) = '${filtros.ncm}'`);
  if (filtros.tipoItem === 'servico') extra.push(`TRIM(COALESCE(EST.ID_TIPOITEM, '')) = '9'`);
  if (filtros.tipoItem === 'produto') extra.push(`TRIM(COALESCE(EST.ID_TIPOITEM, '')) NOT IN ('', '9', '99')`);
  if (filtros.tipoItem === 'outros') extra.push(`TRIM(COALESCE(EST.ID_TIPOITEM, '')) IN ('', '99')`);
  return { join, where: extra.length ? ` AND ${extra.join(' AND ')}` : '' };
}

function predNota(tipo, filtros, fonte) {
  const dataCol = tipo === 'compra' ? 'N.DT_ENTRADA' : 'N.DT_EMISSAO';
  const modelos = tipo === 'compra' ? filtros.modelosCompra : filtros.modelosVenda;
  const partes = [
    `N.STATUS = 'E'`,
    `${dataCol} >= '${filtros.inicio}'`,
    `${dataCol} < '${filtros.fimExclusivo}'`,
  ];
  if (tipo === 'venda') {
    partes.push(`NOT (UPPER(TRIM(N.NF_MODELO)) = 'GR' AND EXISTS (SELECT 1 FROM TB_GR_CONVERTIDO G WHERE G.ID_NFVENDA = N.ID_NFVENDA))`);
    if (filtros.excluirConvertidas && fonte && !fonte.manage) {
      partes.push(`NOT EXISTS (SELECT 1 FROM TB_GR_CONVERTIDO G WHERE G.ID_NFVENDA = N.${fonte.id})`);
    }
  }
  if (modelos && modelos.length) {
    partes.push(`UPPER(TRIM(N.NF_MODELO)) IN (${listaSql(modelos)})`);
  }
  return partes.join(' AND ');
}

function bucketModelo(modelo, manage) {
  const m = String(modelo || '').trim();
  if (m === 'GR') return 'gerencial';
  if (manage) return 'manage';
  return 'fiscal';
}

async function somar(db, fonte, filtros, tipo, modo) {
  const classif = sqlClassificacao(fonte, filtros, false);
  return lerFonte(db, fonte, (f) => `
    SELECT TRIM(N.NF_MODELO) AS MODELO,
           COUNT(DISTINCT N.${f.id}) AS NOTAS,
           SUM(${sqlValor(f)}) AS VALOR,
           SUM(${sqlComFrete()}) AS COM_FRETE,
           SUM(COALESCE(I.QTD_ITEM, 0)) AS QTD,
           COUNT(*) AS ITENS
    FROM ${f.item} I
    JOIN ${f.nota} N ON N.${f.id} = I.${f.id}
    ${classif.join}
    WHERE ${predNota(tipo, filtros, f)}
      AND ${predItem(modo)}
      ${classif.where}
    GROUP BY TRIM(N.NF_MODELO)`);
}

async function totais(db, usaManage, filtros, escopo) {
  const vendas = {
    fiscal: 0, gerencial: 0, manage: 0, nfce: 0, nfe: 0, notas: 0, itens: 0, qtd: 0,
    frete: 0, freteFiscal: 0, freteGerencial: 0, freteManage: 0, freteNfce: 0, freteNfe: 0,
  };
  const compras = { valor: 0, notas: 0, itens: 0, qtd: 0 };
  let devolucaoVenda = 0;
  let devolucaoCompra = 0;
  let devolucaoVendaFrete = 0;

  if (escopo !== 'compras') {
    for (const fonte of fontesVendaEscopo(usaManage, filtros)) {
      const positivas = await somar(db, fonte, filtros, 'venda', 'venda');
      if (positivas) {
        for (const r of positivas) {
          vendas[bucketModelo(r.MODELO, fonte.manage)] += centavos(r.VALOR);
          const frete = centavos(r.COM_FRETE);
          const modelo = String(r.MODELO || '').trim();
          const bucket = bucketModelo(modelo, fonte.manage);
          vendas.frete += frete;
          if (bucket === 'gerencial') vendas.freteGerencial += frete;
          else if (bucket === 'manage') vendas.freteManage += frete;
          else vendas.freteFiscal += frete;
          if (modelo === '65') {
            vendas.nfce += centavos(r.VALOR);
            vendas.freteNfce += frete;
          }
          if (modelo === '55') {
            vendas.nfe += centavos(r.VALOR);
            vendas.freteNfe += frete;
          }
          vendas.notas += inteiro(r.NOTAS);
          vendas.itens += inteiro(r.ITENS);
          vendas.qtd += centavos(r.QTD);
        }
      }
      const dev = await somar(db, fonte, filtros, 'venda', 'devolucao_compra');
      if (dev) for (const r of dev) devolucaoCompra += centavos(r.VALOR);
    }
  }

  if (escopo !== 'vendas') {
    for (const fonte of fontesCompra(usaManage, filtros)) {
      const positivas = await somar(db, fonte, filtros, 'compra', 'compra');
      if (positivas) {
        for (const r of positivas) {
          compras.valor += centavos(r.VALOR);
          compras.notas += inteiro(r.NOTAS);
          compras.itens += inteiro(r.ITENS);
          compras.qtd += centavos(r.QTD);
        }
      }
      const dev = await somar(db, fonte, filtros, 'compra', 'devolucao_venda');
      if (dev) for (const r of dev) {
        devolucaoVenda += centavos(r.VALOR);
        devolucaoVendaFrete += centavos(r.COM_FRETE);
      }
    }
  }

  return {
    vendas,
    compras,
    devolucaoVenda,
    devolucaoCompra,
    totalVendido: vendas.fiscal + vendas.gerencial + vendas.manage - devolucaoVenda,
    totalComprado: compras.valor - devolucaoCompra,
    totalComFrete: vendas.frete - devolucaoVendaFrete,
  };
}

function variacao(atual, anterior) {
  if (!anterior) return null;
  return Math.round((10000 * (atual - anterior)) / anterior) / 100;
}

async function agregarGrupo(db, fonte, filtros, tipo, modo, sinal, comCusto) {
  const classif = sqlClassificacao(fonte, filtros, true);
  const lista = await lerFonte(db, fonte, (f) => `
    SELECT COALESCE(EST.ID_GRUPO, 0) AS ID_GRUPO,
           COALESCE(TRIM(GRP.DESCRICAO), 'Sem grupo') AS DESCRICAO,
           SUM(${sqlValor(f)}) AS VALOR,
           ${comCusto ? `SUM(${sqlCustoLinha(f)}) AS CUSTO,` : ''}
           SUM(COALESCE(I.QTD_ITEM, 0)) AS QTD,
           COUNT(DISTINCT N.${f.id}) AS NOTAS
    FROM ${f.item} I
    JOIN ${f.nota} N ON N.${f.id} = I.${f.id}
    ${classif.join}
    WHERE ${predNota(tipo, filtros, f)}
      AND ${predItem(modo)}
      ${classif.where}
    GROUP BY COALESCE(EST.ID_GRUPO, 0), COALESCE(TRIM(GRP.DESCRICAO), 'Sem grupo')`);
  return (lista || []).map((r) => ({
    id: inteiro(r.ID_GRUPO),
    descricao: String(r.DESCRICAO || 'Sem grupo').trim() || 'Sem grupo',
    valor: sinal * centavos(r.VALOR),
    custo: comCusto ? sinal * centavos(r.CUSTO) : 0,
    qtd: sinal * centavos(r.QTD),
    notas: sinal * inteiro(r.NOTAS),
  }));
}

function juntarGrupo(listas) {
  const map = new Map();
  for (const item of listas.flat()) {
    const chave = `${item.id}|${item.descricao}`;
    const atual = map.get(chave) || { id: item.id, grupo: item.descricao, valor: 0, custo: 0, quantidade: 0, notas: 0 };
    atual.valor += item.valor;
    atual.custo += item.custo || 0;
    atual.quantidade += item.qtd;
    atual.notas += item.notas;
    map.set(chave, atual);
  }
  const rows = [...map.values()].map((r) => ({
    id: r.id,
    grupo: r.grupo,
    valor: reais(r.valor),
    margem: reais(r.valor - r.custo),
    margemPct: r.valor ? Math.round((10000 * (r.valor - r.custo)) / r.valor) / 100 : 0,
    quantidade: reais(r.quantidade),
    notas: r.notas,
  }));
  const total = rows.reduce((a, r) => a + centavos(r.valor), 0);
  return rows
    .map((r) => ({ ...r, participacao: total ? Math.round((10000 * centavos(r.valor)) / total) / 100 : 0 }))
    .sort((a, b) => b.valor - a.valor);
}

async function porGrupo(db, usaManage, filtros, lado) {
  const listas = [];
  if (lado === 'vendas') {
    for (const fonte of fontesVendaEscopo(usaManage, filtros)) {
      listas.push(await agregarGrupo(db, fonte, filtros, 'venda', 'venda', 1, true));
    }
    for (const fonte of fontesCompra(usaManage, filtros)) {
      listas.push(await agregarGrupo(db, fonte, filtros, 'compra', 'devolucao_venda', -1, true));
    }
  } else {
    for (const fonte of fontesCompra(usaManage, filtros)) {
      listas.push(await agregarGrupo(db, fonte, filtros, 'compra', 'compra', 1));
    }
    for (const fonte of fontesVendaEscopo(usaManage, filtros)) {
      listas.push(await agregarGrupo(db, fonte, filtros, 'venda', 'devolucao_compra', -1));
    }
  }
  return juntarGrupo(listas);
}

async function porNcm(db, usaManage, filtros) {
  const fiscais = { ...filtros, modelosVenda: MODELOS_FISCAIS, modelosCompra: MODELOS_FISCAIS };
  const map = new Map();
  function add(ncm, cents) {
    const codigo = String(ncm || '').replace(/\D/g, '');
    if (!codigo) return;
    map.set(codigo, (map.get(codigo) || 0) + cents);
  }
  async function lado(fonte, tipo, modo, sinal) {
    const classif = sqlClassificacao(fonte, fiscais, true);
    const lista = await lerFonte(db, fonte, (f) => `
      SELECT COALESCE(TRIM(PRD.COD_NCM), '') AS NCM,
             SUM(${sqlValor(f)}) AS VALOR
      FROM ${f.item} I
      JOIN ${f.nota} N ON N.${f.id} = I.${f.id}
      ${classif.join}
      WHERE ${predNota(tipo, fiscais, f)}
        AND ${predItem(modo)}
        AND TRIM(COALESCE(PRD.COD_NCM, '')) <> ''
        ${classif.where}
      GROUP BY COALESCE(TRIM(PRD.COD_NCM), '')`);
    for (const r of lista || []) add(r.NCM, sinal * centavos(r.VALOR));
  }
  for (const fonte of fontesVendaEscopo(usaManage, filtros)) {
    await lado(fonte, 'venda', 'venda', 1);
  }
  for (const fonte of fontesCompra(usaManage, filtros)) {
    await lado(fonte, 'compra', 'devolucao_venda', -1);
  }
  return [...map.entries()]
    .map(([ncm, valor]) => ({ ncm, totalVendido: reais(valor) }))
    .filter((r) => r.totalVendido !== 0)
    .sort((a, b) => b.totalVendido - a.totalVendido);
}

async function mapaFormas(db) {
  const lista = await ler(db, `SELECT ID_FMAPGTO, TRIM(DESCRICAO) AS DESCRICAO FROM TB_FORMA_PAGTO_SIS`);
  const map = new Map();
  for (const r of lista || []) map.set(inteiro(r.ID_FMAPGTO), String(r.DESCRICAO || '').trim() || 'Não informado');
  return map;
}

async function porPagamento(db, usaManage, filtros, devolucaoVendaCentavos) {
  const formas = await mapaFormas(db);
  const acc = new Map();
  function add(nome, cents) {
    const chave = nome || 'Não informado';
    acc.set(chave, (acc.get(chave) || 0) + cents);
  }
  for (const fonte of fontesVendaEscopo(usaManage, filtros)) {
    const classif = sqlClassificacao(fonte, filtros, false);
    const notas = await lerFonte(db, fonte, (f) => `
      SELECT N.${f.id} AS ID, N.ID_FMAPGTO AS FORMA, SUM(${sqlValor(f)}) AS VALOR
      FROM ${f.item} I
      JOIN ${f.nota} N ON N.${f.id} = I.${f.id}
      ${classif.join}
      WHERE ${predNota('venda', filtros, f)}
        AND ${predItem('venda')}
        ${classif.where}
      GROUP BY N.${f.id}, N.ID_FMAPGTO`);
    if (!notas) continue;
    const detalhe = new Map();
    if (fonte.pagamentoDetalhe) {
      const pags = await ler(db, `
        SELECT P.ID_NFVENDA AS ID,
               TRIM(COALESCE(F.DESCRICAO, 'Não informado')) AS DESCRICAO,
               SUM(COALESCE(P.VLR_PAGTO, 0)) AS VLR
        FROM TB_NFVENDA_FMAPAGTO_NFCE P
        JOIN ${fonte.nota} N ON N.ID_NFVENDA = P.ID_NFVENDA
        LEFT JOIN TB_FORMA_PAGTO_NFCE F ON F.ID_FMANFCE = P.ID_FMANFCE
        WHERE ${predNota('venda', filtros, fonte)}
        GROUP BY P.ID_NFVENDA, TRIM(COALESCE(F.DESCRICAO, 'Não informado'))`);
      for (const p of pags || []) {
        const id = inteiro(p.ID);
        if (!detalhe.has(id)) detalhe.set(id, []);
        detalhe.get(id).push({ descricao: String(p.DESCRICAO || 'Não informado').trim(), vlr: Number(p.VLR) || 0 });
      }
    }
    for (const nota of notas) {
      const valor = centavos(nota.VALOR);
      const lines = detalhe.get(inteiro(nota.ID)) || [];
      const soma = lines.reduce((a, l) => a + l.vlr, 0);
      if (soma > 0) {
        let usado = 0;
        lines.forEach((l, i) => {
          const parte = i === lines.length - 1 ? valor - usado : Math.round((valor * l.vlr) / soma);
          usado += parte;
          add(l.descricao, parte);
        });
      } else {
        add(formas.get(inteiro(nota.FORMA)) || 'Não informado', valor);
      }
    }
  }
  if (devolucaoVendaCentavos) add('Devolução de venda', -devolucaoVendaCentavos);
  const rows = [...acc.entries()].map(([forma, valor]) => ({ forma, valor }));
  const total = rows.reduce((a, r) => a + r.valor, 0);
  return rows
    .map((r) => ({
      forma: r.forma,
      valor: reais(r.valor),
      participacao: total ? Math.round((10000 * r.valor) / total) / 100 : 0,
    }))
    .sort((a, b) => b.valor - a.valor);
}

async function porDia(db, usaManage, filtros) {
  const map = new Map();
  function celula(dia) {
    const iso = diaIso(dia);
    if (!map.has(iso)) map.set(iso, { dia: iso, vendido: 0, comprado: 0 });
    return map.get(iso);
  }
  async function acumular(fonte, tipo, modo, campo, sinal) {
    const classif = sqlClassificacao(fonte, filtros, false);
    const dataCol = tipo === 'compra' ? 'N.DT_ENTRADA' : 'N.DT_EMISSAO';
    const lista = await lerFonte(db, fonte, (f) => `
      SELECT CAST(${dataCol} AS DATE) AS DIA, SUM(${sqlValor(f)}) AS VALOR
      FROM ${f.item} I
      JOIN ${f.nota} N ON N.${f.id} = I.${f.id}
      ${classif.join}
      WHERE ${predNota(tipo, filtros, f)}
        AND ${predItem(modo)}
        ${classif.where}
      GROUP BY CAST(${dataCol} AS DATE)`);
    for (const r of lista || []) celula(r.DIA)[campo] += sinal * centavos(r.VALOR);
  }
  for (const fonte of fontesVendaEscopo(usaManage, filtros)) {
    await acumular(fonte, 'venda', 'venda', 'vendido', 1);
    await acumular(fonte, 'venda', 'devolucao_compra', 'comprado', -1);
  }
  for (const fonte of fontesCompra(usaManage, filtros)) {
    await acumular(fonte, 'compra', 'compra', 'comprado', 1);
    await acumular(fonte, 'compra', 'devolucao_venda', 'vendido', -1);
  }
  return [...map.values()]
    .map((r) => ({ dia: r.dia, vendido: reais(r.vendido), comprado: reais(r.comprado) }))
    .sort((a, b) => a.dia.localeCompare(b.dia));
}

const NOMES_MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

async function porMes(db, usaManage, filtros) {
  const ano = String(filtros.inicio || isoHoje()).slice(0, 4);
  const filtrosAno = {
    ...filtros,
    inicio: `${ano}-01-01`,
    fim: `${ano}-12-31`,
    fimExclusivo: `${Number(ano) + 1}-01-01`,
  };
  const meses = NOMES_MES.map((nome, i) => ({ mes: i + 1, nome, vendido: 0, comprado: 0 }));
  function celula(mes) {
    const n = inteiro(mes);
    return n >= 1 && n <= 12 ? meses[n - 1] : null;
  }
  async function acumular(fonte, tipo, modo, campo, sinal) {
    const classif = sqlClassificacao(fonte, filtrosAno, false);
    const dataCol = tipo === 'compra' ? 'N.DT_ENTRADA' : 'N.DT_EMISSAO';
    const lista = await lerFonte(db, fonte, (f) => `
      SELECT EXTRACT(MONTH FROM CAST(${dataCol} AS DATE)) AS MES, SUM(${sqlValor(f)}) AS VALOR
      FROM ${f.item} I
      JOIN ${f.nota} N ON N.${f.id} = I.${f.id}
      ${classif.join}
      WHERE ${predNota(tipo, filtrosAno, f)}
        AND ${predItem(modo)}
        ${classif.where}
      GROUP BY EXTRACT(MONTH FROM CAST(${dataCol} AS DATE))`);
    for (const r of lista || []) {
      const cel = celula(r.MES);
      if (cel) cel[campo] += sinal * centavos(r.VALOR);
    }
  }
  for (const fonte of fontesVendaEscopo(usaManage, filtrosAno)) {
    await acumular(fonte, 'venda', 'venda', 'vendido', 1);
    await acumular(fonte, 'venda', 'devolucao_compra', 'comprado', -1);
  }
  for (const fonte of fontesCompra(usaManage, filtros)) {
    await acumular(fonte, 'compra', 'compra', 'comprado', 1);
    await acumular(fonte, 'compra', 'devolucao_venda', 'vendido', -1);
  }
  return meses.map((r) => ({ mes: r.mes, nome: r.nome, vendido: reais(r.vendido), comprado: reais(r.comprado) }));
}

async function relacaoExiste(db, nome) {
  const rows = await ler(db, `
    SELECT 1 AS OK FROM RDB$RELATIONS
    WHERE RDB$SYSTEM_FLAG = 0 AND TRIM(RDB$RELATION_NAME) = '${nome}'`);
  return !!(rows && rows.length);
}

async function colunaExiste(db, tabela, coluna) {
  const rows = await ler(db, `
    SELECT 1 AS OK FROM RDB$RELATION_FIELDS
    WHERE TRIM(RDB$RELATION_NAME) = '${tabela}'
      AND TRIM(RDB$FIELD_NAME) = '${coluna}'`);
  return !!(rows && rows.length);
}

async function baixaReceber(db, conta) {
  const direta = conta === 'TB_CONTA_RECEBER' ? 'TB_CTAREC_BAIXA' : 'TB_CTAREC_BAIXA_2';
  if (await relacaoExiste(db, direta) && await colunaExiste(db, direta, 'VLR_RECEB')) return direta;
  const rows = await ler(db, `
    SELECT TRIM(RC.RDB$RELATION_NAME) AS NOME
    FROM RDB$RELATION_CONSTRAINTS RC
    JOIN RDB$REF_CONSTRAINTS REF ON REF.RDB$CONSTRAINT_NAME = RC.RDB$CONSTRAINT_NAME
    JOIN RDB$RELATION_CONSTRAINTS PK ON PK.RDB$CONSTRAINT_NAME = REF.RDB$CONST_NAME_UQ
    WHERE RC.RDB$CONSTRAINT_TYPE = 'FOREIGN KEY'
      AND TRIM(PK.RDB$RELATION_NAME) = '${conta}'`);
  for (const r of rows || []) {
    const nome = String(r.NOME || '').trim();
    if (nome && await colunaExiste(db, nome, 'VLR_RECEB') && await colunaExiste(db, nome, 'TIP_RECBTO')) return nome;
  }
  return '';
}

async function fontesContaReceber(db, usaManage) {
  const nomes = ['TB_CONTA_RECEBER'];
  if (usaManage && await relacaoExiste(db, 'TB_CONTA_RECEBER_2')) nomes.push('TB_CONTA_RECEBER_2');
  const fontes = [];
  for (const conta of nomes) {
    if (!(await relacaoExiste(db, conta))) continue;
    fontes.push({
      conta,
      baixa: await baixaReceber(db, conta),
      temRestante: await colunaExiste(db, conta, 'VLR_RESTANTE'),
    });
  }
  return fontes;
}

async function porMesFinanceiro(db, filtros, ignorarCartao, usaManage) {
  const ano = String(filtros.inicio || isoHoje()).slice(0, 4);
  const inicio = `${ano}-01-01`;
  const fim = `${Number(ano) + 1}-01-01`;
  const meses = NOMES_MES.map((nome, i) => ({ mes: i + 1, nome, vendido: 0, comprado: 0 }));
  function somar(lista, campo) {
    for (const r of lista || []) {
      const n = inteiro(r.MES);
      if (n >= 1 && n <= 12) meses[n - 1][campo] += centavos(r.VALOR);
    }
  }
  for (const fonte of await fontesContaReceber(db, usaManage)) {
    if (!fonte.baixa) continue;
    const origem = ignorarCartao
      ? `FROM ${fonte.baixa} B LEFT JOIN ${fonte.conta} C ON C.ID_CTAREC = B.ID_CTAREC
         WHERE B.DT_BAIXA >= '${inicio}' AND B.DT_BAIXA < '${fim}'
           AND TRIM(COALESCE(B.TIP_RECBTO, '')) = 'T'${filtroCartao('C.HISTORICO', true)}`
      : `FROM ${fonte.baixa}
         WHERE DT_BAIXA >= '${inicio}' AND DT_BAIXA < '${fim}'
           AND TRIM(COALESCE(TIP_RECBTO, '')) = 'T'`;
    const colData = ignorarCartao ? 'B.DT_BAIXA' : 'DT_BAIXA';
    const colValor = ignorarCartao ? 'B.VLR_RECEB' : 'VLR_RECEB';
    somar(await ler(db, `
      SELECT EXTRACT(MONTH FROM ${colData}) AS MES, SUM(COALESCE(${colValor}, 0)) AS VALOR
      ${origem}
      GROUP BY EXTRACT(MONTH FROM ${colData})`), 'vendido');
  }
  somar(await ler(db, `
    SELECT EXTRACT(MONTH FROM DT_BAIXA) AS MES, SUM(COALESCE(VLR_PAGO, 0)) AS VALOR
    FROM TB_CTAPAG_BAIXA
    WHERE DT_BAIXA >= '${inicio}' AND DT_BAIXA < '${fim}'
      AND TRIM(COALESCE(TIP_PAGTO, '')) = 'T'
    GROUP BY EXTRACT(MONTH FROM DT_BAIXA)`), 'comprado');
  return meses.map((r) => ({ mes: r.mes, nome: r.nome, vendido: reais(r.vendido), comprado: reais(r.comprado) }));
}

const NOMES_MES_LONGO = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

function intervaloMes(iso) {
  const [y, m] = parseIso(iso).split('-').map(Number);
  const inicio = `${y}-${String(m).padStart(2, '0')}-01`;
  const fimExclusivo = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { inicio, fimExclusivo, rotulo: `${NOMES_MES_LONGO[m - 1]} de ${y}` };
}

function dataBr(iso) {
  const [y, m, d] = parseIso(iso).split('-');
  return `${d}/${m}/${y}`;
}

function linhaConta(r) {
  return {
    documento: String(r.DOCUMENTO == null ? '' : r.DOCUMENTO).trim(),
    historico: String(r.HISTORICO || '').trim(),
    vencimento: diaIso(r.DT_VENCTO),
    valor: reais(centavos(r.VALOR)),
    situacao: String(r.SITUACAO || '').trim(),
  };
}

function sqlRestante(alias, fonte) {
  if (fonte.temRestante) return `COALESCE(${alias}.VLR_RESTANTE, 0)`;
  if (!fonte.baixa) return `COALESCE(${alias}.VLR_CTAREC, 0)`;
  return `(COALESCE(${alias}.VLR_CTAREC, 0) - COALESCE((
    SELECT SUM(BX.VLR_RECEB) FROM ${fonte.baixa} BX
    WHERE BX.ID_CTAREC = ${alias}.ID_CTAREC
      AND TRIM(COALESCE(BX.TIP_RECBTO, '')) = 'T'
  ), 0))`;
}

async function somaReceberAberto(db, fontes, inicio, fimExclusivo, ignorarCartao) {
  let total = 0;
  for (const fonte of fontes) {
    const saldo = sqlRestante('C', fonte);
    const rows = await ler(db, `
      SELECT COALESCE(SUM(${saldo}), 0) AS VALOR
      FROM ${fonte.conta} C
      WHERE C.DT_VENCTO >= '${inicio}' AND C.DT_VENCTO < '${fimExclusivo}'
        AND TRIM(COALESCE(C.TIP_CTAREC, '')) <> 'C'
        AND ${saldo} > 0.009
        ${filtroCartao('C.HISTORICO', ignorarCartao)}`);
    total += rows && rows[0] ? centavos(rows[0].VALOR) : 0;
  }
  return total;
}

async function somaPagarAberto(db, inicio, fimExclusivo) {
  const rows = await ler(db, `
    SELECT COALESCE(SUM(C.VLR_CTAPAG), 0) AS VALOR
    FROM TB_CONTA_PAGAR C
    WHERE C.DT_VENCTO >= '${inicio}' AND C.DT_VENCTO < '${fimExclusivo}'
      AND TRIM(COALESCE(C.TIP_CTAPAG, '')) <> 'C'
      AND NOT EXISTS (
        SELECT 1 FROM TB_CTAPAG_BAIXA B
        WHERE B.ID_CTAPAG = C.ID_CTAPAG AND TRIM(COALESCE(B.TIP_PAGTO, '')) = 'T'
      )`);
  return rows && rows[0] ? centavos(rows[0].VALOR) : 0;
}

async function somaRecebidas(db, fontes, inicio, fimExclusivo, ignorarCartao) {
  let total = 0;
  for (const fonte of fontes) {
    if (!fonte.baixa) continue;
    const rows = await ler(db, `
      SELECT COALESCE(SUM(B.VLR_RECEB), 0) AS VALOR
      FROM ${fonte.baixa} B
      LEFT JOIN ${fonte.conta} C ON C.ID_CTAREC = B.ID_CTAREC
      WHERE B.DT_BAIXA >= '${inicio}' AND B.DT_BAIXA < '${fimExclusivo}'
        AND TRIM(COALESCE(B.TIP_RECBTO, '')) = 'T'
        ${filtroCartao('C.HISTORICO', ignorarCartao)}`);
    total += rows && rows[0] ? centavos(rows[0].VALOR) : 0;
  }
  return total;
}

async function colunaPlanoTitulo(db, tabela) {
  if (await colunaExiste(db, tabela, 'ID_CTAPLA_ORIGEM')) return 'ID_CTAPLA_ORIGEM';
  if (await colunaExiste(db, tabela, 'ID_CTAPLA')) return 'ID_CTAPLA';
  return '';
}

function linhasPlano(map) {
  return [...map.values()]
    .map((r) => ({ codigo: r.codigo, plano: r.plano, recebido: reais(r.recebido), pago: reais(r.pago) }))
    .filter((r) => r.recebido !== 0 || r.pago !== 0)
    .sort((a, b) => `${a.codigo} ${a.plano}`.localeCompare(`${b.codigo} ${b.plano}`, 'pt-BR'));
}

function acumularPlano(map, id, codigo, descricao, campo, cents) {
  const chave = `${id == null ? '' : id}|${codigo}|${descricao}`;
  const atual = map.get(chave) || {
    codigo: String(codigo || '').trim(),
    plano: String(descricao || '').trim() || 'Sem plano de contas',
    recebido: 0,
    pago: 0,
  };
  atual[campo] += cents;
  map.set(chave, atual);
}

async function porRecebimentoConta(db, filtros, ignorarCartao, fontes) {
  if (!(await relacaoExiste(db, 'TB_PLANO_CONTAS'))) return [];
  const map = new Map();
  for (const fonte of fontes) {
    if (!fonte.baixa || !(await colunaExiste(db, fonte.baixa, 'ID_CTAPLA'))) continue;
    const rows = await ler(db, `
      SELECT B.ID_CTAPLA AS ID,
             TRIM(COALESCE(P.COD_CONTA, '')) AS CODIGO,
             TRIM(COALESCE(P.DESCRICAO, '')) AS DESCRICAO,
             SUM(COALESCE(B.VLR_RECEB, 0)) AS VALOR
      FROM ${fonte.baixa} B
      LEFT JOIN ${fonte.conta} C ON C.ID_CTAREC = B.ID_CTAREC
      LEFT JOIN TB_PLANO_CONTAS P ON P.ID_CTAPLA = B.ID_CTAPLA
      WHERE B.DT_BAIXA >= '${filtros.inicio}' AND B.DT_BAIXA < '${filtros.fimExclusivo}'
        AND TRIM(COALESCE(B.TIP_RECBTO, '')) = 'T'
        ${filtroCartao('C.HISTORICO', ignorarCartao)}
      GROUP BY B.ID_CTAPLA, P.COD_CONTA, P.DESCRICAO`);
    for (const r of rows || []) acumularPlano(map, r.ID, r.CODIGO, r.DESCRICAO, 'recebido', centavos(r.VALOR));
  }
  return linhasPlano(map);
}

async function porPlano(db, filtros, ignorarCartao, fontes) {
  if (!(await relacaoExiste(db, 'TB_PLANO_CONTAS'))) return [];
  const map = new Map();
  for (const fonte of fontes) {
    const col = await colunaPlanoTitulo(db, fonte.conta);
    if (!fonte.baixa || !col) continue;
    const rows = await ler(db, `
      SELECT C.${col} AS ID,
             TRIM(COALESCE(P.COD_CONTA, '')) AS CODIGO,
             TRIM(COALESCE(P.DESCRICAO, '')) AS DESCRICAO,
             SUM(COALESCE(B.VLR_RECEB, 0)) AS VALOR
      FROM ${fonte.baixa} B
      JOIN ${fonte.conta} C ON C.ID_CTAREC = B.ID_CTAREC
      LEFT JOIN TB_PLANO_CONTAS P ON P.ID_CTAPLA = C.${col}
      WHERE B.DT_BAIXA >= '${filtros.inicio}' AND B.DT_BAIXA < '${filtros.fimExclusivo}'
        AND TRIM(COALESCE(B.TIP_RECBTO, '')) = 'T'
        ${filtroCartao('C.HISTORICO', ignorarCartao)}
      GROUP BY C.${col}, P.COD_CONTA, P.DESCRICAO`);
    for (const r of rows || []) acumularPlano(map, r.ID, r.CODIGO, r.DESCRICAO, 'recebido', centavos(r.VALOR));
  }
  const colPagar = await colunaPlanoTitulo(db, 'TB_CONTA_PAGAR');
  if (colPagar && await colunaExiste(db, 'TB_CTAPAG_BAIXA', 'ID_CTAPAG')) {
    const rows = await ler(db, `
      SELECT C.${colPagar} AS ID,
             TRIM(COALESCE(P.COD_CONTA, '')) AS CODIGO,
             TRIM(COALESCE(P.DESCRICAO, '')) AS DESCRICAO,
             SUM(COALESCE(B.VLR_PAGO, 0)) AS VALOR
      FROM TB_CTAPAG_BAIXA B
      JOIN TB_CONTA_PAGAR C ON C.ID_CTAPAG = B.ID_CTAPAG
      LEFT JOIN TB_PLANO_CONTAS P ON P.ID_CTAPLA = C.${colPagar}
      WHERE B.DT_BAIXA >= '${filtros.inicio}' AND B.DT_BAIXA < '${filtros.fimExclusivo}'
        AND TRIM(COALESCE(B.TIP_PAGTO, '')) = 'T'
      GROUP BY C.${colPagar}, P.COD_CONTA, P.DESCRICAO`);
    for (const r of rows || []) acumularPlano(map, r.ID, r.CODIGO, r.DESCRICAO, 'pago', centavos(r.VALOR));
  }
  return linhasPlano(map);
}

async function somaPagas(db, inicio, fimExclusivo) {
  const rows = await ler(db, `
    SELECT COALESCE(SUM(VLR_PAGO), 0) AS VALOR
    FROM TB_CTAPAG_BAIXA
    WHERE DT_BAIXA >= '${inicio}' AND DT_BAIXA < '${fimExclusivo}'
      AND TRIM(COALESCE(TIP_PAGTO, '')) = 'T'`);
  return rows && rows[0] ? centavos(rows[0].VALOR) : 0;
}

async function consultarFinanceiro(db, filtros, ignorarCartao, usaManage) {
  const fontes = await fontesContaReceber(db, usaManage);
  const dia = filtros.fim;
  const diaFim = addDias(dia, 1);
  const mes = intervaloMes(dia);
  const pagarDia = await somaPagarAberto(db, dia, diaFim);
  const pagarMes = await somaPagarAberto(db, mes.inicio, mes.fimExclusivo);
  const receberDia = await somaReceberAberto(db, fontes, dia, diaFim, ignorarCartao);
  const receberMes = await somaReceberAberto(db, fontes, mes.inicio, mes.fimExclusivo, ignorarCartao);
  const pagasDia = await somaPagas(db, dia, diaFim);
  const pagasMes = await somaPagas(db, mes.inicio, mes.fimExclusivo);
  const recebidasDia = await somaRecebidas(db, fontes, dia, diaFim, ignorarCartao);
  const recebidasMes = await somaRecebidas(db, fontes, mes.inicio, mes.fimExclusivo, ignorarCartao);
  const pagar = await ler(db, `
    SELECT FIRST 200 TRIM(CAST(C.DOCUMENTO AS VARCHAR(40))) AS DOCUMENTO,
           TRIM(COALESCE(C.HISTORICO, '')) AS HISTORICO,
           C.DT_VENCTO, C.VLR_CTAPAG AS VALOR,
           CASE WHEN EXISTS (
             SELECT 1 FROM TB_CTAPAG_BAIXA B
             WHERE B.ID_CTAPAG = C.ID_CTAPAG AND TRIM(COALESCE(B.TIP_PAGTO, '')) = 'T'
           ) THEN 'Paga' ELSE 'Em aberto' END AS SITUACAO
    FROM TB_CONTA_PAGAR C
    WHERE C.DT_VENCTO >= '${filtros.inicio}' AND C.DT_VENCTO < '${filtros.fimExclusivo}'
      AND TRIM(COALESCE(C.TIP_CTAPAG, '')) <> 'C'
    ORDER BY C.DT_VENCTO, C.ID_CTAPAG`);
  const receber = [];
  let contasReceberTotal = 0;
  for (const fonte of fontes) {
    const saldoReceber = sqlRestante('C', fonte);
    const lista = await ler(db, `
      SELECT FIRST 200 TRIM(CAST(C.DOCUMENTO AS VARCHAR(40))) AS DOCUMENTO,
             TRIM(COALESCE(C.HISTORICO, '')) AS HISTORICO,
             C.DT_VENCTO, C.VLR_CTAREC AS VALOR,
             CASE WHEN ${saldoReceber} > 0.009 THEN 'Em aberto' ELSE 'Recebida' END AS SITUACAO
      FROM ${fonte.conta} C
      WHERE C.DT_VENCTO >= '${filtros.inicio}' AND C.DT_VENCTO < '${filtros.fimExclusivo}'
        AND TRIM(COALESCE(C.TIP_CTAREC, '')) <> 'C'
        ${filtroCartao('C.HISTORICO', ignorarCartao)}
      ORDER BY C.DT_VENCTO, C.ID_CTAREC`);
    receber.push(...(lista || []));
    const total = await ler(db, `
      SELECT COUNT(*) AS N FROM ${fonte.conta}
      WHERE DT_VENCTO >= '${filtros.inicio}' AND DT_VENCTO < '${filtros.fimExclusivo}'
        AND TRIM(COALESCE(TIP_CTAREC, '')) <> 'C'
        ${filtroCartao('HISTORICO', ignorarCartao)}`);
    contasReceberTotal += total && total[0] ? inteiro(total[0].N) : 0;
  }
  receber.sort((a, b) => String(diaIso(a.DT_VENCTO)).localeCompare(String(diaIso(b.DT_VENCTO))));
  const totalPagar = await ler(db, `
    SELECT COUNT(*) AS N FROM TB_CONTA_PAGAR
    WHERE DT_VENCTO >= '${filtros.inicio}' AND DT_VENCTO < '${filtros.fimExclusivo}'
      AND TRIM(COALESCE(TIP_CTAPAG, '')) <> 'C'`);
  return {
    referenciaDia: dataBr(dia),
    referenciaMes: mes.rotulo,
    ignorarCartao: !!ignorarCartao,
    pagarDia: reais(pagarDia),
    pagarMes: reais(pagarMes),
    receberDia: reais(receberDia),
    receberMes: reais(receberMes),
    pagasDia: reais(pagasDia),
    pagasMes: reais(pagasMes),
    recebidasDia: reais(recebidasDia),
    recebidasMes: reais(recebidasMes),
    contasPagar: (pagar || []).map(linhaConta),
    contasReceber: receber.slice(0, 200).map(linhaConta),
    contasPagarTotal: totalPagar && totalPagar[0] ? inteiro(totalPagar[0].N) : 0,
    contasReceberTotal,
    porRecebimentoConta: await porRecebimentoConta(db, filtros, ignorarCartao, fontes),
    porPlano: await porPlano(db, filtros, ignorarCartao, fontes),
  };
}

async function detalharDashboard(db, opcoes = {}) {
  const usaManage = opcoes.usaManage === undefined
    ? lerUsaManage(opcoes.appCfg || loadAppConfig())
    : (Number(opcoes.usaManage) === 1 ? 1 : 0);
  const filtros = montarFiltros(opcoes, 'CONTADOR_ACESSA');
  const linhas = [];
  async function lerLado(fonte, tipo, modo, natureza, sinal) {
    const classif = sqlClassificacao(fonte, filtros, true);
    const dataCol = tipo === 'compra' ? 'N.DT_ENTRADA' : 'N.DT_EMISSAO';
    const lista = await lerFonte(db, fonte, (f) => `
      SELECT N.NF_NUMERO AS NOTA, ${dataCol} AS DATA, I.NUM_ITEM AS ITEM,
             COALESCE(TRIM(PRD.COD_NCM), '') AS NCM,
             COALESCE(I.QTD_ITEM, 0) AS QTD,
             ${sqlValor(f)} AS VALOR
      FROM ${f.item} I
      JOIN ${f.nota} N ON N.${f.id} = I.${f.id}
      ${classif.join}
      WHERE ${predNota(tipo, filtros, f)}
        AND ${predItem(modo)}
        ${classif.where}`);
    for (const r of lista || []) {
      linhas.push({
        natureza,
        nota: r.NOTA == null ? '' : String(r.NOTA).trim(),
        data: diaIso(r.DATA),
        item: r.ITEM == null ? '' : String(r.ITEM).trim(),
        ncm: String(r.NCM || '').trim(),
        quantidade: Math.round((Number(r.QTD) || 0) * sinal * 1000) / 1000,
        valor: reais(sinal * centavos(r.VALOR)),
      });
    }
  }
  for (const fonte of fontesVendaEscopo(usaManage, filtros)) {
    await lerLado(fonte, 'venda', 'venda', 'Saída', 1);
  }
  for (const fonte of fontesCompra(usaManage, filtros)) {
    await lerLado(fonte, 'compra', 'compra', 'Entrada', 1);
    await lerLado(fonte, 'compra', 'devolucao_venda', 'Devolução de venda', -1);
  }
  linhas.sort((a, b) => a.data.localeCompare(b.data) || String(a.nota).localeCompare(String(b.nota)));
  return linhas;
}

function cardsVenda(t) {
  const notas = t.vendas.notas;
  return {
    totalVendido: reais(t.totalVendido),
    comFrete: reais(t.totalComFrete),
    comFreteFiscais: reais(t.vendas.freteFiscal),
    comFreteGerenciais: reais(t.vendas.freteGerencial),
    comFreteManage: reais(t.vendas.freteManage),
    comFreteNfce: reais(t.vendas.freteNfce),
    comFreteNfe: reais(t.vendas.freteNfe),
    vendasFiscais: reais(t.vendas.fiscal),
    vendasGerenciais: reais(t.vendas.gerencial),
    vendasManage: reais(t.vendas.manage),
    vendasNfce: reais(t.vendas.nfce),
    vendasNfe: reais(t.vendas.nfe),
    totalComprado: reais(t.totalComprado),
    notasVenda: notas,
    notasEntrada: t.compras.notas,
    quantidadeVendida: reais(t.vendas.qtd),
    quantidadeComprada: reais(t.compras.qtd),
    ticketMedio: notas ? reais(Math.round(t.totalVendido / notas)) : 0,
  };
}

function montarFiltros(opcoes, perfil) {
  const modelo = limparModelo(opcoes.modelo);
  const base = {
    grupoId: limparGrupo(opcoes.grupoId),
    tipoItem: limparTipo(opcoes.tipoItem),
    ncm: limparNcm(opcoes.ncm),
  };
  if (perfil === 'MT_ENTRADAS') {
    const hoje = isoHoje();
    const inicio = opcoes.inicio ? parseIso(opcoes.inicio) : `${hoje.slice(0, 8)}01`;
    const fim = opcoes.fim ? parseIso(opcoes.fim) : hoje;
    if (fim < inicio) throw new Error('A data final é anterior à inicial');
    return {
      ...base,
      grupoId: null,
      tipoItem: '',
      ncm: '',
      inicio,
      fim,
      fimExclusivo: addDias(fim, 1),
      modelosVenda: MODELOS_FISCAIS,
      modelosCompra: MODELOS_FISCAIS,
      dia: fim,
    };
  }
  const inicio = parseIso(opcoes.inicio);
  const fim = parseIso(opcoes.fim);
  if (fim < inicio) throw new Error('A data final é anterior à inicial');
  const fiscal = perfil === 'CONTADOR_ACESSA';
  return {
    ...base,
    grupoId: fiscal ? null : base.grupoId,
    tipoItem: fiscal ? '' : base.tipoItem,
    inicio,
    fim,
    fimExclusivo: addDias(fim, 1),
    modelosVenda: fiscal ? MODELOS_FISCAIS : (modelo ? [modelo] : MODELOS_VENDA),
    modelosCompra: fiscal ? MODELOS_FISCAIS : (modelo ? [modelo] : null),
  };
}

async function consultarDashboard(db, opcoes = {}) {
  const perfil = String(opcoes.perfil || 'PADRAO').trim().toUpperCase();
  if (!['PADRAO', 'CONTADOR_ACESSA', 'MT_ENTRADAS'].includes(perfil)) {
    throw new Error('Perfil de dashboard inválido');
  }
  const usaManage = opcoes.usaManage === undefined
    ? lerUsaManage(opcoes.appCfg || loadAppConfig())
    : (Number(opcoes.usaManage) === 1 ? 1 : 0);
  const filtros = montarFiltros(opcoes, perfil);

  if (perfil === 'MT_ENTRADAS') {
    const mesIntervalo = intervaloMes(filtros.fim);
    const diaFiltro = { ...filtros, inicio: filtros.fim, fim: filtros.fim, fimExclusivo: addDias(filtros.fim, 1) };
    const mesFiltro = { ...filtros, inicio: mesIntervalo.inicio, fimExclusivo: mesIntervalo.fimExclusivo };
    const dia = await totais(db, usaManage, diaFiltro, 'compras');
    const mes = await totais(db, usaManage, mesFiltro, 'compras');
    const grupos = await porGrupo(db, usaManage, filtros, 'compras');
    return {
      perfil,
      usaManage,
      fiscal: true,
      periodo: { inicio: filtros.inicio, fim: filtros.fim },
      referenciaDia: dataBr(filtros.fim),
      referenciaMes: mesIntervalo.rotulo,
      entradasDia: reais(dia.totalComprado),
      entradasMes: reais(mes.totalComprado),
      notasDia: dia.compras.notas,
      notasMes: mes.compras.notas,
      porGrupo: grupos,
      vazio: false,
      mensagem: '',
    };
  }

  if (perfil === 'CONTADOR_ACESSA') {
    const t = await totais(db, usaManage, filtros, 'ambos');
    const ncm = await porNcm(db, usaManage, filtros);
    const vazio = t.totalVendido === 0 && t.totalComprado === 0;
    return {
      perfil,
      usaManage,
      fiscal: true,
      periodo: { inicio: filtros.inicio, fim: filtros.fim },
      totalComprado: reais(t.totalComprado),
      totalVendido: reais(t.totalVendido),
      diferenca: reais(t.totalVendido - t.totalComprado),
      notasEntrada: t.compras.notas,
      notasSaida: t.vendas.notas,
      itensComprados: reais(t.compras.qtd),
      itensVendidos: reais(t.vendas.qtd),
      porNcm: ncm,
      vazio,
      mensagem: vazio ? 'Nenhuma movimentação no período' : '',
    };
  }

  const usaGr = await empresaUsaGr(db);
  const abas = [];
  if (usaManage) abas.push('manage');
  if (usaGr || !usaManage) abas.push('vendas');
  abas.push('fiscal');
  abas.push('financeiro');
  const pedida = String(opcoes.aba || '').trim().toLowerCase();
  const aba = abas.includes(pedida) ? pedida : (usaManage ? 'manage' : 'vendas');
  const ignorarCartao = Number((opcoes.appCfg || loadAppConfig()).ignorar_receber_cartao) === 1;
  if (aba === 'financeiro') {
    const fin = await consultarFinanceiro(db, filtros, ignorarCartao, usaManage);
    return {
      perfil,
      usaManage,
      usaGr,
      aba,
      abas,
      fiscal: false,
      periodo: { inicio: filtros.inicio, fim: filtros.fim },
      ano: String(filtros.inicio || '').slice(0, 4),
      ...fin,
      vazio: false,
      mensagem: '',
    };
  }
  const filtrosAba = filtrosDaAba(filtros, aba, usaManage, usaGr);
  const t = await totais(db, usaManage, filtrosAba, aba === 'fiscal' ? 'vendas' : 'ambos');
  let vendidoDia = 0;
  let vendidoMes = 0;
  let vendidoDiaComFrete = 0;
  let vendidoMesComFrete = 0;
  if (aba === 'fiscal' || aba === 'manage') {
    const hoje = isoHoje();
    const diaFiltro = { ...filtrosAba, inicio: hoje, fim: hoje, fimExclusivo: addDias(hoje, 1) };
    const mesFiltro = { ...filtrosAba, inicio: `${hoje.slice(0, 8)}01`, fim: hoje, fimExclusivo: addDias(hoje, 1) };
    const dia = await totais(db, usaManage, diaFiltro, 'vendas');
    const mes = await totais(db, usaManage, mesFiltro, 'vendas');
    vendidoDia = reais(dia.totalVendido);
    vendidoMes = reais(mes.totalVendido);
    vendidoDiaComFrete = reais(dia.totalComFrete);
    vendidoMesComFrete = reais(mes.totalComFrete);
  }
  const gruposVenda = await porGrupo(db, usaManage, filtrosAba, 'vendas');
  const gruposCompra = await porGrupo(db, usaManage, filtrosAba, 'compras');
  const pagamento = await porPagamento(db, usaManage, filtrosAba, t.devolucaoVenda);
  const serieMensal = aba === 'manage'
    ? await porMesFinanceiro(db, filtrosAba, ignorarCartao, usaManage)
    : await porMes(db, usaManage, filtrosAba);
  const vazio = t.totalVendido === 0 && (aba === 'fiscal' || t.totalComprado === 0);
  return {
    perfil,
    usaManage,
    usaGr,
    aba,
    abas,
    fiscal: aba === 'fiscal',
    periodo: { inicio: filtros.inicio, fim: filtros.fim },
    ano: String(filtros.inicio || '').slice(0, 4),
    ...cardsVenda(t),
    vendidoDia,
    vendidoMes,
    vendidoDiaComFrete,
    vendidoMesComFrete,
    porGrupoVenda: gruposVenda,
    porGrupoCompra: gruposCompra,
    porPagamento: pagamento,
    porMes: serieMensal,
    vazio,
    mensagem: vazio ? 'Nenhuma movimentação no período' : '',
  };
}

async function empresaUsaGr(db) {
  const gr = await ler(db, "SELECT FIRST 1 1 AS TEM FROM TB_NFVENDA WHERE TRIM(NF_MODELO) = 'GR'");
  if (gr && gr.length) return true;
  const conv = await ler(db, 'SELECT FIRST 1 1 AS TEM FROM TB_GR_CONVERTIDO');
  return !!(conv && conv.length);
}

function filtrosDaAba(filtros, aba, usaManage, usaGr) {
  const modeloEscolhido = filtros.modelosVenda && filtros.modelosVenda.length === 1 ? filtros.modelosVenda : null;
  if (aba === 'manage') {
    return {
      ...filtros,
      escopoVenda: 'manage',
      escopoCompra: 'manage',
      excluirConvertidas: false,
      modelosVenda: modeloEscolhido,
      modelosCompra: modeloEscolhido || filtros.modelosCompra,
    };
  }
  if (aba === 'fiscal') {
    return {
      ...filtros,
      escopoVenda: 'clipp',
      escopoCompra: 'clipp',
      excluirConvertidas: false,
      modelosVenda: MODELOS_FISCAIS,
      modelosCompra: MODELOS_FISCAIS,
    };
  }
  if (usaGr) {
    return {
      ...filtros,
      escopoVenda: 'clipp',
      escopoCompra: 'clipp',
      excluirConvertidas: true,
      modelosVenda: filtros.modelosVenda,
    };
  }
  return {
    ...filtros,
    escopoVenda: usaManage ? '' : 'clipp',
    escopoCompra: usaManage ? '' : 'clipp',
    excluirConvertidas: false,
  };
}

module.exports = {
  consultarDashboard,
  detalharDashboard,
  lerUsaManage,
  periodoAnterior,
  INDICES_SUGERIDOS,
  CFOP_EXCLUIR,
  CFOP_DEVOLUCAO,
  CFOP_COMPRA,
};
