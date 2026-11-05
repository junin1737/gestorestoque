(() => {
  let deps = null;
  let ligado = false;
  let authz = null;

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

  async function autorizacao() {
    if (deps.isSupervisor?.()) return {};
    if (!authz) {
      authz = await deps.pedirAutorizacao?.();
      if (!authz) return null;
    }
    return { autorizacao: authz };
  }

  async function salvar(sel) {
    const card = sel.closest('.auto-prod');
    const aviso = $('#cfg-auto-aviso');
    const id = card?.dataset.id;
    const anterior = sel.value === 'S' ? 'N' : 'S';
    const importar = card?.querySelector('[data-campo="importar"]')?.value === 'S';
    const ciencia = card?.querySelector('[data-campo="ciencia"]')?.value === 'S';
    const extra = await autorizacao();
    if (!extra) {
      sel.value = anterior;
      return;
    }
    const res = await deps.api(`/importacao/auto-produtos/${id}`, {
      method: 'PUT',
      body: { importar, ciencia, ...extra },
    });
    if (!res?.ok) {
      authz = null;
      sel.value = anterior;
      if (aviso) aviso.textContent = res?.error || 'Não foi possível salvar.';
      return;
    }
    if (aviso) aviso.textContent = 'Salvo.';
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

  async function carregarGeral() {
    const res = await deps.api('/compras/parametro');
    const chk = $('#cfg-auto-geral');
    if (chk && res?.ok) chk.checked = !!res.importarAutomatico;
  }

  function montar() {
    carregarGeral();
    if (ligado) return;
    ligado = true;
    $('#cfg-auto-buscar')?.addEventListener('click', () => buscar());
    $('#cfg-auto-busca')?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        buscar();
      }
    });
    $('#cfg-auto-geral-salvar')?.addEventListener('click', async () => {
      const chk = $('#cfg-auto-geral');
      const ok = await deps.salvarGeral?.(!!chk?.checked);
      if (!ok) carregarGeral();
    });
  }

  window.ImportacaoAuto = {
    init(d) { deps = d; },
    montar,
  };
})();
