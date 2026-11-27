'use strict';

const Firebird = require('node-firebird');
const { query, buildFbOptions, detach } = require('./db');
const { lerUsaManage, loadAppConfig } = require('./config');

/**
 * Camada única dos dashboards. Tela, PDF e Excel devem chamar só daqui.
 *
 * Mapeado na base C:\Work\MT\Cliente\Clipp\Base\CLIPP.FDB:
 * - Venda Clipp: TB_NFVENDA + TB_NFV_ITEM. Data: DT_EMISSAO. Status E = emitida.
 * - Valor do item: VLR_TOTAL - VLR_DESC + frete + seguro + despesa + ST + IPI + FCP ST.
 *   ST, IPI e FCP ST vêm das filhas (TB_NFV_ITEM_ST/IPI/FCP e TB_NFC_ITEM_*). No Manage, a filha
 *   prevalece e, se não houver linha, usa VLR_ST/VLR_IPI do próprio item.
 *   Na venda Clipp, ST e FCP ST só somam em NF-e com CFOP de ST cobrado (CFOP_ST_COBRADO);
 *   na NFC-e e no 5405 a filha traz ST informativo, fora do total da nota.
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
/* CFOPs em que o emitente cobra o ICMS-ST como substituto e o valor entra no total da NF-e.
   x404/x405 (ST retido anteriormente) e toda NFC-e só trazem o ST informativo. */
const CFOP_ST_COBRADO = ['401', '402', '403', '408', '409', '410', '411', '412', '413', '414', '415'];
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
  { manage: false, nota: 'TB_NFVENDA', item: 'TB_NFV_ITEM', id: 'ID_NFVENDA', idItem: 'ID_NFVITEM', ident: 'TB_EST_IDENTIFICADOR', estoque: 'TB_ESTOQUE', produto: 'TB_EST_PRODUTO', pagamentoDetalhe: true, stSoCobrado: true, st: 'TB_NFV_ITEM_ST', ipi: 'TB_NFV_ITEM_IPI', fcp: 'TB_NFV_ITEM_FCP' },
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
  let fcp = fonte.fcp ? `COALESCE(${somaFilha(fonte.fcp, 'X.VLR_FCP_ST', fonte.idItem)}, 0)` : '0';
  if (fonte.stSoCobrado) {
    /* Na venda Clipp a filha de ST é preenchida também quando o ST é só informativo
       (NFC-e, 5405, 5102); somá-lo inflava o vendido em relação ao total das notas. */
    const cobrado = `UPPER(TRIM(N.NF_MODELO)) = '55' AND ${sufixoCfop('I.CFOP')} IN (${listaSql(CFOP_ST_COBRADO)})`;
    if (st !== '0') st = `CASE WHEN ${cobrado} THEN ${st} ELSE 0 END`;
    if (fcp !== '0') fcp = `CASE WHEN ${cobrado} THEN ${fcp} ELSE 0 END`;
  }
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
  return ` AND NOT ${exprCartao(coluna)}`;
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
  return require('./datetime').isoHoje();
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

