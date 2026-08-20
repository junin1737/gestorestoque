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
  isNovo: false,
  buscaAplicada: '',
  buscaAnterior: '',
  estoqueStatus: 'A',
  buscaBarras: false,
  scanTarget: 'search',
  alteracoesLista: [],
  alteracoesTipo: 'todos',
  niveis: { nivel1: [], nivel2: [] },
  grupos: [],
  unidades: [],
};

let scanControls = null;
let toastTimer = null;

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const CAMERA_ICON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7.2 10.1 5.8A1.4 1.4 0 0 1 11.25 5.2h1.5a1.4 1.4 0 0 1 1.15.6L15 7.2h3.1A2.1 2.1 0 0 1 20.2 9.3v8.1A2.1 2.1 0 0 1 18.1 19.5H5.9A2.1 2.1 0 0 1 3.8 17.4V9.3A2.1 2.1 0 0 1 5.9 7.2H9z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13.1" r="3.05" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';

window.setGestorScanTarget = (target) => {
  state.scanTarget = ['ficha', 'importacao', 'importacao-prod'].includes(target) ? target : 'search';
};

function showToast(message) {
  const el = $('#app-toast');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2800);
}

function showMsg(message) {
  const dlg = $('#dlg-msg');
  const text = $('#dlg-msg-text');
  const ok = $('#dlg-msg-ok');
  if (!dlg || !text) {
    window.console?.warn(message);
    return;
  }
  text.textContent = String(message || '');
  const close = () => {
    try { dlg.close(); } catch { /* ignore */ }
  };
  ok.onclick = close;
  dlg.onclose = close;
  if (!dlg.open) dlg.showModal();
}

/** Confirmação async — funciona no APK (window.confirm costuma falhar na WebView). */
function showConfirm(message, { okLabel = 'Confirmar', cancelLabel = 'Cancelar' } = {}) {
  return new Promise((resolve) => {
    const dlg = $('#dlg-confirm');
    const text = $('#dlg-confirm-text');
    const btnSim = $('#dlg-confirm-sim');
    const btnNao = $('#dlg-confirm-nao');
    if (!dlg || !text || !btnSim || !btnNao) {
      resolve(window.confirm(String(message || '')));
      return;
    }
    text.textContent = String(message || '');
    btnSim.textContent = okLabel;
    btnNao.textContent = cancelLabel;
    const finish = (value) => {
      btnSim.onclick = null;
      btnNao.onclick = null;
      dlg.onclose = null;
      try { if (dlg.open) dlg.close(); } catch { /* ignore */ }
      resolve(value);
    };
    btnSim.onclick = () => finish(true);
    btnNao.onclick = () => finish(false);
    dlg.onclose = () => resolve(false);
    if (!dlg.open) dlg.showModal();
  });
}

window.alert = (message) => showMsg(message);

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

function initialsFromName(name) {
  const raw = String(name || '').trim();
  const skip = /^(de|da|do|das|dos|e|the|and)$/i;
  const parts = raw.split(/\s+/).filter((w) => w && !skip.test(w));
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  const letters = raw.replace(/[^A-Za-z0-9À-ÿ]/g, '');
  if (letters.length >= 2) return letters.slice(0, 2).toUpperCase();
  if (letters.length === 1) return (letters + letters).toUpperCase();
  return 'GE';
}

function setEmitenteUI(emitente) {
  state.emitente = emitente || { nome_fanta: '', logo: null };
  const nome = state.emitente.nome_fanta || 'Gestor Estoque';
  $('#login-empresa').textContent = nome;
  $('#side-empresa').textContent = nome;
  document.title = `${nome} — Gestor Estoque`;
  const ini = initialsFromName(nome);
  const loginPh = $('#login-logo-placeholder');
  const sidePh = $('#side-logo-placeholder');
  if (loginPh) loginPh.textContent = ini;
  if (sidePh) sidePh.textContent = ini;

  const hasLogo = !!state.emitente.logo;
  const pairs = [
    ['#login-logo', '#login-logo-placeholder', '#login-logo-wrap'],
    ['#side-logo', '#side-logo-placeholder', '#side-logo-wrap'],
  ];
  for (const [imgSel, phSel, wrapSel] of pairs) {
    const img = $(imgSel);
    const ph = $(phSel);
    const wrap = $(wrapSel);
    if (hasLogo) {
      img.src = state.emitente.logo;
      img.hidden = false;
      if (ph) ph.hidden = true;
      if (wrap) wrap.classList.add('has-logo');
    } else {
      img.removeAttribute('src');
      img.hidden = true;
      if (ph) ph.hidden = false;
      if (wrap) wrap.classList.remove('has-logo');
    }
  }
  try {
    if (window.GestorApp && typeof window.GestorApp.setEmitente === 'function') {
      window.GestorApp.setEmitente(nome, state.emitente.logo || '');
    }
  } catch {
    /* APK antigo ou logo grande demais para a ponte */
  }
}

async function bootstrap() {
  $('#view-login').hidden = false;
  $('#view-app').hidden = true;

  const cfgRes = await api('/config');
  if (cfgRes.offline) {
    setServiceStatus(false, cfgRes.error);
    setEmitenteUI({ nome_fanta: 'Gestor Estoque', logo: null });
    state.config = { host: '127.0.0.1', port: 3050, database: '', user: 'SYSDBA', sistema: 'clipp', tema: 'claro' };
    return;
  }

  state.config = cfgRes.config;
  state.modulos = cfgRes.modulos || {};
  applyTheme(state.config.tema);
  if ($('#tema-rapido')) $('#tema-rapido').value = state.config.tema || 'claro';

  const conn = await api('/connect', { method: 'POST', body: state.config });
  if (conn.ok) {
    setServiceStatus(true, `Conectado · ${conn.emitente?.nome_fanta || ''}`);
    setEmitenteUI(conn.emitente);
    applyTheme(state.config.tema, conn.emitente?.logo);
    await loadFuncionarios();
  } else {
    setServiceStatus(true, `Painel online, base offline: ${conn.error || 'falha Firebird'}`);
    setEmitenteUI({ nome_fanta: 'Gestor Estoque', logo: null });
    $('#login-usuario').innerHTML = '<option value="">Selecione o usuário</option><option value="0">SUPERVISOR (Supervisor)</option>';
  }
}

