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
  state.scanTarget = ['ficha', 'importacao', 'importacao-prod', 'importacao-ean'].includes(target) ? target : 'search';
};

/** APK Android (ponte nativa). Navegador/iPhone Safari = false. */
function isNativeApk() {
  try {
    if (window.__GESTOR_APP__) return true;
    if (window.GestorApp && typeof window.GestorApp.isNativeApp === 'function') {
      return !!window.GestorApp.isNativeApp();
    }
    return !!(window.GestorApp && typeof window.GestorApp.scanBarcode === 'function');
  } catch {
    return false;
  }
}

function isChaveScanTarget(target = state.scanTarget) {
  return target === 'importacao';
}

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

function showPrompt({ message, password = false, defaultValue = '' } = {}) {
  return new Promise((resolve) => {
    const dlg = $('#dlg-prompt');
    const text = $('#dlg-prompt-text');
    const input = $('#dlg-prompt-input');
    const btnOk = $('#dlg-prompt-ok');
    const btnCancel = $('#dlg-prompt-cancel');
    if (!dlg || !text || !input || !btnOk || !btnCancel) {
      resolve(password ? window.prompt(message) : window.prompt(message, defaultValue));
      return;
    }
    text.textContent = String(message || '');
    input.type = password ? 'password' : 'text';
    input.value = password ? '' : String(defaultValue || '');
    const finish = (value) => {
      btnOk.onclick = null;
      btnCancel.onclick = null;
      dlg.onclose = null;
      try { if (dlg.open) dlg.close(); } catch { /* ignore */ }
      resolve(value);
    };
    btnOk.onclick = () => finish(input.value);
    btnCancel.onclick = () => finish(null);
    dlg.onclose = () => resolve(null);
    if (!dlg.open) dlg.showModal();
    setTimeout(() => input.focus(), 30);
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

const UI_SCALE_KEY = 'gestor.uiScale';

function applyUiScale(scale) {
  const allowed = ['compacto', 'padrao', 'padrao', 'confortavel', 'confortavel', 'grande'];
  const value = allowed.includes(scale) ? scale : 'padrao';
  document.documentElement.setAttribute('data-ui-scale', value);
  try { localStorage.setItem(UI_SCALE_KEY, value); } catch { /* ignore */ }
  const sel = $('#ui-scale');
  if (sel && sel.value !== value) sel.value = value;
}

function initUiScale() {
  let saved = 'padrao';
  try { saved = localStorage.getItem(UI_SCALE_KEY) || 'padrao'; } catch { /* ignore */ }
  applyUiScale(saved);
}

function applyTheme(tema, logoUrl) {
  const logo = logoUrl || state.emitente?.logo;
  document.documentElement.setAttribute('data-theme', tema || 'claro');
  if (tema === 'empresa' && logo) {
    extractAccent(logo).then((color) => {
      if (!color) return;
      document.documentElement.style.setProperty('--empresa-accent', color);
      document.documentElement.style.setProperty('--empresa-accent', color);
    });
  } else {
    document.documentElement.style.removeProperty('--empresa-accent');
    document.documentElement.style.removeProperty('--empresa-accent');
  }
}

function rgbToHex(r, g, b) {
  const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function chromaOf(r, g, b) {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function boostAccent(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max <= 0) return [r, g, b];
  const sat = (max - min) / max;
  const target = Math.min(1, sat * 1.35 + 0.12);
  const scale = max === min ? 1 : (target * max) / (max - min);
  return [
    max - (max - r) * scale,
    max - (max - g) * scale,
    max - (max - b) * scale,
  ];
}

/** Cor mais forte da logo (ignora branco/preto/cinza). */
function extractAccent(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 64;
        const c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        const buckets = new Map();
        let fallbackR = 0;
        let fallbackG = 0;
        let fallbackB = 0;
        let fallbackN = 0;
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3];
          if (a < 140) continue;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const mx = Math.max(r, g, b);
          const mn = Math.min(r, g, b);
          if (mx < 28) continue;
          if (mn > 232) continue;
          fallbackR += r;
          fallbackG += g;
          fallbackB += b;
          fallbackN++;
          const ch = mx - mn;
          if (ch < 36) continue;
          const key = `${r >> 4},${g >> 4},${b >> 4}`;
          let bucket = buckets.get(key);
          if (!bucket) {
            bucket = {
              n: 0, r: 0, g: 0, b: 0, chroma: 0,
            };
            buckets.set(key, bucket);
          }
          bucket.n += 1;
          bucket.r += r;
          bucket.g += g;
          bucket.b += b;
          bucket.chroma += ch;
        }
        let best = null;
        for (const bucket of buckets.values()) {
          const avgG = bucket.g / bucket.n;
          const avgR = bucket.r / bucket.n;
          const avgB = bucket.b / bucket.n;
          const greenBias = avgG >= avgR && avgG >= avgB ? 1.55 : 1;
          const score = bucket.n * (bucket.chroma / bucket.n) * greenBias;
          if (!best || score > best.score) best = { score, bucket };
        }
        let r;
        let g;
        let b;
        if (best) {
          r = best.bucket.r / best.bucket.n;
          g = best.bucket.g / best.bucket.n;
          b = best.bucket.b / best.bucket.n;
        } else if (fallbackN) {
          r = fallbackR / fallbackN;
          g = fallbackG / fallbackN;
          b = fallbackB / fallbackN;
        } else {
          return resolve('#b71c1c');
        }
        [r, g, b] = boostAccent(r, g, b);
        resolve(rgbToHex(r, g, b));
      } catch {
        resolve('#b71c1c');
      }
    };
    img.onerror = () => resolve('#b71c1c');
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
  if (state.config?.tema === 'empresa') applyTheme('empresa', state.emitente.logo);
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
  const showImp = !!state.usuario?.supervisor || can('importacao', 'acesso');
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
  const bd = $('#sidebar-backdrop');
  if (bd) bd.hidden = true;
  loadFuncionarios();
}

