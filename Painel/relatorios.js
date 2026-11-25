(function () {
  const TITULOS = {
    'ncm-branco': 'NCM em branco ou inválido',
    'ncm-distintos': 'NCMs distintos',
  };
  let deps = {};
  let pedido = 'ncm-branco';
  let atual = null;

  function esc(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function titulo() {
    return TITULOS[pedido] || 'Relatório';
  }

  function usuario() {
    return typeof deps.usuario === 'function' ? deps.usuario() : '';
  }

  function pacote() {
    return {
      titulo: atual?.titulo || titulo(),
      empresa: atual?.empresa || '',
      usuario: usuario(),
      colunas: (atual?.colunas || []).map((c) => ({
        ...c,
        largura: c.id === 'descricao' ? '58%' : c.id === 'id_identificador' ? '16%' : '26%',
      })),
      linhas: atual?.linhas || [],
    };
  }

  function exportarPdf() {
    if (!atual) return;
    window.ExportarTabela?.abrirPdf(pacote());
  }

  function exportarExcel() {
    if (!atual) return;
    window.ExportarTabela?.excel(pacote());
  }

  function desenhar(res) {
    const host = document.getElementById('relatorios-host');
    if (!host) return;
    atual = res;
    const colunas = res.colunas || [];
    const linhas = res.linhas || [];
    const nome = res.titulo || titulo();
    const head = colunas.map((c) => `<th>${esc(c.titulo)}</th>`).join('');
    const body = linhas.length
      ? linhas.map((linha) => `<tr>${colunas.map((c) => `<td>${esc(linha[c.id] || '—')}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${colunas.length || 1}">Nenhum registro</td></tr>`;
    host.innerHTML = `
      <div class="rel-cabeca">
        <div>
          <strong>${esc(nome)}</strong>
          <span class="hint">${linhas.length.toLocaleString('pt-BR')} ${linhas.length === 1 ? 'registro' : 'registros'}</span>
        </div>
        <div class="rel-exportar">
          <button type="button" class="btn small" id="rel-pdf">PDF</button>
          <button type="button" class="btn small" id="rel-excel">Excel</button>
        </div>
      </div>
      <div class="rel-tabela-wrap">
        <table class="rel-tabela">
          <thead><tr>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
    document.getElementById('rel-pdf')?.addEventListener('click', exportarPdf);
    document.getElementById('rel-excel')?.addEventListener('click', exportarExcel);
  }

  async function onPageEnter() {
    const host = document.getElementById('relatorios-host');
    if (!host) return;
    host.innerHTML = '<p class="hint">Carregando…</p>';
    const res = await deps.api(`/relatorios/${encodeURIComponent(pedido)}`);
    if (!res?.ok) {
      atual = null;
      host.innerHTML = `<p class="hint">${esc(res?.error || 'Não foi possível abrir o relatório.')}</p>`;
      return;
    }
    desenhar(res);
  }

  window.Relatorios = {
    init(d) { deps = d || {}; },
    definir(id) { if (TITULOS[id]) pedido = id; },
    atual() { return pedido; },
    titulo,
    onPageEnter,
  };
}());
