'use strict';

(function initContador(global) {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  let deps = { api() { return Promise.resolve({ ok: false }); }, showMsg() {}, showToast() {} };
  let clienteAtual = true;
  let itemAberto = null;

  function api(path, options) {
    return deps.api(path, options);
  }

  async function carregar() {
    const host = $('#contador-host');
    if (!host) return;
    const supervisor = !!deps.supervisor?.();
    const [clientesRes, contasRes, relRes] = await Promise.all([
      api('/contador/clientes'),
      supervisor ? api('/contador/contas') : Promise.resolve({ ok: true, contas: [] }),
      api('/contador/relacao'),
    ]);
    const clientes = clientesRes.clientes || [];
    const contas = contasRes.contas || [];
    const relacao = relRes.itens || [];
    host.innerHTML = `
      ${supervisor ? `
        <section class="imp-section">
          <header class="imp-section-head"><h4>Acesso do contador</h4></header>
          <p class="hint">O contador entra com e-mail e senha e vê as lojas do grupo que usam o gestor online.</p>
          <div class="imp-fields">
            <label class="imp-field">Nome<input id="cont-nome" type="text" maxlength="80" /></label>
            <label class="imp-field">E-mail<input id="cont-email" type="email" autocomplete="off" /></label>
            <label class="imp-field">Senha<input id="cont-senha" type="password" autocomplete="new-password" /></label>
          </div>
          <div class="imp-vinc-btns">
            <button type="button" class="btn small primary" id="cont-salvar-conta">Salvar contador</button>
          </div>
          <div id="cont-contas" class="item-list">${contas.map((c) => `
            <div class="item-row">
              <strong>${esc(c.nome)}</strong>
              <span class="hint">${esc(c.email)}</span>
              <button type="button" class="btn small" data-remover="${esc(c.email)}">Remover</button>
            </div>`).join('') || '<p class="hint">Nenhum contador cadastrado.</p>'}</div>
        </section>` : ''}
      <div class="cont-split">
        <section class="imp-section">
          <header class="imp-section-head"><h4>Clientes</h4></header>
          <div id="cont-clientes" class="item-list">
            ${clientes.map((c) => `
              <button type="button" class="item-row ${c.atual ? 'is-current' : ''}" data-cnpj="${esc(c.cnpj)}" data-atual="${c.atual ? '1' : '0'}" data-url="${esc(c.url || '')}">
                <strong>${esc(c.nome || c.cnpj)}</strong>
                <span class="hint">${c.atual ? 'Esta loja' : (c.online ? 'Gestor online' : 'Sem endereço online')} · ${esc(c.cnpj || '')}</span>
              </button>`).join('') || '<p class="hint">Nenhum cliente encontrado.</p>'}
          </div>
        </section>
        <section class="imp-section" id="cont-trabalho">
          <header class="imp-section-head"><h4>Itens desta loja</h4></header>
          <p class="hint">A edição fica nesta loja. Cada gravação guarda como o item estava, para desfazer, e entra na relação abaixo. Regras por NCM da reforma entram numa próxima versão.</p>
          <div class="search-field">
            <input id="cont-busca" type="search" placeholder="Descrição, NCM, código ou ID…" autocomplete="off" />
          </div>
          <div id="cont-itens" class="item-list"></div>
          <div id="cont-ficha"></div>
        </section>
      </div>
      <section class="imp-section">
        <header class="imp-section-head"><h4>Relação do que foi feito</h4></header>
        <div id="cont-relacao" class="item-list">${htmlRelacao(relacao)}</div>
      </section>`;
    $('#cont-salvar-conta')?.addEventListener('click', salvarConta);
    $$('[data-remover]', host).forEach((btn) => {
      btn.addEventListener('click', () => removerConta(btn.dataset.remover));
    });
    $$('#cont-clientes [data-cnpj]', host).forEach((btn) => {
      btn.addEventListener('click', () => escolherCliente(btn));
    });
    $('#cont-busca')?.addEventListener('input', () => {
      clearTimeout(carregar._t);
      carregar._t = setTimeout(() => buscarItens($('#cont-busca').value), 250);
    });
    $$('[data-desfazer]', host).forEach((btn) => {
      btn.addEventListener('click', () => desfazer(btn.dataset.desfazer));
    });
  }

  function htmlRelacao(itens) {
    if (!itens.length) return '<p class="hint">Nenhuma alteração ainda.</p>';
    return itens.slice(0, 80).map((r) => {
      const quando = String(r.em || '').replace('T', ' ').slice(0, 16);
      return `
        <div class="item-row">
          <strong>${esc(r.descricao || '')} · ID ${esc(r.id_identificador)}</strong>
          <span class="hint">${esc(quando)} · ${esc(r.nome || r.email || '')}${r.desfaz ? ' · desfez uma alteração' : ''}${r.desfeito ? ' · desfeito' : ''}</span>
          <span class="hint">${esc(resumoDiff(r.antes, r.depois))}</span>
          ${r.desfeito ? '' : `<button type="button" class="btn small" data-desfazer="${esc(r.id)}">Desfazer</button>`}
        </div>`;
    }).join('');
  }

  function resumoDiff(antes, depois) {
    const campos = [
      ['descricao', 'Descrição'],
      ['ncm', 'NCM'],
      ['cest', 'CEST'],
      ['cfop', 'CFOP'],
      ['cfop_nf', 'CFOP NFC-e'],
      ['referencia', 'Referência'],
      ['class_nfe', 'Class. NF-e'],
      ['class_nfce', 'Class. NFC-e'],
    ];
    const partes = [];
    for (const [k, rotulo] of campos) {
      const a = String(antes?.[k] ?? '');
      const b = String(depois?.[k] ?? '');
      if (a !== b) partes.push(`${rotulo}: ${a || '—'} → ${b || '—'}`);
    }
    return partes.join(' · ') || 'Sem diferença visível';
  }

  async function salvarConta() {
    const res = await api('/contador/contas', {
      method: 'POST',
      body: {
        nome: $('#cont-nome')?.value || '',
        email: $('#cont-email')?.value || '',
        senha: $('#cont-senha')?.value || '',
      },
    });
    if (!res.ok) {
      deps.showMsg?.(res.error || 'Não foi possível salvar o contador.');
      return;
    }
    deps.showToast?.('Contador salvo');
    carregar();
  }

  async function removerConta(email) {
    const res = await api('/contador/contas', { method: 'DELETE', body: { email } });
    if (!res.ok) {
      deps.showMsg?.(res.error || 'Não foi possível remover.');
      return;
    }
    carregar();
  }

  function escolherCliente(btn) {
    $$('#cont-clientes [data-cnpj]').forEach((el) => el.classList.toggle('is-current', el === btn));
    clienteAtual = btn.dataset.atual === '1';
    const box = $('#cont-trabalho');
    if (!box) return;
    if (!clienteAtual) {
      const url = btn.dataset.url || '';
      box.innerHTML = `
        <header class="imp-section-head"><h4>${esc(btn.querySelector('strong')?.textContent || 'Cliente')}</h4></header>
        <p class="hint">Os itens dessa loja abrem no gestor online dela. A edição, o backup e a relação ficam registrados lá.</p>
        ${url ? `<a class="btn small primary" href="${esc(url)}" target="_blank" rel="noopener">Abrir gestor online</a>` : '<p class="hint">Esta loja ainda não tem endereço online.</p>'}`;
      return;
    }
    carregar();
  }

  async function buscarItens(q) {
    const box = $('#cont-itens');
    if (!box || !clienteAtual) return;
    const termo = String(q || '').trim();
    if (termo.length < 2) {
      box.innerHTML = '<p class="hint">Digite ao menos 2 caracteres.</p>';
      return;
    }
    const res = await api(`/contador/itens?q=${encodeURIComponent(termo)}`);
    const itens = res.itens || [];
    if (!res.ok) {
      box.innerHTML = `<p class="hint">${esc(res.error || 'Falha na busca')}</p>`;
      return;
    }
    box.innerHTML = itens.map((it) => `
      <button type="button" class="item-row" data-id="${esc(it.id_identificador)}">
        <strong>${esc(it.descricao)}</strong>
        <span class="hint">ID ${esc(it.id_identificador)} · NCM ${esc(it.ncm || '—')} · Qtd ${esc(it.qtd_atual)}</span>
      </button>`).join('') || '<p class="hint">Nenhum item.</p>';
    $$('[data-id]', box).forEach((btn) => {
      btn.addEventListener('click', () => abrirItem(btn.dataset.id));
    });
  }

  async function abrirItem(id) {
    const res = await api(`/contador/itens/${encodeURIComponent(id)}`);
    if (!res.ok || !res.item) {
      deps.showMsg?.(res.error || 'Item não encontrado.');
      return;
    }
    itemAberto = res.item;
    const it = res.item;
    const ficha = $('#cont-ficha');
    if (!ficha) return;
    ficha.innerHTML = `
      <h4>${esc(it.descricao)}</h4>
      <p class="hint">ID ${esc(it.id_identificador)} · Qtd ${esc(it.qtd_atual)} ${esc(it.uni_medida || '')}</p>
      <div class="imp-fields">
        <label class="imp-field">Descrição<input id="cont-desc" value="${esc(it.descricao)}" /></label>
        <label class="imp-field">NCM<input id="cont-ncm" value="${esc(it.ncm)}" /></label>
        <label class="imp-field">CEST<input id="cont-cest" value="${esc(it.cest)}" /></label>
        <label class="imp-field">CFOP NF-e<input id="cont-cfop" value="${esc(it.cfop)}" /></label>
        <label class="imp-field">CFOP NFC-e<input id="cont-cfop-nf" value="${esc(it.cfop_nf)}" /></label>
        <label class="imp-field">Referência<input id="cont-ref" value="${esc(it.referencia)}" /></label>
      </div>
      <label class="imp-field">Classificação NF-e
        <input id="cont-class-nfe" type="search" value="${esc(it.class_nfe)}" data-id="${esc(it.id_class_trib ?? '')}" placeholder="Código ou descrição" autocomplete="off" />
        <div id="cont-class-nfe-list" class="imp-combo-list" hidden></div>
      </label>
      <label class="imp-field">Classificação NFC-e
        <input id="cont-class-nfce" type="search" value="${esc(it.class_nfce)}" data-id="${esc(it.id_class_trib_nfce ?? '')}" placeholder="Código ou descrição" autocomplete="off" />
        <div id="cont-class-nfce-list" class="imp-combo-list" hidden></div>
      </label>
      <div class="imp-vinc-btns">
        <button type="button" class="btn small primary" id="cont-gravar-item">Gravar item</button>
      </div>`;
    ligarClass('#cont-class-nfe', '#cont-class-nfe-list');
    ligarClass('#cont-class-nfce', '#cont-class-nfce-list');
    $('#cont-gravar-item')?.addEventListener('click', gravarItem);
  }

  function ligarClass(inputSel, listSel) {
    const input = $(inputSel);
    const box = $(listSel);
    if (!input || !box) return;
    const buscar = async () => {
      const q = String(input.value || '').trim();
      if (q.length < 1) {
        box.hidden = true;
        return;
      }
      const res = await api(`/contador/class-trib?q=${encodeURIComponent(q)}`);
      const itens = res.itens || [];
      box.hidden = false;
      box.innerHTML = itens.slice(0, 20).map((c) => `
        <button type="button" class="imp-prod-opt" data-id="${esc(c.id_class_trib)}" data-label="${esc(`${c.cod_class_trib || ''} — ${c.desc_class_trib || c.descricao || ''}`)}">
          <strong>${esc(c.cod_class_trib || '')}</strong>
          <span>${esc(c.desc_class_trib || c.descricao || '')}</span>
        </button>`).join('') || '<p class="hint">Nenhuma classificação</p>';
      $$('.imp-prod-opt', box).forEach((btn) => {
        btn.addEventListener('click', () => {
          input.value = btn.dataset.label || '';
          input.dataset.id = btn.dataset.id || '';
          box.hidden = true;
        });
      });
    };
    input.addEventListener('input', () => {
      input.dataset.id = '';
      clearTimeout(input._t);
      input._t = setTimeout(buscar, 220);
    });
  }

  async function gravarItem() {
    if (!itemAberto) return;
    const nfe = $('#cont-class-nfe');
    const nfce = $('#cont-class-nfce');
    const res = await api(`/contador/itens/${itemAberto.id_identificador}`, {
      method: 'PUT',
      body: {
        descricao: $('#cont-desc')?.value || '',
        ncm: $('#cont-ncm')?.value || '',
        cest: $('#cont-cest')?.value || '',
        cfop: $('#cont-cfop')?.value || '',
        cfop_nf: $('#cont-cfop-nf')?.value || '',
        referencia: $('#cont-ref')?.value || '',
        id_class_trib: nfe?.dataset.id || null,
        id_class_trib_nfce: nfce?.dataset.id || null,
      },
    });
    if (!res.ok) {
      deps.showMsg?.(res.error || 'Não foi possível gravar.');
      return;
    }
    deps.showToast?.(res.sem_mudanca ? 'Nada mudou neste item.' : 'Item gravado. A relação foi atualizada.');
    if (res.item) itemAberto = res.item;
    const rel = await api('/contador/relacao');
    const box = $('#cont-relacao');
    if (box) {
      box.innerHTML = htmlRelacao(rel.itens || []);
      $$('[data-desfazer]', box).forEach((btn) => {
        btn.addEventListener('click', () => desfazer(btn.dataset.desfazer));
      });
    }
  }

  async function desfazer(id) {
    const res = await api('/contador/desfazer', { method: 'POST', body: { id } });
    if (!res.ok) {
      deps.showMsg?.(res.error || 'Não foi possível desfazer.');
      return;
    }
    deps.showToast?.('Alteração desfeita a partir do backup.');
    carregar();
  }

  global.Contador = {
    init(next) { deps = { ...deps, ...next }; },
    onPageEnter() { carregar(); },
  };
}(window));
