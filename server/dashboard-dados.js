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

function fontesCompra(usaManage) {
  return usaManage ? FONTES_COMPRA : FONTES_COMPRA.filter((f) => !f.manage);
}

function joinsValor(fonte) {
  const partes = [];
  if (fonte.st) partes.push(`LEFT JOIN ${fonte.st} ST ON ST.${fonte.idItem} = I.${fonte.idItem}`);
  if (fonte.ipi) partes.push(`LEFT JOIN ${fonte.ipi} IPI ON IPI.${fonte.idItem} = I.${fonte.idItem}`);
  if (fonte.fcp) partes.push(`LEFT JOIN ${fonte.fcp} FCP ON FCP.${fonte.idItem} = I.${fonte.idItem}`);
  return partes.join('\n');
}

function sqlValor(fonte) {
  let st = '0';
  if (fonte.st && fonte.stNoItem) st = 'COALESCE(ST.VLR_ST, I.VLR_ST, 0)';
  else if (fonte.st) st = 'COALESCE(ST.VLR_ST, 0)';
  else if (fonte.stNoItem) st = 'COALESCE(I.VLR_ST, 0)';
  let ipi = '0';
  if (fonte.ipi && fonte.ipiNoItem) ipi = 'COALESCE(IPI.VLR_IPI, I.VLR_IPI, 0)';
  else if (fonte.ipi) ipi = 'COALESCE(IPI.VLR_IPI, 0)';
  else if (fonte.ipiNoItem) ipi = 'COALESCE(I.VLR_IPI, 0)';
  const fcp = fonte.fcp ? 'COALESCE(FCP.VLR_FCP_ST, 0)' : '0';
  return `(COALESCE(I.VLR_TOTAL, 0) - COALESCE(I.VLR_DESC, 0) + COALESCE(I.VLR_FRETE, 0) + COALESCE(I.VLR_SEGURO, 0) + COALESCE(I.VLR_DESPESA, 0) + ${st} + ${ipi} + ${fcp})`;
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

const SQL_TIPO = `TRIM(CASE
  WHEN TRIM(COALESCE(EST.ID_TIPOITEM, '')) = '9' THEN 'servico'
  WHEN TRIM(COALESCE(EST.ID_TIPOITEM, '')) IN ('', '99') THEN 'outros'
  ELSE 'produto'
END)`;

function predNota(tipo, filtros, fonte) {
  const dataCol = tipo === 'compra' ? 'N.DT_ENTRADA' : 'N.DT_EMISSAO';
  const modelos = tipo === 'compra' ? filtros.modelosCompra : filtros.modelosVenda;
  const partes = [
    `N.STATUS = 'E'`,
    `${dataCol} >= '${filtros.inicio}'`,
    `${dataCol} < '${filtros.fimExclusivo}'`,
  ];
  if (tipo === 'venda') {
    partes.push(`NOT (N.NF_MODELO = 'GR' AND EXISTS (SELECT 1 FROM TB_GR_CONVERTIDO G WHERE G.ID_NFVENDA = N.ID_NFVENDA))`);
    if (filtros.excluirConvertidas && fonte && !fonte.manage) {
      partes.push(`NOT EXISTS (SELECT 1 FROM TB_GR_CONVERTIDO G WHERE G.ID_NFVENDA = N.${fonte.id})`);
    }
  }
  if (modelos && modelos.length) {
    partes.push(`N.NF_MODELO IN (${listaSql(modelos)})`);
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
  const sql = `
    SELECT TRIM(N.NF_MODELO) AS MODELO,
           COUNT(DISTINCT N.${fonte.id}) AS NOTAS,
           SUM(${sqlValor(fonte)}) AS VALOR,
           SUM(COALESCE(I.QTD_ITEM, 0)) AS QTD,
           COUNT(*) AS ITENS
    FROM ${fonte.item} I
    JOIN ${fonte.nota} N ON N.${fonte.id} = I.${fonte.id}
    ${joinsValor(fonte)}
    ${classif.join}
    WHERE ${predNota(tipo, filtros, fonte)}
      AND ${predItem(modo)}
      ${classif.where}
    GROUP BY TRIM(N.NF_MODELO)`;
  return ler(db, sql);
}

async function totais(db, usaManage, filtros, escopo) {
  const vendas = { fiscal: 0, gerencial: 0, manage: 0, nfce: 0, nfe: 0, notas: 0, itens: 0, qtd: 0 };
  const compras = { valor: 0, notas: 0, itens: 0, qtd: 0 };
  let devolucaoVenda = 0;
  let devolucaoCompra = 0;

  if (escopo !== 'compras') {
    for (const fonte of fontesVendaEscopo(usaManage, filtros)) {
      const positivas = await somar(db, fonte, filtros, 'venda', 'venda');
      if (positivas) {
        for (const r of positivas) {
          vendas[bucketModelo(r.MODELO, fonte.manage)] += centavos(r.VALOR);
          const modelo = String(r.MODELO || '').trim();
          if (modelo === '65') vendas.nfce += centavos(r.VALOR);
          if (modelo === '55') vendas.nfe += centavos(r.VALOR);
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
    for (const fonte of fontesCompra(usaManage)) {
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
      if (dev) for (const r of dev) devolucaoVenda += centavos(r.VALOR);
    }
  }

  return {
    vendas,
    compras,
    devolucaoVenda,
    devolucaoCompra,
    totalVendido: vendas.fiscal + vendas.gerencial + vendas.manage - devolucaoVenda,
    totalComprado: compras.valor - devolucaoCompra,
  };
}

function variacao(atual, anterior) {
  if (!anterior) return null;
  return Math.round((10000 * (atual - anterior)) / anterior) / 100;
}

async function agregarGrupo(db, fonte, filtros, tipo, modo, sinal) {
  const classif = sqlClassificacao(fonte, filtros, true);
  const sql = `
    SELECT COALESCE(EST.ID_GRUPO, 0) AS ID_GRUPO,
           COALESCE(TRIM(GRP.DESCRICAO), 'Sem grupo') AS DESCRICAO,
           SUM(${sqlValor(fonte)}) AS VALOR,
           SUM(COALESCE(I.QTD_ITEM, 0)) AS QTD,
           COUNT(DISTINCT N.${fonte.id}) AS NOTAS
    FROM ${fonte.item} I
    JOIN ${fonte.nota} N ON N.${fonte.id} = I.${fonte.id}
    ${joinsValor(fonte)}
    ${classif.join}
    WHERE ${predNota(tipo, filtros, fonte)}
      AND ${predItem(modo)}
      ${classif.where}
    GROUP BY COALESCE(EST.ID_GRUPO, 0), COALESCE(TRIM(GRP.DESCRICAO), 'Sem grupo')`;
  const lista = await ler(db, sql);
  return (lista || []).map((r) => ({
    id: inteiro(r.ID_GRUPO),
    descricao: String(r.DESCRICAO || 'Sem grupo').trim() || 'Sem grupo',
    valor: sinal * centavos(r.VALOR),
    qtd: sinal * centavos(r.QTD),
    notas: sinal * inteiro(r.NOTAS),
  }));
}

function juntarGrupo(listas) {
  const map = new Map();
  for (const item of listas.flat()) {
    const chave = `${item.id}|${item.descricao}`;
    const atual = map.get(chave) || { id: item.id, grupo: item.descricao, valor: 0, quantidade: 0, notas: 0 };
    atual.valor += item.valor;
    atual.quantidade += item.qtd;
    atual.notas += item.notas;
    map.set(chave, atual);
  }
  const rows = [...map.values()].map((r) => ({
    id: r.id,
    grupo: r.grupo,
    valor: reais(r.valor),
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
      listas.push(await agregarGrupo(db, fonte, filtros, 'venda', 'venda', 1));
    }
    for (const fonte of fontesCompra(usaManage)) {
      listas.push(await agregarGrupo(db, fonte, filtros, 'compra', 'devolucao_venda', -1));
    }
  } else {
    for (const fonte of fontesCompra(usaManage)) {
      listas.push(await agregarGrupo(db, fonte, filtros, 'compra', 'compra', 1));
    }
    for (const fonte of fontesVendaEscopo(usaManage, filtros)) {
      listas.push(await agregarGrupo(db, fonte, filtros, 'venda', 'devolucao_compra', -1));
    }
  }
  return juntarGrupo(listas);
}

async function porTipo(db, usaManage, filtros) {
  const map = new Map();
  const evolucao = new Map();
  function somaTipo(tipo, valor, itens, notas) {
    const atual = map.get(tipo) || { tipo, valor: 0, itens: 0, notas: 0 };
    atual.valor += valor;
    atual.itens += itens;
    atual.notas += notas;
    map.set(tipo, atual);
  }
  for (const fonte of fontesVendaEscopo(usaManage, filtros)) {
    const classif = sqlClassificacao(fonte, filtros, true);
    const sql = `
      SELECT ${SQL_TIPO} AS TIPO,
             CAST(N.DT_EMISSAO AS DATE) AS DIA,
             SUM(${sqlValor(fonte)}) AS VALOR,
             COUNT(*) AS ITENS,
             COUNT(DISTINCT N.${fonte.id}) AS NOTAS
      FROM ${fonte.item} I
      JOIN ${fonte.nota} N ON N.${fonte.id} = I.${fonte.id}
    ${joinsValor(fonte)}
      ${classif.join}
      WHERE ${predNota('venda', filtros, fonte)}
        AND ${predItem('venda')}
        ${classif.where}
      GROUP BY ${SQL_TIPO}, CAST(N.DT_EMISSAO AS DATE)`;
    const lista = await ler(db, sql);
    for (const r of lista || []) {
      const tipo = String(r.TIPO || 'outros').trim() || 'outros';
      const valor = centavos(r.VALOR);
      somaTipo(tipo, valor, inteiro(r.ITENS), inteiro(r.NOTAS));
      const dia = diaIso(r.DIA);
      const chave = `${dia}|${tipo}`;
      evolucao.set(chave, (evolucao.get(chave) || 0) + valor);
    }
  }
  for (const fonte of fontesCompra(usaManage)) {
    const classif = sqlClassificacao(fonte, filtros, true);
    const sql = `
      SELECT ${SQL_TIPO} AS TIPO,
             SUM(${sqlValor(fonte)}) AS VALOR,
             COUNT(*) AS ITENS
      FROM ${fonte.item} I
      JOIN ${fonte.nota} N ON N.${fonte.id} = I.${fonte.id}
    ${joinsValor(fonte)}
      ${classif.join}
      WHERE ${predNota('compra', filtros)}
        AND ${predItem('devolucao_venda')}
        ${classif.where}
      GROUP BY ${SQL_TIPO}`;
    const lista = await ler(db, sql);
    for (const r of lista || []) somaTipo(String(r.TIPO || 'outros').trim() || 'outros', -centavos(r.VALOR), -inteiro(r.ITENS), 0);
  }
  const rows = [...map.values()];
  const total = rows.reduce((a, r) => a + r.valor, 0);
  return {
    itens: rows
      .map((r) => ({
        tipo: r.tipo,
        valor: reais(r.valor),
        itens: r.itens,
        vendas: r.notas,
        participacao: total ? Math.round((10000 * r.valor) / total) / 100 : 0,
      }))
      .sort((a, b) => b.valor - a.valor),
    evolucao: [...evolucao.entries()]
      .map(([chave, valor]) => {
        const [dia, tipo] = chave.split('|');
        return { dia, tipo, valor: reais(valor) };
      })
      .sort((a, b) => a.dia.localeCompare(b.dia) || a.tipo.localeCompare(b.tipo)),
  };
}

async function porNcm(db, usaManage, filtros) {
  const map = new Map();
  function add(ncm, cents) {
    const codigo = String(ncm || '').trim() || 'Sem NCM';
    map.set(codigo, (map.get(codigo) || 0) + cents);
  }
  async function lado(fonte, tipo, modo, sinal) {
    const classif = sqlClassificacao(fonte, filtros, true);
    const lista = await ler(db, `
      SELECT COALESCE(TRIM(PRD.COD_NCM), '') AS NCM,
             SUM(${sqlValor(fonte)}) AS VALOR
      FROM ${fonte.item} I
      JOIN ${fonte.nota} N ON N.${fonte.id} = I.${fonte.id}
      ${joinsValor(fonte)}
      ${classif.join}
      WHERE ${predNota(tipo, filtros, fonte)}
        AND ${predItem(modo)}
        ${classif.where}
      GROUP BY COALESCE(TRIM(PRD.COD_NCM), '')`);
    for (const r of lista || []) add(r.NCM, sinal * centavos(r.VALOR));
  }
  for (const fonte of fontesVendaEscopo(usaManage, filtros)) {
    await lado(fonte, 'venda', 'venda', 1);
  }
  for (const fonte of fontesCompra(usaManage)) {
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
    const notas = await ler(db, `
      SELECT N.${fonte.id} AS ID, N.ID_FMAPGTO AS FORMA, SUM(${sqlValor(fonte)}) AS VALOR
      FROM ${fonte.item} I
      JOIN ${fonte.nota} N ON N.${fonte.id} = I.${fonte.id}
    ${joinsValor(fonte)}
      ${classif.join}
      WHERE ${predNota('venda', filtros, fonte)}
        AND ${predItem('venda')}
        ${classif.where}
      GROUP BY N.${fonte.id}, N.ID_FMAPGTO`);
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
    const lista = await ler(db, `
      SELECT CAST(${dataCol} AS DATE) AS DIA, SUM(${sqlValor(fonte)}) AS VALOR
      FROM ${fonte.item} I
      JOIN ${fonte.nota} N ON N.${fonte.id} = I.${fonte.id}
      ${joinsValor(fonte)}
      ${classif.join}
      WHERE ${predNota(tipo, filtros, fonte)}
        AND ${predItem(modo)}
        ${classif.where}
      GROUP BY CAST(${dataCol} AS DATE)`);
    for (const r of lista || []) celula(r.DIA)[campo] += sinal * centavos(r.VALOR);
  }
  for (const fonte of fontesVendaEscopo(usaManage, filtros)) {
    await acumular(fonte, 'venda', 'venda', 'vendido', 1);
    await acumular(fonte, 'venda', 'devolucao_compra', 'comprado', -1);
  }
  for (const fonte of fontesCompra(usaManage)) {
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
    const lista = await ler(db, `
      SELECT EXTRACT(MONTH FROM CAST(${dataCol} AS DATE)) AS MES, SUM(${sqlValor(fonte)}) AS VALOR
      FROM ${fonte.item} I
      JOIN ${fonte.nota} N ON N.${fonte.id} = I.${fonte.id}
      ${joinsValor(fonte)}
      ${classif.join}
      WHERE ${predNota(tipo, filtrosAno, fonte)}
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
  for (const fonte of fontesCompra(usaManage)) {
    await acumular(fonte, 'compra', 'compra', 'comprado', 1);
    await acumular(fonte, 'compra', 'devolucao_venda', 'vendido', -1);
  }
  return meses.map((r) => ({ mes: r.mes, nome: r.nome, vendido: reais(r.vendido), comprado: reais(r.comprado) }));
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
    const lista = await ler(db, `
      SELECT N.NF_NUMERO AS NOTA, ${dataCol} AS DATA, I.NUM_ITEM AS ITEM,
             COALESCE(TRIM(PRD.COD_NCM), '') AS NCM,
             COALESCE(I.QTD_ITEM, 0) AS QTD,
             ${sqlValor(fonte)} AS VALOR
      FROM ${fonte.item} I
      JOIN ${fonte.nota} N ON N.${fonte.id} = I.${fonte.id}
      ${joinsValor(fonte)}
      ${classif.join}
      WHERE ${predNota(tipo, filtros, fonte)}
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
  for (const fonte of fontesCompra(usaManage)) {
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
    return {
      ...base,
      grupoId: null,
      tipoItem: '',
      ncm: '',
      inicio: `${hoje.slice(0, 8)}01`,
      fim: hoje,
      fimExclusivo: addDias(hoje, 1),
      modelosVenda: MODELOS_FISCAIS,
      modelosCompra: MODELOS_FISCAIS,
      dia: hoje,
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
    const diaFiltro = { ...filtros, inicio: filtros.dia, fim: filtros.dia, fimExclusivo: addDias(filtros.dia, 1) };
    const dia = await totais(db, usaManage, diaFiltro, 'compras');
    const mes = await totais(db, usaManage, filtros, 'compras');
    const grupos = await porGrupo(db, usaManage, filtros, 'compras');
    const vazio = dia.totalComprado === 0 && mes.totalComprado === 0;
    return {
      perfil,
      usaManage,
      fiscal: true,
      periodo: { inicio: filtros.inicio, fim: filtros.fim },
      entradasDia: reais(dia.totalComprado),
      entradasMes: reais(mes.totalComprado),
      notasDia: dia.compras.notas,
      notasMes: mes.compras.notas,
      porGrupo: grupos,
      vazio,
      mensagem: vazio ? 'Nenhuma movimentação no período' : '',
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
  const pedida = String(opcoes.aba || '').trim().toLowerCase();
  const aba = abas.includes(pedida) ? pedida : (usaManage ? 'manage' : 'vendas');
  const filtrosAba = filtrosDaAba(filtros, aba, usaManage, usaGr);
  const t = await totais(db, usaManage, filtrosAba, aba === 'fiscal' ? 'vendas' : 'ambos');
  let vendidoDia = 0;
  let vendidoMes = 0;
  if (aba === 'fiscal') {
    const hoje = isoHoje();
    const diaFiltro = { ...filtrosAba, inicio: hoje, fim: hoje, fimExclusivo: addDias(hoje, 1) };
    const mesFiltro = { ...filtrosAba, inicio: `${hoje.slice(0, 8)}01`, fim: hoje, fimExclusivo: addDias(hoje, 1) };
    const dia = await totais(db, usaManage, diaFiltro, 'vendas');
    const mes = await totais(db, usaManage, mesFiltro, 'vendas');
    vendidoDia = reais(dia.totalVendido);
    vendidoMes = reais(mes.totalVendido);
  }
  const gruposVenda = aba === 'fiscal' ? [] : await porGrupo(db, usaManage, filtrosAba, 'vendas');
  const gruposCompra = aba === 'fiscal' ? [] : await porGrupo(db, usaManage, filtrosAba, 'compras');
  const tipos = aba === 'fiscal' ? { itens: [], evolucao: [] } : await porTipo(db, usaManage, filtrosAba);
  const pagamento = aba === 'fiscal' ? [] : await porPagamento(db, usaManage, filtrosAba, t.devolucaoVenda);
  const serieMensal = aba === 'fiscal' ? [] : await porMes(db, usaManage, filtrosAba);
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
    porGrupoVenda: gruposVenda,
    porGrupoCompra: gruposCompra,
    porTipo: tipos.itens,
    evolucaoTipo: tipos.evolucao,
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
  if (aba === 'manage') {
    return {
      ...filtros,
      escopoVenda: 'manage',
      excluirConvertidas: false,
      modelosVenda: ['55', '65'],
    };
  }
  if (aba === 'fiscal') {
    return {
      ...filtros,
      escopoVenda: 'clipp',
      excluirConvertidas: false,
      modelosVenda: MODELOS_FISCAIS,
    };
  }
  if (usaGr) {
    return {
      ...filtros,
      escopoVenda: 'clipp',
      excluirConvertidas: true,
      modelosVenda: filtros.modelosVenda,
    };
  }
  return { ...filtros, escopoVenda: usaManage ? '' : 'clipp', excluirConvertidas: false };
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
