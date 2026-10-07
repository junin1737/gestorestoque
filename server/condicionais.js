'use strict';

const {
  withDb, query, hasTable, columnExists, activeTargets, writeTargets, withTransaction, nextGenId,
} = require('./db');

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

function mapPedido(r) {
  return {
    id: num(r.ID_PEDIDO),
    id_cliente: r.ID_CLIENTE == null ? null : num(r.ID_CLIENTE),
    cliente: String(r.CLIENTE || '').trim(),
    telefone: foneCliente(r),
    data: dataBr(r.DT_PEDIDO),
    horario: horaBr(r.HR_PEDIDO),
    id_funcionario: r.ID_VENDEDOR == null ? null : num(r.ID_VENDEDOR),
    vendedor: String(r.VENDEDOR || '').trim(),
    status: String(r.ID_STATUS ?? ''),
    status_label: String(r.STATUS || '').trim() || 'Sem status',
    reserva: reservaSim(r.RESERVA),
    obs: String(r.OBS || '').trim(),
    total: num(r.TOTAL),
    origem: 'pedido',
  };
}

const SQL_PEDIDO = `
  SELECT P.ID_PEDIDO, P.DT_PEDIDO, P.HR_PEDIDO, P.ID_STATUS, P.ID_CLIENTE, P.ID_VENDEDOR,
         CAST(P.OBSERVACAO AS VARCHAR(300)) AS OBS,
         S.DESCRICAO AS STATUS, S.RESERVA,
         CL.NOME AS CLIENTE, CL.FONE_CELUL, CL.FONE_RESID, CL.FONE_COMER,
         F.NOME AS VENDEDOR
  FROM TB_PEDIDO_VENDA P
  LEFT JOIN TB_PED_VENDA_STATUS S ON S.ID_STATUS = P.ID_STATUS
  LEFT JOIN TB_CLIENTE CL ON CL.ID_CLIENTE = P.ID_CLIENTE
  LEFT JOIN TB_FUNCIONARIO F ON F.ID_FUNCIONARIO = P.ID_VENDEDOR`;

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

async function listar(statusFiltro) {
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
    const corpo = SQL_PEDIDO.replace(/^\s*SELECT\s*/i, '');
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
  return itens.map((r) => ({
    id: num(r.ID_ITEMPED),
    id_identificador: num(r.ID_IDENTIFICADOR),
    descricao: nomeGrade(r.DESCRICAO, r.GRADE_SERIE, r.COR, r.TAMANHO),
    qtd: num(r.QTD_ITEM),
    prc_unit: num(r.VLR_UNIT),
    desconto: num(r.VLR_DESC),
    total: num(r.VLR_TOTAL),
    uni_medida: String(r.UNI_MEDIDA || '').trim(),
  }));
}

