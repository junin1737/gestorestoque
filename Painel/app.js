'use strict';

const state = {
  config: null,
  emitente: { nome_fanta: '', logo: null },
  usuario: null,
  funcionarios: [],
  usuarios: [],
  modulos: {},
  estoqueLista: [],
  selecionado: null,
  niveis: { nivel1: [], nivel2: [] },
  grupos: [],
};

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
      body: options.body != null ? JSON.stringify(options.body) : undefined,
    });
  } catch (err) {
    const error = 'Serviço do painel offline. Execute iniciar.bat ou npm start e abra http://127.0.0.1:5077';
    return { ok: false, offline: true, error };
  }
  try {
    return await res.json();
  } catch {
    return { ok: false, error: `Resposta inválida da API (${res.status})` };
  }
}

function setServiceStatus(online, detail) {
  const el = $('#svc-status');
  if (!el) return;
  el.classList.toggle('erro', !online);
  el.textContent = online
    ? (detail || 'Serviço online')
    : (detail || 'Serviço offline — inicie com iniciar.bat');
}

function can(modulo, acao) {
  const u = state.usuario;
  if (!u) return false;
  if (u.supervisor) return true;
  const p = (u.permissoes && u.permissoes[modulo]) || {};
  if (acao === 'acesso') return !!p.acesso;
  const nivel = p[acao];
  if (!nivel || nivel === 'nenhum') return false;
  return true;
}

function precoNivel() {
  if (!state.usuario) return 'nenhum';
  if (state.usuario.supervisor) return 'total';
  return (state.usuario.permissoes?.estoque?.precos) || 'nenhum';
}

function podeVerCusto() {
  return precoNivel() === 'total';
}

function podeEditarPrecoVenda() {
  const n = precoNivel();
  return n === 'editar' || n === 'total';
}

function podeEditarCusto() {
  return precoNivel() === 'total';
}

function applyTheme(tema, logoUrl) {
  document.documentElement.setAttribute('data-theme', tema || 'claro');
  if (tema === 'empresa' && logoUrl) {
    extractAccent(logoUrl).then((color) => {
      document.documentElement.style.setProperty('--empresa-accent', color || '#1e3a5f');
    });
  }
}

function extractAccent(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = 16; c.height = 16;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, 16, 16);
        const data = ctx.getImageData(0, 0, 16, 16).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
        }
        if (!n) return resolve('#1e3a5f');
        r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
        resolve(`rgb(${r}, ${g}, ${b})`);
      } catch {
        resolve('#1e3a5f');
      }
    };
    img.onerror = () => resolve('#1e3a5f');
    img.src = url;
  });
}

function setEmitenteUI(emitente) {
  state.emitente = emitente || { nome_fanta: '', logo: null };
  const nome = state.emitente.nome_fanta || 'Gestor Estoque';
  $('#login-empresa').textContent = nome;
  $('#side-empresa').textContent = nome;
  document.title = `${nome} — Gestor Estoque`;

  const logoEls = [
    ['#login-logo', '#login-logo-placeholder'],
    ['#side-logo', '#side-logo-placeholder'],
  ];
  for (const [imgSel, phSel] of logoEls) {
    const img = $(imgSel);
    const ph = $(phSel);
    if (state.emitente.logo) {
      img.src = state.emitente.logo;
      img.hidden = false;
      ph.hidden = true;
    } else {
      img.removeAttribute('src');
      img.hidden = true;
      ph.hidden = false;
    }
  }
}

