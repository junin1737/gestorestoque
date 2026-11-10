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

  function campo(rotulo, nome, valor, largo) {
    return `<label class="auto-campo${largo ? ' largo' : ''}"><span>${esc(rotulo)}</span><input data-campo="${nome}" value="${esc(valor || '')}" autocomplete="off" /></label>`;
  }

  function linhaConversao(c) {
    const item = c || {};
    const pacote = item.pacote ? ' checked' : '';
    return `<div class="auto-conv" data-id="${esc(item.id || '')}">
      ${campo('Unid. nota', 'uni_xml', item.uni_xml)}
      ${campo('Fator', 'conversor', item.conversor)}
      ${campo('Unid. estoque', 'uni_estoque', item.uni_estoque, true)}
      <label class="auto-pacote"><input type="checkbox" data-campo="pacote"${pacote} /><span>Pacote</span></label>
    </div>`;
  }

  function linhaParam(p) {
    const conversoes = (p.conversoes || []).length ? p.conversoes : [{}];
    return `<div class="auto-prod-edit">
      ${campo('CFOP', 'cfop', p.cfop)}
      ${campo('CST', 'cst', p.cst)}
      ${campo('CSOSN', 'csosn', p.csosn)}
      ${campo('ICMS', 'aliq_icms', p.aliq_icms)}
      ${campo('CST IPI', 'cst_ipi', p.cst_ipi, true)}
      ${campo('IPI', 'ipi', p.ipi)}
      ${campo('CST PIS', 'cst_pis', p.cst_pis, true)}
      ${campo('PIS', 'pis', p.pis)}
      ${campo('CST COFINS', 'cst_cofins', p.cst_cofins, true)}
      ${campo('COFINS', 'cofins', p.cofins)}
      ${campo('MVA', 'mva', p.mva)}
      ${campo('Unidade', 'uni_medida', p.uni_medida, true)}
      ${conversoes.map((c) => linhaConversao(c)).join('')}
      <button type="button" class="btn small" data-salvar-param>Salvar dados</button>
    </div>`;
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
    box.querySelectorAll('select[data-campo="importar"]').forEach((sel) => {
      sel.addEventListener('change', () => salvar(sel));
    });
    box.querySelectorAll('[data-salvar-param]').forEach((btn) => {
      btn.addEventListener('click', () => salvarDados(btn));
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

  function lerCampo(raiz, nome) {
    return raiz.querySelector(`[data-campo="${nome}"]`)?.value ?? '';
  }

  async function salvarDados(btn) {
    const card = btn.closest('.auto-prod');
    const aviso = $('#cfg-auto-aviso');
    const edit = card?.querySelector('.auto-prod-edit');
    if (!card || !edit) return;
    const extra = await autorizacao();
    if (!extra) return;
    const conversoes = [...edit.querySelectorAll('.auto-conv')].map((row) => ({
      id: Number(row.dataset.id) || undefined,
      uni_xml: lerCampo(row, 'uni_xml'),
      conversor: lerCampo(row, 'conversor'),
      uni_estoque: lerCampo(row, 'uni_estoque'),
      pacote: !!row.querySelector('[data-campo="pacote"]')?.checked,
    }));
    btn.disabled = true;
    const res = await deps.api(`/importacao/auto-produtos/${card.dataset.id}/dados`, {
      method: 'PUT',
      body: {
        id_fornec: Number(card.dataset.fornec),
        cfop: lerCampo(edit, 'cfop'),
        cst: lerCampo(edit, 'cst'),
        csosn: lerCampo(edit, 'csosn'),
        aliq_icms: lerCampo(edit, 'aliq_icms'),
        cst_ipi: lerCampo(edit, 'cst_ipi'),
        ipi: lerCampo(edit, 'ipi'),
        cst_pis: lerCampo(edit, 'cst_pis'),
        pis: lerCampo(edit, 'pis'),
        cst_cofins: lerCampo(edit, 'cst_cofins'),
        cofins: lerCampo(edit, 'cofins'),
        mva: lerCampo(edit, 'mva'),
        uni_medida: lerCampo(edit, 'uni_medida'),
        conversoes,
        ...extra,
      },
    });
    btn.disabled = false;
    if (!res?.ok) {
      authz = null;
      if (aviso) aviso.textContent = res?.error || 'Não foi possível salvar os dados.';
      return;
    }
    if (aviso) aviso.textContent = 'Dados salvos. Valem na próxima importação.';
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
        ? `${lista.length} produto(s). Corrija os dados e use Salvar dados. Importar grava na hora.`
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