$('#btn-logout').addEventListener('click', trocarUsuario);
$('#btn-trocar-usuario').addEventListener('click', trocarUsuario);
$('#btn-trocar-usuario-top').addEventListener('click', trocarUsuario);
$('#btn-trocar-mobile')?.addEventListener('click', trocarUsuario);
function setSidebarOpen(open) {
  document.body.classList.toggle('sidebar-open', open);
  const bd = $('#sidebar-backdrop');
  if (bd) bd.hidden = !open;
}

$('#btn-menu-mobile')?.addEventListener('click', () => {
  setSidebarOpen(!document.body.classList.contains('sidebar-open'));
});
$('#sidebar-backdrop')?.addEventListener('click', () => setSidebarOpen(false));

$('#tema-rapido').addEventListener('change', async (e) => {
  const tema = e.target.value;
  await api('/config', { method: 'POST', body: { ...state.config, tema } });
  state.config.tema = tema;
  applyTheme(tema, state.emitente.logo);
});

$('#ui-scale')?.addEventListener('change', (e) => {
  applyUiScale(e.target.value);
});
initUiScale();

function setNavActive(page) {
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  $$('#mobile-nav [data-page]').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
}

$$('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    document.body.classList.remove('sidebar-open');
    await showPage(btn.dataset.page);
  });
});
$$('#mobile-nav [data-page]').forEach((btn) => {
  btn.addEventListener('click', async () => showPage(btn.dataset.page));
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

async function showPage(page) {
  const pageImp = $('#page-importacao');
  const saindoImportacao = pageImp && !pageImp.hidden && page !== 'importacao';
  if (saindoImportacao && window.ImportacaoNfe?.isDirtyConferencia?.()) {
    const ok = await showConfirm(
      'A conferência da NF-e está aberta. Sair sem salvar? Alterações deste item que ainda não foram gravadas serão perdidas. A nota permanece em “Em conferência”.',
      { okLabel: 'Sair', cancelLabel: 'Continuar na NF-e' }
    );
    if (!ok) return;
  }

  if (page === 'alteracoes' && !can('alteracoes', 'acesso')) {
    showMsg('Sem permissão para o relatório de alterações.');
    page = 'dashboard';
  }
  if (page === 'estoque' && !can('estoque', 'acesso')) {
    showMsg('Sem permissão de estoque.');
    page = 'dashboard';
  }
  if (page === 'importacao' && !(state.usuario?.supervisor || can('importacao', 'acesso'))) {
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
  if (e.key === 'Enter' || e.key === 'Search') {
    e.preventDefault();
    buscarEstoque($('#estoque-busca').value);
    $('#estoque-busca').blur();
  }
});
$('#estoque-busca').addEventListener('search', (e) => {
  e.preventDefault();
  buscarEstoque($('#estoque-busca').value);
  $('#estoque-busca').blur();
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
  if ((editarVenda || state.isNovo) && $('#p-venda')) body.prc_venda = parseBrMoney($('#p-venda').value);
  if ((editarCusto || state.isNovo) && $('#p-custo') && (verCusto || state.isNovo)) body.prc_custo = parseBrMoney($('#p-custo').value);
  if (editarQtd && $('#q-atual')) body.qtd_atual = parseBrMoney($('#q-atual').value);
  if ($('#t-cfop')) {
    body.cfop = $('#t-cfop').value;
    body.cfop_nf = $('#t-cfop-nf')?.value || '';
    body.csosn = $('#t-csosn')?.value || '';
    body.cst = $('#t-cst')?.value || '';
    body.csosn_cfe = $('#t-csosn-cfe')?.value || '';
    body.cst_cfe = $('#t-cst-cfe')?.value || '';
    body.cst_pis = $('#t-cst-pis')?.value || '';
    body.cst_cofins = $('#t-cst-cofins')?.value || '';
    if ($('#t-pis')) body.pis = Number($('#t-pis').value || 0);
    if ($('#t-cofins')) body.cofins = Number($('#t-cofins').value || 0);
    body.id_cti = $('#t-id-cti')?.value || '';
    body.id_cti_cfe = $('#t-id-cti-cfe')?.value || '';
    body.ncm = $('#t-ncm')?.value || '';
    body.cest = $('#t-cest')?.value || '';
  }
  if ($('#r-id-class-trib')) {
    body.trib_nfe = {
      id_class_trib: $('#r-id-class-trib').value || null,
      diferimento_cbs: Number($('#r-dif-cbs')?.value || 0),
      diferimento_ibs_uf: Number($('#r-dif-ibs-uf')?.value || 0),
      diferimento_ibs_mun: Number($('#r-dif-ibs-mun')?.value || 0),
    };
  }

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

function inp(id, val, dis) {
  return `<input id="${id}" value="${escapeAttr(val == null ? '' : val)}" ${dis ? 'disabled' : ''} />`;
}

async function loadTributosProduto(it, editar) {
  const host = $('#trib-host');
  if (!host || !it?.id_identificador) return;
  const res = await api(`/estoque/${it.id_identificador}/tributacao`);
  if (!res.ok) {
    host.innerHTML = `<p class="hint">${escapeHtml(res.error || 'Não foi possível carregar os tributos.')}</p>`;
    return;
  }
  const u = res.ultima_entrada;
  const s = res.sugestao && !res.sugestao.error ? res.sugestao : null;
  const a = res.atual || {};
  const val = (k) => (s && s[k] != null && s[k] !== '' ? s[k] : (a[k] != null ? a[k] : ''));
  const dis = !editar;
  const ultimaHtml = u
    ? `<div class="trib-ultima">
        <strong>Última entrada</strong>
        <p>NF ${escapeHtml(u.nf_numero)} · ${escapeHtml(u.fornecedor_nome || '—')} · ${escapeHtml(fmtDate(u.dt_entrada))}</p>
        <p class="hint">CFOP nota ${escapeHtml(u.cfop || '—')} · CSOSN ${escapeHtml(u.csosn || '—')} · CST ICMS ${escapeHtml(u.cst_icms || '—')}
          ${u.vlr_st_ret ? ` · ST retido ${fmtMoney(u.vlr_st_ret)}` : ''}</p>
        ${s ? `<p class="hint">Sugestão com base nos parâmetros (${escapeHtml(s.origem || 'parâmetro')}). Confira e grave na ficha.</p>` : '<p class="hint">Sem parâmetro de CFOP para sugerir. Preencha manualmente.</p>'}
      </div>`
    : '<p class="hint">Este item ainda não tem entrada em TB_NFC_ITEM. Os campos abaixo são o cadastro atual.</p>';
  host.innerHTML = `
    ${ultimaHtml}
    ${s ? `<button type="button" class="btn small outline" id="btn-aplicar-sugestao-trib">Aplicar sugestão nos campos</button>` : ''}
    <div class="form-grid side-by-side">
      <label>CFOP saída (NFe)${inp('t-cfop', val('cfop'), dis)}</label>
      <label>CFOP NFCe/SAT${inp('t-cfop-nf', val('cfop_nf'), dis)}</label>
      <label>CSOSN${inp('t-csosn', val('csosn'), dis)}</label>
      <label>CST ICMS${inp('t-cst', val('cst'), dis)}</label>
      <label>CSOSN CFe${inp('t-csosn-cfe', val('csosn_cfe'), dis)}</label>
      <label>CST CFe${inp('t-cst-cfe', val('cst_cfe'), dis)}</label>
      <label>CST PIS${inp('t-cst-pis', val('cst_pis'), dis)}</label>
      <label>CST COFINS${inp('t-cst-cofins', val('cst_cofins'), dis)}</label>
      <label>Alíq. PIS${inp('t-pis', val('pis'), dis)}</label>
      <label>Alíq. COFINS${inp('t-cofins', val('cofins'), dis)}</label>
      <label>CTI (NFe)${inp('t-id-cti', val('id_cti'), dis)}</label>
      <label>CTI CFe${inp('t-id-cti-cfe', val('id_cti_cfe'), dis)}</label>
      <label>NCM${inp('t-ncm', a.ncm || it.ncm || '', dis)}</label>
      <label>CEST${inp('t-cest', a.cest || it.cest || '', dis)}</label>
    </div>
  `;
  $('#btn-aplicar-sugestao-trib')?.addEventListener('click', () => {
    if (!s) return;
    const set = (id, v) => { const el = $(id); if (el && v != null) el.value = v; };
    set('#t-cfop', s.cfop);
    set('#t-cfop-nf', s.cfop_nf);
    set('#t-csosn', s.csosn);
    set('#t-cst', s.cst);
    set('#t-csosn-cfe', s.csosn_cfe);
    set('#t-cst-cfe', s.cst_cfe);
    set('#t-cst-pis', s.cst_pis);
    set('#t-cst-cofins', s.cst_cofins);
    set('#t-pis', s.pis);
    set('#t-cofins', s.cofins);
    set('#t-id-cti', s.id_cti);
    set('#t-id-cti-cfe', s.id_cti_cfe);
    showToast('Sugestão aplicada. Grave o produto para atualizar o cadastro.');
  });
  const tn = a.trib_nfe || {};
  const refHost = $('#ref-host');
  if (refHost) {
    refHost.innerHTML = `
      <p class="hint">Dados da reforma tributária (classificação) já gravados no cadastro, quando existirem.</p>
      <div class="form-grid side-by-side">
        <label>ID classificação NFe${inp('r-id-class-trib', tn.id_class_trib || '', dis)}</label>
        <label>Diferimento CBS %${inp('r-dif-cbs', tn.diferimento_cbs ?? 0, dis)}</label>
        <label>Diferimento IBS UF %${inp('r-dif-ibs-uf', tn.diferimento_ibs_uf ?? 0, dis)}</label>
        <label>Diferimento IBS mun. %${inp('r-dif-ibs-mun', tn.diferimento_ibs_mun ?? 0, dis)}</label>
      </div>
      <p class="hint" id="r-class-label"></p>
    `;
    const idClass = Number(tn.id_class_trib);
    if (idClass) {
      api(`/importacao/class-trib?id=${idClass}`).then((r) => {
        const item = r.itens && r.itens[0];
        if (item && $('#r-class-label')) {
          $('#r-class-label').textContent = `${item.codigo || ''} — ${item.descricao || ''}`.trim();
        }
      }).catch(() => {});
    }
  }
}

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
      <button class="tab" data-tab="estoque-precos">Estoque e preços</button>
      ${!state.isNovo ? '<button class="tab" data-tab="tributos">Tributos</button>' : ''}
      ${!state.isNovo ? '<button class="tab" data-tab="reforma">Reforma tributária</button>' : ''}
      ${showGrade || showSerial || showLote ? '<button class="tab" data-tab="controle">Grade / Lote / Serial</button>' : ''}
    </div>
    <div class="tab-pane" data-pane="ficha">
      <div class="form-grid side-by-side">
        <label>ID Estoque<input value="${it.id_estoque ?? 'Novo'}" disabled /></label>
        <label>ID Identificador<input value="${it.id_identificador ?? 'Novo'}" disabled /></label>
        <label class="full">Descrição<input id="f-descricao" value="${escapeAttr(it.descricao)}" ${editarFicha || state.isNovo ? '' : 'disabled'} /></label>
        <label>Grupo
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
        <div class="ficha-cod-ref">
        <div class="field">
          <span>Cód. barras</span>
          <div class="input-row barcode-row">
            <input id="f-barras" value="${escapeAttr(it.cod_barras)}" ${editarFicha ? '' : 'disabled'} />
            ${editarFicha ? `<button type="button" id="btn-scan-ficha-barras" class="btn icon-cam" title="Ler código de barras" aria-label="Ler código de barras">${CAMERA_ICON_SVG}</button>` : ''}
          </div>
        </div>
        <label>Referência<input id="f-ref" value="${escapeAttr(it.referencia)}" ${editarFicha ? '' : 'disabled'} /></label>
        </div>
        <label>Status
          <select id="f-status" ${editarFicha || state.isNovo ? '' : 'disabled'}>
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
      </div>
    </div>
    <div class="tab-pane" data-pane="estoque-precos" hidden>
      <div class="form-grid side-by-side">
        <label>Preço de venda<input id="p-venda" inputmode="decimal" value="${escapeAttr(fmtMoney2(it.prc_venda))}" ${editarVenda ? '' : 'disabled'} /></label>
        <label>Preço de custo
          <input id="p-custo" inputmode="decimal"
            value="${verCusto ? escapeAttr(fmtMoney2(it.prc_custo)) : '****'}" ${editarCusto ? '' : 'disabled'} class="${verCusto ? '' : 'masked'}" />
        </label>
        <p class="hint full">${verCusto ? `Margem: ${fmtMargem(it.prc_venda, it.prc_custo)}` : 'Custo oculto pela permissão do usuário.'}</p>
        <label class="full">Quantidade atual (banco)
          <input id="q-atual" inputmode="decimal" value="${escapeAttr(fmtMoney2(it.qtd_atual))}" ${editarQtd ? '' : 'disabled'} />
        </label>
      </div>
      <div class="qty-box">
        <div class="qty-card add">
          <div>Adicionar</div>
          <input id="q-add" inputmode="decimal" value="${escapeAttr(fmtMoney2(0))}" ${editarQtd ? '' : 'disabled'} />
        </div>
        <div class="qty-card rem">
          <div>Remover</div>
          <input id="q-rem" inputmode="decimal" value="${escapeAttr(fmtMoney2(0))}" ${editarQtd ? '' : 'disabled'} />
        </div>
      </div>
      <div id="q-diff" class="diff-box">Diferença: 0</div>
    </div>
    ${!state.isNovo ? `
    <div class="tab-pane" data-pane="tributos" hidden>
      <div id="trib-host" class="trib-host"><p class="hint">Carregando última entrada e parâmetros…</p></div>
    </div>
    <div class="tab-pane" data-pane="reforma" hidden>
      <div id="ref-host" class="trib-host"><p class="hint">Carregando classificação da reforma tributária…</p></div>
    </div>` : ''}
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
      if (tab.dataset.tab === 'tributos' || tab.dataset.tab === 'reforma') loadTributosProduto(it, editarFicha);
    });
  });

  const qAtual = $('#q-atual');
  const qAdd = $('#q-add');
  const qRem = $('#q-rem');
  const base = Number(it.qtd_atual || 0);
  let syncing = false;

  function updateDiffFromAddRem() {
    const add = parseBrMoney(qAdd?.value || 0);
    const rem = parseBrMoney(qRem?.value || 0);
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
      qAtual.value = fmtMoney2(base + delta);
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
    const nome = await showPrompt({ message: 'Nome do novo grupo:' });
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
        <label>Notas de entrada
          <select data-perm="importacao.acesso" ${u.supervisor ? 'disabled' : ''}>
            <option value="true" ${u.permissoes?.importacao?.acesso ? 'selected' : ''}>Sim</option>
            <option value="false" ${!u.permissoes?.importacao?.acesso ? 'selected' : ''}>Não</option>
          </select>
        </label>
      </div>
    </div>
  `).join('');
  applyUsuariosFiltros();
}

function applyUsuariosFiltros() {
  const qUser = String($('#busca-usuarios')?.value || '').trim().toLowerCase();
  const qPerm = String($('#busca-permissoes')?.value || '').trim().toLowerCase();
  $$('.user-card').forEach((card) => {
    const nome = card.querySelector('input')?.value || '';
    card.hidden = !!(qUser && !nome.toLowerCase().includes(qUser));
    $$('.perm-grid label', card).forEach((lab) => {
      const txt = String(lab.textContent || '').toLowerCase();
      lab.hidden = !!(qPerm && !txt.includes(qPerm));
    });
  });
}

$('#busca-usuarios')?.addEventListener('input', applyUsuariosFiltros);
$('#busca-permissoes')?.addEventListener('input', applyUsuariosFiltros);

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
  const senhaSup = await showPrompt({ message: 'Confirme a senha do supervisor para salvar:', password: true });
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
        importacao: {
          acesso: $('[data-perm="importacao.acesso"]', card)?.value === 'true',
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
    notas: 'Nota lançada',
  };
  return map[tipo] || tipo || 'Alteração';
}

async function abrirResumoNotaLancada(idNf) {
  const id = Number(idNf);
  if (!id) return;
  const qs = `supervisor=${state.usuario?.supervisor ? '1' : '0'}&usuarioId=${encodeURIComponent(state.usuario?.id ?? 0)}`;
  const res = await api(`/importacao/notas/${id}/resumo?${qs}`);
  if (!res.ok || !res.nota) {
    showMsg(res.error || 'Não foi possível carregar o resumo da nota.');
    return;
  }
  const n = res.nota;
  const linhas = (n.itens || []).map((it) => {
    const desc = it.descricao || `ID ${it.id_identificador || '—'}`;
    return `${it.num_item || '—'} · ${desc}  ${fmtNum(it.qtd)} ${it.uni_medida || ''}  ${fmtMoney(it.vlr_total)}`;
  });
  const texto = [
    `NF ${n.nf_numero}/${n.nf_serie || '1'}`,
    `Fornecedor: ${n.fornecedor_nome || '—'}`,
    n.fornecedor_cnpj ? `CNPJ: ${n.fornecedor_cnpj}` : '',
    `Entrada: ${fmtDate(n.dt_entrada)}  ·  Emissão: ${fmtDate(n.dt_emissao)}`,
    `Itens: ${n.qtd_itens || (n.itens || []).length}  ·  Total: ${fmtMoney(n.vlr_itens)}`,
    n.status ? `Status: ${n.status}` : '',
    '',
    linhas.length ? linhas.join('\n') : 'Sem itens.',
  ].filter((x, i, arr) => x !== '' || arr[i + 1] !== '').join('\n');
  showMsg(texto);
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
      <div class="item-row alt-row ${tipo === 'notas' ? 'is-clickable' : ''}" ${tipo === 'notas' ? `data-nf="${escapeAttr(it.id_estoque)}"` : ''}>
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

  $$('.alt-row[data-nf]', box).forEach((row) => {
    row.addEventListener('click', () => abrirResumoNotaLancada(row.dataset.nf));
  });
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
$('#btn-exportar-alt')?.addEventListener('click', () => exportarAlteracoesPdf());

function exportarAlteracoesPdf() {
  const list = state.alteracoesLista || [];
  const titulo = `Alterações — ${tipoAlteracaoLabel(state.alteracoesTipo === 'todos' ? '' : state.alteracoesTipo) || 'Todas'}`;
  const rows = list.map((it) => `<tr>
      <td>${escapeHtml(fmtDataHora(it.data, it.hora, it.data_hora))}</td>
      <td>${escapeHtml(tipoAlteracaoLabel(it.tipo))}</td>
      <td>${escapeHtml(it.descricao || '')}</td>
      <td>${escapeHtml(it.detalhe || it.resumo || '')}</td>
      <td>${escapeHtml(it.funcionario || '')}</td>
    </tr>`).join('') || '<tr><td colspan="5">Nenhum registro</td></tr>';
  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(titulo)}</title>
    <style>body{font-family:sans-serif;padding:16px;color:#222}h1{font-size:18px}table{width:100%;border-collapse:collapse;font-size:12px}
    th,td{border:1px solid #ccc;padding:6px;text-align:left}th{background:#eee}</style></head>
    <body><h1>${escapeHtml(titulo)}</h1><p>${list.length} registro(s)</p>
    <table><thead><tr><th>Data</th><th>Tipo</th><th>Produto / NF</th><th>Detalhe</th><th>Usuário</th></tr></thead>
    <tbody>${rows}</tbody></table></body></html>`;
  if (window.GestorApp && typeof window.GestorApp.printHtml === 'function') {
    window.GestorApp.printHtml(titulo, html);
    return;
  }
  const w = window.open('', '_blank');
  if (!w) {
    showMsg('Permita pop-ups para exportar o PDF.');
    return;
  }
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
}

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