async function loadUnidades() {
  const res = await api('/unidades');
  state.unidades = res.unidades || [];
}

function optionsUnidades(selected) {
  const cur = String(selected || '').trim();
  const opts = ['<option value="">—</option>'];
  for (const u of state.unidades) {
    const sel = u.unidade === cur ? 'selected' : '';
    opts.push(`<option value="${escapeAttr(u.unidade)}" ${sel}>${escapeHtml(u.unidade)} — ${escapeHtml(u.descricao)}</option>`);
  }
  if (cur && !state.unidades.some((u) => u.unidade === cur)) {
    opts.push(`<option value="${escapeAttr(cur)}" selected>${escapeHtml(cur)}</option>`);
  }
  return opts.join('');
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
  const canUsers = can('usuarios', 'acesso');
  const canAlt = can('alteracoes', 'acesso');
  const canEst = can('estoque', 'acesso');
  $('#nav-usuarios').hidden = !canUsers;
  if ($('#nav-usuarios-mobile')) $('#nav-usuarios-mobile').hidden = !canUsers;
  $('#nav-alteracoes').hidden = !canAlt;
  if ($('#nav-alteracoes-mobile')) $('#nav-alteracoes-mobile').hidden = !canAlt;
  if ($('#dash-alteracoes')) $('#dash-alteracoes').hidden = !canAlt;
  $('#nav-estoque').hidden = !canEst;
  if ($('#nav-estoque-mobile')) $('#nav-estoque-mobile').hidden = !canEst;
  if ($('#dash-estoque')) $('#dash-estoque').hidden = !canEst;
  const showImp = !!state.usuario?.supervisor;
  if ($('#nav-importacao')) $('#nav-importacao').hidden = !showImp;
  if ($('#nav-importacao-mobile')) $('#nav-importacao-mobile').hidden = !showImp;
  if ($('#dash-importacao')) $('#dash-importacao').hidden = !showImp;
  showPage('dashboard');
  loadUnidades();
}

function trocarUsuario() {
  stopScanner();
  state.usuario = null;
  state.selecionado = null;
  state.isNovo = false;
  $('#login-senha').value = '';
  $('#view-app').hidden = true;
  $('#view-login').hidden = false;
  document.body.classList.remove('sidebar-open');
  loadFuncionarios();
}

$('#btn-logout').addEventListener('click', trocarUsuario);
$('#btn-trocar-usuario').addEventListener('click', trocarUsuario);
$('#btn-trocar-usuario-top').addEventListener('click', trocarUsuario);
$('#btn-trocar-mobile')?.addEventListener('click', trocarUsuario);
$('#btn-menu-mobile')?.addEventListener('click', () => document.body.classList.toggle('sidebar-open'));

$('#tema-rapido').addEventListener('change', async (e) => {
  const tema = e.target.value;
  await api('/config', { method: 'POST', body: { ...state.config, tema } });
  state.config.tema = tema;
  applyTheme(tema, state.emitente.logo);
});

function setNavActive(page) {
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  $$('#mobile-nav [data-page]').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
}

$$('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.body.classList.remove('sidebar-open');
    showPage(btn.dataset.page);
  });
});
$$('#mobile-nav [data-page]').forEach((btn) => {
  btn.addEventListener('click', () => showPage(btn.dataset.page));
});
$('#dash-estoque')?.addEventListener('click', () => showPage('estoque'));
$('#dash-importacao')?.addEventListener('click', () => showPage('importacao'));
$('#dash-alteracoes')?.addEventListener('click', () => showPage('alteracoes'));

function scrollAppTop() {
  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  const main = document.querySelector('.main');
  if (main) main.scrollTop = 0;
  $$('.page').forEach((p) => { p.scrollTop = 0; });
  const list = $('#estoque-lista');
  if (list) list.scrollTop = 0;
  const detail = $('#estoque-detalhe');
  if (detail) detail.scrollTop = 0;
  const alt = $('#alteracoes-lista');
  if (alt) alt.scrollTop = 0;
}

function showPage(page) {
  if (page === 'alteracoes' && !can('alteracoes', 'acesso')) {
    showMsg('Sem permissão para o relatório de alterações.');
    page = 'dashboard';
  }
  if (page === 'estoque' && !can('estoque', 'acesso')) {
    showMsg('Sem permissão de estoque.');
    page = 'dashboard';
  }
  if (page === 'importacao' && !state.usuario?.supervisor) {
    showMsg('Importação NF-e em desenvolvimento — disponível apenas para supervisor.');
    page = 'dashboard';
  }

  setNavActive(page);
  if ($('#page-dashboard')) $('#page-dashboard').hidden = page !== 'dashboard';
  $('#page-estoque').hidden = page !== 'estoque';
  if ($('#page-importacao')) $('#page-importacao').hidden = page !== 'importacao';
  if ($('#page-alteracoes')) $('#page-alteracoes').hidden = page !== 'alteracoes';
  $('#page-usuarios').hidden = page !== 'usuarios';

  if (page === 'dashboard') {
    $('#page-title').textContent = 'Início';
    $('#page-sub').textContent = 'Escolha um módulo';
  } else if (page === 'usuarios') {
    $('#page-title').textContent = 'Usuários';
    $('#page-sub').textContent = 'Permissões por módulo';
    loadUsuarios();
  } else if (page === 'alteracoes') {
    $('#page-title').textContent = 'Alterações';
    $('#page-sub').textContent = 'Histórico de saldos editados no painel';
    const escopoWrap = $('#alt-escopo-wrap');
    if (escopoWrap) escopoWrap.hidden = !state.usuario?.supervisor;
    loadAlteracoes();
  } else if (page === 'estoque') {
    showEstoqueLista();
    buscarEstoque(state.buscaAplicada, { keepHistory: true });
  } else if (page === 'importacao') {
    window.ImportacaoNfe?.onPageEnter();
  }
  scrollAppTop();
}

