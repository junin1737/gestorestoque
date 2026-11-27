'use strict';

/**
 * Relatórios da O.S e a aba Serviços do dashboard.
 *
 * De onde vêm os números (especificação, item 10):
 * - Operacionais (em aberto, finalizados, por técnico): direto das tabelas GESTOR_OS*.
 * - Financeiros (serviços vendidos, totalizador, descontos e acréscimos, faturamento no dashboard):
 *   das vendas modelo 'GR'. No dashboard entra só o item tipo 9, líquido de desconto, com o
 *   acréscimo já dentro do valor e as GR canceladas à parte. O totalizador ainda separa produto
 *   e serviço da mesma nota. Entra a GR já convertida em NF-e/NFC-e, porque a nota leva só os
 *   produtos e o serviço fica só na GR.
 * - A GR é ligada à O.S pelo caminho TB_NFV_ITEM → TB_PED_VENDA_NFVENDA → TB_PED_VENDA_ITEM →
 *   GESTOR_OS.ID_PEDIDO. É isso que permite filtrar os financeiros por técnico, status e tipo.
 *   Com algum desses filtros, só entram as GR que vieram de uma O.S.
 */

const { query, hasTable } = require('./db');
const { isoHoje, sqlDate } = require('./datetime');
const os = require('./os');

const SQL_TIPO = (alias) => `COALESCE(NULLIF(TRIM(LEADING '0' FROM TRIM(${alias}.ID_TIPOITEM)), ''), '0')`;
const CFOP_FORA = ['910', '529', '929', '201', '202', '411'];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function txt(v, max) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return max ? s.slice(0, max) : s;
}
function cent(v) {
  return Math.round(num(v) * 100);
}
function brl(cents) {
  return (num(cents) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function qtdBr(v) {
  const n = num(v);
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: n % 1 ? 3 : 0 });
}
function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dataIso(v) {
  if (!v) return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? '' : iso(d);
}
function dataBr(v) {
  const s = dataIso(v);
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}
function addDia(isoDia) {
  const [y, m, d] = isoDia.split('-').map(Number);
  return iso(new Date(y, m - 1, d + 1, 12));
}
function lista(v) {
  if (Array.isArray(v)) return v;
  if (v == null || v === '') return [];
  return String(v).split(',');
}

/** Filtros iguais aos do quadro: período, status, tipo e técnico. */
function lerFiltros(q = {}, periodoObrigatorio) {
  const dia = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim()) ? String(v).trim() : '');
  let inicio = dia(q.inicio);
  let fim = dia(q.fim);
  if (periodoObrigatorio && (!inicio || !fim)) {
    const hoje = isoHoje();
    if (!inicio) inicio = `${hoje.slice(0, 8)}01`;
    if (!fim) fim = hoje;
  }
  if (inicio && fim && inicio > fim) throw new Error('A data inicial é maior que a final.');
  const tecnicoLista = lista(q.tecnico);
  return {
    inicio,
    fim,
    status: lista(q.status).map(num).filter(Boolean),
    tipo: ['I', 'E'].includes(q.tipo) ? q.tipo : '',
    tecnico: tecnicoLista.map(num).filter(Boolean),
    semTecnico: tecnicoLista.includes('sem'),
  };
}

function rotuloPeriodo(f) {
  if (f.inicio && f.fim) return `${dataBr(f.inicio)} a ${dataBr(f.fim)}`;
  if (f.inicio) return `desde ${dataBr(f.inicio)}`;
  if (f.fim) return `até ${dataBr(f.fim)}`;
  return 'todo o período';
}

/** Condições sobre GESTOR_OS (alias O) para status, tipo e técnico. */
function whereOs(f, where, params) {
  if (f.status.length) where.push(`O.ID_STATUS IN (${f.status.map(() => '?').join(',')})`), params.push(...f.status);
  if (f.tipo) where.push('O.TIPO = ?'), params.push(f.tipo);
  const tec = [];
  if (f.tecnico.length) tec.push(`O.ID_TECNICO IN (${f.tecnico.map(() => '?').join(',')})`), params.push(...f.tecnico);
  if (f.semTecnico) tec.push('O.ID_TECNICO IS NULL');
  if (tec.length) where.push(`(${tec.join(' OR ')})`);
}

