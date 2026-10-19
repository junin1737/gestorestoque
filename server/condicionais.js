'use strict';

const crypto = require('crypto');
const {
  withDb, query, hasTable, columnExists, activeTargets, writeTargets, withTransaction, nextGenIdSincronizado, refreshTables,
} = require('./db');
const { loadAppConfig } = require('./config');

/** O Clipp numera pelo primeiro; o trigger XX_TR_INC_PED_I da integração ManagePro, pelo segundo. */
const GENERATORS_ITEM_PEDIDO = ['GEN_TB_PED_VENDA_ITEM_ID', 'XX_GEN_TB_PEDI_I'];
/** O Clipp abre o próximo pedido com GEN_TB_DAV_ID. A integração ManagePro pode ter XX_GEN_ID_PEDIDO. */
const GENERATORS_PEDIDO = ['GEN_TB_DAV_ID', 'XX_GEN_ID_PEDIDO'];

/** Espera curta: o Clipp/ManagePro com o pedido ou a peça aberta em edição segura a linha. */
const ESPERA_BLOQUEIO_S = 8;

function erroDeBloqueio(err) {
  const texto = String(err?.message || err || '');
  if (!/deadlock|lock conflict|lock time-?out|concurrent update|update conflicts/i.test(texto)) return err;
  return new Error('O condicional ou o estoque de uma peça está aberto em outro programa (Clipp ou ManagePro). Feche a tela do pedido lá e tente de novo.');
}

async function geradoresPedido(db) {
  const gens = await query(db, `
    SELECT TRIM(RDB$GENERATOR_NAME) AS G FROM RDB$GENERATORS
    WHERE RDB$GENERATOR_NAME IN (${GENERATORS_PEDIDO.map(() => '?').join(',')})`, GENERATORS_PEDIDO);
  return gens
    .map((r) => String(r.G || '').trim())
    .filter((g) => /^[A-Z0-9_]+$/.test(g));
}

async function valorGerador(db, nome) {
  return num((await query(db, `SELECT GEN_ID(${nome}, 0) AS V FROM RDB$DATABASE`))[0]?.V);
}

async function proximoIdPedido(tx) {
  const seq = await query(tx, 'SELECT COALESCE(MAX(ID_PEDIDO), 0) + 1 AS ID FROM TB_PEDIDO_VENDA');
  let id = num(seq[0]?.ID);
  const atuais = [];
  for (const g of await geradoresPedido(tx)) {
    const v = await valorGerador(tx, g);
    atuais.push({ g, v });
    if (v + 1 > id) id = v + 1;
  }
  for (const { g, v } of atuais) {
    if (v < id) await query(tx, `SELECT GEN_ID(${g}, ${id - v}) AS V FROM RDB$DATABASE`);
  }
  return id;
}

