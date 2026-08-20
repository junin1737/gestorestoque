'use strict';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(n) {
  const v = Number(n || 0);
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function num(n) {
  const v = Number(n || 0);
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
}

function fmtCnpj(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length !== 14) return String(v || '—');
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function fmtDate(v) {
  if (!v) return '—';
  const dt = new Date(v);
  if (Number.isNaN(dt.getTime())) return String(v).slice(0, 10);
  return dt.toLocaleString('pt-BR');
}

function ender(e = {}) {
  return [e.xLgr, e.nro, e.xBairro, e.xMun, e.UF, e.CEP].filter(Boolean).join(', ') || '—';
}

function renderDanfeHtml(sessao) {
  const s = sessao || {};
  const ide = s.xml?.ide || {};
  const emit = s.xml?.emit || {};
  const dest = s.xml?.dest || {};
  const tot = s.xml?.total || {};
  const transp = s.xml?.transp || {};
  const itens = s.itens || [];
  const fin = s.financeiro || {};
  const parcelas = fin.parcelas || fin.dup || [];

  const rows = itens.map((it) => {
    const x = it.xml || {};
    const sys = it.sistema || {};
    const vTot = Number(x.qCom || 0) * Number(x.vUnCom || 0);
    return `
      <tr>
        <td>${esc(x.nItem)}</td>
        <td>${esc(x.cProd)}</td>
        <td>${esc(x.xProd)}</td>
        <td>${esc(x.NCM)}</td>
        <td>${esc(x.CFOP)}→${esc(sys.cfop || x.CFOP || '')}</td>
        <td>${esc(x.uCom)}</td>
        <td class="r">${esc(num(x.qCom))}</td>
        <td class="r">${esc(money(x.vUnCom))}</td>
        <td class="r">${esc(money(vTot))}</td>
      </tr>`;
  }).join('');

  const parc = parcelas.map((p) => `
    <tr>
      <td>${esc(p.nDup || '')}</td>
      <td>${esc(String(p.dVenc || '').slice(0, 10))}</td>
      <td class="r">${esc(money(p.vDup))}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>NF-e ${esc(ide.nNF || '')} — visualização</title>
  <style>
    @page { size: A4; margin: 12mm; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; margin: 0; padding: 16px; }
    h1 { font-size: 16px; margin: 0 0 4px; }
    h2 { font-size: 12px; margin: 14px 0 6px; border-bottom: 1px solid #333; padding-bottom: 2px; }
    .top { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
    .box { border: 1px solid #333; padding: 8px; border-radius: 4px; }
    .mono { font-family: Consolas, monospace; font-size: 10px; word-break: break-all; }
    table { width: 100%; border-collapse: collapse; margin-top: 4px; }
    th, td { border: 1px solid #999; padding: 3px 4px; vertical-align: top; }
    th { background: #eee; font-size: 10px; }
    .r { text-align: right; white-space: nowrap; }
    .muted { color: #555; }
    .actions { margin-bottom: 12px; }
    .actions button { margin-right: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer; }
    @media print { .actions { display: none; } body { padding: 0; } }
  </style>
</head>
<body>
  <div class="actions">
    <button onclick="window.print()">Imprimir / Salvar PDF</button>
    <button type="button" id="btn-fechar-danfe">Fechar</button>
  </div>
  <script>
    (function () {
      var btn = document.getElementById('btn-fechar-danfe');
      if (!btn) return;
      btn.addEventListener('click', function () {
        try {
          if (window.parent && window.parent !== window) {
            var p = window.parent.document.getElementById('dlg-danfe');
            var f = window.parent.document.getElementById('dlg-danfe-frame');
            if (f) f.src = 'about:blank';
            if (p && p.close) p.close();
            return;
          }
        } catch (e) {}
        try { window.close(); } catch (e2) {}
        document.body.innerHTML = '<p style="padding:16px;font-family:sans-serif">Feche esta aba/janela para voltar.</p>';
      });
    })();
  </script>
  <div class="top">
    <div>
      <h1>DANFE — Documento Auxiliar da NF-e (consulta)</h1>
      <div class="muted">Visualização da nota consultada no Gestor Estoque</div>
    </div>
    <div class="box">
      <div><strong>NF-e ${esc(ide.nNF || '—')}</strong> · Série ${esc(ide.serie || '—')}</div>
      <div>Emissão: ${esc(fmtDate(ide.dhEmi))}</div>
      <div><strong>${esc(money(tot.vNF))}</strong></div>
    </div>
  </div>
  <div class="box mono">Chave: ${esc(s.chave || '—')}</div>

  <h2>Emitente</h2>
  <div class="box">
    <div><strong>${esc(emit.xNome || '—')}</strong> (${esc(emit.xFant || '—')})</div>
    <div>CNPJ ${esc(fmtCnpj(emit.CNPJ))} · IE ${esc(emit.IE || '—')}</div>
    <div>${esc(ender(emit.enderEmit))}</div>
  </div>

  <h2>Destinatário</h2>
  <div class="box">
    <div><strong>${esc(dest.xNome || '—')}</strong></div>
    <div>CNPJ ${esc(fmtCnpj(dest.CNPJ))} · IE ${esc(dest.IE || '—')}</div>
    <div>${esc(ender(dest.enderDest))}</div>
  </div>

  <h2>Totais</h2>
  <table>
    <tr>
      <th>Produtos</th><th>Desconto</th><th>Frete</th><th>Seguro</th><th>Outras</th>
      <th>BC ICMS</th><th>ICMS</th><th>ST</th><th>IPI</th><th>Total NF</th>
    </tr>
    <tr>
      <td class="r">${esc(money(tot.vProd))}</td>
      <td class="r">${esc(money(tot.vDesc))}</td>
      <td class="r">${esc(money(tot.vFrete))}</td>
      <td class="r">${esc(money(tot.vSeg))}</td>
      <td class="r">${esc(money(tot.vOutro))}</td>
      <td class="r">${esc(money(tot.vBC))}</td>
      <td class="r">${esc(money(tot.vICMS))}</td>
      <td class="r">${esc(money(tot.vST))}</td>
      <td class="r">${esc(money(tot.vIPI))}</td>
      <td class="r"><strong>${esc(money(tot.vNF))}</strong></td>
    </tr>
  </table>

  <h2>Produtos / Serviços (${itens.length} itens)</h2>
  <table>
    <thead>
      <tr>
        <th>#</th><th>Cód.</th><th>Descrição</th><th>NCM</th><th>CFOP</th>
        <th>Un</th><th>Qtd</th><th>V. Unit</th><th>Total</th>
      </tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="9">Sem itens</td></tr>'}</tbody>
  </table>

  <h2>Transporte</h2>
  <div class="box">Modalidade frete: ${esc(transp.modFrete ?? '—')} · Transportador: ${esc(transp.transporta?.xNome || '—')}</div>

  <h2>Cobrança</h2>
  <table>
    <thead><tr><th>Parcela</th><th>Vencimento</th><th>Valor</th></tr></thead>
    <tbody>${parc || '<tr><td colspan="3">Sem parcelas</td></tr>'}</tbody>
  </table>

  <p class="muted" style="margin-top:16px">Documento gerado pelo Gestor Estoque — protótipo de importação NF-e.</p>
  <script>window.addEventListener('load', () => { /* pronto para imprimir */ });</script>
</body>
</html>`;
}

module.exports = { renderDanfeHtml };