async function bootstrap() {
  $('#view-login').hidden = false;
  $('#view-app').hidden = true;

  const cfgRes = await api('/config');
  if (cfgRes.offline) {
    setServiceStatus(false, cfgRes.error);
    setEmitenteUI({ nome_fanta: 'Gestor Estoque', logo: null });
    state.config = {
      host: '127.0.0.1',
      port: 3050,
      database: '',
      user: 'SYSDBA',
      sistema: 'clipp',
      tema: 'claro',
    };
    fillConfigForm(state.config);
    return;
  }

  state.config = cfgRes.config;
  state.modulos = cfgRes.modulos || {};
  applyTheme(state.config.tema);
  $('#tema-rapido').value = state.config.tema || 'claro';
  fillConfigForm(state.config);

  const conn = await api('/connect', { method: 'POST', body: state.config });
  if (conn.ok) {
    setServiceStatus(true, `Conectado · Firebird ${conn.fbVersion} · ${conn.emitente?.nome_fanta || ''}`);
    setEmitenteUI(conn.emitente);
    applyTheme(state.config.tema, conn.emitente?.logo);
    await loadFuncionarios();
  } else {
    setServiceStatus(true, `Painel online, base offline: ${conn.error || 'falha na conexão Firebird'}`);
    setEmitenteUI({ nome_fanta: 'Gestor Estoque', logo: null });
    // Ainda lista supervisor local para não travar a tela
    const sel = $('#login-usuario');
    sel.innerHTML = '<option value="">Selecione o usuário</option><option value="0">SUPERVISOR (Supervisor)</option>';
  }
}

function fillConfigForm(cfg) {
  $('#cfg-database').value = cfg.database || '';
  $('#cfg-host').value = cfg.host || '127.0.0.1';
  $('#cfg-port').value = cfg.port || 3050;
  $('#cfg-user').value = cfg.user || 'SYSDBA';
  $('#cfg-password').value = '';
  $('#cfg-sistema').value = cfg.sistema || 'clipp';
  $('#cfg-tema').value = cfg.tema || 'claro';
}

async function loadFuncionarios() {
  const res = await api('/funcionarios');
  state.funcionarios = res.funcionarios || [];
  const sel = $('#login-usuario');
  sel.innerHTML = '<option value="">Selecione o usuário</option>';
  for (const f of state.funcionarios) {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = f.nome + (f.supervisor ? ' (Supervisor)' : '');
    sel.appendChild(opt);
  }
}

$('#toggle-senha').addEventListener('click', () => {
  const input = $('#login-senha');
  input.type = input.type === 'password' ? 'text' : 'password';
});

$('#btn-abrir-config').addEventListener('click', () => {
  fillConfigForm(state.config || {});
  $('#cfg-msg').hidden = true;
  $('#dlg-config').showModal();
});

$('#cfg-browse').addEventListener('click', async () => {
  if (window.desktop?.openFile) {
    const file = await window.desktop.openFile({
      properties: ['openFile'],
      filters: [{ name: 'Firebird', extensions: ['fdb', 'FDB'] }],
    });
    if (file) $('#cfg-database').value = file;
  } else {
    alert('No navegador, cole o caminho completo do arquivo .FDB.');
  }
});

$('#cfg-testar').addEventListener('click', async () => {
  const body = readConfigForm();
  $('#cfg-msg').hidden = false;
  $('#cfg-msg').textContent = 'Testando…';
  const saved = await api('/config', { method: 'POST', body });
  if (saved.offline) {
    $('#cfg-msg').textContent = saved.error;
    return;
  }
  const res = await api('/connect', { method: 'POST', body });
  if (res.ok) {
    state.config = { ...state.config, ...body, password: undefined };
    setEmitenteUI(res.emitente);
    applyTheme(body.tema, res.emitente?.logo);
    setServiceStatus(true, `Conectado · Firebird ${res.fbVersion} · ${res.emitente?.nome_fanta || ''}`);
    await loadFuncionarios();
    $('#cfg-msg').textContent = `Conectado (Firebird ${res.fbVersion}). ${res.emitente?.nome_fanta || ''}`;
  } else {
    $('#cfg-msg').textContent = res.error || 'Falha na conexão. Confira se o Firebird Server está rodando e o caminho do .FDB.';
  }
});