/** O Clipp mostra o próximo número como GEN_ID(GEN_TB_DAV_ID, 0) + 1 e carrega as peças desse pedido. */
async function alinharGeradorPedido(db) {
  if (!hasTable('TB_PEDIDO_VENDA')) return 0;
  const max = num((await query(db, 'SELECT COALESCE(MAX(ID_PEDIDO), 0) AS ID FROM TB_PEDIDO_VENDA'))[0]?.ID);
  let movidos = 0;
  for (const g of await geradoresPedido(db)) {
    let v = await valorGerador(db, g);
    if (v >= max) continue;
    await query(db, `SELECT GEN_ID(${g}, ${max - v}) AS V FROM RDB$DATABASE`);
    v = await valorGerador(db, g);
    if (v < max) await query(db, `SELECT GEN_ID(${g}, ${max - v}) AS V FROM RDB$DATABASE`);
    movidos += 1;
  }
  return movidos;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function dataBr(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
  return d.toLocaleDateString('pt-BR');
}

function horaBr(v) {
  if (!v) return '';
  if (v instanceof Date) {
    const h = String(v.getUTCHours()).padStart(2, '0');
    const m = String(v.getUTCMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
  const s = String(v);
  const m = s.match(/(\d{2}:\d{2})/);
  return m ? m[1] : s.slice(0, 5);
}

function reservaSim(v) {
  return String(v || '').trim().toUpperCase() === 'S';
}

function nomeGrade(descricao, grade, cor, tamanho) {
  const base = String(descricao || '').trim();
  if (String(grade || '').trim().toUpperCase() !== 'G') return base;
  return [base, String(cor || '').trim(), String(tamanho || '').trim()].filter(Boolean).join(' - ');
}

function foneCliente(row) {
  return String(row?.FONE_CELUL || row?.FONE_RESID || row?.FONE_COMER || '').trim();
}

function isoData(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function mapPedido(r) {
  return {
    id: num(r.ID_PEDIDO),
    id_cliente: r.ID_CLIENTE == null ? null : num(r.ID_CLIENTE),
    cliente: String(r.CLIENTE || '').trim(),
    telefone: foneCliente(r),
    data: dataBr(r.DT_PEDIDO),
    horario: horaBr(r.HR_PEDIDO),
    validade: dataBr(r.DT_VALIDA),
    validade_iso: isoData(r.DT_VALIDA),
    id_funcionario: r.ID_VENDEDOR == null ? null : num(r.ID_VENDEDOR),
    vendedor: String(r.VENDEDOR || '').trim(),
    status: String(r.ID_STATUS ?? ''),
    status_label: String(r.STATUS || '').trim() || 'Sem status',
    reserva: reservaSim(r.RESERVA),
    obs: String(r.OBS || '').trim(),
    id_parcela: r.ID_PARCELA == null ? null : num(r.ID_PARCELA),
    pagamento: nomePagamento(r.ID_PARCELA, r.PAGAMENTO),
    total: num(r.TOTAL),
    origem: 'pedido',
  };
}

/** ID_PARCELA 1 é o "Nenhum" do Clipp. */
function nomePagamento(idParcela, descricao) {
  if (!num(idParcela) || num(idParcela) === 1) return '';
  return String(descricao || '').replace(/\s+/g, ' ').trim();
}

async function sqlPedido(db) {
  const temValidade = await columnExists(db, 'TB_PEDIDO_VENDA', 'DT_VALIDA');
  return `
  SELECT P.ID_PEDIDO, P.DT_PEDIDO, P.HR_PEDIDO, ${temValidade ? 'P.DT_VALIDA,' : ''} P.ID_STATUS, P.ID_CLIENTE, P.ID_VENDEDOR,
         CAST(P.OBSERVACAO AS VARCHAR(300)) AS OBS,
         S.DESCRICAO AS STATUS, S.RESERVA,
         CL.NOME AS CLIENTE, CL.FONE_CELUL, CL.FONE_RESID, CL.FONE_COMER,
         F.NOME AS VENDEDOR,
         P.ID_PARCELA, PA.DESCRICAO AS PAGAMENTO
  FROM TB_PEDIDO_VENDA P
  LEFT JOIN TB_PED_VENDA_STATUS S ON S.ID_STATUS = P.ID_STATUS
  LEFT JOIN TB_CLIENTE CL ON CL.ID_CLIENTE = P.ID_CLIENTE
  LEFT JOIN TB_FUNCIONARIO F ON F.ID_FUNCIONARIO = P.ID_VENDEDOR
  LEFT JOIN TB_PARCELAMENTO PA ON PA.ID_PARCELA = P.ID_PARCELA`;
}

/** Mesma lista do Clipp no pedido: parcelamentos ativos, cada um ligado à sua forma de pagamento. */
async function listarPagamentos() {
  return withDb(async (db) => {
    if (!hasTable('TB_PARCELAMENTO')) return [];
    const rows = await query(db, `
      SELECT PA.ID_PARCELA, PA.DESCRICAO, PA.ID_FMAPGTO, F.DESCRICAO AS FORMA
      FROM TB_PARCELAMENTO PA
      LEFT JOIN TB_FORMA_PAGTO_SIS F ON F.ID_FMAPGTO = PA.ID_FMAPGTO
      WHERE COALESCE(TRIM(PA.STATUS), 'A') = 'A' AND PA.ID_PARCELA <> 1
      ORDER BY PA.DESCRICAO`);
    return rows.map((r) => ({
      id_parcela: num(r.ID_PARCELA),
      descricao: String(r.DESCRICAO || '').replace(/\s+/g, ' ').trim(),
      id_fmapgto: num(r.ID_FMAPGTO) || 1,
      forma: String(r.FORMA || '').trim(),
    }));
  });
}

async function resolverPagamento(db, idParcela) {
  const id = num(idParcela);
  if (!id) throw new Error('Informe a forma de pagamento.');
  const rows = await query(db, `
    SELECT ID_PARCELA, ID_FMAPGTO, DESCRICAO FROM TB_PARCELAMENTO
    WHERE ID_PARCELA = ? AND COALESCE(TRIM(STATUS), 'A') = 'A'`, [id]);
  if (!rows.length) throw new Error('Forma de pagamento inválida ou inativa.');
  return {
    id_parcela: num(rows[0].ID_PARCELA),
    id_fmapgto: num(rows[0].ID_FMAPGTO) || 1,
    descricao: String(rows[0].DESCRICAO || '').replace(/\s+/g, ' ').trim(),
  };
}

async function listarStatus(db) {
  const rows = await query(db, `
    SELECT ID_STATUS, DESCRICAO, RESERVA
    FROM TB_PED_VENDA_STATUS
    WHERE COALESCE(STATUS, 'A') = 'A'
    ORDER BY DESCRICAO`);
  return rows.map((r) => ({
    id: num(r.ID_STATUS),
    descricao: String(r.DESCRICAO || '').trim(),
    reserva: reservaSim(r.RESERVA),
  }));
}

/** Número do condicional e/ou nome do cliente. Número curto também procura no nome. */
function montarBuscaPedido(busca) {
  const termo = String(busca || '').trim();
  if (!termo) return null;
  const n = Number(termo);
  const idOk = /^\d+$/.test(termo) && Number.isSafeInteger(n) && n > 0 && n <= 2147483647;
  if (idOk) {
    return {
      where: ['(P.ID_PEDIDO = ? OR UPPER(COALESCE(CL.NOME, \'\')) CONTAINING UPPER(?))'],
      params: [n, termo],
    };
  }
  const partes = termo.split(/\s+/).map((p) => p.trim()).filter(Boolean);
  const lista = partes.length ? partes : [termo];
  return {
    where: lista.map(() => 'UPPER(COALESCE(CL.NOME, \'\')) CONTAINING UPPER(?)'),
    params: lista,
  };
}

async function listar(statusFiltro, busca) {
  return withDb(async (db) => {
    if (!hasTable('TB_PEDIDO_VENDA') || !hasTable('TB_PED_VENDA_ITEM')) {
      return { disponivel: false, itens: [], statuses: [], aviso: 'Esta base não tem pedido de venda.' };
    }
    const filtro = String(statusFiltro || 'reservado').trim().toLowerCase();
    const where = [];
    const params = [];
    if (filtro === 'todos') {
      /* sem filtro de status */
    } else if (filtro === 'reservado' || filtro === '') {
      where.push(`TRIM(S.RESERVA) = 'S'`);
    } else if (/^\d+$/.test(filtro)) {
      where.push('P.ID_STATUS = ?');
      params.push(Number(filtro));
    }
    const extra = montarBuscaPedido(busca);
    if (extra) {
      where.push(...extra.where);
      params.push(...extra.params);
    }
    const corpo = (await sqlPedido(db)).replace(/^\s*SELECT\s*/i, '');
    const rows = await query(db, `
      SELECT FIRST 200 ${corpo}
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY P.DT_PEDIDO DESC, P.HR_PEDIDO DESC, P.ID_PEDIDO DESC`, params);
    const totais = await query(db, `
      SELECT I.ID_PEDIDO, SUM(COALESCE(I.VLR_TOTAL, 0)) AS TOTAL
      FROM TB_PED_VENDA_ITEM I
      WHERE I.ID_PEDIDO IN (${rows.length ? rows.map(() => '?').join(',') : '0'})
        AND COALESCE(TRIM(I.ITEM_CANCEL), 'N') <> 'S'
      GROUP BY I.ID_PEDIDO`, rows.map((r) => num(r.ID_PEDIDO)));
    const porId = new Map(totais.map((r) => [num(r.ID_PEDIDO), num(r.TOTAL)]));
    return {
      disponivel: true,
      filtro,
      aviso: '',
      statuses: await listarStatus(db),
      itens: rows.map((r) => ({ ...mapPedido(r), total: porId.get(num(r.ID_PEDIDO)) || 0 })),
    };
  });
}

async function itensDoPedido(db, appCfg, idPedido) {
  const t = activeTargets(appCfg)[0]?.tables;
  if (!t) throw new Error('Estoque não encontrado nesta base.');
  const itens = await query(db, `
    SELECT I.ID_ITEMPED, I.ID_IDENTIFICADOR, I.QTD_ITEM, I.VLR_UNIT, I.VLR_DESC, I.VLR_TOTAL, I.ITEM_CANCEL,
           E.DESCRICAO, E.GRADE_SERIE, E.UNI_MEDIDA, N1.DESCRICAO AS COR, N2.DESCRICAO AS TAMANHO
    FROM TB_PED_VENDA_ITEM I
    LEFT JOIN ${t.identificador} IDN ON IDN.ID_IDENTIFICADOR = I.ID_IDENTIFICADOR
    LEFT JOIN ${t.estoque} E ON E.ID_ESTOQUE = IDN.ID_ESTOQUE
    LEFT JOIN ${t.produto} P ON P.ID_IDENTIFICADOR = I.ID_IDENTIFICADOR
    LEFT JOIN ${t.nivel1} N1 ON N1.ID_NIVEL1 = P.ID_NIVEL1
    LEFT JOIN ${t.nivel2} N2 ON N2.ID_NIVEL2 = P.ID_NIVEL2
    WHERE I.ID_PEDIDO = ?
      AND COALESCE(TRIM(I.ITEM_CANCEL), 'N') <> 'S'
    ORDER BY I.ID_ITEMPED`, [idPedido]);
  return itens.map((r) => {
    const qtd = num(r.QTD_ITEM);
    const unit = num(r.VLR_UNIT);
    const bruto = Math.round(qtd * unit * 100) / 100;
    return {
      id: num(r.ID_ITEMPED),
      id_identificador: num(r.ID_IDENTIFICADOR),
      descricao: nomeGrade(r.DESCRICAO, r.GRADE_SERIE, r.COR, r.TAMANHO),
      qtd,
      prc_unit: unit,
      desconto: num(r.VLR_DESC),
      acrescimo: Math.max(0, Math.round((num(r.VLR_TOTAL) - bruto) * 100) / 100),
      total: num(r.VLR_TOTAL),
      uni_medida: String(r.UNI_MEDIDA || '').trim(),
    };
  });
}

async function detalhe(id) {
  const codigo = num(id);
  if (!codigo) throw new Error('Condicional inválido.');
  return withDb(async (db, appCfg) => {
    if (!hasTable('TB_PEDIDO_VENDA')) throw new Error('Esta base não tem pedido de venda.');
    const cab = await query(db, `${await sqlPedido(db)} WHERE P.ID_PEDIDO = ?`, [codigo]);
    if (!cab.length) throw new Error('Condicional não encontrado.');
    const doc = mapPedido(cab[0]);
    doc.itens = await itensDoPedido(db, appCfg, codigo);
    Object.assign(doc, await totaisCondicional(db, codigo));
    doc.subtotal = doc.itens.reduce((s, it) => s + Math.max(0, num(it.total) - num(it.desconto)), 0);
    doc.total = totalDocumento(doc);
    const idReprovado = await statusReprovado(db);
    doc.pode_reprovar = !!idReprovado && String(idReprovado) !== doc.status;
    return doc;
  });
}

async function reservasDoProduto(db, id) {
  if (!hasTable('V_RESERVAS')) return [];
  const rows = await query(db, `
    SELECT ID_PRODUTO, DESCRICAO, TIPO, NUMERO, QTD_RESERVADA, DT_DOCUMENTO, CLIENTE
    FROM V_RESERVAS
    WHERE ID_PRODUTO = ?
    ORDER BY DT_DOCUMENTO DESC`, [id]);
  return rows.map((r) => ({
    tipo: String(r.TIPO || '').trim(),
    numero: num(r.NUMERO),
    qtd: num(r.QTD_RESERVADA),
    data: dataBr(r.DT_DOCUMENTO),
    cliente: String(r.CLIENTE || '').trim(),
    descricao: String(r.DESCRICAO || '').trim(),
    origem: 'reserva',
  }));
}

async function doProduto(idIdentificador) {
  const id = num(idIdentificador);
  if (!id) throw new Error('Produto inválido.');
  return withDb(async (db, appCfg) => {
    const reservas = await reservasDoProduto(db, id);
    if (!hasTable('TB_PEDIDO_VENDA')) return { reservas, condicionais: [] };
    const rows = await query(db, `
      ${await sqlPedido(db)}
      WHERE EXISTS (
        SELECT 1 FROM TB_PED_VENDA_ITEM I
        WHERE I.ID_PEDIDO = P.ID_PEDIDO
          AND I.ID_IDENTIFICADOR = ?
          AND COALESCE(TRIM(I.ITEM_CANCEL), 'N') <> 'S'
      )
        AND TRIM(S.RESERVA) = 'S'
      ORDER BY P.DT_PEDIDO DESC, P.ID_PEDIDO DESC`, [id]);
    const condicionais = [];
    for (const r of rows) {
      const doc = mapPedido(r);
      doc.itens = await itensDoPedido(db, appCfg, doc.id);
      const desta = doc.itens.find((it) => it.id_identificador === id);
      doc.qtd = desta ? desta.qtd : 0;
      doc.total = doc.itens.reduce((s, it) => s + num(it.total), 0);
      condicionais.push(doc);
    }
    const numeros = new Set(condicionais.map((c) => c.id));
    return {
      condicionais,
      reservas: reservas.filter((r) => !/ped/i.test(r.tipo) || !numeros.has(r.numero)),
    };
  });
}

async function buscarClientes(q) {
  const termo = String(q || '').trim();
  if (termo.length < 1) return [];
  return withDb(async (db) => {
    const rows = await query(db, `
      SELECT FIRST 12 ID_CLIENTE, NOME, FONE_CELUL, FONE_RESID
      FROM TB_CLIENTE
      WHERE UPPER(NOME) CONTAINING UPPER(?)
      ORDER BY NOME`, [termo]);
    return rows.map((r) => ({
      id_cliente: num(r.ID_CLIENTE),
      nome: String(r.NOME || '').trim(),
      telefone: foneCliente(r),
    }));
  });
}

async function buscarPecas(q) {
  const termo = String(q || '').trim();
  if (termo.length < 1) return [];
  return withDb(async (db, appCfg) => {
    const t = activeTargets(appCfg)[0]?.tables;
    if (!t) return [];
    const soNumero = /^\d+$/.test(termo);
    let where;
    let params;
    if (soNumero) {
      const n = Number(termo);
      const cabeInteiro = Number.isSafeInteger(n) && n <= 2147483647;
      const longo = termo.length > 5;
      where = `(
        ${cabeInteiro ? 'I.ID_IDENTIFICADOR = ? OR E.ID_ESTOQUE = ? OR ' : ''}
        TRIM(CAST(P.COD_BARRA AS VARCHAR(60))) = ?
        OR TRIM(CAST(P.REFERENCIA AS VARCHAR(60))) = ?
        ${longo ? `OR TRIM(CAST(P.COD_BARRA AS VARCHAR(60))) CONTAINING ?
        OR TRIM(CAST(P.REFERENCIA AS VARCHAR(60))) CONTAINING ?` : ''}
      )`;
      params = [];
      if (cabeInteiro) params.push(n, n);
      params.push(termo, termo);
      if (longo) params.push(termo, termo);
    } else {
      const termos = termo.split(/\s+/).map((p) => p.trim()).filter((p) => p.length >= 2);
      const lista = termos.length ? termos : [termo];
      where = lista.map(() => `(
        UPPER(E.DESCRICAO) CONTAINING UPPER(?)
        OR UPPER(COALESCE(P.COD_BARRA, '')) CONTAINING UPPER(?)
        OR UPPER(COALESCE(P.REFERENCIA, '')) CONTAINING UPPER(?)
      )`).join(' AND ');
      params = lista.flatMap((p) => [p, p, p]);
    }
    const temReserv = await columnExists(db, t.produto, 'QTD_RESERV');
    if (Number(appCfg?.somente_com_estoque ?? loadAppConfig().somente_com_estoque) === 1) {
      const saldo = temReserv
        ? 'COALESCE(P.QTD_ATUAL, 0) - COALESCE(P.QTD_RESERV, 0)'
        : 'COALESCE(P.QTD_ATUAL, 0)';
      where = `(${where}) AND ${saldo} > 0`;
    }
    const rows = await query(db, `
      SELECT FIRST 20 I.ID_IDENTIFICADOR, E.ID_ESTOQUE, E.DESCRICAO, E.PRC_VENDA,
             P.COD_BARRA, P.REFERENCIA, P.QTD_ATUAL${temReserv ? ', P.QTD_RESERV' : ''},
             E.GRADE_SERIE, N1.DESCRICAO AS COR, N2.DESCRICAO AS TAMANHO
      FROM ${t.estoque} E
      JOIN ${t.identificador} I ON I.ID_ESTOQUE = E.ID_ESTOQUE
      JOIN ${t.produto} P ON P.ID_IDENTIFICADOR = I.ID_IDENTIFICADOR
      LEFT JOIN ${t.nivel1} N1 ON N1.ID_NIVEL1 = P.ID_NIVEL1
      LEFT JOIN ${t.nivel2} N2 ON N2.ID_NIVEL2 = P.ID_NIVEL2
      WHERE (E.STATUS = 'A' OR E.STATUS IS NULL) AND ${where}
      ORDER BY I.ID_IDENTIFICADOR`, params);
    return rows.map((r) => ({
      id_identificador: num(r.ID_IDENTIFICADOR),
      id_estoque: num(r.ID_ESTOQUE),
      descricao: nomeGrade(r.DESCRICAO, r.GRADE_SERIE, r.COR, r.TAMANHO),
      cod_barras: String(r.COD_BARRA || '').trim(),
      referencia: String(r.REFERENCIA || '').trim(),
      prc_venda: num(r.PRC_VENDA),
      qtd_atual: num(r.QTD_ATUAL),
      qtd_disponivel: disponivelDe(r, temReserv),
    }));
  });
}

function dataInformada(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function listarVendedores() {
  return withDb(async (db) => {
    const temStatus = await columnExists(db, 'TB_FUNCIONARIO', 'STATUS');
    const where = temStatus ? `WHERE COALESCE(STATUS, 'A') <> 'I'` : '';
    const rows = await query(db, `
      SELECT ID_FUNCIONARIO, NOME FROM TB_FUNCIONARIO ${where} ORDER BY NOME`);
    return rows.map((r) => ({ id_funcionario: num(r.ID_FUNCIONARIO), nome: String(r.NOME || '').trim() }));
  });
}

function disponivelDe(row, temReserv) {
  const atual = num(row?.QTD_ATUAL);
  const reserv = temReserv ? num(row?.QTD_RESERV) : 0;
  return Math.round((atual - reserv) * 1000) / 1000;
}

function textoQtd(n) {
  return num(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

async function resolverStatus(db, idStatus) {
  if (num(idStatus)) {
    const row = await query(db, `
      SELECT ID_STATUS FROM TB_PED_VENDA_STATUS
      WHERE ID_STATUS = ? AND COALESCE(STATUS, 'A') = 'A'`, [num(idStatus)]);
    if (!row.length) throw new Error('Situação do condicional inválida.');
    return num(row[0].ID_STATUS);
  }
  const st = await query(db, `
    SELECT FIRST 1 ID_STATUS FROM TB_PED_VENDA_STATUS
    WHERE TRIM(RESERVA) = 'S' AND COALESCE(STATUS, 'A') = 'A'
    ORDER BY CASE WHEN UPPER(DESCRICAO) CONTAINING 'RESERV' THEN 0 ELSE 1 END, ID_STATUS`);
  if (!st.length) throw new Error('Não há status de pedido configurado para reservar estoque.');
  return num(st[0].ID_STATUS);
}

/** 32 hex, no mesmo formato da CHAVE que o Clipp grava ao fechar o DAV. */
function chaveClipp() {
  return crypto.randomBytes(16).toString('hex').toUpperCase();
}

function textoVazio(v) {
  return v == null || String(v).trim() === '';
}

async function colunasFechamento(db) {
  const item = ['ID_SEQUENCIA_DAV', 'CHAVE', 'DT_LACTO', 'CASAS_QTD', 'CASAS_VLR', 'ST', 'ALIQUOTA', 'VLR_IPI', 'ID_AGRUPAMENTO', 'USOU_VALOR_PROMOCIONAL'];
  const tem = {};
  for (const nome of item) tem[nome] = await columnExists(db, 'TB_PED_VENDA_ITEM', nome);
  tem.CHAVE_PEDIDO = await columnExists(db, 'TB_PEDIDO_VENDA', 'CHAVE');
  return tem;
}

async function casasClipp(db) {
  let qtd = '2';
  let vlr = '2';
  if (hasTable('TB_PARAMETRO')) {
    const rows = await query(db, `
      SELECT TRIM(INFORMACAO) AS I, TRIM(CONTEUDO) AS C
      FROM TB_PARAMETRO
      WHERE INFORMACAO IN ('CASAS_DEC_QTDE', 'CASAS_DEC_PRECO')`);
    const map = new Map(rows.map((r) => [String(r.I || '').trim(), String(r.C || '').trim()]));
    qtd = (map.get('CASAS_DEC_QTDE') || qtd).replace(/\D/g, '').slice(0, 1) || '2';
    vlr = (map.get('CASAS_DEC_PRECO') || vlr).replace(/\D/g, '').slice(0, 1) || '2';
  }
  return { qtd, vlr };
}

async function tributoPadrao(tx, cache) {
  if (cache.has(0)) return cache.get(0);
  const rows = await query(tx, `
    SELECT FIRST 1 TRIM(ST) AS ST, ALIQUOTA
    FROM TB_PED_VENDA_ITEM
    WHERE ST IS NOT NULL AND DT_LACTO IS NOT NULL
    ORDER BY ID_ITEMPED DESC`);
  const padrao = {
    st: String(rows[0]?.ST || 'T').trim().slice(0, 1) || 'T',
    aliquota: rows.length ? num(rows[0].ALIQUOTA) : 0,
  };
  cache.set(0, padrao);
  return padrao;
}

async function tributoProduto(tx, idIdentificador, cache) {
  const id = num(idIdentificador);
  if (cache.has(id)) return cache.get(id);
  const rows = await query(tx, `
    SELECT FIRST 1 TRIM(ST) AS ST, ALIQUOTA
    FROM TB_PED_VENDA_ITEM
    WHERE ID_IDENTIFICADOR = ? AND ST IS NOT NULL AND DT_LACTO IS NOT NULL
    ORDER BY ID_ITEMPED DESC`, [id]);
  const padrao = await tributoPadrao(tx, cache);
  const achou = String(rows[0]?.ST || '').trim();
  const out = achou
    ? { st: achou.slice(0, 1), aliquota: num(rows[0].ALIQUOTA) }
    : padrao;
  cache.set(id, out);
  return out;
}

/**
 * O Clipp só considera o item preso a este condicional quando a linha tem chave,
 * sequência e data de lançamento. Sem isso, o próximo condicional aberto no sistema
 * reaproveita estas peças.
 */
async function fecharItensNoPedido(tx, cols, casas, idPedido) {
  const id = num(idPedido);
  const itens = await query(tx, `
    SELECT ID_ITEMPED, ID_IDENTIFICADOR
    FROM TB_PED_VENDA_ITEM
    WHERE ID_PEDIDO = ?
    ORDER BY ID_ITEMPED`, [id]);
  if (!itens.length) return;
  const cache = new Map();
  let sequencia = 0;
  if (cols.ID_SEQUENCIA_DAV) {
    const max = await query(tx, `
      SELECT COALESCE(MAX(ID_SEQUENCIA_DAV), 0) AS M
      FROM TB_PED_VENDA_ITEM WHERE ID_PEDIDO = ?`, [id]);
    sequencia = num(max[0]?.M);
  }
  for (const it of itens) {
    const campos = ['CHAVE', 'DT_LACTO', 'CASAS_QTD', 'CASAS_VLR', 'ST', 'ALIQUOTA', 'VLR_IPI', 'ID_AGRUPAMENTO', 'USOU_VALOR_PROMOCIONAL', 'ID_SEQUENCIA_DAV']
      .filter((nome) => cols[nome]);
    if (!campos.length) continue;
    const row = (await query(tx, `
      SELECT ${campos.join(', ')}
      FROM TB_PED_VENDA_ITEM
      WHERE ID_ITEMPED = ? AND ID_PEDIDO = ?`, [num(it.ID_ITEMPED), id]))[0];
    if (!row) continue;
    const sets = [];
    const params = [];
    if (cols.CHAVE && textoVazio(row.CHAVE)) {
      sets.push('CHAVE = ?');
      params.push(chaveClipp());
    }
    if (cols.DT_LACTO && !row.DT_LACTO) sets.push('DT_LACTO = CURRENT_DATE');
    if (cols.CASAS_QTD && textoVazio(row.CASAS_QTD)) {
      sets.push('CASAS_QTD = ?');
      params.push(casas.qtd);
    }
    if (cols.CASAS_VLR && textoVazio(row.CASAS_VLR)) {
      sets.push('CASAS_VLR = ?');
      params.push(casas.vlr);
    }
    if (cols.ST && textoVazio(row.ST)) {
      const trib = await tributoProduto(tx, it.ID_IDENTIFICADOR, cache);
      sets.push('ST = ?');
      params.push(trib.st);
      if (cols.ALIQUOTA && row.ALIQUOTA == null) {
        sets.push('ALIQUOTA = ?');
        params.push(trib.aliquota);
      }
    } else if (cols.ALIQUOTA && row.ALIQUOTA == null) {
      sets.push('ALIQUOTA = 0');
    }
    if (cols.VLR_IPI && row.VLR_IPI == null) sets.push('VLR_IPI = 0');
    if (cols.ID_AGRUPAMENTO && row.ID_AGRUPAMENTO == null) sets.push('ID_AGRUPAMENTO = 0');
    if (cols.USOU_VALOR_PROMOCIONAL && row.USOU_VALOR_PROMOCIONAL == null) sets.push('USOU_VALOR_PROMOCIONAL = 0');
    if (cols.ID_SEQUENCIA_DAV && !num(row.ID_SEQUENCIA_DAV)) {
      sequencia += 1;
      sets.push('ID_SEQUENCIA_DAV = ?');
      params.push(sequencia);
    }
    if (!sets.length) continue;
    params.push(num(it.ID_ITEMPED), id);
    await query(tx, `
      UPDATE TB_PED_VENDA_ITEM
      SET ${sets.join(', ')}
      WHERE ID_ITEMPED = ? AND ID_PEDIDO = ?`, params);
  }
  if (!cols.CHAVE_PEDIDO) return;
  const cab = await query(tx, 'SELECT CHAVE FROM TB_PEDIDO_VENDA WHERE ID_PEDIDO = ?', [id]);
  if (!cab.length || !textoVazio(cab[0].CHAVE)) return;
  await query(tx, `
    UPDATE TB_PEDIDO_VENDA
    SET CHAVE = ?
    WHERE ID_PEDIDO = ? AND (CHAVE IS NULL OR TRIM(CHAVE) = '')`, [chaveClipp(), id]);
}

let selagemFeita = false;

/** Condicionais já gravados sem chave continuariam vazando no próximo lançamento do Clipp. */
async function selarCondicionaisAntigos(db) {
  if (selagemFeita) return 0;
  if (!hasTable('GESTOR_COND_TOTAL') || !hasTable('TB_PEDIDO_VENDA') || !hasTable('TB_PED_VENDA_ITEM')) {
    selagemFeita = true;
    return 0;
  }
  const cols = await colunasFechamento(db);
  const partes = [];
  if (cols.CHAVE_PEDIDO) partes.push("(P.CHAVE IS NULL OR TRIM(P.CHAVE) = '')");
  const solto = [];
  if (cols.CHAVE) solto.push("(I.CHAVE IS NULL OR TRIM(I.CHAVE) = '')");
  if (cols.ID_SEQUENCIA_DAV) solto.push('I.ID_SEQUENCIA_DAV IS NULL');
  if (cols.DT_LACTO) solto.push('I.DT_LACTO IS NULL');
  if (solto.length) {
    partes.push(`EXISTS (
      SELECT 1 FROM TB_PED_VENDA_ITEM I
      WHERE I.ID_PEDIDO = T.ID_PEDIDO AND (${solto.join(' OR ')})
    )`);
  }
  if (!partes.length) {
    selagemFeita = true;
    return 0;
  }
  const casas = await casasClipp(db);
  const pedidos = await query(db, `
    SELECT T.ID_PEDIDO
    FROM GESTOR_COND_TOTAL T
    JOIN TB_PEDIDO_VENDA P ON P.ID_PEDIDO = T.ID_PEDIDO
    WHERE ${partes.join(' OR ')}`);
  let fechados = 0;
  let pulados = 0;
  for (const pedido of pedidos) {
    try {
      await withTransaction(db, async (tx) => {
        await fecharItensNoPedido(tx, cols, casas, pedido.ID_PEDIDO);
      }, { waitTimeout: 3 });
      fechados += 1;
    } catch (err) {
      pulados += 1;
      if (!/deadlock|lock conflict|lock time-?out|concurrent update/i.test(String(err?.message || err))) throw err;
    }
  }
  if (!pulados) selagemFeita = true;
  return fechados;
}

async function ensureCondTotal(db) {
  const tem = await query(db, `
    SELECT 1 AS OK FROM RDB$RELATIONS WHERE TRIM(RDB$RELATION_NAME) = 'GESTOR_COND_TOTAL'`);
  if (tem.length) return;
  await query(db, `
    CREATE TABLE GESTOR_COND_TOTAL (
      ID_PEDIDO INTEGER NOT NULL,
      VLR_FRETE NUMERIC(15,2),
      VLR_DESC NUMERIC(15,2),
      VLR_ACRESC NUMERIC(15,2),
      CONSTRAINT PK_GESTOR_COND_TOTAL PRIMARY KEY (ID_PEDIDO)
    )`);
  await refreshTables(db);
}

async function totaisCondicional(db, idPedido) {
  const tem = await query(db, `
    SELECT 1 AS OK FROM RDB$RELATIONS WHERE TRIM(RDB$RELATION_NAME) = 'GESTOR_COND_TOTAL'`);
  if (!tem.length) return { frete: 0, desconto_geral: 0, acrescimo_geral: 0 };
  const rows = await query(db, `
    SELECT VLR_FRETE, VLR_DESC, VLR_ACRESC FROM GESTOR_COND_TOTAL WHERE ID_PEDIDO = ?`, [idPedido]);
  return {
    frete: num(rows[0]?.VLR_FRETE),
    desconto_geral: num(rows[0]?.VLR_DESC),
    acrescimo_geral: num(rows[0]?.VLR_ACRESC),
  };
}

function totalDocumento(doc) {
  const subtotal = (doc.itens || []).reduce((s, it) => s + Math.max(0, num(it.total) - num(it.desconto)), 0);
  return Math.max(0, subtotal + num(doc.frete) - num(doc.desconto_geral) + num(doc.acrescimo_geral));
}

function descontoExibido(doc) {
  const itens = (doc.itens || []).reduce((s, it) => s + num(it.desconto), 0);
  return itens + num(doc.desconto_geral);
}

function acrescimoExibido(doc) {
  const itens = (doc.itens || []).reduce((s, it) => s + num(it.acrescimo), 0);
  return itens + num(doc.acrescimo_geral);
}

async function criar({ idCliente, idFuncionario, obs, itens, validade, idStatus, idParcela, frete, desconto, acrescimo }) {
  const itensOk = (itens || []).map((it) => ({
    id: num(it.id_identificador || it.id),
    qtd: num(it.qtd),
    prc: num(it.prc_venda != null ? it.prc_venda : it.prc_unit),
    desconto: Math.max(0, num(it.desconto)),
    acrescimo: Math.max(0, num(it.acrescimo)),
  })).filter((it) => it.id > 0 && it.qtd > 0);
  if (!num(idCliente)) throw new Error('Selecione o cliente na lista.');
  if (!num(idFuncionario)) throw new Error('Informe o vendedor.');
  if (!itensOk.length) throw new Error('Inclua ao menos uma peça.');
  const dtValidade = dataInformada(validade);
  if (!dtValidade) throw new Error('Informe a validade.');
  if (!num(idParcela)) throw new Error('Informe a forma de pagamento.');
  return withDb(async (db, appCfg) => {
    if (!hasTable('TB_PEDIDO_VENDA')) throw new Error('Esta base não tem pedido de venda.');
    const temValidade = await columnExists(db, 'TB_PEDIDO_VENDA', 'DT_VALIDA');
    if (!temValidade) throw new Error('Esta base não tem o campo de validade no pedido.');
    const t = writeTargets(appCfg)[0]?.tables;
    if (!t) throw new Error('Estoque não encontrado nesta base.');
    const idStatusPedido = await resolverStatus(db, idStatus);
    const pagamento = await resolverPagamento(db, idParcela);
    const temReserv = await columnExists(db, t.produto, 'QTD_RESERV');
    const mod = await query(db, `
      SELECT FIRST 1 P.ID_MODULO
      FROM TB_PEDIDO_VENDA P
      JOIN TB_PED_VENDA_STATUS S ON S.ID_STATUS = P.ID_STATUS
      WHERE TRIM(S.RESERVA) = 'S' AND P.ID_MODULO IS NOT NULL`);
    const idModulo = num(mod[0]?.ID_MODULO) || 4;
    const fretePed = Math.max(0, num(frete));
    const descPed = Math.max(0, num(desconto));
    const acresPed = Math.max(0, num(acrescimo));
    await ensureCondTotal(db);
    try { await selarCondicionaisAntigos(db); } catch (err) { console.warn('Proteção dos condicionais:', err.message); }
    const colsFechamento = await colunasFechamento(db);
    const casas = await casasClipp(db);
    let ultimoErro = null;
    for (let tentativa = 0; tentativa < 3; tentativa += 1) {
      try {
        return await withTransaction(db, async (tx) => {
          const id = await proximoIdPedido(tx);
          const colsValidade = temValidade ? ', DT_VALIDA' : '';
          const valValidade = temValidade ? ', ?' : '';
          const paramsPedido = [
            num(idCliente), num(idFuncionario), id, pagamento.id_parcela, pagamento.id_fmapgto,
            idStatusPedido, idModulo, String(obs || '').slice(0, 300) || null,
          ];
          if (temValidade) paramsPedido.push(dtValidade);
          await query(tx, `
            INSERT INTO TB_PEDIDO_VENDA (
              ID_CLIENTE, ID_VENDEDOR, ID_PEDIDO, DT_PEDIDO, HR_PEDIDO,
              ID_PARCELA, ID_FMAPGTO, ID_STATUS, ID_MODULO, ORIGEM,
              UPDATED_INTEGRADORA, ENVIAR_INTEGRADORA, OBSERVACAO${colsValidade}
            ) VALUES (?, ?, ?, CURRENT_DATE, CURRENT_TIME, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, 'N', ?${valValidade})`, paramsPedido);
          const pedidoPorId = new Map();
          for (const it of itensOk) pedidoPorId.set(it.id, (pedidoPorId.get(it.id) || 0) + it.qtd);
          const estoqueVisto = new Set();
          const temFlagDesc = await columnExists(tx, 'TB_PED_VENDA_ITEM', 'EFETUOU_DESCONTO');
          for (const it of itensOk) {
            const prod = await query(tx, `
              SELECT FIRST 1 E.DESCRICAO, E.PRC_VENDA, E.PRC_CUSTO, P.COD_BARRA, P.QTD_ATUAL
                     ${temReserv ? ', P.QTD_RESERV' : ''}
              FROM ${t.produto} P
              JOIN ${t.identificador} I ON I.ID_IDENTIFICADOR = P.ID_IDENTIFICADOR
              JOIN ${t.estoque} E ON E.ID_ESTOQUE = I.ID_ESTOQUE
              WHERE P.ID_IDENTIFICADOR = ?`, [it.id]);
            if (!prod.length) throw new Error(`Produto ${it.id} não encontrado.`);
            const nome = String(prod[0].DESCRICAO || it.id).trim();
            if (!estoqueVisto.has(it.id)) {
              estoqueVisto.add(it.id);
              const disponivel = disponivelDe(prod[0], temReserv);
              const pedido = pedidoPorId.get(it.id) || it.qtd;
              if (!(disponivel > 0)) throw new Error(`${nome} está sem estoque. Não é possível lançar.`);
              if (pedido > disponivel + 0.0001) {
                throw new Error(`${nome} tem ${textoQtd(disponivel)} em estoque. Não é possível lançar ${textoQtd(pedido)}.`);
              }
            }
            const prc = it.prc > 0 ? it.prc : num(prod[0].PRC_VENDA);
            if (!(prc > 0)) throw new Error(`Informe o preço de ${nome}.`);
            const bruto = Math.round(it.qtd * prc * 100) / 100;
            const desc = Math.round(Math.min(it.desconto, bruto) * 100) / 100;
            const acres = Math.round(Math.max(0, it.acrescimo) * 100) / 100;
            const idItem = await nextGenIdSincronizado(tx, GENERATORS_ITEM_PEDIDO, 'TB_PED_VENDA_ITEM', 'ID_ITEMPED');
            await query(tx, `
              INSERT INTO TB_PED_VENDA_ITEM (
                ID_ITEMPED, QTD_ITEM, VLR_TOTAL, PRC_CUSTO, PRC_LISTA, VLR_DESC,
                ID_IDENTIFICADOR, ID_PEDIDO, ITEM_CANCEL, VLR_UNIT, COD_BARRA, UPDATED_INTEGRADORA
                ${temFlagDesc ? ', EFETUOU_DESCONTO' : ''}
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'N', ?, ?, CURRENT_TIMESTAMP${temFlagDesc ? ', ?' : ''})`, [
              idItem, it.qtd, bruto + acres, num(prod[0].PRC_CUSTO), prc, desc,
              it.id, id, prc, String(prod[0].COD_BARRA || '').slice(0, 20) || null,
              ...(temFlagDesc ? [desc > 0 ? 1 : 0] : []),
            ]);
          }
          await query(tx, `
            UPDATE OR INSERT INTO GESTOR_COND_TOTAL (ID_PEDIDO, VLR_FRETE, VLR_DESC, VLR_ACRESC)
            VALUES (?, ?, ?, ?)
            MATCHING (ID_PEDIDO)`, [id, fretePed, descPed, acresPed]);
          /* O Clipp preenche TB_PED_VENDA_NOME e o total no AFTER UPDATE.
             Sem esse toque o nome não aparece e a venda não importa o pedido. */
          await query(tx, `
            UPDATE TB_PEDIDO_VENDA
            SET UPDATED_INTEGRADORA = CURRENT_TIMESTAMP
            WHERE ID_PEDIDO = ?`, [id]);
          await fecharItensNoPedido(tx, colsFechamento, casas, id);
          return { id };
        });
      } catch (err) {
        ultimoErro = err;
        if (!/UNIQUE|PRIMARY|violation/i.test(String(err.message || '')) || tentativa === 2) throw erroDeBloqueio(err);
      }
    }
    throw ultimoErro || new Error('Não foi possível lançar o condicional.');
  });
}

async function atualizar(idPedido, { idCliente, idFuncionario, obs, itens, validade, idStatus, idParcela, frete, desconto, acrescimo }) {
  const codigo = num(idPedido);
  if (!codigo) throw new Error('Condicional inválido.');
  const itensOk = (itens || []).map((it) => ({
    itemId: num(it.id_item || it.id_itemped),
    id: num(it.id_identificador || it.id),
    qtd: num(it.qtd),
    prc: num(it.prc_venda != null ? it.prc_venda : it.prc_unit),
    desconto: Math.max(0, num(it.desconto)),
    acrescimo: Math.max(0, num(it.acrescimo)),
  })).filter((it) => it.id > 0 && it.qtd > 0);
  if (!num(idCliente)) throw new Error('Selecione o cliente na lista.');
  if (!num(idFuncionario)) throw new Error('Informe o vendedor.');
  if (!itensOk.length) throw new Error('Inclua ao menos uma peça.');
  const dtValidade = dataInformada(validade);
  if (!dtValidade) throw new Error('Informe a validade.');
  if (!num(idParcela)) throw new Error('Informe a forma de pagamento.');
  return withDb(async (db, appCfg) => {
    if (!hasTable('TB_PEDIDO_VENDA')) throw new Error('Esta base não tem pedido de venda.');
    const temValidade = await columnExists(db, 'TB_PEDIDO_VENDA', 'DT_VALIDA');
    const t = writeTargets(appCfg)[0]?.tables;
    if (!t) throw new Error('Estoque não encontrado nesta base.');
    const temReserv = await columnExists(db, t.produto, 'QTD_RESERV');
    const temFlagDesc = await columnExists(db, 'TB_PED_VENDA_ITEM', 'EFETUOU_DESCONTO');
    await ensureCondTotal(db);
    try { await selarCondicionaisAntigos(db); } catch (err) { console.warn('Proteção dos condicionais:', err.message); }
    const colsFechamento = await colunasFechamento(db);
    const casas = await casasClipp(db);
    try {
      return await withTransaction(db, async (tx) => {
        const cab = await query(tx, 'SELECT ID_PEDIDO, ID_STATUS FROM TB_PEDIDO_VENDA WHERE ID_PEDIDO = ?', [codigo]);
        if (!cab.length) throw new Error('Condicional não encontrado.');
        const reservaDe = async (idSt) => {
          const rows = await query(tx, 'SELECT TRIM(RESERVA) AS RESERVA FROM TB_PED_VENDA_STATUS WHERE ID_STATUS = ?', [idSt]);
          return String(rows[0]?.RESERVA || '').toUpperCase() === 'S';
        };
        const reservava = await reservaDe(cab[0].ID_STATUS);
        const idStatusPedido = await resolverStatus(tx, idStatus);
        const pagamento = await resolverPagamento(tx, idParcela);
        const atuais = await query(tx, `
          SELECT ID_ITEMPED, ID_IDENTIFICADOR, QTD_ITEM
          FROM TB_PED_VENDA_ITEM
          WHERE ID_PEDIDO = ? AND COALESCE(TRIM(ITEM_CANCEL), 'N') <> 'S'`, [codigo]);
        const reservadoAntes = new Map();
        if (reservava) {
          for (const row of atuais) {
            const idProd = num(row.ID_IDENTIFICADOR);
            reservadoAntes.set(idProd, (reservadoAntes.get(idProd) || 0) + num(row.QTD_ITEM));
          }
        }
        const pedidoPorId = new Map();
        for (const it of itensOk) pedidoPorId.set(it.id, (pedidoPorId.get(it.id) || 0) + it.qtd);
        for (const [idProd, qtdPed] of pedidoPorId) {
          const prod = await query(tx, `
            SELECT FIRST 1 E.DESCRICAO, P.QTD_ATUAL ${temReserv ? ', P.QTD_RESERV' : ''}
            FROM ${t.produto} P
            JOIN ${t.identificador} I ON I.ID_IDENTIFICADOR = P.ID_IDENTIFICADOR
            JOIN ${t.estoque} E ON E.ID_ESTOQUE = I.ID_ESTOQUE
            WHERE P.ID_IDENTIFICADOR = ?`, [idProd]);
          if (!prod.length) throw new Error(`Produto ${idProd} não encontrado.`);
          const nome = String(prod[0].DESCRICAO || idProd).trim();
          const folga = reservadoAntes.get(idProd) || 0;
          const disponivel = disponivelDe(prod[0], temReserv) + folga;
          if (!(disponivel > 0)) throw new Error(`${nome} está sem estoque. Não é possível lançar.`);
          if (qtdPed > disponivel + 0.0001) {
            throw new Error(`${nome} tem ${textoQtd(disponivel)} em estoque. Não é possível lançar ${textoQtd(qtdPed)}.`);
          }
        }
        const mantidos = new Set();
        const gravarNovo = async (it) => {
          const prod = await query(tx, `
            SELECT FIRST 1 E.PRC_CUSTO, P.COD_BARRA
            FROM ${t.produto} P
            JOIN ${t.identificador} I ON I.ID_IDENTIFICADOR = P.ID_IDENTIFICADOR
            JOIN ${t.estoque} E ON E.ID_ESTOQUE = I.ID_ESTOQUE
            WHERE P.ID_IDENTIFICADOR = ?`, [it.id]);
          const prc = it.prc;
          const bruto = Math.round(it.qtd * prc * 100) / 100;
          const desc = Math.round(Math.min(it.desconto, bruto) * 100) / 100;
          const acres = Math.round(Math.max(0, it.acrescimo) * 100) / 100;
          const idItem = await nextGenIdSincronizado(tx, GENERATORS_ITEM_PEDIDO, 'TB_PED_VENDA_ITEM', 'ID_ITEMPED');
          await query(tx, `
            INSERT INTO TB_PED_VENDA_ITEM (
              ID_ITEMPED, QTD_ITEM, VLR_TOTAL, PRC_CUSTO, PRC_LISTA, VLR_DESC,
              ID_IDENTIFICADOR, ID_PEDIDO, ITEM_CANCEL, VLR_UNIT, COD_BARRA, UPDATED_INTEGRADORA
              ${temFlagDesc ? ', EFETUOU_DESCONTO' : ''}
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'N', ?, ?, CURRENT_TIMESTAMP${temFlagDesc ? ', ?' : ''})`, [
            idItem, it.qtd, bruto + acres, num(prod[0]?.PRC_CUSTO), prc, desc,
            it.id, codigo, prc, String(prod[0]?.COD_BARRA || '').slice(0, 20) || null,
            ...(temFlagDesc ? [desc > 0 ? 1 : 0] : []),
          ]);
        };
        for (const it of itensOk) {
          const linha = it.itemId ? atuais.find((a) => num(a.ID_ITEMPED) === it.itemId) : null;
          if (linha && num(linha.ID_IDENTIFICADOR) === it.id) {
            const prod = await query(tx, `
              SELECT FIRST 1 P.COD_BARRA, E.PRC_CUSTO
              FROM ${t.produto} P
              JOIN ${t.identificador} I ON I.ID_IDENTIFICADOR = P.ID_IDENTIFICADOR
              JOIN ${t.estoque} E ON E.ID_ESTOQUE = I.ID_ESTOQUE
              WHERE P.ID_IDENTIFICADOR = ?`, [it.id]);
            const bruto = Math.round(it.qtd * it.prc * 100) / 100;
            const desc = Math.round(Math.min(it.desconto, bruto) * 100) / 100;
            const acres = Math.round(Math.max(0, it.acrescimo) * 100) / 100;
            await query(tx, `
              UPDATE TB_PED_VENDA_ITEM
              SET QTD_ITEM = ?, VLR_TOTAL = ?, PRC_CUSTO = ?, PRC_LISTA = ?, VLR_DESC = ?,
                  VLR_UNIT = ?, COD_BARRA = ?, UPDATED_INTEGRADORA = CURRENT_TIMESTAMP
                  ${temFlagDesc ? ', EFETUOU_DESCONTO = ?' : ''}
              WHERE ID_ITEMPED = ? AND ID_PEDIDO = ?`, [
              it.qtd, bruto + acres, num(prod[0]?.PRC_CUSTO), it.prc, desc,
              it.prc, String(prod[0]?.COD_BARRA || '').slice(0, 20) || null,
              ...(temFlagDesc ? [desc > 0 ? 1 : 0] : []),
              it.itemId, codigo,
            ]);
            mantidos.add(it.itemId);
          } else {
            if (linha) {
              await query(tx, `
                UPDATE TB_PED_VENDA_ITEM SET ITEM_CANCEL = 'S', UPDATED_INTEGRADORA = CURRENT_TIMESTAMP
                WHERE ID_ITEMPED = ? AND ID_PEDIDO = ?`, [it.itemId, codigo]);
              mantidos.add(it.itemId);
            }
            await gravarNovo(it);
          }
        }
        for (const row of atuais) {
          const idItem = num(row.ID_ITEMPED);
          if (mantidos.has(idItem)) continue;
          await query(tx, `
            UPDATE TB_PED_VENDA_ITEM SET ITEM_CANCEL = 'S', UPDATED_INTEGRADORA = CURRENT_TIMESTAMP
            WHERE ID_ITEMPED = ? AND ID_PEDIDO = ?`, [idItem, codigo]);
        }
        const sets = [
          'ID_CLIENTE = ?', 'ID_VENDEDOR = ?', 'ID_PARCELA = ?', 'ID_FMAPGTO = ?',
          'ID_STATUS = ?', 'OBSERVACAO = ?', 'UPDATED_INTEGRADORA = CURRENT_TIMESTAMP',
        ];
        const paramsCab = [
          num(idCliente), num(idFuncionario), pagamento.id_parcela, pagamento.id_fmapgto,
          idStatusPedido, String(obs || '').slice(0, 300) || null,
        ];
        if (temValidade) {
          sets.push('DT_VALIDA = ?');
          paramsCab.push(dtValidade);
        }
        paramsCab.push(codigo);
        await query(tx, `UPDATE TB_PEDIDO_VENDA SET ${sets.join(', ')} WHERE ID_PEDIDO = ?`, paramsCab);
        await query(tx, `
          UPDATE OR INSERT INTO GESTOR_COND_TOTAL (ID_PEDIDO, VLR_FRETE, VLR_DESC, VLR_ACRESC)
          VALUES (?, ?, ?, ?)
          MATCHING (ID_PEDIDO)`, [codigo, Math.max(0, num(frete)), Math.max(0, num(desconto)), Math.max(0, num(acrescimo))]);
        await fecharItensNoPedido(tx, colsFechamento, casas, codigo);
        return { id: codigo };
      });
    } catch (err) {
      throw erroDeBloqueio(err);
    }
  });
}

function textoValidade(valor, doc) {
  const bruto = String(valor || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(bruto)) {
    const [y, m, d] = bruto.split('-');
    return `${d}/${m}/${y}`;
  }
  return bruto || doc.validade || '____/____/________';
}

function limpo(v) {
  return String(v || '').replace(/\s+/g, ' ').trim();
}

function foneLoja(ddd, numero) {
  const d = limpo(ddd);
  const n = limpo(numero);
  if (!n) return '';
  return d ? `(${d}) ${n}` : n;
}

function montarLoja(row) {
  if (!row) return { nome: '', endereco: '', telefone: '' };
  const rua = [limpo(row.END_TIPO), limpo(row.END_LOGRAD)].filter(Boolean).join(' ');
  const numero = [limpo(row.END_NUMERO), limpo(row.END_COMPLE)].filter(Boolean).join(' ');
  const linha1 = [rua, numero].filter(Boolean).join(', ');
  const comBairro = [linha1, limpo(row.END_BAIRRO)].filter(Boolean).join(' - ');
  const cidade = [limpo(row.CIDADE), limpo(row.SIGLA_UF)].filter(Boolean).join('/');
  const cep = limpo(row.END_CEP);
  const linha2 = [cidade, cep ? `CEP ${cep}` : ''].filter(Boolean).join(' · ');
  const telefone = foneLoja(row.DDD_COMER, row.FONE_COMER) || foneLoja(row.DDD_CELUL, row.FONE_CELUL);
  return {
    nome: limpo(row.NOME_FANTA) || limpo(row.NOME),
    endereco: [comBairro, linha2].filter(Boolean).join('\n'),
    telefone: telefone ? `Tel. ${telefone}` : '',
  };
}

async function lojaEmitente() {
  return withDb(async (db) => {
    const cidade = hasTable('TB_CIDADE_SIS')
      ? 'C.NOME AS CIDADE, C.SIGLA_UF'
      : 'CAST(NULL AS VARCHAR(80)) AS CIDADE, CAST(NULL AS VARCHAR(8)) AS SIGLA_UF';
    const join = hasTable('TB_CIDADE_SIS')
      ? 'LEFT JOIN TB_CIDADE_SIS C ON C.ID_CIDADE = E.ID_CIDADE'
      : '';
    const rows = await query(db, `
      SELECT FIRST 1 E.NOME_FANTA, E.NOME, E.END_TIPO, E.END_LOGRAD, E.END_NUMERO, E.END_COMPLE,
             E.END_BAIRRO, E.END_CEP, E.DDD_COMER, E.FONE_COMER, E.DDD_CELUL, E.FONE_CELUL,
             ${cidade}
      FROM TB_EMITENTE E
      ${join}`);
    return montarLoja(rows[0]);
  });
}

function lojaDe(empresa) {
  if (empresa && typeof empresa === 'object') {
    return {
      nome: limpo(empresa.nome),
      endereco: String(empresa.endereco || ''),
      telefone: limpo(empresa.telefone),
    };
  }
  return { nome: limpo(empresa), endereco: '', telefone: '' };
}

function htmlPdf(doc, empresa, opcoes = {}) {
  const formato = ['a4', 'meia', '80'].includes(opcoes.formato) ? opcoes.formato : 'a4';
  const validade = textoValidade(opcoes.validade, doc);
  const termico = formato === '80';
  const loja = lojaDe(empresa);
  const page = termico
    ? '@page { size: 80mm auto; margin: 4mm 3mm; }'
    : formato === 'meia'
      ? '@page { size: 148mm 210mm portrait; margin: 10mm 9mm 12mm; }'
      : '@page { size: A4 portrait; margin: 16mm 14mm 18mm; }';
  const tela = termico
    ? 'width:72mm;margin:8px auto;padding:4mm 3mm;font-size:12px;'
    : formato === 'meia'
      ? 'max-width:148mm;margin:0 auto;padding:10mm 9mm 12mm;'
      : 'max-width:210mm;margin:0 auto;padding:16mm 14mm 18mm;';
  const endereco = String(loja.endereco || '').split('\n').filter(Boolean)
    .map((linha) => `<div>${esc(linha)}</div>`).join('');
  const itens = doc.itens || [];
  const corpo = termico
    ? itens.map((it) => `
      <div class="item">
        <strong>${it.id_identificador} · ${esc(it.descricao)}</strong>
        <div>${fmt(it.qtd)} ${esc(it.uni_medida || 'UN')} × ${money(it.prc_unit)}</div>
        <div class="num">Total ${money(Math.max(0, num(it.total) - num(it.desconto)))}</div>
      </div>`).join('')
    : `<table><thead><tr>
        <th>Identificador</th><th>Descrição</th><th>Qtd</th><th>Un</th><th>Unitário</th><th>Total</th>
      </tr></thead><tbody>${itens.map((it) => `
        <tr>
          <td>${it.id_identificador}</td>
          <td>${esc(it.descricao)}</td>
          <td class="num">${fmt(it.qtd)}</td>
          <td>${esc(it.uni_medida || 'UN')}</td>
          <td class="num">${money(it.prc_unit)}</td>
          <td class="num">${money(Math.max(0, num(it.total) - num(it.desconto)))}</td>
        </tr>`).join('')}</tbody></table>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Condicional ${doc.id}</title>
<style>
  ${page}
  body{font-family:Segoe UI,sans-serif;color:#152033;box-sizing:border-box;${tela}}
  .loja{text-align:center;border-bottom:2px solid #152033;padding-bottom:8px;margin:0 0 12px}
  .loja-nome{display:block;font-size:${termico ? '14px' : '18px'};letter-spacing:.02em}
  .loja div{font-size:${termico ? '10px' : '12px'};line-height:1.35}
  h1{font-size:${termico ? '15px' : '18px'};margin:10px 0 4px}
  table{width:100%;border-collapse:collapse;margin-top:10px}
  th,td{border-bottom:1px solid #d5dbe3;padding:5px 6px;text-align:left;font-size:${termico ? '10px' : '12px'}}
  .num{text-align:right} .muted{color:#5c6b7a;font-size:12px}
  .item{border-bottom:1px dashed #c5ced8;padding:6px 0}
  .total{margin-top:12px;font-size:${termico ? '13px' : '15px'}}
  .assina{margin-top:26px}
  .linha{border-bottom:1px solid #152033;height:28px;width:${termico ? '100%' : '220px'}}
  button{margin:0 0 12px;padding:8px 14px}
  @media print { body{margin:0;padding:0;max-width:none;width:auto} button{display:none} }
</style></head><body>
  <button type="button" onclick="if(parent!==window){parent.postMessage({tipo:'gestor-imprimir'}, location.origin)}else{window.print()}">Imprimir / Salvar PDF</button>
  <header class="loja">
    <strong class="loja-nome">${esc(loja.nome || 'Loja')}</strong>
    ${endereco}
    ${loja.telefone ? `<div>${esc(loja.telefone)}</div>` : ''}
  </header>
  <h1>Condicional ${doc.id}</h1>
  <p>Cliente: <strong>${esc(doc.cliente || '—')}</strong><br>
  Data: ${esc(doc.data)} ${esc(doc.horario)}<br>
  Validade: <strong>${esc(validade)}</strong><br>
  Vendedor: ${esc(doc.vendedor || '—')}<br>
  ${doc.pagamento ? `Pagamento: <strong>${esc(doc.pagamento)}</strong><br>` : ''}
  Situação: ${esc(doc.status_label)}</p>
  ${doc.obs ? `<p>Obs.: ${esc(doc.obs)}</p>` : ''}
  ${corpo}
  <p class="total">
    <strong>Peças: ${fmt(itens.reduce((s, it) => s + num(it.qtd), 0))}</strong><br>
    ${(num(doc.frete) || descontoExibido(doc) || acrescimoExibido(doc)) && num(doc.subtotal) ? `<span>Subtotal: ${money(itens.reduce((s, it) => s + Math.max(0, num(it.total) - num(it.acrescimo)), 0))}</span><br>` : ''}
    ${num(doc.frete) ? `<span>Frete: ${money(doc.frete)}</span><br>` : ''}
    ${descontoExibido(doc) ? `<span>Desconto: ${money(descontoExibido(doc))}</span><br>` : ''}
    ${acrescimoExibido(doc) ? `<span>Acréscimo: ${money(acrescimoExibido(doc))}</span><br>` : ''}
    <strong>Valor total: ${money(doc.total || totalDocumento(doc))}</strong>
  </p>
  <div class="assina"><div class="linha"></div><span>Assinatura do cliente</span></div>
</body></html>`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmt(n) {
  return num(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}
function money(n) {
  return num(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function alterarStatus(id, idStatus, idParcela) {
  const codigo = num(id);
  const status = num(idStatus);
  if (!codigo) throw new Error('Condicional inválido.');
  if (!status) throw new Error('Informe a situação.');
  return withDb(async (db) => {
    const st = await query(db, `
      SELECT ID_STATUS, DESCRICAO, RESERVA
      FROM TB_PED_VENDA_STATUS
      WHERE ID_STATUS = ? AND COALESCE(STATUS, 'A') = 'A'`, [status]);
    if (!st.length) throw new Error('Situação inválida.');
    const existe = await query(db, `
      SELECT P.ID_PEDIDO, P.ID_STATUS, P.ID_PARCELA, P.ID_MODULO, S.RESERVA
      FROM TB_PEDIDO_VENDA P
      LEFT JOIN TB_PED_VENDA_STATUS S ON S.ID_STATUS = P.ID_STATUS
      WHERE P.ID_PEDIDO = ?`, [codigo]);
    if (!existe.length) throw new Error('Condicional não encontrado.');
    const pagamento = num(idParcela) ? await resolverPagamento(db, idParcela) : null;
    const trocaPagamento = pagamento && pagamento.id_parcela !== num(existe[0].ID_PARCELA);
    if (status !== num(existe[0].ID_STATUS) || trocaPagamento) {
      try {
        await withTransaction(db, async (tx) => {
          if (trocaPagamento) {
            await query(tx, 'UPDATE TB_PEDIDO_VENDA SET ID_PARCELA = ?, ID_FMAPGTO = ? WHERE ID_PEDIDO = ?', [
              pagamento.id_parcela, pagamento.id_fmapgto, codigo,
            ]);
          }
          if (status !== num(existe[0].ID_STATUS)) {
            // Os triggers do Clipp acertam QTD_RESERV ao entrar ou sair de uma situação que reserva.
            await query(tx, 'UPDATE TB_PEDIDO_VENDA SET ID_STATUS = ? WHERE ID_PEDIDO = ?', [status, codigo]);
          }
        }, { waitTimeout: ESPERA_BLOQUEIO_S });
      } catch (err) {
        throw erroDeBloqueio(err);
      }
    }
    return {
      id: codigo,
      id_status: status,
      status_label: String(st[0].DESCRICAO || '').trim(),
      reserva: reservaSim(st[0].RESERVA),
      id_parcela: pagamento ? pagamento.id_parcela : num(existe[0].ID_PARCELA),
      pagamento: pagamento ? pagamento.descricao : undefined,
      estornou_reserva: reservaSim(existe[0].RESERVA) && !reservaSim(st[0].RESERVA) && num(existe[0].ID_MODULO) === 4,
    };
  });
}

async function statusReprovado(db) {
  const rows = await query(db, `
    SELECT FIRST 1 ID_STATUS FROM TB_PED_VENDA_STATUS
    WHERE UPPER(DESCRICAO) CONTAINING 'REPROV' AND COALESCE(TRIM(RESERVA), 'N') <> 'S'
      AND COALESCE(STATUS, 'A') = 'A'
    ORDER BY ID_STATUS`);
  return rows.length ? num(rows[0].ID_STATUS) : 0;
}

/** Reprovar = situação "Reprovado" do Clipp; o trigger dele devolve a quantidade reservada. */
async function reprovar(id) {
  const codigo = num(id);
  if (!codigo) throw new Error('Condicional inválido.');
  const idStatus = await withDb((db) => statusReprovado(db));
  if (!idStatus) throw new Error('Esta base não tem a situação "Reprovado" ativa no pedido de venda.');
  return alterarStatus(codigo, idStatus);
}

function textoWhatsapp(doc) {
  const linhas = (doc.itens || []).map((it) => `${it.descricao} · qtd ${fmt(it.qtd)} · ${money(it.total)}`);
  return [
    `Condicional ${doc.id}`,
    doc.cliente ? `Cliente: ${doc.cliente}` : '',
    [doc.data, doc.horario].filter(Boolean).join(' '),
    doc.vendedor ? `Vendedor: ${doc.vendedor}` : '',
    ...linhas,
    num(doc.frete) ? `Frete: ${money(doc.frete)}` : '',
    descontoExibido(doc) ? `Desconto: ${money(descontoExibido(doc))}` : '',
    acrescimoExibido(doc) ? `Acréscimo: ${money(acrescimoExibido(doc))}` : '',
    `Total: ${money(doc.total)}`,
    doc.pagamento ? `Pagamento: ${doc.pagamento}` : '',
  ].filter(Boolean).join('\n');
}

module.exports = {
  montarBuscaPedido,
  listar,
  detalhe,
  doProduto,
  buscarClientes,
  buscarPecas,
  listarVendedores,
  listarPagamentos,
  criar,
  atualizar,
  selarCondicionaisAntigos: () => withDb((db) => selarCondicionaisAntigos(db)),
  alinharGeradorPedido: () => withDb((db) => alinharGeradorPedido(db)),
  alterarStatus,
  reprovar,
  htmlPdf,
  lojaEmitente,
  textoWhatsapp,
};