function diaMovimento(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${v.getFullYear()}-${m}-${d}`;
  }
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
    /* TB_GR_CONVERTIDO guarda a nota fiscal gerada. Só a gerencial de origem sai,
       para o mês não perder a NFC-e nem contar a mesma venda duas vezes. */
    partes.push(`NOT (UPPER(TRIM(N.NF_MODELO)) = 'GR' AND EXISTS (SELECT 1 FROM TB_GR_CONVERTIDO G WHERE G.ID_NFVENDA = N.ID_NFVENDA))`);
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

async function procedimentoExiste(db, nome) {
  const seguro = String(nome || '').toUpperCase().replace(/[^A-Z0-9_]/g, '');
  if (!seguro) return false;
  const rows = await ler(db, `
    SELECT 1 AS OK FROM RDB$PROCEDURES
    WHERE TRIM(RDB$PROCEDURE_NAME) = '${seguro}'`);
  return !!(rows && rows.length);
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

async function colunasTabela(db, tabela) {
  const rows = await ler(db, `
    SELECT TRIM(RDB$FIELD_NAME) AS COL
    FROM RDB$RELATION_FIELDS
    WHERE TRIM(RDB$RELATION_NAME) = '${tabela}'`);
  return new Set((rows || []).map((r) => String(r.COL || '').trim()));
}

async function baixaPagar(db, conta) {
  const direta = conta === 'TB_CONTA_PAGAR' ? 'TB_CTAPAG_BAIXA' : `${conta.replace('TB_CONTA_PAGAR', 'TB_CTAPAG_BAIXA')}`;
  if (await relacaoExiste(db, direta) && await colunaExiste(db, direta, 'VLR_PAGO')) return direta;
  const rows = await ler(db, `
    SELECT TRIM(RC.RDB$RELATION_NAME) AS NOME
    FROM RDB$RELATION_CONSTRAINTS RC
    JOIN RDB$REF_CONSTRAINTS REF ON REF.RDB$CONSTRAINT_NAME = RC.RDB$CONSTRAINT_NAME
    JOIN RDB$RELATION_CONSTRAINTS PK ON PK.RDB$CONSTRAINT_NAME = REF.RDB$CONST_NAME_UQ
    WHERE RC.RDB$CONSTRAINT_TYPE = 'FOREIGN KEY'
      AND TRIM(PK.RDB$RELATION_NAME) = '${conta}'`);
  for (const r of rows || []) {
    const nome = String(r.NOME || '').trim();
    if (nome && await colunaExiste(db, nome, 'VLR_PAGO') && await colunaExiste(db, nome, 'TIP_PAGTO')) return nome;
  }
  return '';
}

async function fontesContaPagar(db, usaManage) {
  const nomes = ['TB_CONTA_PAGAR'];
  if (usaManage) {
    if (await relacaoExiste(db, 'TB_CONTA_PAGAR_2')) nomes.push('TB_CONTA_PAGAR_2');
    if (await relacaoExiste(db, 'TB_CONTA_PAGAR_3')) nomes.push('TB_CONTA_PAGAR_3');
  }
  const fontes = [];
  for (const conta of nomes) {
    if (!(await relacaoExiste(db, conta))) continue;
    fontes.push({ conta, baixa: await baixaPagar(db, conta) });
  }
  return fontes;
}

function acumularValor(map, id, codigo, descricao, cents) {
  if (!cents) return;
  const chave = `${id == null ? '' : id}|${codigo}|${descricao}`;
  const atual = map.get(chave) || {
    codigo: String(codigo || '').trim(),
    plano: String(descricao || '').trim() || 'Sem plano de contas',
    valor: 0,
  };
  atual.valor += cents;
  map.set(chave, atual);
}

function linhasValor(map) {
  return [...map.values()]
    .map((r) => ({ codigo: r.codigo, plano: r.plano, valor: reais(r.valor) }))
    .filter((r) => r.valor !== 0)
    .sort((a, b) => `${a.codigo} ${a.plano}`.localeCompare(`${b.codigo} ${b.plano}`, 'pt-BR'));
}

function exprValorBaixa(cols, bruto) {
  let expr = `COALESCE(B.${bruto}, 0)`;
  if (cols.has('VLR_JURO')) expr += ' - COALESCE(B.VLR_JURO, 0)';
  if (cols.has('VLR_ACRESC')) expr += ' - COALESCE(B.VLR_ACRESC, 0)';
  if (cols.has('VLR_DESC')) expr += ' + COALESCE(B.VLR_DESC, 0)';
  return expr;
}

async function planoPorTexto(db, texto) {
  const seguro = String(texto || '').replace(/'/g, '').slice(0, 40);
  if (!seguro) return null;
  const rows = await ler(db, `
    SELECT FIRST 1 ID_CTAPLA AS ID,
           TRIM(COALESCE(COD_CONTA, '')) AS CODIGO,
           TRIM(COALESCE(DESCRICAO, '')) AS DESCRICAO
    FROM TB_PLANO_CONTAS
    WHERE UPPER(DESCRICAO) CONTAINING '${seguro}'
    ORDER BY ID_CTAPLA`);
  return rows && rows[0] ? rows[0] : null;
}

async function idsContraPlano(db) {
  const caixa = new Set();
  const controle = new Set();
  function guardar(set, lista) {
    for (const r of lista || []) {
      const n = Number(r.ID);
      if (Number.isFinite(n) && n) set.add(n);
    }
  }
  if (await relacaoExiste(db, 'TB_BANCO_CTA') && await colunaExiste(db, 'TB_BANCO_CTA', 'ID_CTAPLA')) {
    guardar(caixa, await ler(db, `SELECT DISTINCT ID_CTAPLA AS ID FROM TB_BANCO_CTA WHERE ID_CTAPLA IS NOT NULL`));
  }
  if (await relacaoExiste(db, 'TB_CTAREC_BAIXA') && await colunaExiste(db, 'TB_CTAREC_BAIXA', 'ID_CTAPLA')) {
    guardar(caixa, await ler(db, `
      SELECT DISTINCT B.ID_CTAPLA AS ID
      FROM TB_CTAREC_BAIXA B
      JOIN TB_PLANO_CONTAS P ON P.ID_CTAPLA = B.ID_CTAPLA
      WHERE TRIM(COALESCE(P.COD_CONTA, '')) STARTING WITH '1.01.01'`));
  }
  if (await relacaoExiste(db, 'TB_MOVDIARIO') && await relacaoExiste(db, 'TB_CTAREC_MOVTO')) {
    guardar(controle, await ler(db, `
      SELECT FIRST 1 M.ID_CTAPLA AS ID
      FROM TB_MOVDIARIO M
      JOIN TB_CTAREC_MOVTO L ON L.ID_MOVTO = M.ID_MOVTO
      WHERE TRIM(COALESCE(M.TIP_MOVTO, '')) = 'D'
      GROUP BY M.ID_CTAPLA
      ORDER BY COUNT(*) DESC`));
  }
  if (await relacaoExiste(db, 'TB_MOVDIARIO') && await relacaoExiste(db, 'TB_CTAPAG_MOVTO')) {
    guardar(controle, await ler(db, `
      SELECT FIRST 1 M.ID_CTAPLA AS ID
      FROM TB_MOVDIARIO M
      JOIN TB_CTAPAG_MOVTO L ON L.ID_MOVTO = M.ID_MOVTO
      WHERE TRIM(COALESCE(M.TIP_MOVTO, '')) = 'C'
      GROUP BY M.ID_CTAPLA
      ORDER BY COUNT(*) DESC`));
  }
  return { caixa, controle };
}

async function porPlano(db, filtros, ignorarCartao, fontesReceber, usaManage) {
  const vazio = { recebidas: [], receber: [], pagar: [], pagas: [] };
  if (!(await relacaoExiste(db, 'TB_PLANO_CONTAS'))) return vazio;
  const recebidas = new Map();
  const receber = new Map();
  const pagar = new Map();
  const pagas = new Map();
  const contra = await idsContraPlano(db);
  const planoJuros = await planoPorTexto(db, 'RECEBIMENTO DE JUROS') || await planoPorTexto(db, 'JUROS');
  const planoAcresc = await planoPorTexto(db, 'MULTA') || await planoPorTexto(db, 'ACRESC');
  const jurosId = planoJuros ? Number(planoJuros.ID) : 0;
  const acrescId = planoAcresc ? Number(planoAcresc.ID) : 0;
  let jurosBaixa = 0;
  let acrescBaixa = 0;

  for (const fonte of fontesReceber) {
    const col = await colunaPlanoTitulo(db, fonte.conta);
    if (!col) continue;
    const saldo = sqlRestante('C', fonte);
    const abertos = await ler(db, `
      SELECT C.${col} AS ID,
             TRIM(COALESCE(P.COD_CONTA, '')) AS CODIGO,
             TRIM(COALESCE(P.DESCRICAO, '')) AS DESCRICAO,
             SUM(${saldo}) AS VALOR
      FROM ${fonte.conta} C
      LEFT JOIN TB_PLANO_CONTAS P ON P.ID_CTAPLA = C.${col}
      WHERE C.DT_VENCTO >= '${filtros.inicio}' AND C.DT_VENCTO < '${filtros.fimExclusivo}'
        AND TRIM(COALESCE(C.TIP_CTAREC, '')) <> 'C'
        AND ${saldo} > 0.009
        ${filtroCartao('C.HISTORICO', ignorarCartao)}
      GROUP BY C.${col}, P.COD_CONTA, P.DESCRICAO`);
    for (const r of abertos || []) acumularValor(receber, r.ID, r.CODIGO, r.DESCRICAO, centavos(r.VALOR));
    if (!fonte.baixa) continue;
    const cols = await colunasTabela(db, fonte.baixa);
    if (!cols.has('VLR_RECEB')) continue;
    const principal = exprValorBaixa(cols, 'VLR_RECEB');
    const rows = await ler(db, `
      SELECT C.${col} AS ID,
             TRIM(COALESCE(P.COD_CONTA, '')) AS CODIGO,
             TRIM(COALESCE(P.DESCRICAO, '')) AS DESCRICAO,
             SUM(${principal}) AS VALOR
             ${cols.has('VLR_JURO') ? ', SUM(COALESCE(B.VLR_JURO, 0)) AS JURO' : ''}
             ${cols.has('VLR_ACRESC') ? ', SUM(COALESCE(B.VLR_ACRESC, 0)) AS ACRESC' : ''}
      FROM ${fonte.baixa} B
      JOIN ${fonte.conta} C ON C.ID_CTAREC = B.ID_CTAREC
      LEFT JOIN TB_PLANO_CONTAS P ON P.ID_CTAPLA = C.${col}
      WHERE B.DT_BAIXA >= '${filtros.inicio}' AND B.DT_BAIXA < '${filtros.fimExclusivo}'
        AND TRIM(COALESCE(B.TIP_RECBTO, '')) = 'T'
        ${filtroCartao('C.HISTORICO', ignorarCartao)}
      GROUP BY C.${col}, P.COD_CONTA, P.DESCRICAO`);
    for (const r of rows || []) {
      acumularValor(recebidas, r.ID, r.CODIGO, r.DESCRICAO, centavos(r.VALOR));
      jurosBaixa += centavos(r.JURO);
      acrescBaixa += centavos(r.ACRESC);
    }
  }

  for (const fonte of await fontesContaPagar(db, usaManage)) {
    const col = await colunaPlanoTitulo(db, fonte.conta);
    if (!col) continue;
    const baixaSql = fonte.baixa
      ? `AND NOT EXISTS (
           SELECT 1 FROM ${fonte.baixa} B
           WHERE B.ID_CTAPAG = C.ID_CTAPAG AND TRIM(COALESCE(B.TIP_PAGTO, '')) = 'T')`
      : '';
    const abertos = await ler(db, `
      SELECT C.${col} AS ID,
             TRIM(COALESCE(P.COD_CONTA, '')) AS CODIGO,
             TRIM(COALESCE(P.DESCRICAO, '')) AS DESCRICAO,
             SUM(COALESCE(C.VLR_CTAPAG, 0)) AS VALOR
      FROM ${fonte.conta} C
      LEFT JOIN TB_PLANO_CONTAS P ON P.ID_CTAPLA = C.${col}
      WHERE C.DT_VENCTO >= '${filtros.inicio}' AND C.DT_VENCTO < '${filtros.fimExclusivo}'
        AND TRIM(COALESCE(C.TIP_CTAPAG, '')) <> 'C'
        ${baixaSql}
      GROUP BY C.${col}, P.COD_CONTA, P.DESCRICAO`);
    for (const r of abertos || []) acumularValor(pagar, r.ID, r.CODIGO, r.DESCRICAO, centavos(r.VALOR));
    if (!fonte.baixa) continue;
    const cols = await colunasTabela(db, fonte.baixa);
    if (!cols.has('VLR_PAGO')) continue;
    const principal = exprValorBaixa(cols, 'VLR_PAGO');
    const rows = await ler(db, `
      SELECT C.${col} AS ID,
             TRIM(COALESCE(P.COD_CONTA, '')) AS CODIGO,
             TRIM(COALESCE(P.DESCRICAO, '')) AS DESCRICAO,
             SUM(${principal}) AS VALOR
             ${cols.has('VLR_ACRESC') ? ', SUM(COALESCE(B.VLR_ACRESC, 0)) AS ACRESC' : ''}
      FROM ${fonte.baixa} B
      JOIN ${fonte.conta} C ON C.ID_CTAPAG = B.ID_CTAPAG
      LEFT JOIN TB_PLANO_CONTAS P ON P.ID_CTAPLA = C.${col}
      WHERE B.DT_BAIXA >= '${filtros.inicio}' AND B.DT_BAIXA < '${filtros.fimExclusivo}'
        AND TRIM(COALESCE(B.TIP_PAGTO, '')) = 'T'
      GROUP BY C.${col}, P.COD_CONTA, P.DESCRICAO`);
    for (const r of rows || []) {
      acumularValor(pagas, r.ID, r.CODIGO, r.DESCRICAO, centavos(r.VALOR));
      acrescBaixa += centavos(r.ACRESC);
    }
  }

  if (jurosBaixa && planoJuros) acumularValor(recebidas, planoJuros.ID, planoJuros.CODIGO, planoJuros.DESCRICAO, jurosBaixa);
  if (acrescBaixa && planoAcresc) acumularValor(pagas, planoAcresc.ID, planoAcresc.CODIGO, planoAcresc.DESCRICAO, acrescBaixa);
  else if (acrescBaixa) acumularValor(pagas, '', '', 'Acréscimos', acrescBaixa);

  const livros = ['TB_MOVDIARIO'];
  if (usaManage) {
    if (await relacaoExiste(db, 'TB_MOVDIARIO_2')) livros.push('TB_MOVDIARIO_2');
    if (await relacaoExiste(db, 'TB_MOVDIARIO_3')) livros.push('TB_MOVDIARIO_3');
  }
  const ligacoes = [];
  for (const nome of ['TB_CTAREC_MOVTO', 'TB_CTAPAG_MOVTO', 'TB_CTAREC_MOVTO_2', 'TB_CTAPAG_MOVTO_2']) {
    if (await relacaoExiste(db, nome) && await colunaExiste(db, nome, 'ID_MOVTO')) ligacoes.push(nome);
  }
  let jurosLivro = 0;
  for (const livro of livros) {
    if (!(await relacaoExiste(db, livro)) || !(await colunaExiste(db, livro, 'ID_CTAPLA'))) continue;
    const semTitulo = ligacoes.map((t) => `NOT EXISTS (SELECT 1 FROM ${t} L WHERE L.ID_MOVTO = M.ID_MOVTO)`).join(' AND ');
    const rows = await ler(db, `
      SELECT M.ID_CTAPLA AS ID,
             TRIM(COALESCE(P.COD_CONTA, '')) AS CODIGO,
             TRIM(COALESCE(P.DESCRICAO, '')) AS DESCRICAO,
             TRIM(COALESCE(M.TIP_MOVTO, '')) AS TIP,
             SUM(COALESCE(M.VLR_MOVTO, 0)) AS VALOR
      FROM ${livro} M
      LEFT JOIN TB_PLANO_CONTAS P ON P.ID_CTAPLA = M.ID_CTAPLA
      WHERE M.DT_MOVTO >= '${filtros.inicio}' AND M.DT_MOVTO < '${filtros.fimExclusivo}'
        ${semTitulo ? `AND ${semTitulo}` : ''}
        ${filtroCartao('M.HISTORICO', ignorarCartao)}
      GROUP BY M.ID_CTAPLA, P.COD_CONTA, P.DESCRICAO, TRIM(COALESCE(M.TIP_MOVTO, ''))`);
    for (const r of rows || []) {
      const id = Number(r.ID);
      const tip = String(r.TIP || '').trim().toUpperCase();
      const cents = centavos(r.VALOR);
      if (contra.caixa.has(id) || contra.controle.has(id)) continue;
      if (id && id === jurosId && tip === 'C') {
        jurosLivro += cents;
        continue;
      }
      if (id && id === acrescId) continue;
      const codigo = String(r.CODIGO || '');
      const nome = String(r.DESCRICAO || '');
      const reduzReceita = tip === 'D' && (nome.trim().startsWith('(-)') || codigo.startsWith('4.'));
      if (tip === 'C' || reduzReceita) {
        acumularValor(recebidas, r.ID, r.CODIGO, r.DESCRICAO, reduzReceita ? -cents : cents);
      } else if (tip === 'D') {
        acumularValor(pagas, r.ID, r.CODIGO, r.DESCRICAO, cents);
      }
    }
  }
  const jurosExtra = jurosLivro - jurosBaixa;
  if (jurosExtra > 0 && planoJuros) {
    acumularValor(recebidas, planoJuros.ID, planoJuros.CODIGO, planoJuros.DESCRICAO, jurosExtra);
  } else if (jurosLivro > 0 && !jurosBaixa && planoJuros) {
    acumularValor(recebidas, planoJuros.ID, planoJuros.CODIGO, planoJuros.DESCRICAO, jurosLivro);
  }

  const bancos = ['TB_BANCO_CTA_MOVTO'];
  if (usaManage) {
    if (await relacaoExiste(db, 'TB_BANCO_CTA_MOVTO_2')) bancos.push('TB_BANCO_CTA_MOVTO_2');
    if (await relacaoExiste(db, 'TB_BANCO_CTA_MOVTO_3')) bancos.push('TB_BANCO_CTA_MOVTO_3');
  }
  const temBancoConta = await relacaoExiste(db, 'TB_BANCO_CTA');
  for (const tabela of bancos) {
    if (!(await relacaoExiste(db, tabela))) continue;
    const cols = await colunasTabela(db, tabela);
    if (!cols.has('VALOR') || !cols.has('DT_MOVTO')) continue;
    const temPlanoMov = cols.has('ID_CTAPLA');
    const planId = temPlanoMov && temBancoConta
      ? 'COALESCE(B.ID_CTAPLA, CTA.ID_CTAPLA)'
      : (temPlanoMov ? 'B.ID_CTAPLA' : 'CTA.ID_CTAPLA');
    if (!temPlanoMov && !temBancoConta) continue;
    const joinConta = temBancoConta && cols.has('ID_CONTA') ? 'LEFT JOIN TB_BANCO_CTA CTA ON CTA.ID_CONTA = B.ID_CONTA' : '';
    const semTitulo = [
      cols.has('ID_CONTAS_RECEBER') ? 'B.ID_CONTAS_RECEBER IS NULL' : '',
      cols.has('ID_CONTAS_PAGAR') ? 'B.ID_CONTAS_PAGAR IS NULL' : '',
    ].filter(Boolean).join(' AND ');
    const rows = await ler(db, `
      SELECT ${planId} AS ID,
             TRIM(COALESCE(P.COD_CONTA, '')) AS CODIGO,
             TRIM(COALESCE(P.DESCRICAO, '')) AS DESCRICAO,
             TRIM(COALESCE(B.TIP_MOVTO, '')) AS TIP,
             ${temPlanoMov ? 'B.ID_CTAPLA' : 'NULL'} AS PLANO_MOV,
             ${temBancoConta && cols.has('ID_CONTA') ? 'CTA.ID_CTAPLA' : 'NULL'} AS PLANO_BANCO,
             SUM(COALESCE(B.VALOR, 0)) AS VALOR
      FROM ${tabela} B
      ${joinConta}
      LEFT JOIN TB_PLANO_CONTAS P ON P.ID_CTAPLA = ${planId}
      WHERE B.DT_MOVTO >= '${filtros.inicio}' AND B.DT_MOVTO < '${filtros.fimExclusivo}'
        ${semTitulo ? `AND ${semTitulo}` : ''}
        ${filtroCartao('B.HISTORICO', ignorarCartao)}
      GROUP BY ${planId}, P.COD_CONTA, P.DESCRICAO, TRIM(COALESCE(B.TIP_MOVTO, ''))
               ${temPlanoMov ? ', B.ID_CTAPLA' : ''}
               ${temBancoConta && cols.has('ID_CONTA') ? ', CTA.ID_CTAPLA' : ''}`);
    for (const r of rows || []) {
      const planoMov = Number(r.PLANO_MOV);
      const planoBanco = Number(r.PLANO_BANCO);
      const id = Number(r.ID);
      if (temPlanoMov && planoMov && planoBanco && planoMov === planoBanco) continue;
      if (contra.controle.has(id)) continue;
      if (temPlanoMov && planoMov && contra.caixa.has(planoMov)) continue;
      const tip = String(r.TIP || '').trim().toUpperCase();
      const destino = tip === 'D' ? pagas : recebidas;
      if (tip !== 'C' && tip !== 'D') continue;
      acumularValor(destino, r.ID, r.CODIGO, r.DESCRICAO, centavos(r.VALOR));
    }
  }

  return {
    recebidas: linhasValor(recebidas),
    receber: linhasValor(receber),
    pagar: linhasValor(pagar),
    pagas: linhasValor(pagas),
  };
}

async function somaPagas(db, inicio, fimExclusivo) {
  const rows = await ler(db, `
    SELECT COALESCE(SUM(VLR_PAGO), 0) AS VALOR
    FROM TB_CTAPAG_BAIXA
    WHERE DT_BAIXA >= '${inicio}' AND DT_BAIXA < '${fimExclusivo}'
      AND TRIM(COALESCE(TIP_PAGTO, '')) = 'T'`);
  return rows && rows[0] ? centavos(rows[0].VALOR) : 0;
}

function texto(v) {
  if (v == null) return '';
  const s = Buffer.isBuffer(v) ? v.toString('latin1') : String(v);
  return s.replace(/\u0000/g, '').replace(/\s+/g, ' ').trim();
}

function ladoDre(rows) {
  const centros = new Map();
  for (const r of rows || []) {
    const cents = centavos(r.VALOR);
    if (!cents) continue;
    const centro = texto(r.CENTRO) || 'Sem centro de custo';
    const codigo = texto(r.CODIGO);
    const plano = texto(r.PLANO) || 'Sem plano de contas';
    const id = r.ID == null ? '' : String(r.ID).trim();
    const chave = `${id}|${codigo}|${plano}`;
    if (!centros.has(centro)) centros.set(centro, { centro, total: 0, planos: new Map() });
    const grupo = centros.get(centro);
    grupo.total += cents;
    if (!grupo.planos.has(chave)) grupo.planos.set(chave, { codigo: codigo === '0' ? '' : codigo, plano, total: 0, linhas: [] });
    const item = grupo.planos.get(chave);
    item.total += cents;
    item.linhas.push({
      data: diaMovimento(r.DATA),
      historico: texto(r.HISTORICO),
      valor: reais(cents),
    });
  }
  return [...centros.values()].map((g) => ({
    centro: g.centro,
    total: reais(g.total),
    planos: [...g.planos.values()].map((p) => ({
      codigo: p.codigo,
      plano: p.plano,
      total: reais(p.total),
      linhas: p.linhas.sort((a, b) => a.data.localeCompare(b.data) || a.historico.localeCompare(b.historico, 'pt-BR')),
    })).sort((a, b) => centavos(b.total) - centavos(a.total) || a.plano.localeCompare(b.plano, 'pt-BR')),
  })).sort((a, b) => centavos(b.total) - centavos(a.total) || a.centro.localeCompare(b.centro, 'pt-BR'));
}

function somarLado(grupos) {
  return (grupos || []).reduce((s, g) => s + centavos(g.total), 0);
}

async function nomesPlanosFora(db) {
  if (!(await relacaoExiste(db, 'TB_PLANO_CONTAS'))) return [];
  if (!(await temPlanosIgnorados(db))) {
    const reserva = await ler(db, `
      SELECT DISTINCT ${sqlOctets('DESCRICAO', 120)} AS NOME FROM TB_PLANO_CONTAS
      WHERE UPPER(DESCRICAO) CONTAINING 'MERCADORIAS PARA REVENDA'`);
    return (reserva || []).map((r) => texto(r.NOME)).filter(Boolean);
  }
  const rows = await ler(db, `
    SELECT DISTINCT CAST(P.DESCRICAO AS VARCHAR(120) CHARACTER SET OCTETS) AS NOME
    FROM XX_TB_PL_SERV S
    JOIN TB_PLANO_CONTAS P ON P.ID_CTAPLA = S.ID_CTAPLA
    ORDER BY 1`);
  return (rows || []).map((r) => texto(r.NOME)).filter(Boolean);
}

function anexar(appCfg, charset) {
  const opts = { ...buildFbOptions(appCfg || loadAppConfig(), '2.5'), charset };
  return new Promise((resolve, reject) => {
    Firebird.attach(opts, (err, conn) => (err ? reject(err) : resolve(conn)));
  });
}

async function lerRelatorio(db, sql, appCfg) {
  try {
    return await query(db, sql);
  } catch (err) {
    if (!/malformed string/i.test(String(err && err.message || ''))) throw err;
  }
  let ultimo = null;
  for (const charset of ['WIN1252', 'NONE']) {
    let alt = null;
    try {
      alt = await anexar(appCfg, charset);
      return await query(alt, sql);
    } catch (err) {
      ultimo = err;
      if (!/malformed string/i.test(String(err && err.message || ''))) throw err;
    } finally {
      if (alt) await detach(alt);
    }
  }
  throw ultimo || new Error('Falha ao ler o relatório financeiro');
}

function sqlOctets(expr, tam) {
  return `CAST(${expr} AS VARCHAR(${tam}) CHARACTER SET OCTETS)`;
}

async function lerMovimentoDre(db, filtros, usaManage, appCfg) {
  const inicio = parseIso(filtros.inicio);
  const fim = parseIso(filtros.fimExclusivo);
  const leitura = usaManage ? 'manage' : 'clipp';
  /* Sem linha em XX_TB_PL_SERV, NOT IN numa lista vazia deixava passar tudo e
     Mercadorias para Revenda entrava nas despesas pagas (já está no custo das vendas). */
  const fora = await temPlanosIgnorados(db)
    ? 'NOT IN (SELECT ID_CTAPLA FROM XX_TB_PL_SERV)'
    : `NOT IN (SELECT ID_CTAPLA FROM TB_PLANO_CONTAS WHERE UPPER(DESCRICAO) CONTAINING 'MERCADORIAS PARA REVENDA')`;
  const temCentroPag = await colunaExiste(db, 'TB_CONTA_PAGAR', 'CC_CUSTO');
  const temTabelaBanco = await relacaoExiste(db, 'TB_BANCO_CTA_MOVTO');
  const temCentroBanco = temTabelaBanco && await colunaExiste(db, 'TB_BANCO_CTA_MOVTO', 'ID_CCUSTO');
  const colRec = await colunaPlanoTitulo(db, 'TB_CONTA_RECEBER');
  const colPag = await colunaPlanoTitulo(db, 'TB_CONTA_PAGAR');
  /* O Clipp grava o centro escolhido na conta a pagar no rateio TB_CTAPAG_CENTROCUSTOS
     (cadastro TB_CENTRO_CUSTOS), com percentual por centro. CC_CUSTO fica com o padrão
     de TB_CENTRO_CUSTO e só vale quando a conta não tem rateio. */
  const temRateioPag = await relacaoExiste(db, 'TB_CTAPAG_CENTROCUSTOS')
    && await relacaoExiste(db, 'TB_CENTRO_CUSTOS');
  const centroPag = temRateioPag
    ? `COALESCE(${sqlOctets('CCR.DESCRICAO', 80)}, ${temCentroPag ? sqlOctets('CC.NOME', 80) : 'NULL'})`
    : null;
  const valorPag = temRateioPag
    ? 'CASE WHEN R.ID_CTAPAG IS NULL THEN B.VLR_PAGO ELSE CAST(B.VLR_PAGO * COALESCE(R.PERCENTUAL, 0) / 100 AS NUMERIC(18, 2)) END'
    : 'B.VLR_PAGO';
  const joinRateioPag = temRateioPag
    ? `LEFT JOIN TB_CTAPAG_CENTROCUSTOS R ON R.ID_CTAPAG = C.ID_CTAPAG
    LEFT JOIN TB_CENTRO_CUSTOS CCR ON CCR.ID_CC = R.ID_CC`
    : '';
  const centro = (tem, coluna) => (tem
    ? sqlOctets(coluna, 80)
    : 'CAST(NULL AS VARCHAR(80) CHARACTER SET OCTETS)');
  const joinCentro = (tem, coluna) => (tem ? `LEFT JOIN TB_CENTRO_CUSTO CC ON CC.ID = ${coluna}` : '');
  const planoCheio = `
             ${sqlOctets('P.COD_CONTA', 40)} AS CODIGO,
             ${sqlOctets('P.DESCRICAO', 120)} AS PLANO`;
  const planoVazio = `
             CAST(NULL AS VARCHAR(40) CHARACTER SET OCTETS) AS CODIGO,
             CAST(NULL AS VARCHAR(120) CHARACTER SET OCTETS) AS PLANO`;
  const planoDe = (col) => (col ? planoCheio : planoVazio);
  const joinPlano = (col) => (col ? `LEFT JOIN TB_PLANO_CONTAS P ON P.ID_CTAPLA = ${col}` : '');
  let sqlBanco = '';
  if (temTabelaBanco) {
    const colsBanco = await colunasTabela(db, 'TB_BANCO_CTA_MOVTO');
    /* Só entra o movimento com plano próprio. Sem plano, o movimento é espelho de outro
       lançamento (baixa de título, PIX da venda, sangria, abertura/fechamento de caixa) e
       o plano da conta bancária é o próprio caixa, não uma receita ou despesa. Contá-lo
       duplicava o PIX nas entradas e a baixa em lote de 09/11/2026 nas saídas. */
    if (colsBanco.has('ID_CTAPLA') && colsBanco.has('VALOR') && colsBanco.has('DT_MOVTO')) {
      const exprBanco = 'B.ID_CTAPLA';
      const joinConta = '';
      const temContaPlano = await relacaoExiste(db, 'TB_BANCO_CTA') && await colunaExiste(db, 'TB_BANCO_CTA', 'ID_CTAPLA');
      const ligados = [
        colsBanco.has('ID_CONTAS_RECEBER') ? 'AND B.ID_CONTAS_RECEBER IS NULL' : '',
        colsBanco.has('ID_CONTAS_PAGAR') ? 'AND B.ID_CONTAS_PAGAR IS NULL' : '',
        temContaPlano ? 'AND B.ID_CTAPLA NOT IN (SELECT ID_CTAPLA FROM TB_BANCO_CTA WHERE ID_CTAPLA IS NOT NULL)' : '',
      ].join('\n      ');
      const destino = `${colsBanco.has('ID_CTA_DEST') ? 'AND COALESCE(B.ID_CTA_DEST, 0) <> 5' : ''}
      ${ligados}`;
      const historico = colsBanco.has('HISTORICO') ? sqlOctets('B.HISTORICO', 250) : sqlOctets(`''`, 250);
      const semTransf = colsBanco.has('HISTORICO')
        ? `AND COALESCE(B.HISTORICO, '') NOT LIKE 'Transferencia.%'
      AND COALESCE(B.HISTORICO, '') NOT LIKE 'Estorno Transf.%'
      AND COALESCE(B.HISTORICO, '') NOT LIKE 'Estorno de pagamen%'
      AND COALESCE(B.HISTORICO, '') NOT LIKE 'Estorno de Receb%'`
        : '';
      sqlBanco = `
    UNION ALL
    SELECT ${sqlOctets(`CASE WHEN B.VALOR > 0 THEN 'ENTRADAS' ELSE 'SAIDAS' END`, 20)}, ${exprBanco},
           ${planoDe(exprBanco)},
           ${centro(temCentroBanco, 'CC.NOME')},
           ${historico},
           CASE WHEN B.VALOR < 0 THEN B.VALOR * -1 ELSE B.VALOR END, B.DT_MOVTO
    FROM TB_BANCO_CTA_MOVTO B
    ${joinConta}
    ${joinPlano(exprBanco)}
    ${joinCentro(temCentroBanco, 'B.ID_CCUSTO')}
    WHERE B.DT_MOVTO >= '${inicio}' AND B.DT_MOVTO < '${fim}'
      AND ${exprBanco} IS NOT NULL
      ${destino}
      ${semTransf}
      AND (B.VALOR > 0 OR ${exprBanco} ${fora})`;
    }
  }
  const exprRec = colRec ? `C.${colRec}` : 'CAST(NULL AS INTEGER)';
  const exprPag = colPag ? `C.${colPag}` : 'CAST(NULL AS INTEGER)';
  const sql = `
    SELECT ${sqlOctets(`'ENTRADAS'`, 20)} AS TIPO, ${exprRec} AS ID,
           ${planoDe(colRec)},
           ${centro(false, '')} AS CENTRO,
           ${sqlOctets('C.HISTORICO', 250)} AS HISTORICO,
           B.VLR_RECEB AS VALOR, B.DT_BAIXA AS DATA
    FROM TB_CTAREC_BAIXA B
    JOIN TB_CONTA_RECEBER C ON C.ID_CTAREC = B.ID_CTAREC
    ${joinPlano(exprRec)}
    WHERE B.DT_BAIXA >= '${inicio}' AND B.DT_BAIXA < '${fim}'
      AND TRIM(COALESCE(B.TIP_RECBTO, '')) NOT IN ('C', 'B')
      AND TRIM(COALESCE(C.TIP_CTAREC, '')) <> 'E'
    UNION ALL
    SELECT ${sqlOctets(`'SAIDAS'`, 20)}, ${exprPag},
           ${planoDe(colPag)},
           ${centroPag || centro(temCentroPag, 'CC.NOME')},
           ${sqlOctets('C.HISTORICO', 250)},
           ${valorPag}, B.DT_BAIXA
    FROM TB_CTAPAG_BAIXA B
    JOIN TB_CONTA_PAGAR C ON C.ID_CTAPAG = B.ID_CTAPAG
    ${joinPlano(exprPag)}
    ${joinCentro(temCentroPag, 'C.CC_CUSTO')}
    ${joinRateioPag}
    WHERE B.DT_BAIXA >= '${inicio}' AND B.DT_BAIXA < '${fim}'
      AND TRIM(COALESCE(B.TIP_PAGTO, '')) NOT IN ('C', 'B')
      AND TRIM(COALESCE(C.TIP_CTAPAG, '')) <> 'E'
      ${colPag ? `AND C.${colPag} ${fora}` : ''}
    ${sqlBanco}`;
  const rows = await lerRelatorio(db, sql, appCfg);
  /* Receita não tem centro de custo no Clipp: as entradas saem só por plano de contas. */
  const entradas = ladoDre((rows || [])
    .filter((r) => texto(r.TIPO).toUpperCase() === 'ENTRADAS')
    .map((r) => ({ ...r, CENTRO: null })));
  const saidas = ladoDre((rows || []).filter((r) => texto(r.TIPO).toUpperCase() === 'SAIDAS'));
  const totalEntradas = somarLado(entradas);
  const totalSaidas = somarLado(saidas);
  const porCentro = saidas.some((g) => g.centro !== 'Sem centro de custo');
  return {
    leitura,
    totalEntradas: reais(totalEntradas),
    totalSaidas: reais(totalSaidas),
    resultado: reais(totalEntradas - totalSaidas),
    entradas,
    receitas: entradas[0]?.planos || [],
    saidas,
    porCentro,
    planosFora: await nomesPlanosFora(db),
    erro: '',
  };
}

async function temPlanosIgnorados(db) {
  if (!(await relacaoExiste(db, 'XX_TB_PL_SERV'))) return false;
  const rows = await ler(db, 'SELECT FIRST 1 1 AS OK FROM XX_TB_PL_SERV');
  return !!(rows && rows.length);
}

const TITULOS_POR_PLANO = 40;

function exprCartao(coluna) {
  const c = `UPPER(COALESCE(${coluna}, ''))`;
  return `(${c} CONTAINING 'CARTAO' OR ${c} CONTAINING 'CARTÃO' OR ${c} CONTAINING 'CARTÕES')`;
}

/* Títulos em aberto agrupados em centro › plano › título. Cada valor guarda a parte de
   cartão à parte, para a tela ligar e desligar "Considerar cartão" sem nova consulta. */
function agruparTitulos(rows, comCentro) {
  const centros = new Map();
  for (const r of rows || []) {
    const cents = centavos(r.VALOR);
    if (cents <= 0) continue;
    const centro = comCentro ? (texto(r.CENTRO) || 'Sem centro de custo') : '';
    const codigo = texto(r.CODIGO);
    const plano = texto(r.PLANO) || 'Sem plano de contas';
    const cartao = Number(r.CARTAO) === 1;
    if (!centros.has(centro)) centros.set(centro, { centro, total: 0, cartao: 0, planos: new Map() });
    const g = centros.get(centro);
    g.total += cents;
    if (cartao) g.cartao += cents;
    const chave = `${codigo}|${plano}`;
    if (!g.planos.has(chave)) {
      g.planos.set(chave, { codigo: codigo === '0' ? '' : codigo, plano, total: 0, cartao: 0, quantidade: 0, quantidadeCartao: 0, titulos: [] });
    }
    const p = g.planos.get(chave);
    p.total += cents;
    p.quantidade += 1;
    if (cartao) {
      p.cartao += cents;
      p.quantidadeCartao += 1;
    }
    p.titulos.push({
      documento: texto(r.DOCUMENTO),
      historico: texto(r.HISTORICO),
      vencimento: diaMovimento(r.VENC),
      valor: cents,
      cartao,
    });
  }
  const ordem = (a, b) => a.vencimento.localeCompare(b.vencimento) || b.valor - a.valor;
  const fechaPlano = (p) => {
    const sem = p.titulos.filter((t) => !t.cartao).sort(ordem).slice(0, TITULOS_POR_PLANO);
    const com = p.titulos.filter((t) => t.cartao).sort(ordem).slice(0, TITULOS_POR_PLANO);
    return {
      codigo: p.codigo,
      plano: p.plano,
      total: reais(p.total),
      cartao: reais(p.cartao),
      quantidade: p.quantidade,
      quantidadeCartao: p.quantidadeCartao,
      titulos: [...sem, ...com].sort(ordem).map((t) => ({ ...t, valor: reais(t.valor) })),
    };
  };
  return [...centros.values()]
    .map((g) => ({
      centro: g.centro,
      total: reais(g.total),
      cartao: reais(g.cartao),
      planos: [...g.planos.values()].map(fechaPlano).sort((a, b) => b.total - a.total),
    }))
    .sort((a, b) => b.total - a.total);
}

async function aRealizar(db, filtros, appCfg) {
  const inicio = parseIso(filtros.inicio);
  const fim = parseIso(filtros.fimExclusivo);
  const vazio = { total: 0, cartao: 0, quantidade: 0, quantidadeCartao: 0 };
  const resultado = {
    receber: { total: 0, cartao: 0, planos: [] },
    vencidosReceber: { ...vazio },
    pagar: { total: 0, centros: [] },
    vencidosPagar: { ...vazio },
  };
  const planoDe = (col) => (col
    ? `${sqlOctets('P.COD_CONTA', 40)} AS CODIGO, ${sqlOctets('P.DESCRICAO', 120)} AS PLANO`
    : 'CAST(NULL AS VARCHAR(40) CHARACTER SET OCTETS) AS CODIGO, CAST(NULL AS VARCHAR(120) CHARACTER SET OCTETS) AS PLANO');
  const joinPlano = (col) => (col ? `LEFT JOIN TB_PLANO_CONTAS P ON P.ID_CTAPLA = C.${col}` : '');

  const [fonteRec] = await fontesContaReceber(db, 0);
  if (fonteRec) {
    const col = await colunaPlanoTitulo(db, fonteRec.conta);
    const saldo = sqlRestante('C', fonteRec);
    const cartao = exprCartao('C.HISTORICO');
    const base = `FROM ${fonteRec.conta} C
      ${joinPlano(col)}
      WHERE TRIM(COALESCE(C.TIP_CTAREC, '')) <> 'C'
        AND ${saldo} > 0.009`;
    const rows = await lerRelatorio(db, `
      SELECT ${planoDe(col)},
             ${sqlOctets('C.DOCUMENTO', 40)} AS DOCUMENTO,
             ${sqlOctets('C.HISTORICO', 250)} AS HISTORICO,
             C.DT_VENCTO AS VENC, ${saldo} AS VALOR,
             CASE WHEN ${cartao} THEN 1 ELSE 0 END AS CARTAO
      ${base}
        AND C.DT_VENCTO >= '${inicio}' AND C.DT_VENCTO < '${fim}'`, appCfg);
    const [grupo] = agruparTitulos(rows, false);
    if (grupo) resultado.receber = { total: grupo.total, cartao: grupo.cartao, planos: grupo.planos };
    const venc = await lerRelatorio(db, `
      SELECT COUNT(*) AS QTD, SUM(${saldo}) AS VALOR,
             SUM(CASE WHEN ${cartao} THEN 1 ELSE 0 END) AS QTD_CARTAO,
             SUM(CASE WHEN ${cartao} THEN ${saldo} ELSE 0 END) AS VALOR_CARTAO
      ${base}
        AND C.DT_VENCTO < '${inicio}'`, appCfg);
    const v = venc && venc[0];
    if (v) {
      resultado.vencidosReceber = {
        total: reais(centavos(v.VALOR)),
        cartao: reais(centavos(v.VALOR_CARTAO)),
        quantidade: inteiro(v.QTD),
        quantidadeCartao: inteiro(v.QTD_CARTAO),
      };
    }
  }

  if (await relacaoExiste(db, 'TB_CONTA_PAGAR') && await relacaoExiste(db, 'TB_CTAPAG_BAIXA')) {
    const col = await colunaPlanoTitulo(db, 'TB_CONTA_PAGAR');
    const colsBaixa = await colunasTabela(db, 'TB_CTAPAG_BAIXA');
    const pago = `COALESCE((SELECT SUM(${exprValorBaixa(colsBaixa, 'VLR_PAGO')}) FROM TB_CTAPAG_BAIXA B
        WHERE B.ID_CTAPAG = C.ID_CTAPAG AND TRIM(COALESCE(B.TIP_PAGTO, '')) = 'T'), 0)`;
    const saldoCheio = `(COALESCE(C.VLR_CTAPAG, 0) - ${pago})`;
    const temRateio = await relacaoExiste(db, 'TB_CTAPAG_CENTROCUSTOS') && await relacaoExiste(db, 'TB_CENTRO_CUSTOS');
    const temCentro = await colunaExiste(db, 'TB_CONTA_PAGAR', 'CC_CUSTO') && await relacaoExiste(db, 'TB_CENTRO_CUSTO');
    const centroExpr = temRateio
      ? `COALESCE(${sqlOctets('CCR.DESCRICAO', 80)}, ${temCentro ? sqlOctets('CC.NOME', 80) : 'NULL'})`
      : (temCentro ? sqlOctets('CC.NOME', 80) : 'CAST(NULL AS VARCHAR(80) CHARACTER SET OCTETS)');
    const saldo = temRateio
      ? `CASE WHEN R.ID_CTAPAG IS NULL THEN ${saldoCheio} ELSE ${saldoCheio} * COALESCE(R.PERCENTUAL, 0) / 100 END`
      : saldoCheio;
    const joins = `
      ${joinPlano(col)}
      ${temCentro ? 'LEFT JOIN TB_CENTRO_CUSTO CC ON CC.ID = C.CC_CUSTO' : ''}
      ${temRateio ? `LEFT JOIN TB_CTAPAG_CENTROCUSTOS R ON R.ID_CTAPAG = C.ID_CTAPAG
      LEFT JOIN TB_CENTRO_CUSTOS CCR ON CCR.ID_CC = R.ID_CC` : ''}`;
    const base = `FROM TB_CONTA_PAGAR C
      ${joins}
      WHERE TRIM(COALESCE(C.TIP_CTAPAG, '')) <> 'C'
        AND ${saldoCheio} > 0.009`;
    const rows = await lerRelatorio(db, `
      SELECT ${centroExpr} AS CENTRO, ${planoDe(col)},
             ${sqlOctets('C.DOCUMENTO', 40)} AS DOCUMENTO,
             ${sqlOctets('C.HISTORICO', 250)} AS HISTORICO,
             C.DT_VENCTO AS VENC, ${saldo} AS VALOR, 0 AS CARTAO
      ${base}
        AND C.DT_VENCTO >= '${inicio}' AND C.DT_VENCTO < '${fim}'`, appCfg);
    const centros = agruparTitulos(rows, true);
    resultado.pagar = { total: reais(centros.reduce((s, g) => s + centavos(g.total), 0)), centros };
    const venc = await lerRelatorio(db, `
      SELECT COUNT(DISTINCT C.ID_CTAPAG) AS QTD, SUM(${saldo}) AS VALOR
      ${base}
        AND C.DT_VENCTO < '${inicio}'`, appCfg);
    const v = venc && venc[0];
    if (v) resultado.vencidosPagar = { ...vazio, total: reais(centavos(v.VALOR)), quantidade: inteiro(v.QTD) };
  }
  return resultado;
}

const TOP_PRODUTOS = 10;

async function nomesVendedores(db) {
  const mapa = new Map();
  if (!(await relacaoExiste(db, 'TB_FUNCIONARIO'))) return mapa;
  const rows = await ler(db, `SELECT ID_FUNCIONARIO AS ID, ${sqlOctets('NOME', 80)} AS NOME FROM TB_FUNCIONARIO`);
  for (const r of rows || []) mapa.set(String(r.ID), texto(r.NOME));
  return mapa;
}

/* Aba Vendas: fiscal + gerencial do Clipp, com custo e lucro bruto, vendedor e produto. */
async function vendasDetalhe(db, usaManage, filtros) {
  const vendedores = new Map();
  const produtos = new Map();
  for (const fonte of fontesVendaEscopo(usaManage, filtros).filter((f) => !f.manage)) {
    const classif = sqlClassificacao(fonte, filtros, true);
    const de = `FROM ${fonte.item} I
      JOIN ${fonte.nota} N ON N.${fonte.id} = I.${fonte.id}
      ${classif.join}
      WHERE ${predNota('venda', filtros, fonte)}
        AND ${predItem('venda')}
        ${classif.where}`;
    const porVendedor = await lerFonte(db, fonte, (f) => `
      SELECT N.ID_VENDEDOR AS ID, COUNT(DISTINCT N.${f.id}) AS NOTAS,
             SUM(${sqlValor(f)}) AS VALOR, SUM(${sqlCustoLinha(f)}) AS CUSTO
      ${de}
      GROUP BY N.ID_VENDEDOR`);
    for (const r of porVendedor || []) {
      const id = r.ID == null ? '' : String(r.ID);
      const v = vendedores.get(id) || { id, notas: 0, valor: 0, custo: 0 };
      v.notas += inteiro(r.NOTAS);
      v.valor += centavos(r.VALOR);
      v.custo += centavos(r.CUSTO);
      vendedores.set(id, v);
    }
    const porProduto = await lerFonte(db, fonte, (f) => `
      SELECT COALESCE(IDF.ID_ESTOQUE, 0) AS ID,
             ${sqlOctets('MAX(EST.DESCRICAO)', 120)} AS NOME,
             MAX(TRIM(I.UNI_MEDIDA)) AS UN,
             SUM(COALESCE(I.QTD_ITEM, 0)) AS QTD,
             SUM(${sqlValor(f)}) AS VALOR, SUM(${sqlCustoLinha(f)}) AS CUSTO
      ${de}
      GROUP BY COALESCE(IDF.ID_ESTOQUE, 0)`);
    for (const r of porProduto || []) {
      const id = String(r.ID);
      const p = produtos.get(id) || { nome: texto(r.NOME) || 'Sem cadastro', un: String(r.UN || '').trim(), qtd: 0, valor: 0, custo: 0 };
      p.qtd += Number(r.QTD) || 0;
      p.valor += centavos(r.VALOR);
      p.custo += centavos(r.CUSTO);
      produtos.set(id, p);
    }
  }

  const nomes = await nomesVendedores(db);
  const lista = [...vendedores.values()];
  const valor = lista.reduce((s, v) => s + v.valor, 0);
  const custo = lista.reduce((s, v) => s + v.custo, 0);
  const notas = lista.reduce((s, v) => s + v.notas, 0);
  const pctDe = (parte, todo) => (todo ? Math.round((10000 * parte) / todo) / 100 : 0);
  const rankVend = lista
    .map((v) => ({
      nome: nomes.get(v.id) || (v.id ? `Vendedor ${v.id}` : 'Sem vendedor'),
      notas: v.notas,
      valor: reais(v.valor),
      custo: reais(v.custo),
      lucro: reais(v.valor - v.custo),
      ticket: v.notas ? reais(Math.round(v.valor / v.notas)) : 0,
      participacao: pctDe(v.valor, valor),
    }))
    .sort((a, b) => b.valor - a.valor);
  const prods = [...produtos.values()].map((p) => ({
    nome: p.nome,
    unidade: p.un,
    quantidade: Math.round(p.qtd * 1000) / 1000,
    valor: reais(p.valor),
    lucro: reais(p.valor - p.custo),
  }));

  const situacao = { C: { notas: 0, valor: 0 }, X: { notas: 0, valor: 0 } };
  const modelos = filtros.modelosVenda && filtros.modelosVenda.length
    ? `AND UPPER(TRIM(N.NF_MODELO)) IN (${listaSql(filtros.modelosVenda)})`
    : '';
  const fora = await ler(db, `
    SELECT TRIM(N.STATUS) AS STATUS, COUNT(DISTINCT N.ID_NFVENDA) AS NOTAS,
           SUM(COALESCE(I.VLR_TOTAL, 0) - COALESCE(I.VLR_DESC, 0)) AS VALOR
    FROM TB_NFVENDA N
    LEFT JOIN TB_NFV_ITEM I ON I.ID_NFVENDA = N.ID_NFVENDA
    WHERE N.STATUS IN ('C', 'X')
      AND N.DT_EMISSAO >= '${filtros.inicio}' AND N.DT_EMISSAO < '${filtros.fimExclusivo}'
      ${modelos}
    GROUP BY TRIM(N.STATUS)`);
  for (const r of fora || []) {
    const s = situacao[String(r.STATUS || '').trim()];
    if (s) {
      s.notas = inteiro(r.NOTAS);
      s.valor = reais(centavos(r.VALOR));
    }
  }

  return {
    valorVendido: reais(valor),
    custo: reais(custo),
    lucroBruto: reais(valor - custo),
    margemPct: pctDe(valor - custo, valor),
    notasVenda: notas,
    ticketMedio: notas ? reais(Math.round(valor / notas)) : 0,
    cancelamentos: situacao.C,
    inutilizacoes: situacao.X,
    vendedores: rankVend,
    maisVendidos: [...prods].sort((a, b) => b.valor - a.valor).slice(0, TOP_PRODUTOS),
    maisLucro: [...prods].sort((a, b) => b.lucro - a.lucro).slice(0, TOP_PRODUTOS),
  };
}

async function consultarFinanceiro(db, filtros, ignorarCartao, usaManage, appCfg) {
  void ignorarCartao;
  try {
    return await lerMovimentoDre(db, filtros, usaManage, appCfg);
  } catch (err) {
    return {
      leitura: usaManage ? 'manage' : 'clipp',
      totalEntradas: 0,
      totalSaidas: 0,
      resultado: 0,
      entradas: [],
      saidas: [],
      porCentro: false,
      planosFora: [],
      erro: err.message || 'Falha ao ler o financeiro',
    };
  }
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

/* Série de receitas x despesas do ano (mesma do gráfico do Financeiro). */
async function serieReceitasDespesas(db, filtros, usaManage, usaGr, ignorarCartao) {
  const filtrosIniciais = filtrosDaAba(filtros, usaManage ? 'manage' : 'resumo', usaManage, usaGr);
  return usaManage
    ? porMesFinanceiro(db, filtrosIniciais, ignorarCartao, usaManage)
    : porMes(db, usaManage, filtrosIniciais);
}

async function consultarReceitasDespesas(db, opcoes = {}) {
  const usaManage = opcoes.usaManage === undefined
    ? lerUsaManage(opcoes.appCfg || loadAppConfig())
    : (Number(opcoes.usaManage) === 1 ? 1 : 0);
  const filtros = montarFiltros(opcoes, 'PADRAO');
  const usaGr = await empresaUsaGr(db);
  const appCfg = opcoes.appCfg || loadAppConfig();
  const ignorarCartao = Number(appCfg.ignorar_receber_cartao) === 1;
  return {
    ano: String(filtros.inicio || isoHoje()).slice(0, 4),
    porMes: await serieReceitasDespesas(db, filtros, usaManage, usaGr, ignorarCartao),
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
  /* Resumo (cards e recortes), Vendas (fiscal + gerencial com custo, vendedor e produto)
     e Financeiro (realizado, a realizar e receitas x despesas). NFe+NFCe saiu da tela e
     Despesa x Receita foi para dentro do Financeiro. */
  const abas = [];
  if (usaManage) abas.push('manage');
  if (usaGr || !usaManage) abas.push('resumo', 'vendas');
  if (opcoes.servicos === true) abas.push('servicos');
  abas.push('financeiro');
  const pedida = String(opcoes.aba || '').trim().toLowerCase();
  const aba = abas.includes(pedida) ? pedida : abas[0];
  const appCfg = opcoes.appCfg || loadAppConfig();
  const ignorarCartao = Number(appCfg.ignorar_receber_cartao) === 1;
  const cabecalho = {
    perfil,
    usaManage,
    usaGr,
    aba,
    abas,
    fiscal: false,
    periodo: { inicio: filtros.inicio, fim: filtros.fim },
    ano: String(filtros.inicio || '').slice(0, 4),
    vazio: false,
    mensagem: '',
  };
  if (aba === 'financeiro') {
    const fin = await consultarFinanceiro(db, filtros, ignorarCartao, usaManage, appCfg);
    let realizar = null;
    let erroRealizar = '';
    try {
      realizar = await aRealizar(db, filtros, appCfg);
    } catch (err) {
      erroRealizar = err.message || 'Falha ao ler as contas em aberto';
    }
    const serieMensal = await serieReceitasDespesas(db, filtros, usaManage, usaGr, ignorarCartao);
    return {
      ...cabecalho,
      ...fin,
      aRealizar: realizar,
      erroRealizar,
      considerarCartao: !ignorarCartao,
      porMes: serieMensal,
    };
  }
  if (aba === 'servicos') {
    const dados = await require('./os-relatorios').dashboardServicos(db, {
      inicio: filtros.inicio, fim: filtros.fim, status: opcoes.status, tipo: opcoes.tipoOs, tecnico: opcoes.tecnico,
    });
    return { ...cabecalho, ...dados, vazio: false };
  }
  if (aba === 'vendas') {
    const filtrosVendas = filtrosDaAba(filtros, aba, usaManage, usaGr);
    const detalhe = await vendasDetalhe(db, usaManage, filtrosVendas);
    return {
      ...cabecalho,
      ...detalhe,
      vazio: detalhe.valorVendido === 0 && !detalhe.cancelamentos.notas,
      mensagem: detalhe.valorVendido === 0 ? 'Nenhuma venda no período' : '',
    };
  }
  const filtrosAba = filtrosDaAba(filtros, aba, usaManage, usaGr);
  const t = await totais(db, usaManage, filtrosAba, aba === 'fiscal' ? 'vendas' : 'ambos');
  const comprasFiscal = aba === 'fiscal' ? await totais(db, usaManage, filtrosAba, 'compras') : null;
  let vendidoDia = 0;
  let vendidoMes = 0;
  let vendidoDiaComFrete = 0;
  let vendidoMesComFrete = 0;
  {
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
  let servicosPeriodo = null;
  if (opcoes.servicos === true) {
    try {
      servicosPeriodo = await require('./os-relatorios').faturamentoServicos(db, filtros.inicio, filtros.fim);
    } catch {
      servicosPeriodo = null;
    }
  }
  const gruposVenda = await porGrupo(db, usaManage, filtrosAba, 'vendas');
  const gruposCompra = await porGrupo(db, usaManage, filtrosAba, 'compras');
  const pagamento = await porPagamento(db, usaManage, filtrosAba, t.devolucaoVenda);
  const serieMensal = aba === 'fiscal' ? await porMes(db, usaManage, filtrosAba) : [];
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
    ...(comprasFiscal ? {
      totalComprado: reais(comprasFiscal.totalComprado),
      notasEntrada: comprasFiscal.compras.notas,
      quantidadeComprada: reais(comprasFiscal.compras.qtd),
    } : {}),
    vendidoDia,
    vendidoMes,
    vendidoDiaComFrete,
    vendidoMesComFrete,
    porGrupoVenda: gruposVenda,
    porGrupoCompra: gruposCompra,
    porPagamento: pagamento,
    porMes: serieMensal,
    servicosPeriodo,
    vazio: vazio && !(servicosPeriodo && servicosPeriodo.valor),
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
  consultarReceitasDespesas,
  detalharDashboard,
  lerUsaManage,
  periodoAnterior,
  INDICES_SUGERIDOS,
  CFOP_EXCLUIR,
  CFOP_DEVOLUCAO,
  CFOP_COMPRA,
};