function showEstoqueLista() {
  state.selecionado = null;
  state.isNovo = false;
  state.scanTarget = 'search';
  $('#estoque-lista-view').hidden = false;
  $('#estoque-edit-view').hidden = true;
  $('#page-title').textContent = 'Estoque';
  $('#page-sub').textContent = 'Toque em um produto para editar';
  renderEstoqueLista();
  scrollAppTop();
}

function showEstoqueEdicao() {
  $('#estoque-lista-view').hidden = true;
  $('#estoque-edit-view').hidden = false;
  $('#page-title').textContent = state.isNovo ? 'Novo produto' : 'Editar produto';
  $('#page-sub').textContent = 'Altere os dados e salve ou cancele';
  scrollAppTop();
}

$('#btn-buscar-estoque').addEventListener('click', () => {
  buscarEstoque($('#estoque-busca').value);
});
$('#btn-icon-buscar')?.addEventListener('click', () => {
  buscarEstoque($('#estoque-busca').value);
});
$('#estoque-status-filtro')?.addEventListener('change', (e) => {
  state.estoqueStatus = String(e.target.value || 'A').toUpperCase();
  loadEstoque();
});
$('#estoque-busca').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') buscarEstoque($('#estoque-busca').value);
});
$('#estoque-busca').addEventListener('input', syncLimparBuscaBtn);
$('#btn-limpar-busca')?.addEventListener('click', () => {
  const anterior = state.buscaAnterior;
  state.buscaAnterior = '';
  buscarEstoque(anterior, { fromClear: true });
  $('#estoque-busca')?.focus();
});

function syncLimparBuscaBtn() {
  const btn = $('#btn-limpar-busca');
  if (!btn) return;
  const hasText = !!String($('#estoque-busca')?.value || '').trim();
  const hasPrev = state.buscaAnterior !== '' || state.buscaAplicada !== '';
  btn.hidden = !(hasText || hasPrev);
}

function buscarEstoque(q, opts = {}) {
  const next = String(q || '').trim();
  if (!opts.keepHistory && !opts.fromClear && next !== state.buscaAplicada) {
    state.buscaAnterior = state.buscaAplicada;
  }
  state.buscaAplicada = next;
  state.buscaBarras = !!opts.barras || (next.length > 5 && /^\d+$/.test(next));
  if ($('#estoque-busca')) $('#estoque-busca').value = next;
  syncLimparBuscaBtn();
  return loadEstoque();
}

