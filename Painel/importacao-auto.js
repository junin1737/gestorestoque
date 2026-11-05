(() => {
  let deps = null;
  let ligado = false;
  let authz = null;

  function $(sel) { return document.querySelector(sel); }
  function esc(v) { return deps?.escapeHtml ? deps.escapeHtml(v) : String(v ?? ''); }

  function selectImportar(valor) {
    const sim = valor ? ' selected' : '';
    const nao = valor ? '' : ' selected';
    return `<label>Importar
      <select data-campo="importar">
        <option value="N"${nao}>Não</option>
        <option value="S"${sim}>Sim</option>
      </select>
    </label>`;
  }

  function linhaParam(p) {
    const itens = [];
    const por = (rotulo, valor) => {
      const texto = String(valor == null ? '' : valor).trim();
      if (texto) itens.push(`<span><b>${esc(rotulo)}</b> ${esc(texto)}</span>`);
    };
    por('CFOP', p.cfop);
    por('CST', p.cst);
    por('CSOSN', p.csosn);
    por('ICMS', p.aliq_icms);
    por('CST IPI', p.cst_ipi);
    por('IPI', p.ipi);
    por('CST PIS', p.cst_pis);
    por('PIS', p.pis);
    por('CST COFINS', p.cst_cofins);
    por('COFINS', p.cofins);
    por('MVA', p.mva);
    por('Unidade', p.uni_medida);
    if (p.conversor_clipp && !(p.conversoes || []).length) por('Conversão', p.conversor_clipp);
    (p.conversoes || []).forEach((c) => por('Conversão', c));
    if (!itens.length) return '';
    return `<p class="auto-prod-param">${itens.join('')}</p>`;
  }

  function render(produtos) {
    const box = $('#cfg-auto-lista');
    if (!box) return;
    if (!produtos.length) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = produtos.map((p) => `
      <article class="auto-prod" data-id="${esc(p.id_identificador)}" data-fornec="${esc(p.id_fornec)}">
        <div>
          <strong>${esc(p.descricao || 'Produto')}</strong>
          <div class="item-meta">
            <span class="chip">${esc(p.id_identificador)}</span>
            ${p.fornecedor ? `<span class="chip">${esc(p.fornecedor)}</span>` : ''}
            ${p.grupo ? `<span class="chip">${esc(p.grupo)}</span>` : ''}
            ${p.referencia ? `<span class="chip">${esc(p.referencia)}</span>` : ''}
            ${p.cod_barras ? `<span class="chip">${esc(p.cod_barras)}</span>` : ''}
            ${p.cod_fornecedor ? `<span class="chip">${esc(p.cod_fornecedor)}</span>` : ''}
          </div>
          ${linhaParam(p)}
        </div>
        ${selectImportar(p.importar === true)}
      </article>`).join('');
    box.querySelectorAll('select').forEach((sel) => {
      sel.addEventListener('change', () => salvar(sel));
    });
  }

  function pintarGrupos(grupos) {
    const sel = $('#cfg-auto-grupo');
    if (!sel) return;
    const atual = sel.value;
    const opts = ['<option value="">Todos</option>']
      .concat((grupos || []).map((g) => `<option value="${esc(g.id_grupo)}">${esc(g.descricao || g.id_grupo)}</option>`));
    sel.innerHTML = opts.join('');
    if ([...sel.options].some((o) => o.value === atual)) sel.value = atual;
  }

  async function autorizacao() {
    if (deps.isSupervisor?.()) return {};
    if (!authz) {
      authz = await deps.pedirAutorizacao?.();
      if (!authz) return null;
    }
    return { autorizacao: authz };
  }

  function credenciais(auth) {
    if (!auth) return {};
    if (auth.tipo === 'revenda') return { revendaSenha: auth.senha };
    if (auth.senha) return { supervisorSenha: auth.senha };
    return {};
  }

  async function salvar(sel) {
    const card = sel.closest('.auto-prod');
    const aviso = $('#cfg-auto-aviso');
    const id = card?.dataset.id;
    const idFornec = card?.dataset.fornec;
    const anterior = sel.value === 'S' ? 'N' : 'S';
    const importar = sel.value === 'S';
    const extra = await autorizacao();
    if (!extra) {
      sel.value = anterior;
      return;
    }
    const res = await deps.api(`/importacao/auto-produtos/${id}`, {
      method: 'PUT',
      body: { id_fornec: Number(idFornec), importar, ...extra },
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
    const grupo = String($('#cfg-auto-grupo')?.value || '').trim();
    if (aviso) aviso.textContent = 'Buscando…';
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (grupo) qs.set('grupo', grupo);
    const res = await deps.api(`/importacao/auto-produtos?${qs.toString()}`);
    if (!res?.ok) {
      if (aviso) aviso.textContent = res?.error || 'Não foi possível buscar.';
      render([]);
      return;
    }
    pintarGrupos(res.grupos || []);
    const todos = $('#cfg-auto-todos');
    if (todos) todos.checked = !!res.importarTodos;
    const lista = res.produtos || [];
    if (aviso) {
      aviso.textContent = lista.length
        ? `${lista.length} produto(s) parametrizado(s). A alteração grava na hora.`
        : 'Nenhum produto parametrizado com esse filtro.';
    }
    render(lista);
  }

  async function carregarGeral() {
    const res = await deps.api('/compras/parametro');
    const chk = $('#cfg-auto-geral');
    if (chk && res?.ok) chk.checked = !!res.importarAutomatico;
  }

  function montar() {
    carregarGeral();
    buscar();
    if (ligado) return;
    ligado = true;
    $('#cfg-auto-buscar')?.addEventListener('click', () => buscar());
    $('#cfg-auto-busca')?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        buscar();
      }
    });
    $('#cfg-auto-grupo')?.addEventListener('change', () => buscar());
    $('#cfg-auto-geral-salvar')?.addEventListener('click', async () => {
      const aviso = $('#cfg-auto-aviso');
      const auth = await deps.pedirAutorizacao?.();
      if (!auth) {
        carregarGeral();
        buscar();
        return;
      }
      const cred = credenciais(auth);
      const geral = !!$('#cfg-auto-geral')?.checked;
      const marcar = !!$('#cfg-auto-todos')?.checked;
      const r1 = await deps.api('/compras/parametro', {
        method: 'POST',
        body: { importarAutomatico: geral, ...cred },
      });
      if (!r1?.ok) {
        if (aviso) aviso.textContent = r1?.error || 'Não foi possível guardar o interruptor geral.';
        carregarGeral();
        return;
      }
      const r2 = await deps.api('/importacao/auto-produtos/todos', {
        method: 'POST',
        body: { marcar, ...cred },
      });
      if (!r2?.ok) {
        if (aviso) aviso.textContent = r2?.error || 'Não foi possível aplicar a importação em todos os produtos.';
        buscar();
        return;
      }
      const chk = $('#cfg-importar-auto');
      if (chk) chk.checked = !!r1.importarAutomatico;
      if (aviso) aviso.textContent = marcar
        ? 'Importação automática definida em todos os produtos parametrizados.'
        : 'Parâmetros guardados.';
      deps.showToast?.('Importação automática guardada.');
      buscar();
    });
  }

  window.ImportacaoAuto = {
    init(d) { deps = d; },
    montar,
  };
})();