$('#form-config').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = readConfigForm();
  $('#cfg-msg').hidden = false;
  $('#cfg-msg').textContent = 'Salvando…';
  const saved = await api('/config', { method: 'POST', body });
  if (!saved.ok) {
    $('#cfg-msg').textContent = saved.error || 'Não foi possível salvar a configuração.';
    return;
  }
  state.config = saved.config;
  const conn = await api('/connect', { method: 'POST', body });
  if (conn.ok) {
    setEmitenteUI(conn.emitente);
    applyTheme(body.tema, conn.emitente?.logo);
    setServiceStatus(true, `Conectado · Firebird ${conn.fbVersion} · ${conn.emitente?.nome_fanta || ''}`);
    await loadFuncionarios();
    $('#dlg-config').close();
  } else {
    setServiceStatus(true, `Config salva, base offline: ${conn.error || ''}`);
    $('#cfg-msg').textContent = `Configuração salva. Conexão Firebird falhou: ${conn.error || 'erro desconhecido'}. Você pode corrigir o caminho/host e testar de novo.`;
  }
});

function readConfigForm() {
  return {
    database: $('#cfg-database').value.trim(),
    host: $('#cfg-host').value.trim(),
    port: Number($('#cfg-port').value) || 3050,
    user: $('#cfg-user').value.trim(),
    password: $('#cfg-password').value,
    sistema: $('#cfg-sistema').value,
    tema: $('#cfg-tema').value,
  };
}

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-erro').hidden = true;
  const id = Number($('#login-usuario').value);
  const senha = $('#login-senha').value;
  const res = await api('/login', { method: 'POST', body: { id, senha } });
  if (!res.ok) {
    $('#login-erro').hidden = false;
    $('#login-erro').textContent = res.error || 'Falha no login';
    return;
  }
  state.usuario = res.usuario;
  enterApp();
});

function enterApp() {
  $('#view-login').hidden = true;
  $('#view-app').hidden = false;
  $('#user-nome').textContent = state.usuario.nome;
  $('#nav-usuarios').hidden = !can('usuarios', 'acesso');
  showPage('estoque');
  loadEstoque();
}

$('#btn-logout').addEventListener('click', () => {
  state.usuario = null;
  state.selecionado = null;
  $('#login-senha').value = '';
  $('#view-app').hidden = true;
  $('#view-login').hidden = false;
});

$('#tema-rapido').addEventListener('change', async (e) => {
  const tema = e.target.value;
  await api('/config', { method: 'POST', body: { ...state.config, tema } });
  state.config.tema = tema;
  applyTheme(tema, state.emitente.logo);
});

$$('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.nav-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    showPage(btn.dataset.page);
  });
});

function showPage(page) {
  $('#page-estoque').hidden = page !== 'estoque';
  $('#page-usuarios').hidden = page !== 'usuarios';
  $('#page-title').textContent = page === 'usuarios' ? 'Usuários' : 'Estoque';
  $('#page-sub').textContent = page === 'usuarios' ? 'Permissões por módulo' : 'Ficha, preços e quantidades';
  if (page === 'usuarios') loadUsuarios();
}

$('#btn-buscar-estoque').addEventListener('click', () => loadEstoque());
$('#estoque-busca').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadEstoque();
});

async function loadEstoque() {
  const q = $('#estoque-busca').value.trim();
  const res = await api(`/estoque?q=${encodeURIComponent(q)}`);
  state.estoqueLista = res.itens || [];
  renderEstoqueLista();
  if (!state.selecionado) {
    $('#estoque-detalhe').innerHTML = '<p class="empty">Selecione um produto</p>';
  }
}

