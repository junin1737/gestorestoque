(function () {
  let deps = {};
  let arvore = [];
  let grupoId = '';
  let relatorioId = '';

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function grupoAtual() {
    return arvore.find((g) => g.id === grupoId) || arvore[0] || null;
  }

  function desenharArvore() {
    const host = document.getElementById('relatorios-host');
    if (!host) return;
    const grupo = grupoAtual();
    const grupos = arvore.map((g) => `
      <button type="button" class="tab${g.id === grupo?.id ? ' active' : ''}" data-rel-grupo="${esc(g.id)}">${esc(g.titulo)}</button>`).join('');
    const relatorios = (grupo?.relatorios || []).map((r) => `
      <button type="button" class="tab${r.id === relatorioId ? ' active' : ''}" data-rel-id="${esc(r.id)}">${esc(r.titulo)}</button>`).join('');
    const corpo = document.getElementById('rel-corpo');
    const corpoHtml = corpo ? corpo.outerHTML : '<div id="rel-corpo"><p class="hint">Escolha um relatório.</p></div>';
    host.innerHTML = `
      <div class="tabs rel-grupos" role="tablist">${grupos}</div>
      <div class="tabs rel-lista" role="tablist">${relatorios}</div>
      ${corpoHtml}`;
    host.querySelectorAll('[data-rel-grupo]').forEach((btn) => {
      btn.addEventListener('click', () => {
        grupoId = btn.getAttribute('data-rel-grupo') || '';
        const g = grupoAtual();
        relatorioId = g?.relatorios?.[0]?.id || '';
        desenharArvore();
        if (relatorioId) abrir(relatorioId);
      });
    });
    host.querySelectorAll('[data-rel-id]').forEach((btn) => {
      btn.addEventListener('click', () => abrir(btn.getAttribute('data-rel-id')));
    });
  }

  function desenharTabela(res) {
    const corpo = document.getElementById('rel-corpo');
    if (!corpo) return;
    const colunas = res.colunas || [];
    const linhas = res.linhas || [];
    if (!linhas.length) {
      corpo.innerHTML = `<p class="hint">Nenhum registro em ${esc(res.titulo)}.</p>`;
      return;
    }
    const head = colunas.map((c) => `<th>${esc(c.titulo)}</th>`).join('');
    const body = linhas.map((linha) => `
      <tr>${colunas.map((c) => `<td>${esc(linha[c.id] || '—')}</td>`).join('')}</tr>`).join('');
    corpo.innerHTML = `
      <p class="hint">${linhas.length.toLocaleString('pt-BR')} ${linhas.length === 1 ? 'registro' : 'registros'}</p>
      <div class="rel-tabela-wrap">
        <table class="rel-tabela">
          <thead><tr>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  }

  async function abrir(id) {
    relatorioId = id || '';
    desenharArvore();
    const corpo = document.getElementById('rel-corpo');
    if (corpo) corpo.innerHTML = '<p class="hint">Carregando…</p>';
    const res = await deps.api(`/relatorios/${encodeURIComponent(id)}`);
    if (!res?.ok) {
      const alvo = document.getElementById('rel-corpo');
      if (alvo) alvo.innerHTML = `<p class="hint">${esc(res?.error || 'Não foi possível abrir o relatório.')}</p>`;
      return;
    }
    desenharTabela(res);
  }

  async function onPageEnter() {
    const host = document.getElementById('relatorios-host');
    if (!host) return;
    host.innerHTML = '<p class="hint">Abrindo relatórios…</p>';
    const cat = await deps.api('/relatorios');
    if (!cat?.ok) {
      host.innerHTML = `<p class="hint">${esc(cat?.error || 'Não foi possível abrir os relatórios.')}</p>`;
      return;
    }
    arvore = cat.grupos || [];
    if (!arvore.some((g) => g.id === grupoId)) grupoId = arvore[0]?.id || '';
    const grupo = grupoAtual();
    if (!grupo?.relatorios?.some((r) => r.id === relatorioId)) relatorioId = grupo?.relatorios?.[0]?.id || '';
    desenharArvore();
    if (relatorioId) await abrir(relatorioId);
  }

  window.Relatorios = {
    init(d) { deps = d || {}; },
    onPageEnter,
  };
})();