function filtraOs(f) {
  return !!(f.status.length || f.tipo || f.tecnico.length || f.semTecnico);
}

/* ------------------------------------------------------------------ */
/* Base financeira: itens das GR com serviço                           */
/* ------------------------------------------------------------------ */

async function itensGr(db, f) {
  if (!hasTable('TB_NFVENDA') || !hasTable('TB_NFV_ITEM')) return [];
  const cfop = `RIGHT(REPLACE(COALESCE(I.CFOP, ''), '.', ''), 3)`;
  const rows = await query(db, `
    SELECT N.ID_NFVENDA, N.NF_NUMERO, N.DT_EMISSAO, N.ID_CLIENTE, C.NOME AS CLIENTE,
           I.ID_IDENTIFICADOR, EST.DESCRICAO, ${SQL_TIPO('EST')} AS TIPO, TRIM(I.UNI_MEDIDA) AS UN,
           COALESCE(I.QTD_ITEM, 0) AS QTD, COALESCE(I.VLR_TOTAL, 0) AS BRUTO, COALESCE(I.VLR_DESC, 0) AS DESCONTO,
           COALESCE(I.VLR_FRETE, 0) + COALESCE(I.VLR_SEGURO, 0) + COALESCE(I.VLR_DESPESA, 0) AS OUTRAS,
           COALESCE(I.PRC_LISTA, 0) AS LISTA
    FROM TB_NFV_ITEM I
    JOIN TB_NFVENDA N ON N.ID_NFVENDA = I.ID_NFVENDA
    LEFT JOIN TB_CLIENTE C ON C.ID_CLIENTE = N.ID_CLIENTE
    LEFT JOIN TB_EST_IDENTIFICADOR IDF ON IDF.ID_IDENTIFICADOR = I.ID_IDENTIFICADOR
    LEFT JOIN TB_ESTOQUE EST ON EST.ID_ESTOQUE = IDF.ID_ESTOQUE
    WHERE N.STATUS = 'E' AND UPPER(TRIM(N.NF_MODELO)) = 'GR'
      AND N.DT_EMISSAO >= ? AND N.DT_EMISSAO < ?
      AND ${cfop} NOT IN (${CFOP_FORA.map((c) => `'${c}'`).join(',')})
      AND EXISTS (
        SELECT 1 FROM TB_NFV_ITEM I2
        JOIN TB_EST_IDENTIFICADOR D2 ON D2.ID_IDENTIFICADOR = I2.ID_IDENTIFICADOR
        JOIN TB_ESTOQUE E2 ON E2.ID_ESTOQUE = D2.ID_ESTOQUE
        WHERE I2.ID_NFVENDA = N.ID_NFVENDA AND ${SQL_TIPO('E2')} = '9')
    ORDER BY N.DT_EMISSAO, N.ID_NFVENDA`, [f.inicio, addDia(f.fim)]);
  const itens = rows.map((r) => {
    const bruto = cent(r.BRUTO);
    const desconto = cent(r.DESCONTO);
    const lista = cent(num(r.LISTA) * num(r.QTD));
    return {
      nota: num(r.ID_NFVENDA),
      numero: num(r.NF_NUMERO),
      data: dataIso(r.DT_EMISSAO),
      idCliente: num(r.ID_CLIENTE),
      cliente: txt(r.CLIENTE) || 'Consumidor',
      id: num(r.ID_IDENTIFICADOR),
      descricao: txt(r.DESCRICAO) || `Item ${num(r.ID_IDENTIFICADOR)}`,
      servico: txt(r.TIPO) === '9',
      un: txt(r.UN),
      qtd: num(r.QTD),
      desconto,
      // O pedido da O.S grava o acréscimo dentro do valor do item: o que passa do preço de lista é acréscimo.
      acrescimo: lista > 0 ? Math.max(0, bruto - lista) : 0,
      valor: bruto - desconto + cent(r.OUTRAS),
    };
  });
  const vinculo = await osDasNotas(db, [...new Set(itens.map((i) => i.nota))]);
  itens.forEach((i) => { i.os = vinculo.get(i.nota) || null; });
  if (!filtraOs(f)) return itens;
  return itens.filter((i) => {
    const o = i.os;
    if (!o) return false;
    if (f.status.length && !f.status.includes(o.status)) return false;
    if (f.tipo && o.tipo !== f.tipo) return false;
    if (f.tecnico.length || f.semTecnico) {
      const ok = (o.tecnico && f.tecnico.includes(o.tecnico)) || (!o.tecnico && f.semTecnico);
      if (!ok) return false;
    }
    return true;
  });
}