function renderEstoqueLista() {
  const box = $('#estoque-lista');
  const listPanel = box.closest('.list-panel') || box.parentElement;
  if (!state.estoqueLista.length) {
    box.innerHTML = '<p class="empty">Nenhum produto encontrado</p>';
    const head = listPanel.querySelector('.list-panel-head');
    if (head) head.querySelector('[data-count]').textContent = '0 itens';
    return;
  }

  let head = listPanel.querySelector('.list-panel-head');
  if (!head) {
    head = document.createElement('div');
    head.className = 'list-panel-head';
    head.innerHTML = '<strong>Produtos</strong><span data-count></span>';
    listPanel.insertBefore(head, box);
  }
  head.querySelector('[data-count]').textContent = `${state.estoqueLista.length} ite${state.estoqueLista.length === 1 ? 'm' : 'ns'}`;

  box.innerHTML = state.estoqueLista.map((it) => {
    const qtd = Number(it.qtd_atual || 0);
    const stockClass = qtd <= 0 ? 'zero' : qtd <= 5 ? 'low' : '';
    const initials = String(it.descricao || '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase();
    return `
    <div class="item-row ${state.selecionado?.id_identificador === it.id_identificador ? 'active' : ''}"
         data-id="${it.id_identificador}">
      <div class="item-avatar" aria-hidden="true">${escapeHtml(initials || '#')}</div>
      <div class="item-main">
        <strong title="${escapeAttr(it.descricao)}">${escapeHtml(it.descricao)}</strong>
        <div class="item-meta">
          <span class="chip">#${it.id_estoque}</span>
          ${it.grupo ? `<span class="chip">${escapeHtml(it.grupo)}</span>` : ''}
          ${it.cod_barras ? `<span class="chip">${escapeHtml(it.cod_barras)}</span>` : ''}
          ${it.referencia ? `<span class="chip">${escapeHtml(it.referencia)}</span>` : ''}
        </div>
      </div>
      <div class="item-side">
        <span class="stock-badge ${stockClass}">${fmtNum(qtd)} ${escapeHtml(it.uni_medida || 'un')}</span>
        <span class="item-price">${fmtMoney(it.prc_venda)}</span>
      </div>
    </div>`;
  }).join('');

  $$('.item-row', box).forEach((row) => {
    row.addEventListener('click', () => openProduto(Number(row.dataset.id)));
  });
}

async function openProduto(idIdentificador) {
  const [det, grupos, niveis] = await Promise.all([
    api(`/estoque/${idIdentificador}`),
    api('/grupos'),
    api('/niveis'),
  ]);
  if (!det.ok) {
    alert(det.error || 'Erro ao abrir produto');
    return;
  }
  state.selecionado = det.item;
  state.grupos = grupos.grupos || [];
  state.niveis = niveis;
  renderEstoqueLista();
  renderDetalhe();
}

function renderDetalhe() {
  const it = state.selecionado;
  if (!it) return;
  const verCusto = podeVerCusto();
  const editarVenda = podeEditarPrecoVenda();
  const editarCusto = podeEditarCusto();
  const editarFicha = can('estoque', 'acesso') && (state.usuario.supervisor || ['editar', 'total'].includes(state.usuario.permissoes?.estoque?.ficha));
  const editarQtd = can('estoque', 'acesso') && (state.usuario.supervisor || ['editar', 'total'].includes(state.usuario.permissoes?.estoque?.quantidades));
  const showGrade = it.grade_serie === 'G';
  const showSerial = it.grade_serie === 'S';
  const showLote = !!it.controla_lote;

  $('#estoque-detalhe').innerHTML = `
    <div class="tabs">
      <button class="tab active" data-tab="ficha">Ficha</button>
      <button class="tab" data-tab="precos">Preços</button>
      <button class="tab" data-tab="quantidades">Quantidades</button>
      ${showGrade || showSerial || showLote ? '<button class="tab" data-tab="controle">Grade / Lote / Serial</button>' : ''}
    </div>
    <div class="tab-pane" data-pane="ficha">
      <div class="form-grid">
        <label>ID Estoque<input value="${it.id_estoque}" disabled /></label>
        <label>ID Identificador<input value="${it.id_identificador}" disabled /></label>
        <label class="full">Descrição<input id="f-descricao" value="${escapeAttr(it.descricao)}" ${editarFicha ? '' : 'disabled'} /></label>
        <label class="full">Grupo
          <div class="input-row">
            <select id="f-grupo" ${editarFicha ? '' : 'disabled'}>
              <option value="">—</option>
              ${state.grupos.map((g) => `<option value="${g.id_grupo}" ${Number(g.id_grupo) === Number(it.id_grupo) ? 'selected' : ''}>${escapeHtml(g.descricao)}</option>`).join('')}
            </select>
            <button type="button" class="btn small" id="btn-novo-grupo" ${editarFicha ? '' : 'disabled'}>+</button>
          </div>
        </label>
        <label>Unid. medida<input id="f-un" value="${escapeAttr(it.uni_medida)}" ${editarFicha ? '' : 'disabled'} /></label>
        <label>Qtd atual<input value="${fmtNum(it.qtd_atual)}" disabled /></label>
        <label>Cód. barras<input id="f-barras" value="${escapeAttr(it.cod_barras)}" ${editarFicha ? '' : 'disabled'} /></label>
        <label>Referência<input id="f-ref" value="${escapeAttr(it.referencia)}" ${editarFicha ? '' : 'disabled'} /></label>
        <label class="full">Desc. complementar<input id="f-cmpl" value="${escapeAttr(it.desc_cmpl)}" ${editarFicha ? '' : 'disabled'} /></label>
        <label>Preço venda<input value="${fmtMoney(it.prc_venda)}" disabled /></label>
        <label>Preço custo<input class="${verCusto ? '' : 'masked'}" value="${verCusto ? fmtMoney(it.prc_custo) : '****'}" disabled /></label>
      </div>
      ${editarFicha ? '<button class="btn primary" id="btn-salvar-ficha" style="margin-top:1rem">Salvar ficha</button>' : ''}
    </div>
    <div class="tab-pane" data-pane="precos" hidden>
      <div class="form-grid">
        <label>Preço de venda<input id="p-venda" type="number" step="0.01" value="${it.prc_venda}" ${editarVenda ? '' : 'disabled'} /></label>
        <label>Preço de custo
          <input id="p-custo" type="${editarCusto || verCusto ? 'number' : 'text'}" step="0.01"
            value="${verCusto ? it.prc_custo : '****'}" ${editarCusto ? '' : 'disabled'} class="${verCusto ? '' : 'masked'}" />
        </label>
        <p class="hint full">${verCusto ? `Margem: ${fmtMargem(it.prc_venda, it.prc_custo)}` : 'Custo oculto pela permissão do usuário.'}</p>
      </div>
      ${editarVenda || editarCusto ? '<button class="btn primary" id="btn-salvar-precos" style="margin-top:1rem">Salvar preços</button>' : ''}
    </div>
    <div class="tab-pane" data-pane="quantidades" hidden>
      <label>Quantidade atual (banco)
        <input id="q-atual" type="number" step="0.0001" value="${it.qtd_atual}" ${editarQtd ? '' : 'disabled'} />
      </label>
      <div class="qty-box">
        <div class="qty-card add">
          <div>Adicionar</div>
          <input id="q-add" type="number" step="0.0001" value="0" ${editarQtd ? '' : 'disabled'} />
        </div>
        <div class="qty-card rem">
          <div>Remover</div>
          <input id="q-rem" type="number" step="0.0001" value="0" ${editarQtd ? '' : 'disabled'} />
        </div>
      </div>
      <div id="q-diff" class="diff-box">Diferença: 0</div>
      ${editarQtd ? '<button class="btn primary" id="btn-salvar-qtd" style="margin-top:1rem">Salvar contagem</button>' : ''}
    </div>
    <div class="tab-pane" data-pane="controle" hidden>
      ${showGrade ? `
        <h3 class="section-title">Grade (cor / tamanho)</h3>
        <div class="form-grid">
          <label>Cor (nível 1)
            <select id="g-cor" ${editarFicha ? '' : 'disabled'}>
              <option value="">—</option>
              ${(state.niveis.nivel1 || []).map((n) => `<option value="${n.id}" ${Number(n.id) === Number(it.id_nivel1) ? 'selected' : ''}>${escapeHtml(n.descricao)}</option>`).join('')}
            </select>
          </label>
          <label>Tamanho (nível 2)
            <select id="g-tam" ${editarFicha ? '' : 'disabled'}>
              <option value="">—</option>
              ${(state.niveis.nivel2 || []).map((n) => `<option value="${n.id}" ${Number(n.id) === Number(it.id_nivel2) ? 'selected' : ''}>${escapeHtml(n.descricao)}</option>`).join('')}
            </select>
          </label>
        </div>
        ${editarFicha ? '<button class="btn primary" id="btn-salvar-grade">Salvar grade</button>' : ''}
      ` : ''}
      ${showLote ? `
        <h3 class="section-title">Lotes</h3>
        <table class="table">
          <thead><tr><th>Lote</th><th>Validade</th><th>Qtd</th></tr></thead>
          <tbody>
            ${(it.lotes || []).map((l) => `<tr><td>${escapeHtml(l.num_lote)}</td><td>${fmtDate(l.dt_validade)}</td><td>${fmtNum(l.qtd_atual)}</td></tr>`).join('') || '<tr><td colspan="3">Sem lotes</td></tr>'}
          </tbody>
        </table>
      ` : ''}
      ${showSerial ? `
        <h3 class="section-title">Seriais</h3>
        <table class="table">
          <thead><tr><th>Serial</th><th>Status</th></tr></thead>
          <tbody>
            ${(it.seriais || []).map((s) => `<tr><td>${escapeHtml(s.num_serial)}</td><td>${escapeHtml(s.status)}</td></tr>`).join('') || '<tr><td colspan="2">Sem seriais</td></tr>'}
          </tbody>
        </table>
      ` : ''}
    </div>
  `;

  $$('.tab', $('#estoque-detalhe')).forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.tab', $('#estoque-detalhe')).forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      $$('.tab-pane', $('#estoque-detalhe')).forEach((p) => {
        p.hidden = p.dataset.pane !== tab.dataset.tab;
      });
    });
  });

  const qAtual = $('#q-atual');
  const qAdd = $('#q-add');
  const qRem = $('#q-rem');
  const base = Number(it.qtd_atual || 0);
  let syncing = false;

  function updateDiffFromAddRem() {
    const add = Number(qAdd?.value || 0);
    const rem = Number(qRem?.value || 0);
    const delta = add - rem;
    const box = $('#q-diff');
    box.textContent = delta === 0
      ? 'Diferença: 0'
      : delta > 0
        ? `Diferença: +${fmtNum(delta)} — Será adicionado ao estoque`
        : `Diferença: ${fmtNum(delta)} — Será removido do estoque`;
    box.className = `diff-box ${delta > 0 ? 'pos' : delta < 0 ? 'neg' : ''}`;
    if (!syncing && qAtual) {
      syncing = true;
      qAtual.value = String(base + delta);
      syncing = false;
    }
  }

  function updateAddRemFromAtual() {
    if (syncing || !qAtual) return;
    const nova = Number(qAtual.value || 0);
    const delta = nova - base;
    syncing = true;
    if (delta >= 0) {
      if (qAdd) qAdd.value = String(delta);
      if (qRem) qRem.value = '0';
    } else {
      if (qAdd) qAdd.value = '0';
      if (qRem) qRem.value = String(Math.abs(delta));
    }
    syncing = false;
    updateDiffFromAddRem();
  }

  qAdd?.addEventListener('input', updateDiffFromAddRem);
  qRem?.addEventListener('input', updateDiffFromAddRem);
  qAtual?.addEventListener('input', updateAddRemFromAtual);
  updateDiffFromAddRem();

  $('#btn-novo-grupo')?.addEventListener('click', async () => {
    const nome = prompt('Nome do novo grupo:');
    if (!nome) return;
    const res = await api('/grupos', { method: 'POST', body: { descricao: nome } });
    if (!res.ok) return alert(res.error || 'Erro ao criar grupo');
    state.grupos.push(res.grupo);
    const sel = $('#f-grupo');
    const opt = document.createElement('option');
    opt.value = res.grupo.id_grupo;
    opt.textContent = res.grupo.descricao;
    opt.selected = true;
    sel.appendChild(opt);
  });

  $('#btn-salvar-ficha')?.addEventListener('click', async () => {
    const res = await api(`/estoque/${it.id_identificador}`, {
      method: 'PUT',
      body: {
        descricao: $('#f-descricao').value,
        id_grupo: $('#f-grupo').value === '' ? null : Number($('#f-grupo').value),
        uni_medida: $('#f-un').value,
        cod_barras: $('#f-barras').value,
        referencia: $('#f-ref').value,
        desc_cmpl: $('#f-cmpl').value,
        usuarioNome: state.usuario.nome,
        idFuncionario: state.usuario.id,
      },
    });
    if (!res.ok) return alert(res.error || 'Erro ao salvar');
    await openProduto(it.id_identificador);
    alert('Ficha salva.');
  });

  $('#btn-salvar-precos')?.addEventListener('click', async () => {
    const body = {
      usuarioNome: state.usuario.nome,
      idFuncionario: state.usuario.id,
    };
    if (editarVenda) body.prc_venda = Number($('#p-venda').value);
    if (editarCusto) body.prc_custo = Number($('#p-custo').value);
    const res = await api(`/estoque/${it.id_identificador}`, { method: 'PUT', body });
    if (!res.ok) return alert(res.error || 'Erro ao salvar');
    await openProduto(it.id_identificador);
    alert('Preços salvos.');
  });

  $('#btn-salvar-qtd')?.addEventListener('click', async () => {
    const nova = Number($('#q-atual').value);
    const res = await api(`/estoque/${it.id_identificador}`, {
      method: 'PUT',
      body: {
        qtd_atual: nova,
        usuarioNome: state.usuario.nome,
        idFuncionario: state.usuario.id,
      },
    });
    if (!res.ok) return alert(res.error || 'Erro ao salvar');
    await openProduto(it.id_identificador);
    await loadEstoque();
    alert('Quantidade salva e registrada em tb_est_saldo_alterado.');
  });

  $('#btn-salvar-grade')?.addEventListener('click', async () => {
    const res = await api(`/estoque/${it.id_identificador}`, {
      method: 'PUT',
      body: {
        id_nivel1: $('#g-cor').value === '' ? null : Number($('#g-cor').value),
        id_nivel2: $('#g-tam').value === '' ? null : Number($('#g-tam').value),
        usuarioNome: state.usuario.nome,
        idFuncionario: state.usuario.id,
      },
    });
    if (!res.ok) return alert(res.error || 'Erro ao salvar');
    await openProduto(it.id_identificador);
    alert('Grade salva.');
  });
}

