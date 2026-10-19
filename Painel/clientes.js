/**
 * Cadastro de clientes — TB_CLIENTE e as filhas de pessoa, endereço, contato e referência.
 */
const Clientes = (() => {
  let deps = {};
  const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
  let tipos = [];
  let tiposEnd = [];
  let abertoId = 0;
  let timerBusca = null;
  let timerCidade = null;

  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => (deps.escapeHtml ? deps.escapeHtml(s) : String(s ?? ''));
  const api = (...args) => deps.api(...args);

  function chaveFiltro() {
    const id = deps.getUsuario?.()?.id;
    return id == null ? '' : `ge-clientes-filtro-${id}`;
  }

  function filtrosVazios() {
    return { q: '', status: 'A', pessoa: '' };
  }

  function lerFiltrosSalvos() {
    const chave = chaveFiltro();
    if (!chave) return filtrosVazios();
    try {
      const salvo = JSON.parse(sessionStorage.getItem(chave) || '{}');
      return { ...filtrosVazios(), ...salvo };
    } catch {
      return filtrosVazios();
    }
  }

  function gravarFiltros() {
    const chave = chaveFiltro();
    if (!chave) return;
    try {
      sessionStorage.setItem(chave, JSON.stringify({
        q: $('#cli-busca')?.value || '',
        status: $('#cli-status')?.value ?? 'A',
        pessoa: $('#cli-pessoa')?.value || '',
      }));
    } catch { /* ignore */ }
  }

  function aplicarFiltrosNaTela(f) {
    if ($('#cli-busca')) $('#cli-busca').value = f.q || '';
    if ($('#cli-status')) $('#cli-status').value = f.status ?? 'A';
    if ($('#cli-pessoa')) $('#cli-pessoa').value = f.pessoa || '';
  }

  function fecharForm() {
    abertoId = 0;
    const form = $('#cli-form');
    const vazio = $('#cli-vazio');
    if (form) form.hidden = true;
    if (vazio) vazio.hidden = false;
    $('#cli-lista')?.querySelectorAll('.cond-card').forEach((el) => el.classList.remove('is-ativo'));
  }

  function limparFiltrosVisiveis() {
    aplicarFiltrosNaTela(filtrosVazios());
    fecharForm();
    const lista = $('#cli-lista');
    if (lista) lista.innerHTML = '';
  }

  function mostrarPessoa() {
    const pj = $('#cli-pessoa-tipo')?.value === 'pj';
    const blocoPf = $('#cli-bloco-pf');
    const blocoPfMais = $('#cli-bloco-pf-mais');
    const blocoPj = $('#cli-bloco-pj');
    if (blocoPf) blocoPf.hidden = pj;
    if (blocoPfMais) blocoPfMais.hidden = pj;
    if (blocoPj) blocoPj.hidden = !pj;
  }

  function preencherTipoLogradouro(atual) {
    const sel = $('#cli-end-tipo');
    if (!sel) return;
    const valor = String(atual || '').trim();
    const tem = [...sel.options].some((op) => op.value.toLowerCase() === valor.toLowerCase());
    if (valor && !tem) {
      const op = document.createElement('option');
      op.value = valor;
      op.textContent = valor;
      sel.appendChild(op);
    }
    sel.value = [...sel.options].find((op) => op.value.toLowerCase() === valor.toLowerCase())?.value || '';
  }

  function opcoesUf(atual) {
    const uf = String(atual || '').trim().toUpperCase();
    return `<option value="">UF</option>${UFS.map((sigla) => `<option value="${sigla}" ${sigla === uf ? 'selected' : ''}>${sigla}</option>`).join('')}`;
  }

  function mascaraCep(v) {
    const d = String(v || '').replace(/\D/g, '').slice(0, 8);
    return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
  }

  function mascaraCpf(v) {
    const d = String(v || '').replace(/\D/g, '').slice(0, 11);
    if (d.length > 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
    if (d.length > 6) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
    if (d.length > 3) return `${d.slice(0, 3)}.${d.slice(3)}`;
    return d;
  }

  function mascaraCnpj(v) {
    const d = String(v || '').replace(/\D/g, '').slice(0, 14);
    if (d.length > 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
    if (d.length > 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
    if (d.length > 5) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
    if (d.length > 2) return `${d.slice(0, 2)}.${d.slice(2)}`;
    return d;
  }

  function ligarMascara(el, fn) {
    if (!el || el.dataset.mask === '1') return;
    el.dataset.mask = '1';
    el.addEventListener('input', () => {
      const pos = el.selectionStart || 0;
      const antes = el.value.length;
      el.value = fn(el.value);
      const p = Math.max(0, pos + (el.value.length - antes));
      if (document.activeElement === el) el.setSelectionRange(p, p);
    });
  }

  function prepararUfs() {
    const sel = $('#cli-uf');
    if (!sel || sel.dataset.pronto === '1') return;
    sel.dataset.pronto = '1';
    sel.innerHTML = opcoesUf('');
    sel.addEventListener('change', () => {
      const cidade = $('#cli-cidade');
      if (!cidade) return;
      if (cidade.dataset.uf && cidade.dataset.uf !== sel.value) {
        cidade.value = '';
        cidade.dataset.idCidade = '';
        cidade.dataset.uf = '';
      }
    });
  }

  function linhaEndereco(end = {}) {
    const tipo = Number(end.tipoend) === 1 ? 1 : 2;
    return `<div class="cli-linha" data-end>
      <label>Tipo
        <select data-k="tipoend">
          ${tiposEnd.map((t) => `<option value="${t.id}" ${t.id === tipo ? 'selected' : ''}>${esc(t.descricao)}</option>`).join('')
            || `<option value="2" ${tipo === 2 ? 'selected' : ''}>Entrega</option><option value="1" ${tipo === 1 ? 'selected' : ''}>Cobrança</option>`}
        </select>
      </label>
      <label>CEP<input data-k="cep" value="${esc(end.cep || '')}" inputmode="numeric" maxlength="9" placeholder="00000-000" /></label>
      <label>Logradouro<input data-k="logradouro" value="${esc(end.logradouro || '')}" maxlength="40" /></label>
      <label>Nº<input data-k="numero" value="${esc(end.numero || '')}" maxlength="5" /></label>
      <label>Bairro<input data-k="bairro" value="${esc(end.bairro || '')}" maxlength="35" /></label>
      <label>UF<select data-k="uf">${opcoesUf(end.uf)}</select></label>
      <label>Cidade
        <input data-k="cidade" value="${esc([end.cidade, end.uf].filter(Boolean).join(' - '))}" data-id-cidade="${end.id_cidade || ''}" data-uf="${esc(end.uf || '')}" autocomplete="off" />
      </label>
      <button type="button" class="btn small" data-rm>Tirar</button>
    </div>`;
  }

  function linhaContato(c = {}) {
    return `<div class="cli-linha" data-contato>
      <label>Nome<input data-k="nome" value="${esc(c.nome || '')}" maxlength="60" /></label>
      <label>Telefone<input data-k="fone" value="${esc(c.fone || '')}" maxlength="15" /></label>
      <label>E-mail<input data-k="email" value="${esc(c.email || '')}" maxlength="100" /></label>
      <button type="button" class="btn small" data-rm>Tirar</button>
    </div>`;
  }

  function linhaReferencia(r = {}) {
    return `<div class="cli-linha" data-ref>
      <label>Nome<input data-k="nome" value="${esc(r.nome || '')}" maxlength="40" /></label>
      <label>Telefone<input data-k="fone" value="${esc(r.fone || '')}" maxlength="15" /></label>
      <button type="button" class="btn small" data-rm>Tirar</button>
    </div>`;
  }

  function ligarRemover(box) {
    box?.querySelectorAll('[data-rm]').forEach((btn) => {
      btn.addEventListener('click', () => btn.closest('.cli-linha')?.remove());
    });
  }

  function preencherListas(cliente) {
    const ends = $('#cli-ends');
    const conts = $('#cli-contatos');
    const refs = $('#cli-refs');
    if (ends) {
      ends.innerHTML = (cliente.enderecos || []).map(linhaEndereco).join('');
      ligarRemover(ends);
      ends.querySelectorAll('[data-k="cidade"]').forEach(ligarCidade);
      ends.querySelectorAll('[data-k="cep"]').forEach((el) => ligarMascara(el, mascaraCep));
    }
    if (conts) {
      conts.innerHTML = (cliente.contatos || []).map(linhaContato).join('');
      ligarRemover(conts);
    }
    if (refs) {
      refs.innerHTML = (cliente.referencias || []).map(linhaReferencia).join('');
      ligarRemover(refs);
    }
  }

  function setVal(id, valor) {
    const el = document.getElementById(id);
    if (el) el.value = valor == null ? '' : String(valor);
  }

  function preencherTipos(idTipo) {
    const sel = $('#cli-tipo');
    if (!sel) return;
    const atual = idTipo == null ? '' : String(idTipo);
    sel.innerHTML = '<option value="">—</option>' + tipos.map((t) =>
      `<option value="${t.id}" ${String(t.id) === atual ? 'selected' : ''}>${esc(t.descricao)}</option>`).join('');
  }

  function abrirForm(cliente) {
    const form = $('#cli-form');
    const vazio = $('#cli-vazio');
    if (form) form.hidden = false;
    if (vazio) vazio.hidden = true;
    abertoId = cliente?.id || 0;
    $('#cli-titulo').textContent = abertoId ? `Cliente ${abertoId}` : 'Novo cliente';
    setVal('cli-nome', cliente?.nome || '');
    setVal('cli-apelido', cliente?.apelido || '');
    setVal('cli-status-form', cliente?.status === 'I' ? 'I' : 'A');
    preencherTipos(cliente?.id_tipo);
    setVal('cli-pessoa-tipo', cliente?.pessoa === 'pj' ? 'pj' : 'pf');
    setVal('cli-cpf', cliente?.cpf || '');
    setVal('cli-identidade', cliente?.identidade || '');
    setVal('cli-nascimento', cliente?.nascimento || '');
    setVal('cli-profissao', cliente?.profissao || '');
    setVal('cli-pai', cliente?.nome_pai || '');
    setVal('cli-mae', cliente?.nome_mae || '');
    setVal('cli-cnpj', cliente?.cnpj || '');
    setVal('cli-fantasia', cliente?.fantasia || '');
    setVal('cli-ie', cliente?.insc_estadual || '');
    setVal('cli-im', cliente?.insc_municipal || '');
    setVal('cli-suframa', cliente?.suframa || '');
    setVal('cli-ind-ie', cliente?.ind_ie || '');
    setVal('cli-contato', cliente?.contato || '');
    setVal('cli-celular', cliente?.celular || '');
    setVal('cli-residencial', cliente?.residencial || '');
    setVal('cli-comercial', cliente?.comercial || '');
    setVal('cli-email', cliente?.email || '');
    setVal('cli-email-nfe', cliente?.email_nfe || '');
    setVal('cli-cep', cliente?.cep || '');
    preencherTipoLogradouro(cliente?.end_tipo || '');
    setVal('cli-logradouro', cliente?.logradouro || '');
    setVal('cli-numero', cliente?.numero || '');
    setVal('cli-bairro', cliente?.bairro || '');
    setVal('cli-comple', cliente?.complemento || '');
    prepararUfs();
    const uf = $('#cli-uf');
    if (uf) uf.value = String(cliente?.uf || '').trim().toUpperCase();
    const cidade = $('#cli-cidade');
    if (cidade) {
      cidade.value = [cliente?.cidade, cliente?.uf].filter(Boolean).join(' - ');
      cidade.dataset.idCidade = cliente?.id_cidade || '';
      cidade.dataset.uf = String(cliente?.uf || '').trim().toUpperCase();
    }
    const msg = $('#cli-msg');
    if (msg) msg.textContent = '';
    preencherListas(cliente || {});
    mostrarPessoa();
    $('#cli-nome')?.focus();
  }

  async function carregarOpcoes() {
    if (tipos.length) return;
    const res = await api('/clientes/opcoes');
    if (!res.ok) return;
    tipos = res.tipos || [];
    tiposEnd = res.enderecos || [];
  }

  async function listar() {
    const lista = $('#cli-lista');
    if (!lista) return;
    gravarFiltros();
    lista.innerHTML = '<p class="hint">Carregando…</p>';
    const qs = new URLSearchParams({
      q: $('#cli-busca')?.value || '',
      status: $('#cli-status')?.value ?? 'A',
      pessoa: $('#cli-pessoa')?.value || '',
    });
    const res = await api(`/clientes?${qs}`);
    if (!res.ok) {
      lista.innerHTML = `<p class="hint">${esc(res.error || 'Falha ao listar')}</p>`;
      return;
    }
    const itens = res.itens || [];
    if (!itens.length) {
      lista.innerHTML = '<p class="empty">Nenhum cliente neste filtro.</p>';
      return;
    }
    lista.innerHTML = itens.map((it) => {
      const doc = it.cnpj || it.cpf || '';
      const lugar = [it.cidade, it.uf].filter(Boolean).join('/');
      return `<button type="button" class="cond-card${it.id === abertoId ? ' is-ativo' : ''}" data-cli="${it.id}">
        <span class="cond-card-top"><strong>${esc(it.nome)}</strong><span class="cond-pill">${it.status === 'I' ? 'Inativo' : 'Ativo'}</span></span>
        <span class="hint">${esc([it.apelido ? `apelido ${it.apelido}` : '', doc, it.fantasia, it.fone, lugar].filter(Boolean).join(' · ') || `Cód. ${it.id}`)}</span>
      </button>`;
    }).join('') + (itens.length >= 80 ? '<p class="hint">Mostrando 80. Afine a busca para ver outros.</p>' : '');
    lista.querySelectorAll('[data-cli]').forEach((btn) => {
      btn.addEventListener('click', () => abrir(Number(btn.dataset.cli)));
    });
  }

  async function abrir(id) {
    await carregarOpcoes();
    const res = await api(`/clientes/${encodeURIComponent(id)}`);
    if (!res.ok) {
      deps.showMsg?.(res.error || 'Não foi possível abrir o cliente.');
      return;
    }
    abrirForm(res.cliente);
    $('#cli-lista')?.querySelectorAll('.cond-card').forEach((el) => {
      el.classList.toggle('is-ativo', Number(el.dataset.cli) === id);
    });
  }

  function lerLinhas(box, chaves) {
    if (!box) return [];
    return [...box.querySelectorAll('.cli-linha')].map((linha) => {
      const item = {};
      for (const k of chaves) {
        const el = linha.querySelector(`[data-k="${k}"]`);
        item[k] = el?.value || '';
        if (k === 'cidade' && el) item.id_cidade = el.dataset.idCidade || '';
      }
      return item;
    });
  }

  function corpo() {
    const cidade = $('#cli-cidade');
    return {
      id: abertoId || undefined,
      nome: $('#cli-nome')?.value || '',
      apelido: $('#cli-apelido')?.value || '',
      status: $('#cli-status-form')?.value || 'A',
      id_tipo: $('#cli-tipo')?.value || '',
      pessoa: $('#cli-pessoa-tipo')?.value || 'pf',
      cpf: $('#cli-cpf')?.value || '',
      identidade: $('#cli-identidade')?.value || '',
      nascimento: $('#cli-nascimento')?.value || '',
      profissao: $('#cli-profissao')?.value || '',
      nome_pai: $('#cli-pai')?.value || '',
      nome_mae: $('#cli-mae')?.value || '',
      cnpj: $('#cli-cnpj')?.value || '',
      fantasia: $('#cli-fantasia')?.value || '',
      insc_estadual: $('#cli-ie')?.value || '',
      insc_municipal: $('#cli-im')?.value || '',
      suframa: $('#cli-suframa')?.value || '',
      ind_ie: $('#cli-ind-ie')?.value || '',
      contato: $('#cli-contato')?.value || '',
      celular: $('#cli-celular')?.value || '',
      residencial: $('#cli-residencial')?.value || '',
      comercial: $('#cli-comercial')?.value || '',
      email: $('#cli-email')?.value || '',
      email_nfe: $('#cli-email-nfe')?.value || '',
      cep: $('#cli-cep')?.value || '',
      end_tipo: $('#cli-end-tipo')?.value || '',
      logradouro: $('#cli-logradouro')?.value || '',
      numero: $('#cli-numero')?.value || '',
      bairro: $('#cli-bairro')?.value || '',
      complemento: $('#cli-comple')?.value || '',
      id_cidade: cidade?.dataset.idCidade || '',
      enderecos: lerLinhas($('#cli-ends'), ['tipoend', 'cep', 'logradouro', 'numero', 'bairro', 'cidade']).map((e) => ({
        tipoend: e.tipoend,
        cep: e.cep,
        logradouro: e.logradouro,
        numero: e.numero,
        bairro: e.bairro,
        id_cidade: e.id_cidade,
      })),
      contatos: lerLinhas($('#cli-contatos'), ['nome', 'fone', 'email']),
      referencias: lerLinhas($('#cli-refs'), ['nome', 'fone']),
    };
  }

  function ligarCidade(input) {
    if (!input || input.dataset.cidade === '1') return;
    input.dataset.cidade = '1';
    let timer = null;
    input.addEventListener('input', () => {
      input.dataset.idCidade = '';
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = input.value.trim();
        let box = input.parentElement?.querySelector('.cli-cidades');
        if (!box) {
          box = document.createElement('div');
          box.className = 'cli-cidades cond-sugestoes';
          input.parentElement?.appendChild(box);
        }
        if (q.length < 2) {
          box.innerHTML = '';
          return;
        }
        const uf = input.id === 'cli-cidade'
          ? ($('#cli-uf')?.value || '')
          : (input.closest('.cli-linha')?.querySelector('[data-k="uf"]')?.value || '');
        const res = await api(`/clientes/cidades?q=${encodeURIComponent(q)}&uf=${encodeURIComponent(uf)}`);
        const itens = res.itens || [];
        box.innerHTML = itens.map((c) =>
          `<button type="button" class="cond-pick" data-id="${c.id}" data-nome="${esc(c.nome)}" data-uf="${esc(c.uf)}">${esc(c.nome)} - ${esc(c.uf)}</button>`).join('')
          || '<p class="hint">Nenhuma cidade.</p>';
        box.querySelectorAll('[data-id]').forEach((btn) => {
          btn.addEventListener('click', () => {
            input.value = `${btn.dataset.nome} - ${btn.dataset.uf}`;
            input.dataset.idCidade = btn.dataset.id;
            input.dataset.uf = btn.dataset.uf || '';
            const ufSel = input.id === 'cli-cidade'
              ? $('#cli-uf')
              : input.closest('.cli-linha')?.querySelector('[data-k="uf"]');
            if (ufSel && btn.dataset.uf) ufSel.value = btn.dataset.uf;
            box.innerHTML = '';
          });
        });
      }, 250);
    });
  }

  function waLink(telefone, texto) {
    const digits = String(telefone || '').replace(/\D/g, '');
    const fone = digits ? (digits.startsWith('55') ? digits : `55${digits}`) : '';
    const q = encodeURIComponent(texto || '');
    return fone ? `https://wa.me/${fone}?text=${q}` : '';
  }

  function mostrarAba(aba) {
    const qual = aba === 'aniversario' ? 'aniversario' : 'cadastro';
    document.querySelectorAll('#cli-abas .tab').forEach((b) => {
      b.classList.toggle('active', b.dataset.cliAba === qual);
    });
    const cad = $('#cli-aba-cadastro');
    const aniv = $('#cli-aba-aniversario');
    if (cad) cad.hidden = qual !== 'cadastro';
    if (aniv) aniv.hidden = qual !== 'aniversario';
    if (qual === 'aniversario') carregarAniversariantes();
  }

  async function carregarAniversariantes() {
    const lista = $('#cli-aniv-lista');
    if (!lista) return;
    lista.innerHTML = '<p class="hint">Carregando…</p>';
    const res = await api('/clientes/aniversariantes');
    if (!res.ok) {
      lista.innerHTML = `<p class="hint">${esc(res.error || 'Não foi possível listar os aniversariantes.')}</p>`;
      return;
    }
    const itens = res.itens || [];
    if (!itens.length) {
      lista.innerHTML = '<p class="empty">Nenhum cliente faz aniversário hoje.</p>';
      return;
    }
    lista.innerHTML = itens.map((it) => `
      <article class="cond-card">
        <span class="cond-card-top"><strong>${esc(it.nome)}</strong></span>
        <span class="hint">${esc([it.apelido ? `Apelido ${it.apelido}` : 'Sem apelido', it.telefone || 'Sem celular'].join(' · '))}</span>
        <p class="hint">${esc(it.mensagem || '')}</p>
        <div class="cli-aniv-acoes">
          <button type="button" class="btn small primary" data-wa="${esc(it.telefone || '')}" data-msg="${esc(it.mensagem || '')}" ${it.telefone ? '' : 'disabled'}>Enviar WhatsApp</button>
        </div>
      </article>`).join('');
    lista.querySelectorAll('[data-wa]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const url = waLink(btn.dataset.wa, btn.dataset.msg);
        if (url) window.open(url, '_blank', 'noopener');
      });
    });
  }

  function ligar() {
    document.querySelectorAll('#cli-abas .tab').forEach((btn) => {
      btn.addEventListener('click', () => mostrarAba(btn.dataset.cliAba));
    });
    $('#cli-pessoa-tipo')?.addEventListener('change', mostrarPessoa);
    $('#cli-novo-btn')?.addEventListener('click', async () => {
      await carregarOpcoes();
      abrirForm(null);
    });
    $('#cli-fechar')?.addEventListener('click', () => fecharForm());
    $('#cli-cancelar')?.addEventListener('click', () => fecharForm());
    prepararUfs();
    $('#cli-ends')?.addEventListener('change', (e) => {
      if (e.target?.dataset?.k !== 'uf') return;
      const cidade = e.target.closest('.cli-linha')?.querySelector('[data-k="cidade"]');
      if (cidade && cidade.dataset.uf && cidade.dataset.uf !== e.target.value) {
        cidade.value = '';
        cidade.dataset.idCidade = '';
        cidade.dataset.uf = '';
      }
    });
    ligarMascara($('#cli-cep'), mascaraCep);
    ligarMascara($('#cli-cpf'), mascaraCpf);
    ligarMascara($('#cli-cnpj'), mascaraCnpj);
    $('#cli-status')?.addEventListener('change', () => listar());
    $('#cli-pessoa')?.addEventListener('change', () => listar());
    $('#cli-busca')?.addEventListener('input', () => {
      clearTimeout(timerBusca);
      timerBusca = setTimeout(() => listar(), 250);
    });
    $('#cli-add-end')?.addEventListener('click', () => {
      const box = $('#cli-ends');
      if (!box) return;
      box.insertAdjacentHTML('beforeend', linhaEndereco());
      ligarRemover(box);
      box.querySelectorAll('[data-k="cidade"]').forEach(ligarCidade);
      box.querySelectorAll('[data-k="cep"]').forEach((el) => ligarMascara(el, mascaraCep));
    });
    $('#cli-add-contato')?.addEventListener('click', () => {
      const box = $('#cli-contatos');
      if (!box) return;
      box.insertAdjacentHTML('beforeend', linhaContato());
      ligarRemover(box);
    });
    $('#cli-add-ref')?.addEventListener('click', () => {
      const box = $('#cli-refs');
      if (!box) return;
      box.insertAdjacentHTML('beforeend', linhaReferencia());
      ligarRemover(box);
    });
    $('#cli-salvar')?.addEventListener('click', async () => {
      const msg = $('#cli-msg');
      const btn = $('#cli-salvar');
      if (btn) btn.disabled = true;
      const res = await api('/clientes', { method: 'POST', body: corpo() });
      if (btn) btn.disabled = false;
      if (!res.ok) {
        if (msg) msg.textContent = res.error || 'Não foi possível gravar.';
        return;
      }
      abertoId = res.id;
      if (res.cliente) abrirForm(res.cliente);
      if (msg) msg.textContent = `Cliente ${res.id} gravado.`;
      listar();
    });
    ligarCidade($('#cli-cidade'));
    clearTimeout(timerCidade);
  }

  async function onPageEnter() {
    aplicarFiltrosNaTela(lerFiltrosSalvos());
    await carregarOpcoes();
    listar();
  }

  function init(options) {
    deps = options || {};
    ligar();
  }

  return { init, onPageEnter, limparFiltrosVisiveis };
})();

window.Clientes = Clientes;