async function loadEstoque() {
  const q = state.buscaAplicada || $('#estoque-busca').value.trim();
  const status = state.estoqueStatus || 'A';
  const barras = state.buscaBarras && String(q).length > 5 ? '&barras=1' : '';
  const res = await api(`/estoque?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}${barras}`);
  state.estoqueLista = res.itens || [];
  renderEstoqueLista();
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
    const inativo = String(it.status || 'A').toUpperCase() === 'I';
    const initials = String(it.descricao || '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase();
    return `
    <div class="item-row ${state.selecionado?.id_identificador === it.id_identificador ? 'active' : ''} ${inativo ? 'inactive' : ''}"
         data-id="${it.id_identificador}">
      <div class="item-avatar" aria-hidden="true">${escapeHtml(initials || '#')}</div>
      <div class="item-main">
        <strong title="${escapeAttr(it.descricao)}">${escapeHtml(it.descricao)}</strong>
        <div class="item-meta">
          <span class="chip">ID ${it.id_identificador}</span>
          <span class="chip">#${it.id_estoque}</span>
          ${inativo ? '<span class="chip chip-inativo">Inativo</span>' : '<span class="chip chip-ativo">Ativo</span>'}
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
    showMsg(det.error || 'Erro ao abrir produto');
    return;
  }
  if (!state.unidades.length) await loadUnidades();
  state.isNovo = false;
  state.selecionado = det.item;
  state.grupos = grupos.grupos || [];
  state.niveis = niveis;
  $('#edit-produto-nome').textContent = det.item.descricao || 'Produto';
  $('#edit-produto-meta').textContent = `#${det.item.id_estoque} · ID ${det.item.id_identificador}`;
  showEstoqueEdicao();
  renderDetalhe();
}

async function abrirNovoProduto() {
  if (!state.unidades.length) await loadUnidades();
  const [grupos, niveis] = await Promise.all([api('/grupos'), api('/niveis')]);
  state.grupos = grupos.grupos || [];
  state.niveis = niveis;
  state.isNovo = true;
  state.selecionado = {
    id_estoque: null,
    id_identificador: null,
    descricao: '',
    id_grupo: null,
    grupo: '',
    uni_medida: 'UN',
    prc_venda: 0.01,
    prc_custo: 0,
    qtd_atual: 0,
    cod_barras: '',
    referencia: '',
    desc_cmpl: '',
    grade_serie: 'N',
    controla_lote: false,
    status: 'A',
    id_nivel1: null,
    id_nivel2: null,
    lotes: [],
    seriais: [],
  };
  $('#edit-produto-nome').textContent = 'Novo produto';
  $('#edit-produto-meta').textContent = 'Preencha a ficha e salve';
  showEstoqueEdicao();
  renderDetalhe();
}

$('#btn-cancelar-produto').addEventListener('click', () => {
  showEstoqueLista();
  loadEstoque();
});

$('#btn-novo-produto')?.addEventListener('click', () => abrirNovoProduto());

$('#btn-salvar-produto').addEventListener('click', async () => {
  const it = state.selecionado;
  if (!it) return;
  const verCusto = podeVerCusto();
  const editarVenda = podeEditarPrecoVenda();
  const editarCusto = podeEditarCusto();
  const editarFicha = can('estoque', 'acesso') && (state.usuario.supervisor || ['editar', 'total'].includes(state.usuario.permissoes?.estoque?.ficha) || state.isNovo);
  const editarQtd = can('estoque', 'acesso') && (state.usuario.supervisor || ['editar', 'total'].includes(state.usuario.permissoes?.estoque?.quantidades) || state.isNovo);

  const body = {
    usuarioNome: state.usuario.nome,
    idFuncionario: state.usuario.id,
  };

  if (editarFicha) {
    if ($('#f-descricao')) body.descricao = $('#f-descricao').value;
    if ($('#f-grupo')) body.id_grupo = $('#f-grupo').value === '' ? null : Number($('#f-grupo').value);
    if ($('#f-un')) body.uni_medida = $('#f-un').value;
    if ($('#f-barras')) body.cod_barras = $('#f-barras').value;
    if ($('#f-ref')) body.referencia = $('#f-ref').value;
    if ($('#f-cmpl')) body.desc_cmpl = $('#f-cmpl').value;
    if ($('#f-status')) body.status = $('#f-status').value === 'I' ? 'I' : 'A';
    if ($('#g-cor')) body.id_nivel1 = $('#g-cor').value === '' ? null : Number($('#g-cor').value);
    if ($('#g-tam')) body.id_nivel2 = $('#g-tam').value === '' ? null : Number($('#g-tam').value);
  }
  if ((editarVenda || state.isNovo) && $('#p-venda')) body.prc_venda = Number($('#p-venda').value);
  if ((editarCusto || state.isNovo) && $('#p-custo') && (verCusto || state.isNovo)) body.prc_custo = Number($('#p-custo').value);
  if (editarQtd && $('#q-atual')) body.qtd_atual = Number($('#q-atual').value);

  if (!String(body.descricao || it.descricao || '').trim() && state.isNovo) {
    return showMsg('Informe a descrição do produto.');
  }

  let res;
  if (state.isNovo) {
    res = await api('/estoque', { method: 'POST', body });
  } else {
    res = await api(`/estoque/${it.id_identificador}`, { method: 'PUT', body });
  }
  if (!res.ok) return showMsg(res.error || 'Erro ao salvar');
  showToast(state.isNovo ? 'Produto cadastrado com sucesso.' : 'Dados alterados com sucesso.');
  showEstoqueLista();
  await loadEstoque();
});

function renderDetalhe() {
  const it = state.selecionado;
  if (!it) return;
  const editarFicha = state.isNovo || (can('estoque', 'acesso') && (state.usuario.supervisor || ['editar', 'total'].includes(state.usuario.permissoes?.estoque?.ficha)));
  const editarQtd = state.isNovo || (can('estoque', 'acesso') && (state.usuario.supervisor || ['editar', 'total'].includes(state.usuario.permissoes?.estoque?.quantidades)));
  const editarVenda = state.isNovo || podeEditarPrecoVenda();
  const editarCusto = state.isNovo || podeEditarCusto();
  const verCusto = state.isNovo || podeVerCusto();
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
        <label>ID Estoque<input value="${it.id_estoque ?? 'Novo'}" disabled /></label>
        <label>ID Identificador<input value="${it.id_identificador ?? 'Novo'}" disabled /></label>
        <label class="full">Descrição<input id="f-descricao" value="${escapeAttr(it.descricao)}" ${editarFicha || state.isNovo ? '' : 'disabled'} /></label>
        <label class="full">Grupo
          <div class="input-row">
            <select id="f-grupo" ${editarFicha || state.isNovo ? '' : 'disabled'}>
              <option value="">—</option>
              ${state.grupos.map((g) => `<option value="${g.id_grupo}" ${Number(g.id_grupo) === Number(it.id_grupo) ? 'selected' : ''}>${escapeHtml(g.descricao)}</option>`).join('')}
            </select>
            <button type="button" class="btn small" id="btn-novo-grupo" ${editarFicha || state.isNovo ? '' : 'disabled'}>+</button>
          </div>
        </label>
        <label>Unid. medida
          <select id="f-un" ${editarFicha || state.isNovo ? '' : 'disabled'}>
            ${optionsUnidades(it.uni_medida)}
          </select>
        </label>
        <label>Qtd atual<input value="${fmtNum(it.qtd_atual)}" disabled /></label>
        <div class="full field">
          <span>Cód. barras</span>
          <div class="input-row barcode-row">
            <input id="f-barras" value="${escapeAttr(it.cod_barras)}" ${editarFicha ? '' : 'disabled'} />
            ${editarFicha ? `<button type="button" id="btn-scan-ficha-barras" class="btn icon-cam" title="Ler código de barras" aria-label="Ler código de barras">${CAMERA_ICON_SVG}</button>` : ''}
          </div>
        </div>
        <label>Referência<input id="f-ref" value="${escapeAttr(it.referencia)}" ${editarFicha ? '' : 'disabled'} /></label>
        <label>Status
          <select id="f-status" ${editarFicha && !state.isNovo ? '' : (state.isNovo ? '' : 'disabled')}>
            <option value="A" ${String(it.status || 'A').toUpperCase() !== 'I' ? 'selected' : ''}>Ativo</option>
            <option value="I" ${String(it.status || 'A').toUpperCase() === 'I' ? 'selected' : ''}>Inativo</option>
          </select>
        </label>
        <label class="full">Desc. complementar<input id="f-cmpl" value="${escapeAttr(it.desc_cmpl)}" ${editarFicha ? '' : 'disabled'} /></label>
        ${!state.isNovo && editarFicha ? `
        <div class="full status-actions">
          <button type="button" class="btn ${String(it.status || 'A').toUpperCase() === 'I' ? 'ok' : 'outline'}" id="btn-toggle-status">
            ${String(it.status || 'A').toUpperCase() === 'I' ? 'Ativar produto' : 'Inativar produto'}
          </button>
          <span class="hint">Altera o campo STATUS na base (Clipp e ManagePro).</span>
        </div>` : ''}
        <label>Preço venda<input value="${fmtMoney(it.prc_venda)}" disabled /></label>
        <label>Preço custo<input class="${verCusto ? '' : 'masked'}" value="${verCusto ? fmtMoney(it.prc_custo) : '****'}" disabled /></label>
      </div>
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

  $('#btn-toggle-status')?.addEventListener('click', async () => {
    const atual = String(it.status || 'A').toUpperCase() === 'I' ? 'I' : 'A';
    const proximo = atual === 'I' ? 'A' : 'I';
    const ok = confirm(proximo === 'I'
      ? 'Inativar este produto na base (STATUS = I)?'
      : 'Ativar este produto na base (STATUS = A)?');
    if (!ok) return;
    const res = await api(`/estoque/${it.id_identificador}`, {
      method: 'PUT',
      body: {
        status: proximo,
        usuarioNome: state.usuario.nome,
        idFuncionario: state.usuario.id,
      },
    });
    if (!res.ok) return showMsg(res.error || 'Erro ao alterar status');
    it.status = proximo;
    if ($('#f-status')) $('#f-status').value = proximo;
    showToast(proximo === 'I' ? 'Produto inativado.' : 'Produto ativado.');
    renderDetalhe();
  });

  $('#btn-scan-ficha-barras')?.addEventListener('click', () => {
    if ($('#btn-scan-ficha-barras').disabled) return;
    startScanner('ficha');
  });

  $('#btn-novo-grupo')?.addEventListener('click', async () => {
    const nome = prompt('Nome do novo grupo:');
    if (!nome) return;
    const res = await api('/grupos', { method: 'POST', body: { descricao: nome } });
    if (!res.ok) return showMsg(res.error || 'Erro ao criar grupo');
    state.grupos.push(res.grupo);
    const sel = $('#f-grupo');
    const opt = document.createElement('option');
    opt.value = res.grupo.id_grupo;
    opt.textContent = res.grupo.descricao;
    opt.selected = true;
    sel.appendChild(opt);
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
        <label>Relatório Alterações
          <select data-perm="alteracoes.acesso" ${u.supervisor ? 'disabled' : ''}>
            <option value="true" ${u.permissoes?.alteracoes?.acesso ? 'selected' : ''}>Sim</option>
            <option value="false" ${!u.permissoes?.alteracoes?.acesso ? 'selected' : ''}>Não</option>
          </select>
        </label>
        <label>Usuários
          <select data-perm="usuarios.acesso" ${u.supervisor ? 'disabled' : ''}>
            <option value="true" ${u.permissoes?.usuarios?.acesso ? 'selected' : ''}>Sim</option>
            <option value="false" ${!u.permissoes?.usuarios?.acesso ? 'selected' : ''}>Não</option>
          </select>
        </label>
      </div>
      <p class="hint">${u.supervisor ? 'Supervisor: todas as permissões ativas automaticamente.' : 'Preços: Visualizar = só venda; Editar = altera venda; Total = venda + custo.'}</p>
    </div>
  `).join('');
}

const PERM_LABELS = {
  nenhum: 'Nenhum',
  visualizar: 'Visualizar',
  editar: 'Editar',
  total: 'Total',
};

function permOptions(list, current) {
  return list.map((v) => {
    const label = PERM_LABELS[v] || (String(v).charAt(0).toUpperCase() + String(v).slice(1));
    return `<option value="${v}" ${v === current ? 'selected' : ''}>${label}</option>`;
  }).join('');
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
        alteracoes: {
          acesso: $('[data-perm="alteracoes.acesso"]', card).value === 'true',
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
  if (!res.ok) return showMsg(res.error || 'Erro ao salvar');
  state.usuarios = res.usuarios;
  renderUsuarios();
  showToast('Usuários atualizados.');
});

function fmtDataHora(data, hora, dataHoraPronta) {
  const ready = String(dataHoraPronta || '').trim();
  if (/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/.test(ready)) return ready;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(ready)) return ready;

  const pad = (n) => String(Math.trunc(Number(n) || 0)).padStart(2, '0');

  let y; let mo; let d;
  if (data != null && data !== '') {
    const s = String(data);
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else {
      m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; }
    }
  }
  if (!y) return ready || '—';

  let hh = 0; let mi = 0; let ss = 0; let hasTime = false;
  if (hora != null && hora !== '') {
    const s = String(hora).trim();
    let m = s.match(/T(\d{2}):(\d{2}):(\d{2})/i);
    if (!m) m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/);
    if (!m) m = s.match(/\s(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (m) {
      hasTime = true;
      hh = +m[1]; mi = +m[2]; ss = +(m[3] || 0);
    }
  }

  const datePart = `${pad(d)}/${pad(mo)}/${y}`;
  return hasTime ? `${datePart} ${pad(hh)}:${pad(mi)}:${pad(ss)}` : datePart;
}

async function loadAlteracoes() {
  const box = $('#alteracoes-lista');
  if (box) box.innerHTML = '<p class="empty">Carregando…</p>';
  const dias = Number($('#alt-dias')?.value || 30);
  const q = String($('#alt-busca')?.value || '').trim();
  const todos = state.usuario?.supervisor && $('#alt-escopo')?.value === 'todos';
  const tipo = state.alteracoesTipo || 'todos';
  const params = new URLSearchParams({
    idUsuario: String(state.usuario?.id ?? 0),
    supervisor: state.usuario?.supervisor ? '1' : '0',
    todos: todos ? '1' : '0',
    dias: String(dias),
    tipo,
    q,
  });
  const res = await api(`/alteracoes?${params.toString()}`);
  if (!res.ok) {
    if (box) box.innerHTML = `<p class="empty">${escapeHtml(res.error || 'Erro ao carregar')}</p>`;
    return;
  }
  state.alteracoesLista = res.itens || [];
  renderAlteracoes();
}

function tipoAlteracaoLabel(tipo) {
  const map = {
    quantidade: 'Quantidade',
    precos: 'Preços',
    ficha: 'Ficha',
    cadastro: 'Cadastro',
  };
  return map[tipo] || tipo || 'Alteração';
}

function renderAlteracoes() {
  const box = $('#alteracoes-lista');
  if (!box) return;
  const listPanel = box.closest('.list-panel') || box.parentElement;
  let head = listPanel.querySelector('.list-panel-head');
  if (!head) {
    head = document.createElement('div');
    head.className = 'list-panel-head';
    head.innerHTML = '<strong>Movimentações</strong><span data-count></span>';
    listPanel.insertBefore(head, box);
  }
  const n = state.alteracoesLista.length;
  const tipoLabel = tipoAlteracaoLabel(state.alteracoesTipo === 'todos' ? '' : state.alteracoesTipo);
  head.querySelector('strong').textContent = state.alteracoesTipo === 'todos' ? 'Todas as alterações' : tipoLabel;
  head.querySelector('[data-count]').textContent = `${n} registro${n === 1 ? '' : 's'}`;

  if (!n) {
    box.innerHTML = '<p class="empty">Nenhuma alteração encontrada neste filtro</p>';
    return;
  }

  box.innerHTML = state.alteracoesLista.map((it) => {
    const tipo = it.tipo || 'ficha';
    const isQty = tipo === 'quantidade';
    const diff = Number(it.diferenca || 0);
    const side = isQty
      ? `<span class="stock-badge ${diff > 0 ? 'ok' : diff < 0 ? 'zero' : ''}">${diff > 0 ? '+' : ''}${fmtNum(diff)} ${escapeHtml(it.uni_medida || '')}</span>
         <span class="item-price">${fmtNum(it.saldo_antigo)} → ${fmtNum(it.saldo_novo)}</span>`
      : `<span class="chip-tipo ${escapeAttr(tipo)}">${escapeHtml(tipoAlteracaoLabel(tipo))}</span>
         <span class="item-price">${escapeHtml(it.resumo || '—')}</span>`;
    const detalhe = it.detalhe || (isQty ? '' : '');
    return `
      <div class="item-row alt-row">
        <div class="item-avatar alt-${escapeAttr(tipo)}" aria-hidden="true">${isQty ? 'Δ' : tipo === 'precos' ? 'R$' : tipo === 'cadastro' ? '+' : 'F'}</div>
        <div class="item-main">
          <strong title="${escapeAttr(it.descricao)}">${escapeHtml(it.descricao || 'Produto')}</strong>
          <div class="item-meta">
            <span class="chip">${escapeHtml(fmtDataHora(it.data, it.hora, it.data_hora))}</span>
            <span class="chip">#${it.id_estoque || '—'}</span>
            ${it.cod_barras ? `<span class="chip">${escapeHtml(it.cod_barras)}</span>` : ''}
            <span class="chip">${escapeHtml(it.funcionario || '—')}</span>
            ${state.alteracoesTipo === 'todos' ? `<span class="chip chip-tipo ${escapeAttr(tipo)}">${escapeHtml(tipoAlteracaoLabel(tipo))}</span>` : ''}
          </div>
          ${detalhe ? `<p class="alt-obs">${escapeHtml(detalhe)}</p>` : ''}
          ${it.observacao && it.observacao !== detalhe ? `<p class="alt-obs">${escapeHtml(it.observacao)}</p>` : ''}
        </div>
        <div class="item-side">${side}</div>
      </div>`;
  }).join('');
}

$('#btn-buscar-alt')?.addEventListener('click', () => loadAlteracoes());
$('#alt-dias')?.addEventListener('change', () => loadAlteracoes());
$('#alt-escopo')?.addEventListener('change', () => loadAlteracoes());
$('#alt-busca')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadAlteracoes();
});
$('#alt-busca')?.addEventListener('input', () => {
  const btn = $('#btn-limpar-alt');
  if (btn) btn.hidden = !String($('#alt-busca').value || '').trim();
});
$('#btn-limpar-alt')?.addEventListener('click', () => {
  if ($('#alt-busca')) $('#alt-busca').value = '';
  const btn = $('#btn-limpar-alt');
  if (btn) btn.hidden = true;
  loadAlteracoes();
});
$$('#alt-tabs [data-alt-tipo]').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.alteracoesTipo = btn.dataset.altTipo || 'todos';
    $$('#alt-tabs [data-alt-tipo]').forEach((b) => b.classList.toggle('active', b === btn));
    loadAlteracoes();
  });
});

function stopScanner() {
  if (scanControls?.timer) clearInterval(scanControls.timer);
  if (scanControls?.reader?.reset) {
    try { scanControls.reader.reset(); } catch { /* ignore */ }
  }
  if (scanControls?.stream) {
    scanControls.stream.getTracks().forEach((t) => t.stop());
  }
  scanControls = null;
  const video = $('#scan-video');
  if (video) {
    video.srcObject = null;
    video.hidden = true;
  }
}

function normalizeBarcodeNumber(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';

  // Remove espaços e caracteres comuns de formatação
  const compact = text.replace(/[\s\-._]/g, '');

  // Se já for só dígitos, usa direto
  if (/^\d{4,18}$/.test(compact)) return compact;

  // Extrai a maior sequência numérica (código de barras impresso)
  const matches = compact.match(/\d{4,18}/g) || text.match(/\d{4,18}/g) || [];
  if (!matches.length) return '';
  matches.sort((a, b) => b.length - a.length);
  return matches[0];
}

function pickBestBarcode(candidates) {
  const uniq = [...new Set(candidates.filter(Boolean))];
  if (!uniq.length) return '';
  uniq.sort((a, b) => {
    if (a.length === 13 && b.length !== 13) return -1;
    if (b.length === 13 && a.length !== 13) return 1;
    if (a.length === 8 && b.length !== 8) return -1;
    if (b.length === 8 && a.length !== 8) return 1;
    if (a.length === 12 && b.length !== 12) return -1;
    if (b.length === 12 && a.length !== 12) return 1;
    return b.length - a.length;
  });
  return uniq[0];
}

async function applyScannedCode(value) {
  const code = normalizeBarcodeNumber(value);
  if (!code) return false;
  stopScanner();
  $('#dlg-scan')?.close();
  if (state.scanTarget === 'ficha') {
    const exceptId = state.isNovo ? null : state.selecionado?.id_identificador;
    const found = await api(`/estoque/codigo-barras?code=${encodeURIComponent(code)}`);
    const dup = found?.item && Number(found.item.id_identificador) !== Number(exceptId || 0);
    if (dup) {
      showMsg(
        found.item.descricao
          ? `Este código de barras já está cadastrado no produto “${found.item.descricao}”.`
          : 'Este código de barras já está cadastrado.'
      );
      return true;
    }
    const inp = $('#f-barras');
    if (inp && !inp.disabled) {
      inp.value = code;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.focus();
    }
    state.scanTarget = 'search';
    return true;
  }
  if (state.scanTarget === 'importacao') {
    const chave = String(value || code || '').replace(/\D/g, '').slice(0, 44);
    if (chave.length === 44 && window.ImportacaoNfe?.applyScannedChave(chave)) {
      state.scanTarget = 'search';
      return true;
    }
    showMsg('Chave inválida. A NF-e deve ter 44 dígitos numéricos.');
    state.scanTarget = 'search';
    return true;
  }
  if (state.scanTarget === 'importacao-prod') {
    if (window.ImportacaoNfe?.applyScannedProduto?.(code)) {
      state.scanTarget = 'search';
      return true;
    }
    state.scanTarget = 'search';
    return true;
  }
  scrollAppTop();
  buscarEstoque(code, { barras: String(code).length > 5 });
  return true;
}

/** Usado pelo APK Android (câmera nativa ao vivo). */
window.applyScannedCodeFromApp = (value) => applyScannedCode(value);

function getZxingReader() {
  const ZXing = window.ZXingBrowser || window.ZXing;
  if (!ZXing?.BrowserMultiFormatReader) return null;
  return new ZXing.BrowserMultiFormatReader();
}

const BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'codabar'];

async function loadImageElement(url) {
  const img = new Image();
  img.decoding = 'async';
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = url;
  });
  return img;
}

function canvasVariantsFromImage(img) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return [];

  const variants = [];
  const pushVariant = (sx, sy, sw, sh, scale, mode) => {
    const cw = Math.max(1, Math.round(sw * scale));
    const ch = Math.max(1, Math.round(sh * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);

    if (mode !== 'raw') {
      const data = ctx.getImageData(0, 0, cw, ch);
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        let y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        if (mode === 'contrast') {
          y = (y - 128) * 1.55 + 128;
        } else if (mode === 'threshold') {
          y = y > 140 ? 255 : 0;
        } else if (mode === 'invert') {
          y = 255 - y;
        }
        y = Math.max(0, Math.min(255, y));
        px[i] = px[i + 1] = px[i + 2] = y;
      }
      ctx.putImageData(data, 0, 0);
    }
    variants.push(canvas);
  };

  // Original e com contraste em escalas úteis
  for (const scale of [1, 1.6, 0.75]) {
    pushVariant(0, 0, w, h, scale, 'raw');
    pushVariant(0, 0, w, h, scale, 'contrast');
  }

  // Recorte central (usuário costuma centralizar o código)
  const cx = Math.round(w * 0.08);
  const cy = Math.round(h * 0.22);
  const cw = Math.round(w * 0.84);
  const ch = Math.round(h * 0.56);
  pushVariant(cx, cy, cw, ch, 1.4, 'contrast');
  pushVariant(cx, cy, cw, ch, 1.8, 'threshold');
  pushVariant(cx, cy, cw, ch, 1.4, 'invert');

  // Faixa horizontal (barras de produto)
  const bx = Math.round(w * 0.05);
  const by = Math.round(h * 0.35);
  const bw = Math.round(w * 0.9);
  const bh = Math.round(h * 0.3);
  pushVariant(bx, by, bw, bh, 2, 'contrast');
  pushVariant(bx, by, bw, bh, 2.2, 'threshold');

  return variants;
}

async function detectWithBarcodeDetector(source) {
  if (!('BarcodeDetector' in window)) return [];
  try {
    const detector = new BarcodeDetector({ formats: BARCODE_FORMATS });
    const codes = await detector.detect(source);
    return codes.map((c) => normalizeBarcodeNumber(c.rawValue)).filter(Boolean);
  } catch {
    return [];
  }
}

async function detectWithZxingCanvas(canvas) {
  const reader = getZxingReader();
  if (!reader) return [];
  try {
    const result = await reader.decodeFromCanvas(canvas);
    const n = normalizeBarcodeNumber(result?.getText?.() || result?.text || '');
    return n ? [n] : [];
  } catch {
    return [];
  }
}

async function decodeBarcodeFromImageUrl(url) {
  const candidates = [];
  const img = await loadImageElement(url);

  // 1) Imagem original
  candidates.push(...await detectWithBarcodeDetector(img));
  try {
    const bitmap = await createImageBitmap(img);
    candidates.push(...await detectWithBarcodeDetector(bitmap));
    bitmap.close?.();
  } catch { /* ignore */ }

  try {
    const reader = getZxingReader();
    if (reader) {
      const result = await reader.decodeFromImageUrl(url);
      const n = normalizeBarcodeNumber(result?.getText?.() || result?.text || '');
      if (n) candidates.push(n);
    }
  } catch { /* ignore */ }

  if (pickBestBarcode(candidates)) return pickBestBarcode(candidates);

  // 2) Variantes processadas (contraste / recorte / threshold)
  const variants = canvasVariantsFromImage(img);
  for (const canvas of variants) {
    candidates.push(...await detectWithBarcodeDetector(canvas));
    candidates.push(...await detectWithZxingCanvas(canvas));
    const best = pickBestBarcode(candidates);
    if (best) return best;
  }

  return pickBestBarcode(candidates);
}

async function startScanner(target = 'search') {
  state.scanTarget = ['ficha', 'importacao', 'importacao-prod'].includes(target) ? target : 'search';
  // No APK Android: câmera nativa (WebView em HTTP local não abre getUserMedia).
  try {
    if (window.GestorApp && typeof window.GestorApp.scanBarcode === 'function') {
      window.GestorApp.scanBarcode();
      return;
    }
  } catch (err) {
    console.warn('GestorApp.scanBarcode falhou', err);
  }

  const dlg = $('#dlg-scan');
  const msg = $('#scan-msg');
  const preview = $('#scan-preview');
  const liveBtn = $('#btn-scan-live');
  if (!dlg) return;

  stopScanner();
  if (preview) {
    preview.hidden = true;
    preview.removeAttribute('src');
  }
  dlg.showModal();
  msg.textContent = 'Toque em “Abrir câmera”, foque só no código de barras e confirme a foto.';

  const canLive = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia
    && (window.isSecureContext || window.__GESTOR_APP__));
  if (liveBtn) liveBtn.hidden = !canLive;
}

async function startLiveScanner() {
  const video = $('#scan-video');
  const msg = $('#scan-msg');
  const preview = $('#scan-preview');
  if (!video || !msg) return;

  if (!window.isSecureContext && !window.__GESTOR_APP__) {
    msg.textContent = 'Leitura ao vivo precisa de HTTPS. Use “Abrir câmera / galeria”.';
    return;
  }

  try {
    if (preview) preview.hidden = true;
    video.hidden = false;
    msg.textContent = 'Abrindo câmera ao vivo…';
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();

    const reader = getZxingReader();
    scanControls = { stream, reader, timer: null };

    if (reader?.decodeFromVideoDevice) {
      // Alguns builds usam deviceId null = default
      await reader.decodeFromVideoDevice(undefined, video, (result, err) => {
        if (result) applyScannedCode(result.getText());
        void err;
      });
      msg.textContent = 'Aponte para o código de barras…';
      return;
    }

    if ('BarcodeDetector' in window) {
      const detector = new BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'codabar'],
      });
      msg.textContent = 'Aponte para o código de barras…';
      scanControls.timer = setInterval(async () => {
        try {
          const codes = await detector.detect(video);
          if (codes[0]?.rawValue) applyScannedCode(codes[0].rawValue);
        } catch { /* ignore */ }
      }, 450);
      return;
    }

    msg.textContent = 'Leitura ao vivo indisponível neste navegador. Use a foto do código.';
  } catch (err) {
    msg.textContent = `Não foi possível abrir a câmera ao vivo: ${err.message}. Use “Abrir câmera / galeria”.`;
  }
}

async function onScanFileSelected(file) {
  const msg = $('#scan-msg');
  const preview = $('#scan-preview');
  if (!file) return;
  msg.textContent = 'Lendo número do código…';
  const url = URL.createObjectURL(file);
  if (preview) {
    preview.src = url;
    preview.hidden = false;
  }
  $('#scan-video').hidden = true;
  try {
    const code = await decodeBarcodeFromImageUrl(url);
    if (!applyScannedCode(code)) {
      msg.textContent = 'Não encontrei o número. Tire outra foto mais perto, com boa luz e só o código.';
    }
  } catch (err) {
    msg.textContent = `Não foi possível ler o número do código. Tire outra foto mais perto. (${err.message || 'erro'})`;
  } finally {
    // mantém preview; revoga depois de um tempo
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}

$('#btn-scan-barras')?.addEventListener('click', () => startScanner('search'));
$('#btn-scan-fechar')?.addEventListener('click', () => {
  stopScanner();
  state.scanTarget = 'search';
  $('#dlg-scan')?.close();
});
$('#btn-scan-foto')?.addEventListener('click', () => {
  $('#scan-file')?.click();
});
$('#btn-scan-live')?.addEventListener('click', () => startLiveScanner());
$('#scan-file')?.addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  onScanFileSelected(file);
  e.target.value = '';
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

window.ImportacaoNfe?.init({
  api,
  showMsg,
  showConfirm,
  showToast,
  escapeHtml,
  fmtMoney,
  fmtNum,
  scrollAppTop,
  startScanner,
  isSupervisor: () => !!state.usuario?.supervisor,
  getUsuario: () => state.usuario,
});

/** Botão Voltar do Android: uma tela atrás no app (não sair para conexão). */
window.gestorHardwareBack = () => {
  const dlgDanfe = $('#dlg-danfe');
  if (dlgDanfe?.open) {
    const frame = $('#dlg-danfe-frame');
    if (frame) frame.src = 'about:blank';
    try { dlgDanfe.close(); } catch { /* ignore */ }
    return true;
  }
  const dlgConfirm = $('#dlg-confirm');
  if (dlgConfirm?.open) {
    try { dlgConfirm.close(); } catch { /* ignore */ }
    return true;
  }
  const dlg = $('#dlg-scan');
  if (dlg?.open) {
    stopScanner();
    dlg.close();
    return true;
  }
  if (window.ImportacaoNfe?.handleBack?.()) return true;
  const pageImp = $('#page-importacao');
  if (pageImp && !pageImp.hidden) {
    showPage('dashboard');
    return true;
  }
  const pageEst = $('#page-estoque');
  if (pageEst && !pageEst.hidden) {
    showPage('dashboard');
    return true;
  }
  const pageAlt = $('#page-alteracoes');
  if (pageAlt && !pageAlt.hidden) {
    showPage('dashboard');
    return true;
  }
  const pageUsr = $('#page-usuarios');
  if (pageUsr && !pageUsr.hidden) {
    showPage('dashboard');
    return true;
  }
  return false;
};

bootstrap().catch((err) => {
  console.error(err);
  showMsg('Falha ao iniciar: ' + err.message);
});