/** Nota GR → O.S de origem (pelo pedido importado). */
async function osDasNotas(db, notas) {
  const mapa = new Map();
  if (!notas.length || !hasTable('TB_PED_VENDA_NFVENDA') || !hasTable('GESTOR_OS')) return mapa;
  for (let i = 0; i < notas.length; i += 400) {
    const parte = notas.slice(i, i + 400);
    const rows = await query(db, `
      SELECT DISTINCT I.ID_NFVENDA, O.ID_OS, O.ID_TECNICO, O.ID_STATUS, O.TIPO
      FROM TB_NFV_ITEM I
      JOIN TB_PED_VENDA_NFVENDA L ON L.ID_NFVITEM = I.ID_NFVITEM
      JOIN TB_PED_VENDA_ITEM P ON P.ID_ITEMPED = L.ID_ITEMPED
      JOIN GESTOR_OS O ON O.ID_PEDIDO = P.ID_PEDIDO
      WHERE I.ID_NFVENDA IN (${parte.map(() => '?').join(',')})`, parte);
    rows.forEach((r) => {
      if (!mapa.has(num(r.ID_NFVENDA))) {
        mapa.set(num(r.ID_NFVENDA), {
          id: num(r.ID_OS), tecnico: num(r.ID_TECNICO) || null, status: num(r.ID_STATUS), tipo: txt(r.TIPO) === 'E' ? 'E' : 'I',
        });
      }
    });
  }
  return mapa;
}

/* ------------------------------------------------------------------ */
/* Relatórios                                                          */
/* ------------------------------------------------------------------ */

const RELATORIOS = [
  { id: 'os-abertos', titulo: 'Serviços em aberto', base: 'os', periodo: 'opcional' },
  { id: 'os-finalizados', titulo: 'Serviços finalizados', base: 'os', periodo: 'mes' },
  { id: 'os-tecnico', titulo: 'Serviços por técnico', base: 'os', periodo: 'mes' },
  { id: 'os-produtos', titulo: 'Serviços vendidos (tipo 9)', base: 'gr', periodo: 'mes' },
  { id: 'os-totalizador', titulo: 'Totalizador de serviços', base: 'gr', periodo: 'mes' },
  { id: 'os-descontos', titulo: 'Descontos e acréscimos', base: 'gr', periodo: 'mes' },
];

function catalogo() {
  return {
    grupo: { id: 'servicos', titulo: 'Serviços' },
    relatorios: RELATORIOS.map((r) => ({ id: r.id, titulo: r.titulo, periodo: r.periodo, base: r.base })),
  };
}

const C = (id, titulo, extra) => ({ id, titulo, ...(extra || {}) });

async function lerOs(db, f, extraWhere, params0, campoData) {
  const where = [...extraWhere];
  const params = [...params0];
  if (f.inicio) where.push(`CAST(${campoData} AS DATE) >= ?`), params.push(f.inicio);
  if (f.fim) where.push(`CAST(${campoData} AS DATE) <= ?`), params.push(f.fim);
  whereOs(f, where, params);
  return query(db, `
    SELECT O.ID_OS, O.DT_EMISSAO, O.DT_PREVISAO, O.DT_ENTREGA, O.DT_ALTERACAO, O.TIPO, O.ID_STATUS, O.ID_TECNICO,
           O.CLI_NOME, O.EQUIPAMENTO, O.TOTAL_PRODUTOS, O.TOTAL_SERVICOS, O.TOTAL, O.ID_PEDIDO
    FROM GESTOR_OS O
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY O.ID_OS`, params);
}

