(function () {
  const TITULOS = {
    'ncm-branco': 'NCM em branco ou inválido',
    'ncm-distintos': 'NCMs distintos',
  };
  let deps = {};
  let pedido = 'ncm-branco';

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function titulo() {
    return TITULOS[pedido] || 'Relatório';
  }

  function desenhar(res) {
    const host = document.getElementById('relatorios-host');
    if (!host) return;
    const colunas = res.colunas || [];
    const linhas = res.linhas || [];
    const nome = res.titulo || titulo();
    if (!linhas.length) {
      host.innerHTML = `<div class="rel-cabeca"><strong>${esc(nome)}</strong><span class="hint">Nenhum registro</span></div>`;
      return;
    }
    const head = colunas.map((c) => `<th>${esc(c.titulo)}</th>`).join('');
    const body = linhas.map((linha) => `
      <tr>${colunas.map((c) => `<td>${esc(linha[c.id] || '—')}</td>`).join('')}</tr>`).join('');
    host.innerHTML = `
      <div class="rel-cabeca">
        <strong>${esc(nome)}</strong>
        <span class="hint">${linhas.length.toLocaleString('pt-BR')} ${linhas.length === 1 ? 'registro' : 'registros'}</span>
      </div>
      <div class="rel-tabela-wrap">
        <table class="rel-tabela">
          <thead><tr>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  }

  async function onPageEnter() {
    const host = document.getElementById('relatorios-host');
    if (!host) return;
    host.innerHTML = '<p class="hint">Carregando…</p>';
    const res = await deps.api(`/relatorios/${encodeURIComponent(pedido)}`);
    if (!res?.ok) {
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
})();