async function detalhe(id) {
  const codigo = num(id);
  if (!codigo) throw new Error('Condicional inválido.');
  return withDb(async (db, appCfg) => {
    if (!hasTable('TB_PEDIDO_VENDA')) throw new Error('Esta base não tem pedido de venda.');
    const cab = await query(db, `${SQL_PEDIDO} WHERE P.ID_PEDIDO = ?`, [codigo]);
    if (!cab.length) throw new Error('Condicional não encontrado.');
    const doc = mapPedido(cab[0]);
    doc.itens = await itensDoPedido(db, appCfg, codigo);
    doc.total = doc.itens.reduce((s, it) => s + num(it.total), 0);
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
      ${SQL_PEDIDO}
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
  if (termo.length < 2) return [];
  return withDb(async (db) => {
    const rows = await query(db, `
      SELECT FIRST 30 ID_CLIENTE, NOME, FONE_CELUL, FONE_RESID
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

async function listarVendedores() {
  return withDb(async (db) => {
    const temStatus = await columnExists(db, 'TB_FUNCIONARIO', 'STATUS');
    const where = temStatus ? `WHERE COALESCE(STATUS, 'A') <> 'I'` : '';
    const rows = await query(db, `
      SELECT ID_FUNCIONARIO, NOME FROM TB_FUNCIONARIO ${where} ORDER BY NOME`);
    return rows.map((r) => ({ id_funcionario: num(r.ID_FUNCIONARIO), nome: String(r.NOME || '').trim() }));
  });
}

async function criar({ idCliente, idFuncionario, obs, itens }) {
  const itensOk = (itens || []).map((it) => ({
    id: num(it.id_identificador || it.id),
    qtd: num(it.qtd),
    prc: num(it.prc_venda != null ? it.prc_venda : it.prc_unit),
  })).filter((it) => it.id > 0 && it.qtd > 0);
  if (!num(idCliente)) throw new Error('Informe o cliente.');
  if (!num(idFuncionario)) throw new Error('Informe o vendedor.');
  if (!itensOk.length) throw new Error('Informe ao menos uma peça.');
  return withDb(async (db, appCfg) => {
    if (!hasTable('TB_PEDIDO_VENDA')) throw new Error('Esta base não tem pedido de venda.');
    const t = writeTargets(appCfg)[0]?.tables;
    if (!t) throw new Error('Estoque não encontrado nesta base.');
    const st = await query(db, `
      SELECT FIRST 1 ID_STATUS FROM TB_PED_VENDA_STATUS
      WHERE TRIM(RESERVA) = 'S' AND COALESCE(STATUS, 'A') = 'A'
      ORDER BY CASE WHEN UPPER(DESCRICAO) CONTAINING 'RESERV' THEN 0 ELSE 1 END, ID_STATUS`);
    if (!st.length) throw new Error('Não há status de pedido configurado para reservar estoque.');
    const idStatus = num(st[0].ID_STATUS);
    const mod = await query(db, `
      SELECT FIRST 1 P.ID_MODULO
      FROM TB_PEDIDO_VENDA P
      JOIN TB_PED_VENDA_STATUS S ON S.ID_STATUS = P.ID_STATUS
      WHERE TRIM(S.RESERVA) = 'S' AND P.ID_MODULO IS NOT NULL`);
    const idModulo = num(mod[0]?.ID_MODULO) || 4;
    let ultimoErro = null;
    for (let tentativa = 0; tentativa < 3; tentativa += 1) {
      try {
        return await withTransaction(db, async (tx) => {
          const seq = await query(tx, 'SELECT COALESCE(MAX(ID_PEDIDO), 0) + 1 AS ID FROM TB_PEDIDO_VENDA');
          const id = num(seq[0]?.ID);
          await query(tx, `
            INSERT INTO TB_PEDIDO_VENDA (
              ID_CLIENTE, ID_VENDEDOR, ID_PEDIDO, DT_PEDIDO, HR_PEDIDO,
              ID_PARCELA, ID_FMAPGTO, ID_STATUS, ID_MODULO, ORIGEM,
              UPDATED_INTEGRADORA, ENVIAR_INTEGRADORA, OBSERVACAO
            ) VALUES (?, ?, ?, CURRENT_DATE, CURRENT_TIME, 1, 1, ?, ?, 0, CURRENT_TIMESTAMP, 'N', ?)`, [
            num(idCliente), num(idFuncionario), id, idStatus, idModulo,
            String(obs || '').slice(0, 300) || null,
          ]);
          for (const it of itensOk) {
            const prod = await query(tx, `
              SELECT FIRST 1 E.PRC_VENDA, P.PRC_CUSTO, P.COD_BARRA
              FROM ${t.produto} P
              JOIN ${t.identificador} I ON I.ID_IDENTIFICADOR = P.ID_IDENTIFICADOR
              JOIN ${t.estoque} E ON E.ID_ESTOQUE = I.ID_ESTOQUE
              WHERE P.ID_IDENTIFICADOR = ?`, [it.id]);
            if (!prod.length) throw new Error(`Produto ${it.id} não encontrado.`);
            const prc = it.prc > 0 ? it.prc : num(prod[0].PRC_VENDA);
            const idItem = await nextGenId(tx, 'GEN_TB_PED_VENDA_ITEM_ID', 'TB_PED_VENDA_ITEM', 'ID_ITEMPED');
            await query(tx, `
              INSERT INTO TB_PED_VENDA_ITEM (
                ID_ITEMPED, QTD_ITEM, VLR_TOTAL, PRC_CUSTO, PRC_LISTA, VLR_DESC,
                ID_IDENTIFICADOR, ID_PEDIDO, ITEM_CANCEL, VLR_UNIT, COD_BARRA, UPDATED_INTEGRADORA
              ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, 'N', ?, ?, CURRENT_TIMESTAMP)`, [
              idItem, it.qtd, it.qtd * prc, num(prod[0].PRC_CUSTO), prc,
              it.id, id, prc, String(prod[0].COD_BARRA || '').slice(0, 20) || null,
            ]);
          }
          return { id };
        });
      } catch (err) {
        ultimoErro = err;
        if (!/UNIQUE|PRIMARY|violation/i.test(String(err.message || '')) || tentativa === 2) throw err;
      }
    }
    throw ultimoErro || new Error('Não foi possível lançar o condicional.');
  });
}

function htmlPdf(doc, empresa) {
  const linhas = (doc.itens || []).map((it) => `
    <tr>
      <td>${it.id_identificador}</td>
      <td>${esc(it.descricao)}</td>
      <td class="num">${fmt(it.qtd)}</td>
      <td class="num">${money(it.prc_unit)}</td>
      <td class="num">${money(it.total)}</td>
    </tr>`).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Condicional ${doc.id}</title>
<style>
  body{font-family:Segoe UI,sans-serif;color:#152033;margin:24px}
  h1{font-size:20px;margin:0 0 4px} table{width:100%;border-collapse:collapse;margin-top:16px}
  th,td{border-bottom:1px solid #d5dbe3;padding:6px 8px;text-align:left;font-size:13px}
  .num{text-align:right} .muted{color:#5c6b7a;font-size:13px}
  button{margin-top:18px;padding:8px 14px}
  @media print { button{display:none} }
</style></head><body>
  <h1>Condicional ${doc.id}</h1>
  <div class="muted">${esc(empresa || '')}</div>
  <p>Cliente: <strong>${esc(doc.cliente || '—')}</strong><br>
  Data: ${esc(doc.data)} ${esc(doc.horario)}<br>
  Vendedor: ${esc(doc.vendedor || '—')}<br>
  Situação: ${esc(doc.status_label)}</p>
  ${doc.obs ? `<p>Obs.: ${esc(doc.obs)}</p>` : ''}
  <table><thead><tr><th>Código</th><th>Descrição</th><th>Qtd</th><th>Unitário</th><th>Total</th></tr></thead>
  <tbody>${linhas}</tbody></table>
  <p><strong>Total: ${money(doc.total)}</strong></p>
  <button onclick="window.print()">Imprimir / Salvar PDF</button>
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

function textoWhatsapp(doc) {
  const linhas = (doc.itens || []).map((it) => `${it.descricao} · qtd ${fmt(it.qtd)} · ${money(it.total)}`);
  return [
    `Condicional ${doc.id}`,
    doc.cliente ? `Cliente: ${doc.cliente}` : '',
    [doc.data, doc.horario].filter(Boolean).join(' '),
    doc.vendedor ? `Vendedor: ${doc.vendedor}` : '',
    ...linhas,
    `Total: ${money(doc.total)}`,
  ].filter(Boolean).join('\n');
}

module.exports = {
  listar,
  detalhe,
  doProduto,
  buscarClientes,
  listarVendedores,
  criar,
  htmlPdf,
  textoWhatsapp,
};