async function relOperacional(db, def, f) {
  const { funcs, statuses, porId } = await os._mapasApoio(db);
  const finais = statuses.filter((s) => s.final).map((s) => s.id);
  const nomeTec = (id) => funcs.get(num(id))?.nome || (id ? `Funcionário ${id}` : 'Sem técnico');
  const nomeSt = (id) => porId.get(num(id))?.descricao || '—';
  const hoje = isoHoje();

  if (def.id === 'os-abertos') {
    const extra = finais.length ? [`(O.ID_STATUS IS NULL OR O.ID_STATUS NOT IN (${finais.join(',')}))`] : [];
    const rows = await lerOs(db, f, extra, [], 'O.DT_EMISSAO');
    let total = 0;
    const linhas = rows.map((r) => {
      total += cent(r.TOTAL);
      const prev = dataIso(r.DT_PREVISAO);
      return {
        numero: String(num(r.ID_OS)),
        emissao: dataBr(r.DT_EMISSAO),
        cliente: txt(r.CLI_NOME),
        equipamento: txt(r.EQUIPAMENTO),
        status: nomeSt(r.ID_STATUS),
        tecnico: nomeTec(r.ID_TECNICO),
        previsao: prev ? `${dataBr(prev)}${prev < hoje ? ' (vencida)' : ''}` : '',
        total: brl(cent(r.TOTAL)),
      };
    });
    return {
      colunas: [C('numero', 'O.S', { largura: '7%' }), C('emissao', 'Emissão', { largura: '10%' }), C('cliente', 'Cliente', { largura: '20%' }),
        C('equipamento', 'Equipamento', { largura: '19%' }), C('status', 'Status', { largura: '13%' }), C('tecnico', 'Técnico', { largura: '12%' }),
        C('previsao', 'Previsão', { largura: '9%' }), C('total', 'Valor', { numero: true, largura: '10%' })],
      linhas,
      total: { numero: 'Total', cliente: `${linhas.length} O.S`, total: brl(total) },
    };
  }

  if (def.id === 'os-finalizados') {
    if (!finais.length) return { colunas: [], linhas: [], aviso: 'Nenhum status está marcado como final.' };
    const rows = await lerOs(db, f, [`O.ID_STATUS IN (${finais.join(',')})`], [], 'COALESCE(O.DT_ENTREGA, O.DT_ALTERACAO)');
    let total = 0;
    const linhas = rows.map((r) => {
      total += cent(r.TOTAL);
      return {
        numero: String(num(r.ID_OS)),
        emissao: dataBr(r.DT_EMISSAO),
        entrega: dataBr(r.DT_ENTREGA || r.DT_ALTERACAO),
        cliente: txt(r.CLI_NOME),
        equipamento: txt(r.EQUIPAMENTO),
        tecnico: nomeTec(r.ID_TECNICO),
        pedido: num(r.ID_PEDIDO) ? String(num(r.ID_PEDIDO)) : 'não enviada',
        total: brl(cent(r.TOTAL)),
      };
    });
    return {
      colunas: [C('numero', 'O.S', { largura: '7%' }), C('emissao', 'Emissão', { largura: '10%' }), C('entrega', 'Entrega', { largura: '10%' }),
        C('cliente', 'Cliente', { largura: '21%' }), C('equipamento', 'Equipamento', { largura: '20%' }), C('tecnico', 'Técnico', { largura: '12%' }),
        C('pedido', 'Pedido', { largura: '10%' }), C('total', 'Valor', { numero: true, largura: '10%' })],
      linhas,
      total: { numero: 'Total', cliente: `${linhas.length} O.S`, total: brl(total) },
    };
  }

  // os-tecnico: quantidade e valor das O.S abertas no período, por técnico.
  const rows = await lerOs(db, f, [], [], 'O.DT_EMISSAO');
  const grupos = new Map();
  rows.forEach((r) => {
    const id = num(r.ID_TECNICO) || 0;
    const g = grupos.get(id) || { id, qtd: 0, abertas: 0, finalizadas: 0, produtos: 0, servicos: 0, total: 0 };
    g.qtd += 1;
    if (finais.includes(num(r.ID_STATUS))) g.finalizadas += 1; else g.abertas += 1;
    g.produtos += cent(r.TOTAL_PRODUTOS);
    g.servicos += cent(r.TOTAL_SERVICOS);
    g.total += cent(r.TOTAL);
    grupos.set(id, g);
  });
  const ordenados = [...grupos.values()].sort((a, b) => b.total - a.total);
  const soma = ordenados.reduce((s, g) => ({
    qtd: s.qtd + g.qtd, abertas: s.abertas + g.abertas, finalizadas: s.finalizadas + g.finalizadas,
    produtos: s.produtos + g.produtos, servicos: s.servicos + g.servicos, total: s.total + g.total,
  }), { qtd: 0, abertas: 0, finalizadas: 0, produtos: 0, servicos: 0, total: 0 });
  return {
    colunas: [C('tecnico', 'Técnico', { largura: '26%' }), C('qtd', 'O.S', { numero: true, largura: '9%' }), C('abertas', 'Em aberto', { numero: true, largura: '10%' }),
      C('finalizadas', 'Finalizadas', { numero: true, largura: '11%' }), C('produtos', 'Produtos', { numero: true, largura: '14%' }),
      C('servicos', 'Serviços', { numero: true, largura: '14%' }), C('total', 'Valor total', { numero: true, largura: '16%' })],
    linhas: ordenados.map((g) => ({
      tecnico: nomeTec(g.id), qtd: String(g.qtd), abertas: String(g.abertas), finalizadas: String(g.finalizadas),
      produtos: brl(g.produtos), servicos: brl(g.servicos), total: brl(g.total),
    })),
    total: {
      tecnico: 'Total', qtd: String(soma.qtd), abertas: String(soma.abertas), finalizadas: String(soma.finalizadas),
      produtos: brl(soma.produtos), servicos: brl(soma.servicos), total: brl(soma.total),
    },
    nota: 'Valores das próprias O.S, pela data de emissão.',
  };
}

