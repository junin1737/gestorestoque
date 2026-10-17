'use strict';

const { withDb, query, hasTable, activeTargets } = require('./db');

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function limpo(v) {
  return String(v || '').replace(/\s+/g, ' ').trim();
}

function dataBr(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function dataOrdem(v) {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function money(v) {
  return num(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function qtdTxt(v) {
  return num(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

function documento(modelo, numero, idNota) {
  const m = limpo(modelo).toUpperCase();
  const nome = m === '65' ? 'NFCe' : m === '55' ? 'NFe' : m === 'GR' ? 'Gerencial' : (m === '1' || m === '01' ? 'NF' : (m ? `Mod. ${m}` : 'Nota'));
  let n = limpo(numero);
  if ((!n || n === '0') && m === 'GR') n = limpo(idNota);
  if (!n || n === '0') return nome;
  return `${nome} nº ${n}`;
}

function diaSeguinte(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

function periodoSql(coluna, inicio, fim) {
  const partes = [];
  const params = [];
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(inicio || ''))) {
    partes.push(`${coluna} >= ?`);
    params.push(inicio);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(fim || ''))) {
    partes.push(`${coluna} < ?`);
    params.push(diaSeguinte(fim));
  }
  return { sql: partes.length ? ` AND ${partes.join(' AND ')}` : '', params };
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function idsDaFicha(db, tabelaIdent, id) {
  if (!tabelaIdent || !hasTable(tabelaIdent)) return [id];
  const rows = await query(db, `
    SELECT I2.ID_IDENTIFICADOR
    FROM ${tabelaIdent} I
    JOIN ${tabelaIdent} I2 ON I2.ID_ESTOQUE = I.ID_ESTOQUE
    WHERE I.ID_IDENTIFICADOR = ?`, [id]);
  const ids = (rows || []).map((r) => num(r.ID_IDENTIFICADOR)).filter((n) => n > 0);
  return ids.length ? ids : [id];
}

async function movimentos(db, fonte, tipo, ids, periodo) {
  if (!hasTable(fonte.nota) || !hasTable(fonte.item) || !ids.length) return [];
  const dataCol = tipo === 'compra' ? 'COALESCE(N.DT_ENTRADA, N.DT_EMISSAO)' : 'N.DT_EMISSAO';
  const pessoa = tipo === 'compra'
    ? 'LEFT JOIN TB_FORNECEDOR P ON P.ID_FORNEC = N.ID_FORNEC'
    : 'LEFT JOIN TB_CLIENTE P ON P.ID_CLIENTE = N.ID_CLIENTE';
  const nomePessoa = tipo === 'compra'
    ? `COALESCE(NULLIF(TRIM(P.NOME_FANTA), ''), TRIM(P.NOME), '')`
    : `COALESCE(TRIM(P.NOME), '')`;
  const operador = tipo === 'compra'
    ? 'LEFT JOIN TB_FUNCIONARIO OP ON OP.ID_FUNCIONARIO = N.ID_COMPRADOR'
    : 'LEFT JOIN TB_FUNCIONARIO OP ON OP.ID_FUNCIONARIO = N.ID_VENDEDOR';
  const quando = periodoSql(dataCol, periodo.inicio, periodo.fim);
  const marcas = ids.map(() => '?').join(', ');
  const rows = await query(db, `
    SELECT FIRST 300
      ${dataCol} AS DATA_MOV,
      N.${fonte.id} AS ID_NOTA,
      N.NF_NUMERO, N.NF_SERIE, N.NF_MODELO,
      ${nomePessoa} AS PESSOA,
      COALESCE(TRIM(OP.NOME), '') AS OPERADOR,
      COALESCE(I.QTD_ITEM, 0) AS QTD,
      COALESCE(I.VLR_UNIT, 0) AS UNITARIO,
      COALESCE(I.VLR_TOTAL, 0) - COALESCE(I.VLR_DESC, 0)
        + COALESCE(I.VLR_FRETE, 0) + COALESCE(I.VLR_SEGURO, 0) + COALESCE(I.VLR_DESPESA, 0) AS VALOR
    FROM ${fonte.item} I
    JOIN ${fonte.nota} N ON N.${fonte.id} = I.${fonte.id}
    ${pessoa}
    ${operador}
    WHERE I.ID_IDENTIFICADOR IN (${marcas})
      AND UPPER(TRIM(COALESCE(N.STATUS, ''))) = 'E'
      ${quando.sql}
    ORDER BY 1 DESC`, [...ids, ...quando.params]);
  return (rows || []).map((r) => ({
    tipo,
    data: dataBr(r.DATA_MOV),
    ordem: dataOrdem(r.DATA_MOV),
    pessoa: limpo(r.PESSOA),
    documento: documento(r.NF_MODELO, r.NF_NUMERO, r.ID_NOTA),
    qtd: num(r.QTD),
    unitario: num(r.UNITARIO),
    valor: num(r.VALOR),
    operador: limpo(r.OPERADOR),
    papel: tipo === 'compra' ? 'Comprador' : 'Vendedor',
  }));
}

function fontes(usaManage) {
  const vendas = [{ nota: 'TB_NFVENDA', item: 'TB_NFV_ITEM', id: 'ID_NFVENDA' }];
  const compras = [{ nota: 'TB_NFCOMPRA', item: 'TB_NFC_ITEM', id: 'ID_NFCOMPRA' }];
  if (usaManage) {
    vendas.push({ nota: 'TB_NFVENDA_2', item: 'TB_NFV_ITEM_2', id: 'ID_NFVENDA' });
    compras.push({ nota: 'TB_NFCOMPRA_2', item: 'TB_NFC_ITEM_2', id: 'ID_NFCOMPRA' });
    if (hasTable('TB_NFVENDA_3')) vendas.push({ nota: 'TB_NFVENDA_3', item: 'TB_NFV_ITEM_3', id: 'ID_NFVENDA' });
    if (hasTable('TB_NFCOMPRA_3')) compras.push({ nota: 'TB_NFCOMPRA_3', item: 'TB_NFC_ITEM_3', id: 'ID_NFCOMPRA' });
  }
  return { vendas, compras };
}

async function consultar(idIdentificador, periodo = {}) {
  const id = num(idIdentificador);
  if (!id) throw new Error('Produto não informado.');
  return withDb(async (db, appCfg) => {
    const alvos = activeTargets(appCfg);
    const t = alvos[0]?.tables;
    let produto = { id_identificador: id, id_estoque: null, descricao: '' };
    if (t) {
      const rows = await query(db, `
        SELECT FIRST 1 I.ID_IDENTIFICADOR, E.ID_ESTOQUE, E.DESCRICAO
        FROM ${t.identificador} I
        JOIN ${t.estoque} E ON E.ID_ESTOQUE = I.ID_ESTOQUE
        WHERE I.ID_IDENTIFICADOR = ?`, [id]);
      if (rows[0]) {
        produto = {
          id_identificador: num(rows[0].ID_IDENTIFICADOR),
          id_estoque: num(rows[0].ID_ESTOQUE),
          descricao: limpo(rows[0].DESCRICAO),
        };
      }
    }
    const usaManage = alvos.some((a) => a.manage);
    const ids = await idsDaFicha(db, t?.identificador, id);
    const { vendas, compras } = fontes(usaManage);
    const lista = [];
    for (const f of vendas) lista.push(...await movimentos(db, f, 'venda', ids, periodo));
    for (const f of compras) lista.push(...await movimentos(db, f, 'compra', ids, periodo));
    lista.sort((a, b) => b.ordem - a.ordem);
    return {
      produto,
      vendas: lista.filter((m) => m.tipo === 'venda'),
      compras: lista.filter((m) => m.tipo === 'compra'),
    };
  });
}

function textoWhatsapp(doc) {
  const p = doc.produto || {};
  const linhas = [`Histórico — ${p.descricao || 'Produto'}`, `Identificador ${p.id_identificador || ''}`];
  function bloco(titulo, itens) {
    linhas.push('', titulo);
    if (!itens.length) {
      linhas.push('Nenhum lançamento.');
      return;
    }
    for (const it of itens.slice(0, 40)) {
      linhas.push(`${it.data} · ${it.pessoa || '—'} · ${it.documento} · qtd ${qtdTxt(it.qtd)} · ${money(it.valor)} · ${it.papel}: ${it.operador || '—'}`);
    }
    if (itens.length > 40) linhas.push(`… e mais ${itens.length - 40}`);
  }
  bloco('Vendas', doc.vendas || []);
  bloco('Compras', doc.compras || []);
  return linhas.join('\n');
}

function tabela(itens, vazio) {
  if (!itens.length) return `<p class="vazio">${vazio}</p>`;
  return `<table><thead><tr>
    <th>Data</th><th>Cliente / fornecedor</th><th>Nota</th><th>Qtd</th><th>Valor</th><th>Quem fez</th>
  </tr></thead><tbody>${itens.map((it) => `<tr>
    <td>${esc(it.data)}</td>
    <td>${esc(it.pessoa || '—')}</td>
    <td>${esc(it.documento)}</td>
    <td class="num">${esc(qtdTxt(it.qtd))}</td>
    <td class="num">${esc(money(it.valor))}</td>
    <td>${esc(it.operador || '—')}</td>
  </tr>`).join('')}</tbody></table>`;
}

function htmlPdf(doc) {
  const p = doc.produto || {};
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Histórico ${esc(p.id_identificador || '')}</title>
<style>
  @page { size: A4 portrait; margin: 14mm 12mm; }
  body { font-family: Segoe UI, sans-serif; color: #152033; margin: 0; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 18px 0 6px; }
  p { margin: 0 0 8px; color: #526277; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border-bottom: 1px solid #d5deea; padding: 6px 5px; text-align: left; }
  th { font-size: 11px; color: #526277; }
  td.num, th.num { text-align: right; }
  .vazio { color: #526277; }
  @media print { .noprint { display: none; } }
</style></head><body>
  <button class="noprint" onclick="print()">Imprimir / salvar PDF</button>
  <h1>${esc(p.descricao || 'Produto')}</h1>
  <p>Identificador ${esc(p.id_identificador || '')}${p.id_estoque ? ` · Código ${esc(p.id_estoque)}` : ''}</p>
  <h2>Vendas</h2>
  ${tabela(doc.vendas || [], 'Nenhuma venda deste produto.')}
  <h2>Compras</h2>
  ${tabela(doc.compras || [], 'Nenhuma compra deste produto.')}
</body></html>`;
}

module.exports = { consultar, textoWhatsapp, htmlPdf };
