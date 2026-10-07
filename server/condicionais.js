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
  if (v instanceof Date) return v.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const s = String(v);
  const m = s.match(/(\d{2}:\d{2})/);
  return m ? m[1] : s.slice(0, 5);
}

function statusLabel(s) {
  const c = String(s || 'A').trim().toUpperCase();
  if (c === 'C') return 'Cancelado';
  if (c === 'F' || c === 'B') return 'Finalizado';
  return 'Aberto';
}

function nomeGrade(descricao, grade, cor, tamanho) {
  const base = String(descricao || '').trim();
  if (String(grade || '').trim().toUpperCase() !== 'G') return base;
  return [base, String(cor || '').trim(), String(tamanho || '').trim()].filter(Boolean).join(' - ');
}

function foneCliente(row) {
  return String(row?.FONE_CELUL || row?.FONE_RESID || row?.FONE_COMER || '').trim();
}

async function tabelaCondicional(db) {
  return hasTable('TB_CONDICIONAL_PECAS') && hasTable('TB_CONDICIONAL_PECAS_ITENS');
}

async function triggerAtualizaReserva(db) {
  const rows = await query(
    db,
    `SELECT CAST(RDB$TRIGGER_SOURCE AS VARCHAR(4000)) S
     FROM RDB$TRIGGERS
     WHERE RDB$SYSTEM_FLAG = 0 AND TRIM(RDB$RELATION_NAME) = 'TB_CONDICIONAL_PECAS_ITENS'`
  );
  return rows.some((r) => /QTD_RESERV/i.test(String(r.S || '')));
}

function mapCab(r) {
  return {
    id: num(r.GAR_CODIGO),
    id_cliente: r.GAR_CLIENTE == null ? null : num(r.GAR_CLIENTE),
    cliente: String(r.CLIENTE || '').trim(),
    telefone: foneCliente(r),
    data: dataBr(r.GAR_DATA),
    horario: horaBr(r.GAR_HORARIO),
    id_funcionario: r.GAR_FUNCIONARIO == null ? null : num(r.GAR_FUNCIONARIO),
    vendedor: String(r.VENDEDOR || '').trim(),
    status: String(r.STATUS || 'A').trim().toUpperCase() || 'A',
    status_label: statusLabel(r.STATUS),
    obs: String(r.OBS || '').trim(),
    unidades: num(r.UNIDADES),
    qt_itens: num(r.QT_ITEMS),
    total: num(r.TOTALNOTA),
    origem: 'condicional',
  };
}

async function listar() {
  return withDb(async (db) => {
    if (!(await tabelaCondicional(db))) {
      return { disponivel: false, itens: [], aviso: 'Esta base não tem a tabela de condicionais de peças.' };
    }
    const rows = await query(db, `
      SELECT FIRST 200
        C.GAR_CODIGO, C.GAR_CLIENTE, C.GAR_DATA, C.GAR_HORARIO, C.GAR_FUNCIONARIO,
        C.STATUS, C.OBS, C.UNIDADES, C.QT_ITEMS, C.TOTALNOTA,
        CL.NOME AS CLIENTE, CL.FONE_CELUL, CL.FONE_RESID, CL.FONE_COMER,
        F.NOME AS VENDEDOR
      FROM TB_CONDICIONAL_PECAS C
      LEFT JOIN TB_CLIENTE CL ON CL.ID_CLIENTE = C.GAR_CLIENTE
      LEFT JOIN TB_FUNCIONARIO F ON F.ID_FUNCIONARIO = C.GAR_FUNCIONARIO
      ORDER BY C.GAR_DATA DESC, C.GAR_CODIGO DESC`);
    return { disponivel: true, itens: rows.map(mapCab), aviso: '' };
  });
}