async function relFinanceiro(db, def, f) {
  const itens = await itensGr(db, f);
  const notas = new Set(itens.map((i) => i.nota));
  const nota = `Vendas GR com pelo menos um serviço${filtraOs(f) ? ', vindas de O.S com os filtros escolhidos' : ''}. ${notas.size} ${notas.size === 1 ? 'venda' : 'vendas'}.`;

  if (def.id === 'os-produtos') {
    const mapa = new Map();
    itens.filter((i) => i.servico).forEach((i) => {
      const p = mapa.get(i.id) || { id: i.id, descricao: i.descricao, un: i.un, qtd: 0, valor: 0, notas: new Set() };
      p.qtd += i.qtd;
      p.valor += i.valor;
      p.notas.add(i.nota);
      mapa.set(i.id, p);
    });
    const ordenados = [...mapa.values()].sort((a, b) => b.valor - a.valor);
    const total = ordenados.reduce((s, p) => s + p.valor, 0);
    return {
      colunas: [C('codigo', 'Código', { largura: '10%' }), C('descricao', 'Descrição', { largura: '46%' }), C('vendas', 'Vendas', { numero: true, largura: '10%' }),
        C('quantidade', 'Quantidade', { numero: true, largura: '14%' }), C('valor', 'Valor', { numero: true, largura: '20%' })],
      linhas: ordenados.map((p) => ({
        codigo: String(p.id), descricao: p.descricao, vendas: String(p.notas.size), quantidade: `${qtdBr(p.qtd)}${p.un ? ` ${p.un.toLowerCase()}` : ''}`, valor: brl(p.valor),
      })),
      total: { codigo: 'Total', descricao: `${ordenados.length} ${ordenados.length === 1 ? 'serviço' : 'serviços'}`, valor: brl(total) },
      nota: `${nota} Só o tipo 9. O valor já tira o desconto e mantém o acréscimo. Nota cancelada não entra.`,
    };
  }

  if (def.id === 'os-totalizador') {
    const dias = Math.round((Date.parse(`${f.fim}T12:00:00`) - Date.parse(`${f.inicio}T12:00:00`)) / 86400000) + 1;
    const porMes = dias > 31;
    const chave = (d) => (porMes ? d.slice(0, 7) : d);
    const rotulo = (k) => {
      if (!porMes) return dataBr(k);
      const [y, m] = k.split('-');
      return `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(m) - 1]}/${y}`;
    };
    const mapa = new Map();
    itens.forEach((i) => {
      const k = chave(i.data);
      const g = mapa.get(k) || { k, notas: new Set(), produtos: 0, servicos: 0 };
      g.notas.add(i.nota);
      if (i.servico) g.servicos += i.valor; else g.produtos += i.valor;
      mapa.set(k, g);
    });
    const ordenados = [...mapa.values()].sort((a, b) => (a.k < b.k ? -1 : 1));
    const soma = ordenados.reduce((s, g) => ({ produtos: s.produtos + g.produtos, servicos: s.servicos + g.servicos }), { produtos: 0, servicos: 0 });
    return {
      colunas: [C('periodo', porMes ? 'Mês' : 'Dia', { largura: '20%' }), C('vendas', 'Vendas', { numero: true, largura: '14%' }),
        C('produtos', 'Produtos', { numero: true, largura: '22%' }), C('servicos', 'Serviços', { numero: true, largura: '22%' }), C('total', 'Total', { numero: true, largura: '22%' })],
      linhas: ordenados.map((g) => ({
        periodo: rotulo(g.k), vendas: String(g.notas.size), produtos: brl(g.produtos), servicos: brl(g.servicos), total: brl(g.produtos + g.servicos),
      })),
      total: { periodo: 'Total', vendas: String(notas.size), produtos: brl(soma.produtos), servicos: brl(soma.servicos), total: brl(soma.produtos + soma.servicos) },
      nota,
    };
  }

  // os-descontos: por venda, só as que têm desconto ou acréscimo.
  const mapa = new Map();
  itens.forEach((i) => {
    const g = mapa.get(i.nota) || {
      nota: i.nota, numero: i.numero, data: i.data, cliente: i.cliente, os: i.os?.id || null, desconto: 0, acrescimo: 0, valor: 0,
    };
    g.desconto += i.desconto;
    g.acrescimo += i.acrescimo;
    g.valor += i.valor;
    mapa.set(i.nota, g);
  });
  const ordenados = [...mapa.values()].filter((g) => g.desconto || g.acrescimo);
  const soma = ordenados.reduce((s, g) => ({ desconto: s.desconto + g.desconto, acrescimo: s.acrescimo + g.acrescimo, valor: s.valor + g.valor }), { desconto: 0, acrescimo: 0, valor: 0 });
  return {
    colunas: [C('venda', 'Venda GR', { largura: '11%' }), C('data', 'Data', { largura: '11%' }), C('cliente', 'Cliente', { largura: '30%' }), C('os', 'O.S', { largura: '8%' }),
      C('desconto', 'Desconto', { numero: true, largura: '13%' }), C('acrescimo', 'Acréscimo', { numero: true, largura: '13%' }), C('valor', 'Valor final', { numero: true, largura: '14%' })],
    linhas: ordenados.map((g) => ({
      venda: String(g.numero || g.nota), data: dataBr(g.data), cliente: g.cliente, os: g.os ? String(g.os) : '—',
      desconto: brl(g.desconto), acrescimo: brl(g.acrescimo), valor: brl(g.valor),
    })),
    total: { venda: 'Total', cliente: `${ordenados.length} vendas`, desconto: brl(soma.desconto), acrescimo: brl(soma.acrescimo), valor: brl(soma.valor) },
    nota: `${nota} Acréscimo é o que passou do preço de lista do item.`,
  };
}