function extractChaveNfe44(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 44) return digits;
  const compact = String(raw || '').replace(/[\s\-._]/g, '');
  const run = compact.match(/\d{44}/) || digits.match(/\d{44}/);
  return run ? run[0].slice(0, 44) : '';
}

function normalizeBarcodeNumber(raw) {
  const chave = extractChaveNfe44(raw);
  if (chave) return chave;

  const text = String(raw || '').trim();
  if (!text) return '';

  const compact = text.replace(/[\s\-._]/g, '');

  if (/^\d{4,44}$/.test(compact)) return compact;

  const matches = compact.match(/\d{4,44}/g) || text.match(/\d{4,44}/g) || [];
  if (!matches.length) return '';
  matches.sort((a, b) => b.length - a.length);
  return matches[0];
}

function pickBestBarcode(candidates, target = state.scanTarget) {
  const uniq = [...new Set(candidates.filter(Boolean).map((c) => String(c)))];
  if (!uniq.length) return '';
  if (target === 'importacao') {
    const chaves = uniq.map(extractChaveNfe44).filter((c) => c.length === 44);
    if (chaves.length) return chaves[0];
    uniq.sort((a, b) => String(b).replace(/\D/g, '').length - String(a).replace(/\D/g, '').length);
    return extractChaveNfe44(uniq[0]) || uniq[0];
  }
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
  if (state.scanTarget === 'importacao') {
    const chave = extractChaveNfe44(value) || String(value || '').replace(/\D/g, '').slice(0, 44);
    if (chave.length === 44 && (window.ImportacaoNfe?.applyScannedChave?.(chave) || window.ImportacaoNfe?.applyScannedChave?.(chave))) {
      stopScanner();
      $('#dlg-scan')?.close();
      state.scanTarget = 'search';
      return true;
    }
    const codeTry = normalizeBarcodeNumber(value);
    if (codeTry.length === 44 && (window.ImportacaoNfe?.applyScannedChave?.(codeTry) || window.ImportacaoNfe?.applyScannedChave?.(codeTry))) {
      stopScanner();
      $('#dlg-scan')?.close();
      state.scanTarget = 'search';
      return true;
    }
    if (value) {
      stopScanner();
      $('#dlg-scan')?.close();
      showMsg('Não li os 44 dígitos da chave. Fotografe a faixa do código de barras da chave de acesso (DANFE), na horizontal e bem nítida.');
      state.scanTarget = 'search';
      return true;
    }
    return false;
  }
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
  if (state.scanTarget === 'importacao-prod' || state.scanTarget === 'importacao-prod') {
    if (window.ImportacaoNfe?.applyScannedProduto?.(code) || window.ImportacaoNfe?.applyScannedProduto?.(code)) {
      state.scanTarget = 'search';
      return true;
    }
    state.scanTarget = 'search';
    return true;
  }
  if (state.scanTarget === 'importacao-ean' || state.scanTarget === 'importacao-ean') {
    if (window.ImportacaoNfe?.applyScannedEan?.(code) || window.ImportacaoNfe?.applyScannedEan?.(code)) {
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

function getZxingHints(forChave = false) {
  const Z = window.ZXingBrowser || window.ZXing;
  const hints = new Map();
  const BF = Z?.BarcodeFormat;
  const formats = [];
  // Chave NF-e (navegador): formatos longos. Produto: EAN/UPC rápido — sem TRY_HARDER.
  const names = forChave
    ? ['CODE_128', 'ITF', 'CODE_39', 'CODABAR']
    : ['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'CODE_39'];
  if (BF) {
    for (const name of names) {
      if (BF[name] != null) formats.push(BF[name]);
    }
  }
  const DHT = Z?.DecodeHintType;
  if (formats.length) hints.set(DHT?.POSSIBLE_FORMATS ?? 2, formats);
  if (forChave) hints.set(DHT?.TRY_HARDER ?? 3, true);
  return hints;
}

function getZxingReader(forChave = isChaveScanTarget()) {
  const ZXing = window.ZXingBrowser || window.ZXing;
  if (!ZXing?.BrowserMultiFormatReader) return null;
  try {
    return new ZXing.BrowserMultiFormatReader(getZxingHints(forChave));
  } catch {
    return new ZXing.BrowserMultiFormatReader();
  }
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

function drawSourceToCanvas(src, maxEdge = 1800) {
  const w = src.naturalWidth || src.width;
  const h = src.naturalHeight || src.height;
  if (!w || !h) return null;
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function applyMono(ctx, cw, ch, mode) {
  if (mode === 'raw' || !ctx) return;
  const data = ctx.getImageData(0, 0, cw, ch);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    let y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    if (mode === 'contrast') y = (y - 128) * 1.7 + 128;
    else if (mode === 'threshold') y = y > 145 ? 255 : 0;
    else if (mode === 'invert') y = 255 - y;
    y = Math.max(0, Math.min(255, y));
    px[i] = px[i + 1] = px[i + 2] = y;
  }
  ctx.putImageData(data, 0, 0);
}

function canvasVariantsFromImage(img, { heavy = false } = {}) {
  const maxEdge = heavy ? 1800 : 1400;
  const base = drawSourceToCanvas(img, maxEdge);
  if (!base) return [];
  let w = base.width;
  let h = base.height;
  const src = base;
  const variants = [base];

  const pushVariant = (sx, sy, sw, sh, scale, mode, vStretch = 1) => {
    const cw = Math.max(1, Math.round(sw * scale));
    const srcH = Math.max(1, Math.round(sh * scale));
    const ch = Math.max(1, Math.round(srcH * vStretch));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    if (vStretch > 1) {
      const tmp = document.createElement('canvas');
      tmp.width = cw;
      tmp.height = srcH;
      const tctx = tmp.getContext('2d');
      if (!tctx) return;
      tctx.drawImage(src, sx, sy, sw, sh, 0, 0, cw, srcH);
      ctx.drawImage(tmp, 0, 0, cw, srcH, 0, 0, cw, ch);
    } else {
      ctx.drawImage(src, sx, sy, sw, sh, 0, 0, cw, ch);
    }
    applyMono(ctx, cw, ch, mode);
    variants.push(canvas);
  };

  // Caminho rápido (produto / APK nunca usa isto): poucas variantes
  pushVariant(0, 0, w, h, 1, 'contrast');
  const cx = Math.round(w * 0.06);
  const cy = Math.round(h * 0.2);
  pushVariant(cx, cy, Math.round(w * 0.88), Math.round(h * 0.58), 1.25, 'threshold');

  if (!heavy) return variants;

  // Caminho pesado só no navegador/iPhone para chave NF-e (44 dígitos)
  pushVariant(cx, cy, Math.round(w * 0.88), Math.round(h * 0.58), 1.5, 'threshold');

  const strips = [
    [0, 0, w, Math.max(40, Math.round(h * 0.18))],
    [0, Math.round(h * 0.02), w, Math.max(40, Math.round(h * 0.22))],
    [0, Math.round(h * 0.08), w, Math.max(40, Math.round(h * 0.2))],
    [0, Math.round(h * 0.32), w, Math.max(40, Math.round(h * 0.28))],
    [0, Math.round(h * 0.7), w, Math.max(40, Math.round(h * 0.28))],
  ];
  for (const [sx, sy, sw, sh] of strips) {
    pushVariant(sx, sy, sw, sh, 1.6, 'raw', 3);
    pushVariant(sx, sy, sw, sh, 1.8, 'contrast', 3);
    pushVariant(sx, sy, sw, sh, 2, 'threshold', 3);
  }

  const addRotated = (radians) => {
    const rot = document.createElement('canvas');
    const landscape = Math.abs(Math.cos(radians)) < 0.1;
    rot.width = landscape ? h : w;
    rot.height = landscape ? w : h;
    const rctx = rot.getContext('2d', { willReadFrequently: true });
    if (!rctx) return;
    rctx.translate(rot.width / 2, rot.height / 2);
    rctx.rotate(radians);
    rctx.drawImage(src, -w / 2, -h / 2);
    variants.push(rot);
  };
  addRotated(Math.PI / 2);
  addRotated(Math.PI);
  addRotated((3 * Math.PI) / 2);

  return variants;
}

async function detectWithBarcodeDetector(source) {
  if (!('BarcodeDetector' in window)) return [];
  try {
    const detector = new BarcodeDetector({ formats: BARCODE_FORMATS });
    const codes = await detector.detect(source);
    return codes.map((c) => c.rawValue).filter(Boolean);
  } catch {
    return [];
  }
}

async function detectWithZxingCanvas(canvas) {
  const reader = getZxingReader(isChaveScanTarget());
  if (!reader) return [];
  try {
    const result = await reader.decodeFromCanvas(canvas);
    const text = result?.getText?.() || result?.text || '';
    return text ? [text, normalizeBarcodeNumber(text)].filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function decodeBarcodeFromImageUrl(url, file) {
  const candidates = [];
  const heavy = isChaveScanTarget(); // só chave no navegador/iPhone usa variantes pesadas
  const pushTexts = (list) => {
    for (const t of list || []) {
      if (!t) continue;
      candidates.push(t);
      const digits = normalizeBarcodeNumber(t);
      if (digits) candidates.push(digits);
      const chave = extractChaveNfe44(t);
      if (chave) candidates.push(chave);
    }
  };
  const takeIfReady = () => {
    const best = pickBestBarcode(candidates);
    if (!best) return '';
    if (heavy) {
      const chave = extractChaveNfe44(best);
      return chave.length === 44 ? chave : '';
    }
    return best;
  };

  let oriented = null;
  if (file) {
    try {
      oriented = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      try { oriented = await createImageBitmap(file); } catch { oriented = null; }
    }
  }

  const img = oriented || await loadImageElement(url);

  pushTexts(await detectWithBarcodeDetector(img));
  try {
    const bitmap = oriented || await createImageBitmap(img);
    pushTexts(await detectWithBarcodeDetector(bitmap));
    if (!oriented) bitmap.close?.();
  } catch { /* ignore */ }

  try {
    const reader = getZxingReader(heavy);
    if (reader) {
      const result = await reader.decodeFromImageUrl(url);
      const text = result?.getText?.() || result?.text || '';
      if (text) pushTexts([text]);
    }
  } catch { /* ignore */ }

  try {
    const reader = getZxingReader(heavy);
    if (reader?.decodeFromImageElement && img instanceof HTMLImageElement) {
      const result = await reader.decodeFromImageElement(img);
      const text = result?.getText?.() || result?.text || '';
      if (text) pushTexts([text]);
    }
  } catch { /* ignore */ }

  const early = takeIfReady();
  if (early) {
    oriented?.close?.();
    return early;
  }

  let variants = [];
  try {
    variants = canvasVariantsFromImage(img, { heavy });
  } catch (err) {
    console.warn('Variantes de leitura:', err);
  }
  for (const canvas of variants) {
    try {
      pushTexts(await detectWithBarcodeDetector(canvas));
      pushTexts(await detectWithZxingCanvas(canvas));
    } catch { /* ignore */ }
    const got = takeIfReady();
    if (got) {
      oriented?.close?.();
      return got;
    }
  }

  oriented?.close?.();
  if (heavy) {
    const joined = candidates.map((c) => String(c || '').replace(/\D/g, '')).join('');
    const chave = extractChaveNfe44(joined);
    if (chave.length === 44) return chave;
  }

  return pickBestBarcode(candidates);
}

async function startScanner(target = 'search') {
  state.scanTarget = ['ficha', 'importacao', 'importacao-prod', 'importacao-ean'].includes(target) ? target : 'search';
  // APK: câmera nativa rápida (sem getUserMedia / sem decode pesado do navegador)
  try {
    if (isNativeApk() && window.GestorApp) {
      const tgt = state.scanTarget;
      if (typeof window.GestorApp.scanBarcodeFor === 'function') {
        window.GestorApp.scanBarcodeFor(tgt);
      } else if (typeof window.GestorApp.scanBarcode === 'function') {
        window.GestorApp.scanBarcode();
      }
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
  msg.textContent = isChaveScanTarget()
    ? 'No iPhone/navegador: fotografe só a faixa do código de barras da chave (44 dígitos), na horizontal, bem perto e nítida.'
    : 'Toque em “Abrir câmera”, foque só no código de barras e confirme a foto.';

  // Leitura ao vivo só no navegador seguro — nunca forçar no APK
  const canLive = !isNativeApk()
    && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.isSecureContext);
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
        formats: isChaveScanTarget()
          ? ['code_128', 'itf', 'code_39', 'codabar']
          : ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'],
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
    const code = await decodeBarcodeFromImageUrl(url, file);
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
function parseBrMoney(v) {
  if (v == null) return 0;
  let s = String(v).trim();
  if (!s || s === '****') return 0;
  s = s.replace(/[R$\s]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
function fmtMoney2(n) {
  return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtNum(n) {
  return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  showPrompt,
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
  const dlgPrompt = $('#dlg-prompt');
  if (dlgPrompt?.open) {
    try { dlgPrompt.close(); } catch { /* ignore */ }
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

/* Bloqueia pinch-zoom residual no iOS Safari / PWA */
document.addEventListener('gesturestart', (e) => { e.preventDefault(); }, { passive: false });
document.addEventListener('gesturechange', (e) => { e.preventDefault(); }, { passive: false });