async function loadUsuarios() {
  const res = await api('/usuarios');
  state.usuarios = res.usuarios || [];
  state.modulos = res.modulos || state.modulos;
  renderUsuarios();
}

function renderUsuarios() {
  const box = $('#usuarios-lista');
  box.innerHTML = state.usuarios.map((u, idx) => `
    <div class="user-card" data-idx="${idx}">
      <div class="grid-2">
        <label>Nome<input value="${escapeAttr(u.nome)}" disabled /></label>
        <label>Nova senha<input type="password" data-field="senha" placeholder="${u.supervisor ? 'Fixa: 1020' : (u.temSenha ? '••••••' : 'Definir senha')}" ${u.supervisor ? 'disabled' : ''} /></label>
      </div>
      <div class="perm-grid">
        <label>Acesso Estoque
          <select data-perm="estoque.acesso" ${u.supervisor ? 'disabled' : ''}>
            <option value="true" ${u.permissoes?.estoque?.acesso ? 'selected' : ''}>Sim</option>
            <option value="false" ${!u.permissoes?.estoque?.acesso ? 'selected' : ''}>Não</option>
          </select>
        </label>
        <label>Ficha
          <select data-perm="estoque.ficha" ${u.supervisor ? 'disabled' : ''}>
            ${permOptions(['nenhum', 'visualizar', 'editar'], u.permissoes?.estoque?.ficha || 'nenhum')}
          </select>
        </label>
        <label>Preços
          <select data-perm="estoque.precos" ${u.supervisor ? 'disabled' : ''}>
            ${permOptions(['nenhum', 'visualizar', 'editar', 'total'], u.permissoes?.estoque?.precos || 'nenhum')}
          </select>
        </label>
        <label>Quantidades
          <select data-perm="estoque.quantidades" ${u.supervisor ? 'disabled' : ''}>
            ${permOptions(['nenhum', 'visualizar', 'editar'], u.permissoes?.estoque?.quantidades || 'nenhum')}
          </select>
        </label>
        <label>Usuários
          <select data-perm="usuarios.acesso" ${u.supervisor ? 'disabled' : ''}>
            <option value="true" ${u.permissoes?.usuarios?.acesso ? 'selected' : ''}>Sim</option>
            <option value="false" ${!u.permissoes?.usuarios?.acesso ? 'selected' : ''}>Não</option>
          </select>
        </label>
      </div>
      <p class="hint">${u.supervisor ? 'Supervisor: todas as permissões ativas automaticamente.' : 'Preços: visualizar = só venda; editar = altera venda; total = venda + custo.'}</p>
    </div>
  `).join('');
}