async function executar(id, consulta) {
  const def = RELATORIOS.find((r) => r.id === id);
  if (!def) throw new Error('Relatório não encontrado.');
  const f = lerFiltros(consulta, def.periodo === 'mes');
  return os._comBase(async (db) => {
    const res = def.base === 'gr' ? await relFinanceiro(db, def, f) : await relOperacional(db, def, f);
    const emit = await query(db, 'SELECT FIRST 1 NOME_FANTA, NOME FROM TB_EMITENTE').catch(() => []);
    return {
      id: def.id,
      titulo: def.titulo,
      empresa: txt(emit[0]?.NOME_FANTA || emit[0]?.NOME),
      periodo: { inicio: f.inicio, fim: f.fim, rotulo: rotuloPeriodo(f) },
      ...res,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Dashboard: aba Serviços e o card do Resumo                          */
/* ------------------------------------------------------------------ */

/** GR cancelada com item tipo 9: valor líquido, fora do faturamento. */
async function canceladosTipo9(db, f) {
  if (!hasTable('TB_NFVENDA') || !hasTable('TB_NFV_ITEM')) return { notas: 0, valor: 0 };
  const cfop = `RIGHT(REPLACE(COALESCE(I.CFOP, ''), '.', ''), 3)`;
  const rows = await query(db, `
    SELECT COUNT(DISTINCT N.ID_NFVENDA) AS NOTAS,
           SUM(COALESCE(I.VLR_TOTAL, 0) - COALESCE(I.VLR_DESC, 0) + COALESCE(I.VLR_FRETE, 0) + COALESCE(I.VLR_SEGURO, 0) + COALESCE(I.VLR_DESPESA, 0)) AS VALOR
    FROM TB_NFV_ITEM I
    JOIN TB_NFVENDA N ON N.ID_NFVENDA = I.ID_NFVENDA
    JOIN TB_EST_IDENTIFICADOR IDF ON IDF.ID_IDENTIFICADOR = I.ID_IDENTIFICADOR
    JOIN TB_ESTOQUE EST ON EST.ID_ESTOQUE = IDF.ID_ESTOQUE
    WHERE N.STATUS = 'C' AND UPPER(TRIM(N.NF_MODELO)) = 'GR'
      AND N.DT_EMISSAO >= ? AND N.DT_EMISSAO < ?
      AND ${cfop} NOT IN (${CFOP_FORA.map((c) => `'${c}'`).join(',')})
      AND ${SQL_TIPO('EST')} = '9'`, [f.inicio, addDia(f.fim)]);
  return { notas: num(rows[0]?.NOTAS), valor: cent(rows[0]?.VALOR) / 100 };
}

/** Faturamento de serviços no período (para o card do Resumo). */
async function faturamentoServicos(db, inicio, fim) {
  const itens = (await itensGr(db, lerFiltros({ inicio, fim }, true))).filter((i) => i.servico);
  const servicos = itens.reduce((s, i) => s + i.valor, 0);
  return { valor: servicos / 100, vendas: new Set(itens.map((i) => i.nota)).size };
}

async function dashboardServicos(db, consulta) {
  const f = lerFiltros(consulta, true);
  const itens = (await itensGr(db, f)).filter((i) => i.servico);
  const notas = new Set(itens.map((i) => i.nota));
  const servicos = itens.reduce((s, i) => s + i.valor, 0);
  const descontos = itens.reduce((s, i) => s + i.desconto, 0);
  const acrescimos = itens.reduce((s, i) => s + i.acrescimo, 0);
  const cancelamentos = await canceladosTipo9(db, f);

  const rank = () => {
    const mapa = new Map();
    itens.forEach((i) => {
      const p = mapa.get(i.id) || { nome: i.descricao, unidade: i.un, quantidade: 0, valor: 0 };
      p.quantidade += i.qtd;
      p.valor += i.valor;
      mapa.set(i.id, p);
    });
    return [...mapa.values()].sort((a, b) => b.valor - a.valor).slice(0, 10)
      .map((p) => ({ ...p, quantidade: Math.round(p.quantidade * 1000) / 1000, valor: p.valor / 100 }));
  };

  if (!hasTable('GESTOR_OS')) {
    return {
      faturamentoServicos: servicos / 100, faturamentoProdutos: 0, descontos: descontos / 100, acrescimos: acrescimos / 100,
      cancelamentos, vendas: notas.size,
      ticket: notas.size ? servicos / notas.size / 100 : 0,
      porStatus: [], porTecnico: [], maisServicos: rank(), maisProdutos: [],
      abertas: 0, finalizadas: 0, atrasadas: 0,
    };
  }
  const { funcs, statuses } = await os._mapasApoio(db);
  const finais = statuses.filter((s) => s.final).map((s) => s.id);

  // Quantidade por status: as abertas de agora e as finalizadas no período.
  const where = [];
  const params = [];
  whereOs({ ...f, status: [] }, where, params);
  const fin = finais.length ? finais.join(',') : '0';
  const contagem = await query(db, `
    SELECT O.ID_STATUS, COUNT(*) AS N,
           SUM(CASE WHEN O.DT_PREVISAO < ${sqlDate()} THEN 1 ELSE 0 END) AS ATRASADAS
    FROM GESTOR_OS O
    WHERE (O.ID_STATUS NOT IN (${fin}) OR O.ID_STATUS IS NULL
       OR (CAST(COALESCE(O.DT_ENTREGA, O.DT_ALTERACAO) AS DATE) BETWEEN ? AND ?))
      ${where.length ? `AND ${where.join(' AND ')}` : ''}
    GROUP BY O.ID_STATUS`, [f.inicio, f.fim, ...params]);
  const porStatusMapa = new Map(contagem.map((r) => [num(r.ID_STATUS), { n: num(r.N), atrasadas: num(r.ATRASADAS) }]));
  const porStatus = statuses
    .filter((s) => s.ativo || porStatusMapa.has(s.id))
    .map((s) => ({ nome: s.descricao, cor: s.cor, final: s.final, quantidade: porStatusMapa.get(s.id)?.n || 0 }));
  let abertas = 0;
  let finalizadas = 0;
  let atrasadas = 0;
  porStatusMapa.forEach((v, id) => {
    if (finais.includes(id)) finalizadas += v.n; else { abertas += v.n; atrasadas += v.atrasadas; }
  });

  // Faturamento por técnico: só o tipo 9 da GR ligada à O.S; sem ligação fica em "Sem O.S vinculada".
  const tecMapa = new Map();
  itens.forEach((i) => {
    const id = i.os ? (i.os.tecnico || 0) : -1;
    const t = tecMapa.get(id) || { id, valor: 0, servicos: 0, notas: new Set() };
    t.valor += i.valor;
    t.servicos += i.valor;
    t.notas.add(i.nota);
    tecMapa.set(id, t);
  });
  const porTecnico = [...tecMapa.values()].sort((a, b) => b.valor - a.valor).map((t) => ({
    nome: t.id === -1 ? 'Sem O.S vinculada' : (t.id ? (funcs.get(t.id)?.nome || `Funcionário ${t.id}`) : 'O.S sem técnico'),
    valor: t.valor / 100,
    servicos: t.servicos / 100,
    vendas: t.notas.size,
  }));

  return {
    faturamentoServicos: servicos / 100,
    faturamentoProdutos: 0,
    descontos: descontos / 100,
    acrescimos: acrescimos / 100,
    cancelamentos,
    vendas: notas.size,
    ticket: notas.size ? servicos / notas.size / 100 : 0,
    abertas,
    finalizadas,
    atrasadas,
    porStatus,
    porTecnico,
    maisServicos: rank(),
    maisProdutos: [],
    tecnicos: [...funcs.values()].filter((t) => t.tecnico).map((t) => ({ id: t.id, nome: t.nome })),
    statuses: statuses.map((s) => ({ id: s.id, descricao: s.descricao })),
  };
}

module.exports = {
  catalogo, executar, dashboardServicos, faturamentoServicos, _lerFiltros: lerFiltros, _itensGr: itensGr,
};
