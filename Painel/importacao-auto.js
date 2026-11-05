(() => {
  let deps = null;
  let ligado = false;

  function $(sel) { return document.querySelector(sel); }
  function esc(v) { return deps?.escapeHtml ? deps.escapeHtml(v) : String(v ?? ''); }

  function select(nome, valor) {
    const sim = valor ? ' selected' : '';
    const nao = valor ? '' : ' selected';
    return `<label>${esc(nome)}
      <select data-campo="${esc(nome === 'Importar' ? 'importar' : 'ciencia')}">
        <option value="N"${nao}>Não</option>
        <option value="S"${sim}>Sim</option>
      </select>
    </label>`;
  }

  function render(produtos) {
    const box = $('#cfg-auto-lista');
    if (!box) return;
    if (!produtos.length) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = produtos.map((p) => `
      <article class="auto-prod" data-id="${esc(p.id_identificador)}">
        <div>
          <strong>${esc(p.descricao || 'Produto')}</strong>
          <div class="item-meta">
            <span class="chip">${esc(p.id_identificador)}</span>
            ${p.cod_barras ? `<span class="chip">${esc(p.cod_barras)}</span>` : ''}
          </div>
        </div>
        ${select('Importar', p.importar === true)}
        ${select('Ciência', p.ciencia === true)}
      </article>`).join('');
    box.querySelectorAll('select').forEach((sel) => {
      sel.addEventListener('change', () => salvar(sel));
    });
  }

  async function salvar(sel) {
    const card = sel.closest('.auto-prod');
    const aviso = $('#cfg-auto-aviso');
    const id = card?.dataset.id;
    const importar = card?.querySelector('[data-campo="importar"]')?.value === 'S';
    const ciencia = card?.querySelector('[data-campo="ciencia"]')?.value === 'S';
    const res = await deps.api(`/importacao/auto-produtos/${id}`, {
      method: 'PUT',
      body: { importar, ciencia },
    });
    if (aviso) aviso.textContent = res?.ok ? 'Salvo.' : (res?.error || 'Não foi possível salvar.');
  }

  async function buscar() {
    const aviso = $('#cfg-auto-aviso');
    const q = String($('#cfg-auto-busca')?.value || '').trim();
    if (q.length < 2) {
      if (aviso) aviso.textContent = 'Digite pelo menos duas letras ou o código.';
      render([]);
      return;
    }
    if (aviso) aviso.textContent = 'Buscando…';
    const res = await deps.api(`/importacao/auto-produtos?q=${encodeURIComponent(q)}`);
    if (!res?.ok) {
      if (aviso) aviso.textContent = res?.error || 'Não foi possível buscar.';
      render([]);
      return;
    }
    const lista = res.produtos || [];
    if (aviso) aviso.textContent = lista.length ? `${lista.length} produto(s). A alteração grava na hora.` : 'Nenhum produto encontrado.';
    render(lista);
  }

  function montar() {
    if (ligado) return;
    ligado = true;
    $('#cfg-auto-buscar')?.addEventListener('click', () => buscar());
    $('#cfg-auto-busca')?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        buscar();
      }
    });
  }

  window.ImportacaoAuto = {
    init(d) { deps = d; },
    montar,
  };
})();