async function detalhe(id) {
  const codigo = num(id);
  if (!codigo) throw new Error('Condicional inválido.');
  return withDb(async (db, appCfg) => {
    if (!(await tabelaCondicional(db))) throw new Error('Esta base não tem condicionais de peças.');
    const t = activeTargets(appCfg)[0]?.tables;
    if (!t) throw new Error('Estoque não encontrado nesta base.');
    const cab = await query(db, `
      SELECT FIRST 1
        C.GAR_CODIGO, C.GAR_CLIENTE, C.GAR_DATA, C.GAR_HORARIO, C.GAR_FUNCIONARIO,
        C.STATUS, C.OBS, C.UNIDADES, C.QT_ITEMS, C.TOTALNOTA,
        CL.NOME AS CLIENTE, CL.FONE_CELUL, CL.FONE_RESID, CL.FONE_COMER,
        F.NOME AS VENDEDOR
      FROM TB_CONDICIONAL_PECAS C
      LEFT JOIN TB_CLIENTE CL ON CL.ID_CLIENTE = C.GAR_CLIENTE
      LEFT JOIN TB_FUNCIONARIO F ON F.ID_FUNCIONARIO = C.GAR_FUNCIONARIO
      WHERE C.GAR_CODIGO = ?`, [codigo]);
    if (!cab.length) throw new Error('Condicional não encontrado.');
    const itens = await query(db, `
      SELECT I.ID, I.ID_ITEM, I.QT, I.VLR_UNIT, I.VLR_DESC, I.TOTAL, I.UNI_MEDIDA,
             E.DESCRICAO, E.GRADE_SERIE, N1.DESCRICAO AS COR, N2.DESCRICAO AS TAMANHO
      FROM TB_CONDICIONAL_PECAS_ITENS I
      LEFT JOIN ${t.identificador} IDN ON IDN.ID_IDENTIFICADOR = I.ID_ITEM
      LEFT JOIN ${t.estoque} E ON E.ID_ESTOQUE = IDN.ID_ESTOQUE
      LEFT JOIN ${t.produto} P ON P.ID_IDENTIFICADOR = I.ID_ITEM
      LEFT JOIN ${t.nivel1} N1 ON N1.ID_NIVEL1 = P.ID_NIVEL1
      LEFT JOIN ${t.nivel2} N2 ON N2.ID_NIVEL2 = P.ID_NIVEL2
      WHERE I.ID_PAI = ?
      ORDER BY I.ID`, [codigo]);
    const doc = mapCab(cab[0]);
    doc.itens = itens.map((r) => ({
      id: num(r.ID),
      id_identificador: num(r.ID_ITEM),
      descricao: nomeGrade(r.DESCRICAO, r.GRADE_SERIE, r.COR, r.TAMANHO),
      qtd: num(r.QT),
      prc_unit: num(r.VLR_UNIT),
      desconto: num(r.VLR_DESC),
      total: num(r.TOTAL),
      uni_medida: String(r.UNI_MEDIDA || '').trim(),
    }));
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
  return withDb(async (db) => {
    const reservas = await reservasDoProduto(db, id);
    let condicionais = [];
    if (await tabelaCondicional(db)) {
      const rows = await query(db, `
        SELECT C.GAR_CODIGO, C.GAR_DATA, C.GAR_HORARIO, C.STATUS, C.OBS,
               I.QT, I.VLR_UNIT, I.TOTAL,
               CL.NOME AS CLIENTE, CL.FONE_CELUL, CL.FONE_RESID, CL.FONE_COMER,
               F.NOME AS VENDEDOR
        FROM TB_CONDICIONAL_PECAS_ITENS I
        JOIN TB_CONDICIONAL_PECAS C ON C.GAR_CODIGO = I.ID_PAI
        LEFT JOIN TB_CLIENTE CL ON CL.ID_CLIENTE = C.GAR_CLIENTE
        LEFT JOIN TB_FUNCIONARIO F ON F.ID_FUNCIONARIO = C.GAR_FUNCIONARIO
        WHERE I.ID_ITEM = ?
        ORDER BY C.GAR_DATA DESC, C.GAR_CODIGO DESC`, [id]);
      condicionais = rows.map((r) => ({
        ...mapCab(r),
        qtd: num(r.QT),
        prc_unit: num(r.VLR_UNIT),
        total_item: num(r.TOTAL),
      }));
    }
    return { reservas, condicionais };
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

async function criar({ idCliente, idFuncionario, obs, itens, usuario }) {
  const itensOk = (itens || []).map((it) => ({
    id: num(it.id_identificador || it.id),
    qtd: num(it.qtd),
    prc: num(it.prc_venda != null ? it.prc_venda : it.prc_unit),
  })).filter((it) => it.id > 0 && it.qtd > 0);
  if (!num(idCliente)) throw new Error('Informe o cliente.');
  if (!itensOk.length) throw new Error('Informe ao menos uma peça.');
  return withDb(async (db, appCfg) => {
    if (!(await tabelaCondicional(db))) throw new Error('Esta base não tem condicionais de peças.');
    const t = writeTargets(appCfg)[0]?.tables;
    if (!t) throw new Error('Estoque não encontrado nesta base.');
    const atualizaSozinho = await triggerAtualizaReserva(db);
    const agora = new Date();
    const totalQtd = itensOk.reduce((s, it) => s + it.qtd, 0);
    const totalValor = itensOk.reduce((s, it) => s + (it.qtd * it.prc), 0);
    return withTransaction(db, async (tx) => {
      const id = await nextGenId(tx, 'GEN_ID_TB_CONDICIONAL_ID', 'TB_CONDICIONAL_PECAS', 'GAR_CODIGO');
      await query(tx, `
        INSERT INTO TB_CONDICIONAL_PECAS (
          GAR_CODIGO, GAR_CLIENTE, GAR_DATA, GAR_HORARIO, GAR_FUNCIONARIO, STATUS, OBS,
          UNIDADES, QT_ITEMS, TOTALPRODUTOS, TOTALNOTA
        ) VALUES (?, ?, ?, ?, ?, 'A', ?, ?, ?, ?, ?)`, [
        id, num(idCliente), agora, agora, num(idFuncionario) || null,
        String(obs || usuario || '').slice(0, 300),
        totalQtd, itensOk.length, totalValor, totalValor,
      ]);
      for (const it of itensOk) {
        const prod = await query(tx, `
          SELECT FIRST 1 E.UNI_MEDIDA, P.PRC_CUSTO
          FROM ${t.produto} P
          JOIN ${t.identificador} I ON I.ID_IDENTIFICADOR = P.ID_IDENTIFICADOR
          JOIN ${t.estoque} E ON E.ID_ESTOQUE = I.ID_ESTOQUE
          WHERE P.ID_IDENTIFICADOR = ?`, [it.id]);
        if (!prod.length) throw new Error(`Produto ${it.id} não encontrado.`);
        const idItem = await nextGenId(tx, 'GEN_ID_TB_CONDICIONAL_ITENS_ID', 'TB_CONDICIONAL_PECAS_ITENS', 'ID');
        const total = it.qtd * it.prc;
        await query(tx, `
          INSERT INTO TB_CONDICIONAL_PECAS_ITENS (
            ID, ID_PAI, ID_ITEM, VLR_UNIT, QT, VLR_DESC, VLR_CUSTO, VLR_DESPESA, TOTAL, UNI_MEDIDA, PRC_CUSTO
          ) VALUES (?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?)`, [
          idItem, id, it.id, it.prc, it.qtd, num(prod[0].PRC_CUSTO), total,
          String(prod[0].UNI_MEDIDA || 'UN').slice(0, 10), num(prod[0].PRC_CUSTO),
        ]);
        if (!atualizaSozinho) {
          await query(tx, `
            UPDATE ${t.produto}
            SET QTD_RESERV = COALESCE(QTD_RESERV, 0) + ?
            WHERE ID_IDENTIFICADOR = ?`, [it.qtd, it.id]);
        }
      }
      return { id };
    });
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