function permOptions(list, current) {
  return list.map((v) => `<option value="${v}" ${v === current ? 'selected' : ''}>${v}</option>`).join('');
}

$('#btn-salvar-usuarios').addEventListener('click', async () => {
  const senhaSup = prompt('Confirme a senha do supervisor para salvar:');
  if (senhaSup == null) return;
  const cards = $$('.user-card');
  const usuarios = state.usuarios.map((u, idx) => {
    const card = cards[idx];
    const next = {
      id: u.id,
      nome: u.nome,
      supervisor: !!u.supervisor,
      permissoes: {
        estoque: {
          acesso: $( '[data-perm="estoque.acesso"]', card).value === 'true',
          ficha: $('[data-perm="estoque.ficha"]', card).value,
          precos: $('[data-perm="estoque.precos"]', card).value,
          quantidades: $('[data-perm="estoque.quantidades"]', card).value,
        },
        usuarios: {
          acesso: $('[data-perm="usuarios.acesso"]', card).value === 'true',
        },
      },
    };
    const senha = $('[data-field="senha"]', card)?.value;
    if (senha) next.senha = senha;
    return next;
  });
  const res = await api('/usuarios', {
    method: 'POST',
    body: { supervisorSenha: senhaSup, usuarios },
  });
  if (!res.ok) return alert(res.error || 'Erro ao salvar');
  state.usuarios = res.usuarios;
  renderUsuarios();
  alert('Usuários atualizados.');
});

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
function escapeAttr(s) { return escapeHtml(s).replace(/\n/g, ' '); }
function fmtNum(n) {
  return Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
}
function fmtMoney(n) {
  return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtMargem(venda, custo) {
  const v = Number(venda || 0);
  const c = Number(custo || 0);
  if (!c) return '—';
  return `${(((v - c) / c) * 100).toFixed(2)}%`;
}
function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d).slice(0, 10);
  return dt.toLocaleDateString('pt-BR');
}

bootstrap().catch((err) => {
  console.error(err);
  alert('Falha ao iniciar: ' + err.message);
});
