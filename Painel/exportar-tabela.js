(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ExportarTabela = api;
}(typeof window !== 'undefined' ? window : globalThis, function exportarTabela() {
  function xml(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function texto(v) {
    const s = String(v ?? '').trim();
    return s || '—';
  }

  function larguraExcel(coluna) {
    if (['descricao', 'anterior', 'atual'].includes(coluna.id)) return 320;
    if (['ncm', 'cod_ncm'].includes(coluna.id)) return 110;
    return 100;
  }

  function agora() {
    return new Date().toLocaleString('pt-BR');
  }

  function nomeArquivo(titulo) {
    return String(titulo || 'relatorio')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'relatorio';
  }

  function htmlPdf(opcoes) {
    const colunas = opcoes.colunas || [];
    const linhas = opcoes.linhas || [];
    const head = colunas.map((c) => `<th>${xml(c.titulo)}</th>`).join('');
    const cols = colunas.map((c) => `<col style="width:${xml(c.largura || `${Math.floor(100 / (colunas.length || 1))}%`)}">`).join('');
    const body = linhas.length
      ? linhas.map((linha) => `<tr>${colunas.map((c) => `<td class="${c.numero ? 'num' : ''}">${xml(texto(linha[c.id]))}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${colunas.length || 1}">Nenhum registro</td></tr>`;
    return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>${xml(opcoes.titulo || 'Relatório')}</title>
<style>
@page { size: A4 ${opcoes.paisagem === false ? 'portrait' : 'landscape'}; margin: 12mm 12mm 14mm; }
html, body { background: #fff; color: #1c2430; }
body { font-family: "Segoe UI", Arial, sans-serif; font-size: 11px; margin: 0; padding: 16px; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
header { border-bottom: 3px solid #1f4e79; padding-bottom: 8px; margin-bottom: 12px; }
.empresa { font-size: 12px; font-weight: 700; letter-spacing: .02em; }
h1 { font-size: 18px; margin: 2px 0 0; color: #1f4e79; }
.meta { margin: 4px 0 0; color: #445066; }
thead { display: table-header-group; }
th { background: #1f4e79; color: #fff; text-align: left; padding: 6px 8px; font-size: 10px; letter-spacing: .03em; }
td { border-bottom: 1px solid #d5dde8; padding: 5px 8px; vertical-align: top; overflow-wrap: anywhere; }
tr:nth-child(even) td { background: #f4f7fb; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.rodape { margin-top: 14px; color: #5c6b7a; font-size: 10px; }
@media print { body { padding: 0; } .no-print { display: none; } }
</style></head><body>
<header>
  <div class="empresa">${xml(opcoes.empresa || 'Gestor de Estoque')}</div>
  <h1>${xml(opcoes.titulo || 'Relatório')}</h1>
  <p class="meta">${xml(opcoes.subtitulo || '')}${opcoes.subtitulo ? ' · ' : ''}${linhas.length.toLocaleString('pt-BR')} registro(s) · ${xml(opcoes.usuario ? `Usuário ${opcoes.usuario} · ` : '')}Gerado em ${xml(opcoes.geradoEm || agora())}</p>
</header>
<table><colgroup>${cols}</colgroup><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
<p class="rodape">Documento para conferência do usuário e do contador. Gestor de Estoque · MT Automações</p>
<p class="no-print"><button type="button" onclick="window.print()">Imprimir / Salvar PDF</button></p>
</body></html>`;
  }

  function abrirPdf(opcoes) {
    const html = htmlPdf(opcoes);
    const janela = window.open('', '_blank', 'noopener,width=1200,height=800');
    if (!janela) return false;
    janela.document.open();
    janela.document.write(html);
    janela.document.close();
    janela.onload = () => {
      janela.focus();
      janela.print();
    };
    return true;
  }

  function excel(opcoes) {
    const colunas = opcoes.colunas || [];
    const linhas = opcoes.linhas || [];
    const celula = (valor, estilo) => {
      const estiloXml = estilo ? ` ss:StyleID="${estilo}"` : '';
      return `<Cell${estiloXml}><Data ss:Type="String">${xml(texto(valor))}</Data></Cell>`;
    };
    const larguras = colunas.map((c) => `<Column ss:Width="${larguraExcel(c)}"/>`).join('');
    const cabeca = colunas.map((c) => celula(c.titulo, 'cabeca')).join('');
    const corpo = linhas.map((linha) => `<Row>${colunas.map((c) => celula(linha[c.id])).join('')}</Row>`).join('');
    const xmlDoc = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
  <Style ss:ID="titulo"><Font ss:Bold="1" ss:Size="14" ss:Color="#1F4E79"/></Style>
  <Style ss:ID="meta"><Font ss:Size="10" ss:Color="#445066"/></Style>
  <Style ss:ID="cabeca"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#1F4E79" ss:Pattern="Solid"/></Style>
</Styles>
<Worksheet ss:Name="Relatorio"><Table>${larguras}
<Row><Cell ss:MergeAcross="${Math.max(colunas.length - 1, 0)}" ss:StyleID="titulo"><Data ss:Type="String">${xml(opcoes.empresa || 'Gestor de Estoque')}</Data></Cell></Row>
<Row><Cell ss:MergeAcross="${Math.max(colunas.length - 1, 0)}" ss:StyleID="titulo"><Data ss:Type="String">${xml(opcoes.titulo || 'Relatório')}</Data></Cell></Row>
<Row><Cell ss:MergeAcross="${Math.max(colunas.length - 1, 0)}" ss:StyleID="meta"><Data ss:Type="String">${xml(`${opcoes.usuario ? `Usuário ${opcoes.usuario} · ` : ''}${linhas.length} registro(s) · ${opcoes.geradoEm || agora()}`)}</Data></Cell></Row>
<Row></Row>
<Row>${cabeca}</Row>
${corpo}
</Table></Worksheet></Workbook>`;
    const blob = new Blob([xmlDoc], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${nomeArquivo(opcoes.titulo)}.xls`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  return { htmlPdf, abrirPdf, excel, nomeArquivo };
}));
