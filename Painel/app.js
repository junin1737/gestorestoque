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
  filtroCondicional: false,
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

function isIOS() {
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
}

function isChaveScanTarget(target = state.scanTarget) {
  return target === 'importacao';
}

function canUseLiveCamera() {
  if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) return false;
  if (window.isSecureContext || window.__GESTOR_APP__) return true;
  // Rede local (http://192.168…): Safari/iPhone às vezes permite câmera mesmo sem HTTPS
  const host = String(window.location.hostname || '');
  return host === 'localhost'
    || host === '127.0.0.1'
    || /^192\.168\.\d+\.\d+$/.test(host)
    || /^10\.\d+\.\d+\.\d+$/.test(host)
    || /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host);
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
    input.type = 'text';
    mascararSenha(input, !!password);
    input.setAttribute('autocomplete', 'off');
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

function novaChaveIdempotencia() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function deviceId() {
  const key = 'gestor-device-id';
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id = (crypto.randomUUID && crypto.randomUUID()) || novaChaveIdempotencia();
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return 'navegador';
  }
}

let stateCfgTab = 'tema';
let cfgMontada = false;

function setCfgTab(tab) {
  stateCfgTab = tab || 'tema';
  state.cfgTab = stateCfgTab;
  $$('#cfg-tabs .tab').forEach((b) => b.classList.toggle('active', b.dataset.cfgTab === stateCfgTab));
  ['tema', 'tributos', 'saida'].forEach((id) => {
    const pane = $(`#cfg-tab-${id}`);
    if (pane) pane.hidden = id !== stateCfgTab;
  });
  const salvar = $('#cfg-params-salvar');
  if (salvar) salvar.hidden = stateCfgTab === 'tema';
  if (stateCfgTab !== 'tema' && !cfgMontada) {
    cfgMontada = true;
    window.ImportacaoNfe?.mountConfig?.();
  }
}

async function loadEmpresas() {
  const box = $('#empresas-lista');
  if (!box) return;
  box.innerHTML = '<p class="empty">Carregando empresas…</p>';
  const res = await api('/mt/empresas');
  const itens = res.itens || [];
  if (!res.ok && res.error) {
    box.innerHTML = `<p class="empty">${escapeHtml(res.error)}</p>`;
    return;
  }
  if (!itens.length) {
    box.innerHTML = '<p class="empty">Nenhuma empresa online agora. A empresa aparece aqui quando o Gestor online dela está aberto e atualizado.</p>';
    return;
  }
  box.innerHTML = itens.map((e) => `
    <article class="imp-item-row">
      <div class="imp-item-main">
        <strong>${escapeHtml(e.nome || 'Empresa')}</strong>
        <span class="hint">NSE ${escapeHtml(e.nse || '—')} · CNPJ ${escapeHtml(e.cnpj || '—')}</span>
      </div>
      <span class="chip ${e.online ? 'ok' : 'pending'}">${e.online ? 'Online' : 'Off'}</span>
      <button type="button" class="btn small" data-empresa-url="${escapeAttr(e.url || '')}" data-empresa-nome="${escapeAttr(e.nome || '')}" ${e.url ? '' : 'disabled'}>Entrar</button>
    </article>
  `).join('');
  $$('[data-empresa-url]', box).forEach((btn) => {
    btn.addEventListener('click', async () => {
      const url = btn.dataset.empresaUrl;
      const nome = btn.dataset.empresaNome || 'esta empresa';
      if (!url) {
        showMsg('Esta empresa ainda não tem o endereço de acesso.');
        return;
      }
      const ok = await showConfirm(
        `Abrir o login de ${nome}? A senha salva não entra sozinha: é preciso clicar em Entrar.`,
        { okLabel: 'Abrir login', cancelLabel: 'Cancelar' }
      );
      if (!ok) return;
      await api('/logout', { method: 'POST', body: {} });
      location.href = urlLoginEmpresa(url);
    });
  });
  await carregarVinculosPainel();
}

function formatCnpj(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  return d || '—';
}

function urlLoginEmpresa(url) {
  try {
    const u = new URL(url, location.origin);
    u.searchParams.delete('mt');
    const path = u.pathname.endsWith('/') ? u.pathname : `${u.pathname}/`;
    return `${u.origin}${path}${u.search}`;
  } catch {
    return url;
  }
}

const ROTULO_VINCULO = {
  ativo: 'Ativo',
  aguardando: 'Aguardando as duas',
  aguardando_matriz: 'Aguardando a matriz',
  aguardando_filial: 'Aguardando a filial',
  recusado: 'Recusado',
};

async function carregarLojasLogin() {
  const box = $('#login-lojas');
  const lista = $('#login-lojas-lista');
  if (!box || !lista) return;
  const res = await api('/mt/grupo');
  const empresas = (res.empresas || []).filter((e) => e && e.cnpj);
  if (empresas.length < 2) {
    box.hidden = true;
    lista.innerHTML = '';
    return;
  }
  box.hidden = false;
  lista.innerHTML = empresas.map((e) => `
    <button type="button" class="login-loja${e.atual ? ' is-atual' : ''}" data-loja-url="${escapeAttr(e.url || '')}" data-loja-atual="${e.atual ? '1' : ''}" ${e.atual || e.url ? '' : 'disabled'}>
      <strong>${escapeHtml(e.nome || 'Empresa')}</strong>
      <span>${e.papel === 'matriz' ? 'Matriz' : 'Filial'} · ${escapeHtml(formatCnpj(e.cnpj))}${e.atual ? ' · esta loja' : ''}</span>
    </button>
  `).join('');
  $$('.login-loja', lista).forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.lojaAtual === '1') return;
      const url = btn.dataset.lojaUrl;
      if (!url) {
        showMsg('Esta loja ainda não tem o endereço de acesso. Abra o Gestor dela uma vez.');
        return;
      }
      await api('/logout', { method: 'POST', body: {} });
      location.href = urlLoginEmpresa(url);
    });
  });
}

async function carregarPedidoVinculo() {
  const bar = $('#vinculo-pedido');
  if (!bar) return;
  if (!(state.usuario?.supervisor || state.usuario?.mtEntradas)) {
    bar.hidden = true;
    return;
  }
  const res = await api('/mt/vinculos/pendentes');
  const item = (res.pendentes || [])[0];
  const espera = (res.aguardando || [])[0];
  const texto = $('#vinculo-pedido-texto');
  const aceitar = $('#vinculo-aceitar');
  const recusar = $('#vinculo-recusar');
  if (item) {
    bar.hidden = false;
    bar.dataset.id = String(item.id);
    if (texto) {
      texto.textContent = `${item.outra_nome || 'A outra loja'} pediu para aparecer junto no login. Esta loja entra como ${item.papel_outra === 'matriz' ? 'filial' : 'matriz'}. Aceite para liberar a escolha.`;
    }
    if (aceitar) aceitar.hidden = false;
    if (recusar) recusar.hidden = false;
    return;
  }
  if (espera) {
    bar.hidden = false;
    delete bar.dataset.id;
    if (texto) texto.textContent = `Vínculo com ${espera.outra_nome || 'a outra loja'} aguardando o aceite dela.`;
    if (aceitar) aceitar.hidden = true;
    if (recusar) recusar.hidden = true;
    return;
  }
  bar.hidden = true;
}

async function responderVinculo(aceite) {
  const bar = $('#vinculo-pedido');
  const id = Number(bar?.dataset.id);
  if (!id) return;
  const res = await api('/mt/vinculos/aceite', { method: 'POST', body: { id, aceite } });
  if (!res.ok) {
    showMsg(res.error || 'Não foi possível gravar o aceite.');
    return;
  }
  await carregarPedidoVinculo();
}

async function carregarVinculosPainel() {
  const lista = $('#vinculos-lista');
  const selM = $('#vinculo-matriz');
  const selF = $('#vinculo-filial');
  if (!lista || !selM || !selF) return;
  const cad = await api('/mt/empresas/cadastro');
  const empresas = cad.itens || [];
  const opt = (e) => `<option value="${escapeAttr(e.cnpj)}">${escapeHtml(e.nome || 'Empresa')} · ${escapeHtml(formatCnpj(e.cnpj))}</option>`;
  selM.innerHTML = `<option value="">Selecione</option>${empresas.map(opt).join('')}`;
  selF.innerHTML = selM.innerHTML;
  const res = await api('/mt/vinculos');
  const itens = res.itens || [];
  if (!res.ok && res.error) {
    lista.innerHTML = `<p class="empty">${escapeHtml(res.error)}</p>`;
    return;
  }
  if (!itens.length) {
    lista.innerHTML = '<p class="empty">Nenhum vínculo criado.</p>';
    return;
  }
  lista.innerHTML = itens.map((v) => `
    <article class="imp-item-row">
      <div class="imp-item-main">
        <strong>${escapeHtml(v.nome_matriz || 'Matriz')} → ${escapeHtml(v.nome_filial || 'Filial')}</strong>
        <span class="hint">${escapeHtml(formatCnpj(v.cnpj_matriz))} · ${escapeHtml(formatCnpj(v.cnpj_filial))}</span>
      </div>
      <span class="chip ${v.status === 'ativo' ? 'ok' : 'pending'}">${escapeHtml(ROTULO_VINCULO[v.status] || v.status || '')}</span>
    </article>
  `).join('');
}

$('#btn-vincular-empresas')?.addEventListener('click', async () => {
  const cnpjMatriz = $('#vinculo-matriz')?.value || '';
  const cnpjFilial = $('#vinculo-filial')?.value || '';
  if (!cnpjMatriz || !cnpjFilial) {
    showMsg('Selecione a matriz e a filial.');
    return;
  }
  if (cnpjMatriz === cnpjFilial) {
    showMsg('A matriz e a filial precisam ser empresas diferentes.');
    return;
  }
  const res = await api('/mt/vinculos', { method: 'POST', body: { cnpjMatriz, cnpjFilial } });
  if (!res.ok) {
    showMsg(res.error || 'Não foi possível criar o vínculo.');
    return;
  }
  showMsg(res.ativo ? 'Essas lojas já estão vinculadas.' : 'Vínculo criado. Cada loja precisa aceitar no próprio Gestor.');
  await carregarVinculosPainel();
});

$('#vinculo-aceitar')?.addEventListener('click', () => responderVinculo('aceito'));
$('#vinculo-recusar')?.addEventListener('click', () => responderVinculo('recusado'));

/**
 * No acesso online todas as lojas usam o mesmo endereço: ler o QR Code (ou "Entrar") de outra loja em outra aba
 * troca a loja do navegador inteiro. Cada resposta traz o identificador da loja; se mudar, nada desta tela continua.
 */
let lojaDoPainel = '';
function mesmaLoja(res) {
  const loja = res.headers.get('X-Gestor-Loja') || '';
  if (!loja) return true;
  if (!lojaDoPainel) lojaDoPainel = loja;
  if (loja === lojaDoPainel) return true;
  fecharTelaDeOutraLoja();
  return false;
}

function fecharTelaDeOutraLoja() {
  if (document.body.dataset.lojaTrocada) return;
  document.body.dataset.lojaTrocada = '1';
  document.body.innerHTML = `
    <main class="loja-trocada">
      <h1>Outra loja foi aberta neste navegador</h1>
      <p>Em outra aba foi lido o QR Code ou usado o "Entrar" de outra empresa. Para não misturar os dados, esta tela foi fechada.</p>
      <p>Para voltar a esta loja, leia de novo o QR Code dela. Para usar a loja aberta agora, recarregue.</p>
      <button type="button" class="btn primary" id="loja-trocada-recarregar">Recarregar</button>
    </main>`;
  document.getElementById('loja-trocada-recarregar').addEventListener('click', () => location.reload());
}

// Voltar pelo histórico restaura a tela antiga da memória, que pode ser de outra loja.
window.addEventListener('pageshow', (ev) => {
  if (ev.persisted) location.reload();
});

async function api(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const grava = method !== 'GET' && method !== 'HEAD';
  const headers = { 'Content-Type': 'application/json', 'X-Device-Id': deviceId(), ...(options.headers || {}) };
  if (state.usuario) headers['X-Gestor-Usuario'] = String(state.usuario.id);
  if (lojaDoPainel) headers['X-Gestor-Loja'] = lojaDoPainel;
  // Mesma chave nas repetições: se a resposta se perdeu na rede, o servidor não grava duas vezes.
  if (grava) headers['Idempotency-Key'] = novaChaveIdempotencia();
  const init = {
    ...options,
    headers,
    credentials: 'same-origin',
    body: options.body != null ? JSON.stringify(options.body) : undefined,
  };
  let res;
  for (let tentativa = 0; ; tentativa += 1) {
    try {
      res = await fetch(`/api${path}`, init);
      break;
    } catch (err) {
      if (grava && tentativa < 2) {
        await esperar(1500);
        continue;
      }
      const error = 'Serviço do painel offline. Execute iniciar.bat ou npm start e abra http://127.0.0.1:5077';
      return { ok: false, offline: true, error };
    }
  }
  if (!mesmaLoja(res)) return { ok: false, code: 'LOJA_TROCADA', error: 'Este navegador passou a acessar outra loja.' };
  let data;
  try {
    data = await res.json();
  } catch {
    return { ok: false, error: `Resposta inválida da API (${res.status})` };
  }
  if (data && data.code === 'LICENCA_BLOQUEADA') mostrarBloqueioLicenca(data.licenca);
  if (res.status === 403 && data?.code === 'APARELHO') {
    window.location.reload();
    return data;
  }
  if (data && data.code === 'DISPOSITIVO') showMsg(data.error || 'Dispositivo fora do prazo.');
  if (res.status === 401 && (data?.code === 'AUTH' || data?.code === 'SESSAO_TROCADA') && state.usuario) {
    sessaoEncerrada(data.error);
  }
  return data;
}

let licencaPoll = null;

function mostrarBloqueioLicenca(lic) {
  const l = lic || {};
  let el = $('#licenca-bloqueio');
  if (!el) {
    el = document.createElement('div');
    el.id = 'licenca-bloqueio';
    el.className = 'licenca-bloqueio';
    el.innerHTML = `
      <div class="licenca-card">
        <div class="licenca-ico" aria-hidden="true">🔒</div>
        <h2 id="lic-titulo"></h2>
        <p id="lic-msg"></p>
        <p class="hint" id="lic-info"></p>
        <button type="button" class="btn primary" id="lic-verificar">Verificar novamente</button>
        <p class="hint">MT Automações (34) 3674-1937</p>
      </div>`;
    document.body.appendChild(el);
    el.querySelector('#lic-verificar').addEventListener('click', async (ev) => {
      ev.target.disabled = true;
      ev.target.textContent = 'Verificando…';
      const r = await api('/licenca/verificar', { method: 'POST', body: {} });
      ev.target.disabled = false;
      ev.target.textContent = 'Verificar novamente';
      if (r.ok && r.licenca?.liberado) location.reload();
      else if (r.licenca) mostrarBloqueioLicenca(r.licenca);
    });
  }
  const titulos = {
    verificando: 'Verificando licença…',
    pendente: 'Cadastro solicitado',
    bloqueado: 'Acesso bloqueado',
    vencido: 'Licença vencida',
    expirado: 'Licença não validada',
    relogio: 'Data/hora incorreta',
    nao_solicitado: 'Registro necessário',
  };
  el.querySelector('#lic-titulo').textContent = titulos[l.status] || 'Licença não validada';
  el.querySelector('#lic-msg').textContent = l.mensagem || 'Não foi possível validar a licença deste computador.';
  const cnpj = String(l.cnpj || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  el.querySelector('#lic-info').textContent = cnpj ? `CNPJ ${cnpj}` : '';
  el.hidden = false;
  // Aguardando aprovação: o serviço reconsulta a cada minuto; a tela libera sozinha quando aprovar.
  const aguardando = l.status === 'verificando' || l.status === 'pendente' || l.status === 'nao_solicitado';
  if (aguardando && !licencaPoll) {
    const statusInicial = l.status;
    licencaPoll = setInterval(async () => {
      const r = await api('/licenca');
      if (r.licenca?.liberado) {
        clearInterval(licencaPoll);
        location.reload();
      } else if (r.licenca && r.licenca.status !== statusInicial) {
        clearInterval(licencaPoll);
        licencaPoll = null;
        mostrarBloqueioLicenca(r.licenca);
      }
    }, statusInicial === 'verificando' ? 3000 : 15000);
  }
}

function setServiceStatus(online, detail) {
  const el = $('#svc-status');
  if (!el) return;
  const texto = online
    ? (detail || 'Serviço online')
    : (detail || 'Serviço offline — inicie com iniciar.bat');
  el.textContent = texto;
  el.classList.toggle('erro', !online);
  el.classList.toggle('is-ok', online && /^Conectado/.test(texto));
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
  let statusColor = '#1e3a5f';
  if (tema === 'empresa' && logo) {
    extractAccent(logo).then((color) => {
      if (!color) return;
      document.documentElement.style.setProperty('--empresa-accent', color);
      syncThemeColor(color);
    });
    statusColor = getComputedStyle(document.documentElement).getPropertyValue('--empresa-accent').trim() || statusColor;
  } else {
    document.documentElement.style.removeProperty('--empresa-accent');
    if (tema === 'escuro') statusColor = '#0f1724';
    else statusColor = '#1e3a5f';
  }
  syncThemeColor(statusColor);
}

function syncThemeColor(color) {
  const hex = String(color || '#1e3a5f').trim();
  if (!hex.startsWith('#')) return;
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', hex);
  try {
    if (window.GestorApp && typeof window.GestorApp.setStatusBarColor === 'function') {
      window.GestorApp.setStatusBarColor(hex);
    }
  } catch { /* ignore */ }
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
  document.body.classList.toggle('gestor-demo', !!cfgRes.demo);
  applyTheme(state.config.tema);
  if ($('#tema-rapido')) $('#tema-rapido').value = state.config.tema || 'claro';

  const lic = await api('/licenca');
  if (lic.ok && lic.licenca && !lic.licenca.liberado) mostrarBloqueioLicenca(lic.licenca);

  const conn = await api('/emitente');
  if (conn.ok) {
    const nomeConn = String(conn.emitente?.nome_fanta || '').trim();
    setServiceStatus(true, nomeConn ? `Conectado • ${nomeConn.toLocaleUpperCase('pt-BR')}` : 'Conectado');
    setEmitenteUI(conn.emitente);
    applyTheme(state.config.tema, conn.emitente?.logo);
    await loadFuncionarios();
    await api('/logout', { method: 'POST', body: {} });
    await carregarLojasLogin();
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

function mascararSenha(input, mascarar = true) {
  if (!input) return;
  if (input.type === 'password') input.type = 'text';
  input.classList.toggle('senha-mascarada', mascarar);
  input.classList.toggle('senha-visivel', !mascarar);
  input.setAttribute('autocomplete', 'off');
}

$('#toggle-senha').addEventListener('click', () => {
  const input = $('#login-senha');
  mascararSenha(input, !input.classList.contains('senha-mascarada'));
});

let loginCliqueEm = 0;
$('#form-login button[type="submit"]')?.addEventListener('click', () => {
  loginCliqueEm = Date.now();
});
$('#login-senha')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loginCliqueEm = Date.now();
});
$('#login-usuario')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loginCliqueEm = Date.now();
});

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (Date.now() - loginCliqueEm > 1500) return;
  loginCliqueEm = 0;
  $('#login-erro').hidden = true;
  const id = Number($('#login-usuario').value);
  const senhaEl = $('#login-senha');
  const senha = senhaEl.value;
  senhaEl.value = '';
  mascararSenha(senhaEl, true);
  state.usuario = null;
  const res = await api('/login', { method: 'POST', body: { id, senha } });
  if (!res.ok) {
    senhaEl.value = senha;
    mascararSenha(senhaEl, true);
    $('#login-erro').hidden = false;
    $('#login-erro').textContent = res.error || 'Falha no login';
    return;
  }
  state.usuario = res.usuario;
  enterApp();
});

function isDesktopLayout() {
  return window.matchMedia('(min-width: 981px)').matches;
}

function setMaisOpen(open) {
  const sheet = $('#mais-sheet');
  if (!sheet) return;
  sheet.hidden = !open;
}

function fillUserChrome() {
  const nome = state.usuario?.nome || '—';
  if ($('#user-nome')) $('#user-nome').textContent = nome;
  if ($('#side-user-nome')) $('#side-user-nome').textContent = nome;
  if ($('#side-user-role')) {
    $('#side-user-role').textContent = state.usuario?.mtEntradas
      ? 'MT Entradas'
      : (state.usuario?.supervisor ? 'Supervisor' : 'Usuário');
  }
  if ($('#side-user-avatar')) $('#side-user-avatar').textContent = initialsFromName(nome);
}

function enterApp() {
  const senhaEl = $('#login-senha');
  if (senhaEl) {
    senhaEl.value = '';
    mascararSenha(senhaEl, true);
  }
  $('#view-login').hidden = true;
  $('#view-app').hidden = false;
  fillUserChrome();
  const canUsers = !!state.usuario?.supervisor;
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
  const showCompras = can('compras', 'acesso');
  if ($('#nav-compras')) $('#nav-compras').hidden = !showCompras;
  if ($('#nav-compras-mobile')) $('#nav-compras-mobile').hidden = !showCompras;
  if ($('#dash-compras')) $('#dash-compras').hidden = !showCompras;
  const showCond = can('condicionais', 'acesso') || can('estoque', 'acesso');
  if ($('#nav-condicionais')) $('#nav-condicionais').hidden = !showCond;
  if ($('#nav-condicionais-mobile')) $('#nav-condicionais-mobile').hidden = !showCond;
  const cfgSrv = $('#btn-config-servidor');
  if (cfgSrv) cfgSrv.hidden = !isNativeApk();
  const cfgMais = $('#btn-config-servidor-mais');
  if (cfgMais) cfgMais.hidden = !isNativeApk();
  const showEmp = !!state.usuario?.mtEntradas;
  if ($('#nav-empresas')) $('#nav-empresas').hidden = !showEmp;
  if ($('#nav-empresas-mobile')) $('#nav-empresas-mobile').hidden = !showEmp;
  showPage('dashboard');
  loadUnidades();
  carregarPedidoVinculo();
}

function trocarUsuario() {
  api('/logout', { method: 'POST', body: {} });
  voltarAoLogin();
}

/** Sessão expirou, foi trocada em outra aba ou a senha mudou: volta ao login com o motivo. */
function sessaoEncerrada(motivo) {
  voltarAoLogin();
  if (motivo) {
    $('#login-erro').hidden = false;
    $('#login-erro').textContent = motivo;
  }
}

function voltarAoLogin() {
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

$('#btn-logout')?.addEventListener('click', trocarUsuario);
$('#btn-trocar-usuario')?.addEventListener('click', trocarUsuario);
$('#btn-trocar-mobile')?.addEventListener('click', () => {
  setMaisOpen(false);
  trocarUsuario();
});
$('#btn-mais-mobile')?.addEventListener('click', () => setMaisOpen(true));
$('#mais-sheet-back')?.addEventListener('click', () => setMaisOpen(false));
$('#mais-sheet')?.querySelectorAll('[data-page]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    setMaisOpen(false);
    await showPage(btn.dataset.page);
  });
});
$('#btn-config-servidor-mais')?.addEventListener('click', () => {
  setMaisOpen(false);
  $('#btn-config-servidor')?.click();
});

(function wireServerConfig() {
  const btn = $('#btn-config-servidor');
  if (!btn) return;
  btn.hidden = !isNativeApk();
  btn.addEventListener('click', () => {
    setSidebarOpen(false);
    try {
      if (window.GestorApp && typeof window.GestorApp.changeServer === 'function') {
        window.GestorApp.changeServer();
      }
    } catch (err) {
      console.warn('changeServer', err);
    }
  });
})();
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
  await api('/tema', { method: 'POST', body: { tema } });
  state.config.tema = tema;
  applyTheme(tema, state.emitente.logo);
});

$('#ui-scale')?.addEventListener('change', (e) => {
  applyUiScale(e.target.value);
});
$$('#cfg-tabs .tab').forEach((btn) => {
  btn.addEventListener('click', () => setCfgTab(btn.dataset.cfgTab));
});
$('#cfg-params-salvar')?.addEventListener('click', () => window.ImportacaoNfe?.saveConfig?.());
$('#btn-empresas-atualizar')?.addEventListener('click', () => loadEmpresas());
initUiScale();

function setNavActive(page) {
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  $$('#mobile-nav [data-page]').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  const mais = $('#btn-mais-mobile');
  if (mais) {
    mais.classList.toggle('active', ['compras', 'condicionais', 'alteracoes', 'usuarios', 'preferencias'].includes(page));
  }
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
$('#dash-compras')?.addEventListener('click', () => showPage('compras'));
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
    showMsg('Sem permissão para notas de entrada.');
    page = 'dashboard';
  }
  if (page === 'compras' && !can('compras', 'acesso')) {
    showMsg('Sem permissão para consultar compras.');
    page = 'dashboard';
  }
  if (page === 'condicionais' && !(can('condicionais', 'acesso') || can('estoque', 'acesso'))) {
    showMsg('Sem permissão para condicionais.');
    page = 'dashboard';
  }
  if (page === 'empresas' && !state.usuario?.mtEntradas) {
    showMsg('Somente o usuário MT Entradas troca de empresa.');
    page = 'dashboard';
  }
  if (page === 'usuarios' && !state.usuario?.supervisor) {
    showMsg('Só o supervisor cadastra os usuários do painel.');
    page = 'dashboard';
  }

  const saiaCompras = $('#page-compras') && !$('#page-compras').hidden && page !== 'compras';
  if (saiaCompras) window.Compras?.onPageLeave?.();

  setNavActive(page);
  if ($('#page-dashboard')) $('#page-dashboard').hidden = page !== 'dashboard';
  $('#page-estoque').hidden = page !== 'estoque';
  if ($('#page-importacao')) $('#page-importacao').hidden = page !== 'importacao';
  if ($('#page-compras')) $('#page-compras').hidden = page !== 'compras';
  if ($('#page-condicionais')) $('#page-condicionais').hidden = page !== 'condicionais';
  if ($('#page-alteracoes')) $('#page-alteracoes').hidden = page !== 'alteracoes';
  $('#page-usuarios').hidden = page !== 'usuarios';
  if ($('#page-preferencias')) $('#page-preferencias').hidden = page !== 'preferencias';
  if ($('#page-empresas')) $('#page-empresas').hidden = page !== 'empresas';
  const estActions = $('#topbar-estoque-actions');
  if (estActions) estActions.hidden = page !== 'estoque';

  if (page === 'dashboard') {
    $('#page-title').textContent = 'Início';
    $('#page-sub').textContent = 'Escolha um módulo';
  } else if (page === 'usuarios') {
    $('#page-title').textContent = 'Usuários';
    $('#page-sub').textContent = 'Permissões por módulo';
    loadUsuarios();
  } else if (page === 'preferencias') {
    $('#page-title').textContent = 'Configurações';
    $('#page-sub').textContent = 'Tema, tributos e saída';
    setCfgTab(state.cfgTab || 'tema');
  } else if (page === 'empresas') {
    $('#page-title').textContent = 'Empresas';
    $('#page-sub').textContent = 'Troca de empresa do usuário MT Entradas';
    loadEmpresas();
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
  } else if (page === 'compras') {
    window.Compras?.onPageEnter();
  } else if (page === 'condicionais') {
    $('#page-title').textContent = 'Condicionais';
    $('#page-sub').textContent = 'Peças reservadas para o cliente';
    window.Condicionais?.onPageEnter();
  }
  scrollAppTop();
}

function showEstoqueLista() {
  state.selecionado = null;
  state.isNovo = false;
  state.scanTarget = 'search';
  $('#page-estoque')?.classList.remove('has-ficha');
  $('#estoque-lista-view').hidden = false;
  $('#estoque-edit-view').hidden = true;
  $('#page-title').textContent = 'Estoque';
  $('#page-sub').textContent = '';
  renderEstoqueLista();
  scrollAppTop();
}

function showEstoqueEdicao() {
  const page = $('#page-estoque');
  page?.classList.add('has-ficha');
  $('#estoque-edit-view').hidden = false;
  if (isDesktopLayout()) {
    $('#estoque-lista-view').hidden = false;
    $('#page-title').textContent = 'Estoque';
    $('#page-sub').textContent = '';
    renderEstoqueLista();
  } else {
    $('#estoque-lista-view').hidden = true;
    $('#page-title').textContent = state.isNovo ? 'Novo produto' : (state.selecionado?.descricao || 'Produto');
    $('#page-sub').textContent = '';
  }
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
$$('#estoque-status-seg .seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('#estoque-status-seg .seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
    const status = String(btn.dataset.status || 'A');
    const sel = $('#estoque-status-filtro');
    if (sel) sel.value = status;
    state.estoqueStatus = status;
    loadEstoque();
  });
});
$('#estoque-grupo-filtro')?.addEventListener('change', () => renderEstoqueLista());
$('#btn-filtro-condicional')?.addEventListener('click', () => {
  state.filtroCondicional = !state.filtroCondicional;
  $('#btn-filtro-condicional').classList.toggle('primary', state.filtroCondicional);
  loadEstoque();
});
$('#btn-exportar-estoque')?.addEventListener('click', () => exportarEstoqueCsv());

function exportarEstoqueCsv() {
  const list = estoqueFiltrado();
  const cols = ['codigo', 'produto', 'grupo', 'estoque', 'unidade', 'venda', ...(podeVerCusto() ? ['custo'] : [])];
  const lines = [cols.join(';')];
  for (const it of list) {
    const row = [
      it.id_estoque ?? it.id_identificador,
      `"${String(it.descricao || '').replace(/"/g, '""')}"`,
      `"${String(it.grupo || '').replace(/"/g, '""')}"`,
      String(it.qtd_atual ?? 0).replace('.', ','),
      it.uni_medida || 'UN',
      String(it.prc_venda ?? 0).replace('.', ','),
    ];
    if (podeVerCusto()) row.push(String(it.prc_custo ?? 0).replace('.', ','));
    lines.push(row.join(';'));
  }
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'estoque.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}
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
  const cond = state.filtroCondicional ? '&condicional=1' : '';
  const res = await api(`/estoque?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}${barras}${cond}`);
  state.estoqueLista = res.itens || [];
  renderEstoqueLista();
}

function estoqueFiltrado() {
  const grupo = String($('#estoque-grupo-filtro')?.value || '');
  const list = state.estoqueLista || [];
  if (!grupo) return list;
  return list.filter((it) => String(it.grupo || '') === grupo);
}

function syncGrupoFiltro() {
  const sel = $('#estoque-grupo-filtro');
  if (!sel) return;
  const cur = sel.value;
  const grupos = [...new Set((state.estoqueLista || []).map((it) => String(it.grupo || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  sel.innerHTML = `<option value="">Grupo</option>${grupos.map((g) => `<option value="${escapeAttr(g)}" ${g === cur ? 'selected' : ''}>${escapeHtml(g)}</option>`).join('')}`;
}

function qtdClass(qtd) {
  const n = Number(qtd || 0);
  if (n < 0) return 'is-neg';
  if (n > 0 && n <= 5) return 'is-low';
  return '';
}

function codigoEstoque(it) {
  const cod = String(it.id_estoque ?? '').padStart(6, '0');
  const ident = it.id_identificador == null ? '' : String(it.id_identificador);
  return `<div class="prod-cod"><strong>${escapeHtml(ident)}</strong><span>${escapeHtml(cod)}</span></div>`;
}

function botaoCondicional(it) {
  if (!(Number(it.qtd_reserv) > 0)) return '';
  return `<button type="button" class="btn small" data-cond-prod="${it.id_identificador}">Condicional</button>`;
}

function renderEstoqueLista() {
  const box = $('#estoque-lista');
  if (!box) return;
  const list = estoqueFiltrado();
  const total = (state.estoqueLista || []).length;
  const foot = $('#estoque-foot');
  const sub = $('#page-sub');
  const pageEst = $('#page-estoque');
  if (sub && pageEst && !pageEst.hidden && (isDesktopLayout() || !pageEst.classList.contains('has-ficha'))) {
    sub.textContent = total ? `${total} produto${total === 1 ? '' : 's'}` : '';
  }
  if (foot) {
    foot.innerHTML = list.length
      ? `<span>Mostrando ${list.length} de ${total}</span><span>Ordenado por cadastro mais recente</span>`
      : '';
  }
  syncGrupoFiltro();

  if (!list.length) {
    box.innerHTML = '<p class="empty">Nenhum produto encontrado</p>';
    return;
  }

  const selectedId = state.selecionado?.id_identificador;
  const rows = list.map((it) => {
    const qtd = Number(it.qtd_atual || 0);
    const cls = qtdClass(qtd);
    const active = Number(selectedId) === Number(it.id_identificador) ? 'is-active' : '';
    const inativo = String(it.status || 'A').toUpperCase() === 'I';
    const uni = escapeHtml(it.uni_medida || 'UN');
    const barras = it.cod_barras || it.referencia || '';
    return { it, qtd, cls, active, inativo, uni, barras };
  });

  const table = `
    <div class="est-table-wrap">
      <table class="est-table">
        <thead>
          <tr>
            <th>Código</th>
            <th>Produto</th>
            <th>Grupo</th>
            <th>Estoque</th>
            <th>Venda</th>
            ${podeVerCusto() ? '<th>Custo</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${rows.map(({ it, qtd, cls, active, uni, barras }) => `
            <tr class="${active}" data-id="${it.id_identificador}">
              <td>${codigoEstoque(it)}</td>
              <td>
                <div class="prod-name">${escapeHtml(it.descricao_exibicao || it.descricao)}</div>
                ${barras ? `<div class="prod-sub">${escapeHtml(barras)}</div>` : ''}
                ${botaoCondicional(it)}
              </td>
              <td>${escapeHtml(it.grupo || '—')}</td>
              <td class="est-qtd ${cls}">${fmtNum(qtd)} ${uni}</td>
              <td>${fmtMoney(it.prc_venda)}</td>
              ${podeVerCusto() ? `<td>${fmtMoney(it.prc_custo)}</td>` : ''}
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  const cards = `
    <div class="est-cards">
      ${rows.map(({ it, qtd, cls, active, uni, barras }) => `
        <div class="est-card ${active}" data-id="${it.id_identificador}">
          <div class="est-card-ico" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M3 8.5 12 4l9 4.5v11L12 20 3 15.5z" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/></svg>
          </div>
          <div>
            <strong>${escapeHtml(it.descricao_exibicao || it.descricao)}</strong>
            <div class="prod-sub">${codigoEstoque(it)}${barras ? ` · ${escapeHtml(barras)}` : ''}${it.prc_venda != null ? ` · ${fmtMoney(it.prc_venda)}` : ''}</div>
            ${botaoCondicional(it)}
          </div>
          <span class="est-qtd ${cls}">${fmtNum(qtd)} ${uni}</span>
        </div>`).join('')}
    </div>`;

  box.innerHTML = table + cards;
  box.querySelectorAll('[data-cond-prod]').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      window.Condicionais?.abrirDoProduto(Number(btn.dataset.condProd));
    });
  });
  box.querySelectorAll('[data-id]').forEach((row) => {
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

const CAMPOS_COM_CONFERENCIA = [
  'descricao', 'id_grupo', 'uni_medida', 'cod_barras', 'referencia', 'desc_cmpl',
  'status', 'id_nivel1', 'id_nivel2', 'prc_venda', 'prc_custo',
];

function valorConflito(campo, v) {
  if (v == null || v === '') return '(vazio)';
  if (campo === 'prc_venda' || campo === 'prc_custo') return fmtMoney(v);
  if (campo === 'qtd_atual') return fmtNum(v);
  if (campo === 'status') return v === 'I' ? 'Inativo' : 'Ativo';
  if (campo === 'id_grupo') return state.grupos?.find((g) => g.id_grupo === Number(v))?.descricao || `#${v}`;
  return String(v);
}

/** Outra pessoa alterou o mesmo campo: mostra o que mudou e pergunta se grava o valor deste usuário. */
function confirmarConflito(res) {
  const linhas = (res.conflitos || []).map((c) => (
    `• ${c.rotulo}: estava ${valorConflito(c.campo, c.visto)} quando você abriu, agora está ${valorConflito(c.campo, c.atual)}. Você quer gravar ${valorConflito(c.campo, c.novo)}.`
  ));
  return showConfirm(
    `${res.error}\n\n${linhas.join('\n')}\n\nGravar mesmo assim (substitui a alteração da outra pessoa) ou recarregar o produto com os valores atuais?`,
    { okLabel: 'Gravar o meu', cancelLabel: 'Recarregar' }
  );
}

$('#btn-salvar-produto').addEventListener('click', async () => {
  const it = state.selecionado;
  if (!it) return;
  const verCusto = podeVerCusto();
  const editarVenda = podeEditarPrecoVenda();
  const editarCusto = podeEditarCusto();
  const editarFicha = can('estoque', 'acesso') && (state.usuario.supervisor || ['editar', 'total'].includes(state.usuario.permissoes?.estoque?.ficha) || state.isNovo);
  const editarQtd = can('estoque', 'acesso') && (state.usuario.supervisor || ['editar', 'total'].includes(state.usuario.permissoes?.estoque?.quantidades) || state.isNovo);

  const body = {};

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
  body.origem = isNativeApk() ? 'celular' : 'navegador';
  if (editarQtd && state.isNovo && $('#q-atual')) {
    body.qtd_atual = parseBrMoney($('#q-atual').value);
  } else if (editarQtd && $('#q-nova') && String($('#q-nova').value).trim()) {
    const nova = parseBrMoney($('#q-nova').value);
    const base = Number(it.qtd_atual || 0);
    if (Number.isFinite(nova) && Math.abs(nova - base) > 1e-9) {
      if (state.qtdModo === 'absoluto') {
        body.qtd_atual = nova;
        body.qtd_vista = base;
      } else body.qtd_delta = Number((nova - base).toFixed(6));
      const obsQtd = String($('#q-obs')?.value || '').trim();
      if (obsQtd) body.obs_qtd = obsQtd;
    }
  }
  if ($('#t-cfop') && editarFicha) {
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
  if (($('#r-id-class-trib') || $('#r-id-class-trib-nfce')) && editarFicha) {
    body.trib_nfe = {
      id_class_trib: $('#r-id-class-trib')?.value || null,
      diferimento_cbs: Number($('#r-dif-cbs')?.value || 0),
      diferimento_ibs_uf: Number($('#r-dif-ibs-uf')?.value || 0),
      diferimento_ibs_mun: Number($('#r-dif-ibs-mun')?.value || 0),
      aliq_cbs: Number($('#r-aliq-cbs')?.value || 0),
      aliq_ibs_uf: Number($('#r-aliq-ibs-uf')?.value || 0),
    };
    body.trib_nfce = {
      id_class_trib: $('#r-id-class-trib-nfce')?.value || null,
      diferimento_cbs: Number($('#r-nfce-dif-cbs')?.value || 0),
      diferimento_ibs_uf: Number($('#r-nfce-dif-ibs-uf')?.value || 0),
      diferimento_ibs_mun: Number($('#r-nfce-dif-ibs-mun')?.value || 0),
      aliq_cbs: Number($('#r-nfce-aliq-cbs')?.value || 0),
      aliq_ibs_uf: Number($('#r-nfce-aliq-ibs-uf')?.value || 0),
    };
  }

  if (!String(body.descricao || it.descricao || '').trim() && state.isNovo) {
    return showMsg('Informe a descrição do produto.');
  }

  let res;
  if (state.isNovo) {
    res = await api('/estoque', { method: 'POST', body });
  } else {
    // Valores que estavam na tela ao abrir: o servidor recusa se outra pessoa mudou o mesmo campo nesse meio tempo.
    body.antes = {};
    for (const k of CAMPOS_COM_CONFERENCIA) {
      if (body[k] !== undefined && it[k] !== undefined && !(k === 'prc_custo' && it[k] == null)) body.antes[k] = it[k];
    }
    res = await api(`/estoque/${it.id_identificador}`, { method: 'PUT', body });
    if (!res.ok && res.code === 'CONFLITO') {
      if (!(await confirmarConflito(res))) {
        await openProduto(Number(it.id_identificador));
        return;
      }
      res = await api(`/estoque/${it.id_identificador}`, { method: 'PUT', body: { ...body, forcar: true } });
    }
  }
  if (!res.ok) return showMsg(res.error || 'Erro ao salvar');
  showToast(state.isNovo ? 'Produto cadastrado com sucesso.' : 'Dados alterados com sucesso.');
  const keepId = res.item?.id_identificador || it.id_identificador;
  await loadEstoque();
  if (isDesktopLayout() && keepId && !state.isNovo) {
    await openProduto(Number(keepId));
  } else {
    showEstoqueLista();
  }
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
  const val = (k) => (a[k] != null && a[k] !== '' ? a[k] : '');
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
  const tc = a.trib_nfce || {};
  const refHost = $('#ref-host');
  if (refHost) {
    const fmtAliq = (v) => (v == null || v === '' ? '' : v);
    refHost.innerHTML = `
      <h3 class="section-title">Reforma tributária</h3>
      <p class="hint">Classificação e alíquotas do cadastro (TB_EST_TRIBUTOS / TB_CLASS_TRIB). CBS 0,9% e IBS UF 0,1% são as alíquotas-padrão 2026 quando a classificação existe.</p>
      <h4 class="section-title">NF-e</h4>
      <p class="hint" id="r-class-label">${escapeHtml(tn._class_label || '')}</p>
      <div class="form-grid side-by-side">
        <label>ID classificação NFe${inp('r-id-class-trib', tn.id_class_trib || '', dis)}</label>
        <label>CST class. trib.${inp('r-cst-class', tn.cst_class_trib || '', true)}</label>
        <label>Alíq. CBS %${inp('r-aliq-cbs', fmtAliq(tn.aliq_cbs), dis)}</label>
        <label>Alíq. IBS UF %${inp('r-aliq-ibs-uf', fmtAliq(tn.aliq_ibs_uf), dis)}</label>
        <label>% red. alíq. CBS${inp('r-red-cbs', fmtAliq(tn.percent_red_aliq_cbs), true)}</label>
        <label>% red. alíq. IBS${inp('r-red-ibs', fmtAliq(tn.percent_red_aliq_ibs), true)}</label>
        <label>Alíq. efetiva CBS${inp('r-efet-cbs', fmtAliq(tn.aliq_efetiva_cbs), true)}</label>
        <label>Alíq. efetiva IBS UF${inp('r-efet-ibs-uf', fmtAliq(tn.aliq_efetiva_ibs_uf), true)}</label>
        <label>Diferimento CBS %${inp('r-dif-cbs', tn.diferimento_cbs ?? 0, dis)}</label>
        <label>Diferimento IBS UF %${inp('r-dif-ibs-uf', tn.diferimento_ibs_uf ?? 0, dis)}</label>
        <label>Diferimento IBS mun. %${inp('r-dif-ibs-mun', tn.diferimento_ibs_mun ?? 0, dis)}</label>
      </div>
      <h4 class="section-title">NFC-e</h4>
      <p class="hint" id="r-class-label-nfce">${escapeHtml(tc._class_label || '')}</p>
      <div class="form-grid side-by-side">
        <label>ID classificação NFC-e${inp('r-id-class-trib-nfce', tc.id_class_trib || '', dis)}</label>
        <label>Alíq. CBS %${inp('r-nfce-aliq-cbs', fmtAliq(tc.aliq_cbs), dis)}</label>
        <label>Alíq. IBS UF %${inp('r-nfce-aliq-ibs-uf', fmtAliq(tc.aliq_ibs_uf), dis)}</label>
        <label>% red. alíq. CBS${inp('r-nfce-red-cbs', fmtAliq(tc.percent_red_aliq_cbs), true)}</label>
        <label>% red. alíq. IBS${inp('r-nfce-red-ibs', fmtAliq(tc.percent_red_aliq_ibs), true)}</label>
        <label>Alíq. efetiva CBS${inp('r-nfce-efet-cbs', fmtAliq(tc.aliq_efetiva_cbs), true)}</label>
        <label>Alíq. efetiva IBS UF${inp('r-nfce-efet-ibs-uf', fmtAliq(tc.aliq_efetiva_ibs_uf), true)}</label>
        <label>Diferimento CBS %${inp('r-nfce-dif-cbs', tc.diferimento_cbs ?? 0, dis)}</label>
        <label>Diferimento IBS UF %${inp('r-nfce-dif-ibs-uf', tc.diferimento_ibs_uf ?? 0, dis)}</label>
        <label>Diferimento IBS mun. %${inp('r-nfce-dif-ibs-mun', tc.diferimento_ibs_mun ?? 0, dis)}</label>
      </div>
    `;
    const fillClassLabel = (idClass, elId) => {
      const n = Number(idClass);
      if (!n) return;
      api(`/importacao/class-trib?id=${n}`).then((r) => {
        const item = r.itens && r.itens[0];
        if (item && $(elId) && !$(elId).textContent) {
          $(elId).textContent = `${item.codigo || item.cod_class_trib || ''} — ${item.descricao || item.desc_class_trib || ''}`.trim();
        }
      }).catch(() => {});
    };
    fillClassLabel(tn.id_class_trib, '#r-class-label');
    fillClassLabel(tc.id_class_trib, '#r-class-label-nfce');
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

  const qtd = Number(it.qtd_atual || 0);
  const uni = escapeHtml(it.uni_medida || 'UN');
  const inativo = String(it.status || 'A').toUpperCase() === 'I';
  const desktop = isDesktopLayout();

  $('#estoque-detalhe').innerHTML = `
    ${desktop ? `
    <div class="ficha-aside-head">
      <div>
        <h2>${escapeHtml(it.descricao_exibicao || it.descricao || 'Novo produto')}</h2>
        <p class="hint">Cód. ${escapeHtml(String(it.id_estoque ?? 'novo'))} · Ident. ${escapeHtml(String(it.id_identificador ?? 'novo'))}</p>
      </div>
      <span class="${inativo ? 'chip-inativo' : 'chip-ativo'}">${inativo ? 'Inativo' : 'Ativo'}</span>
    </div>` : ''}
    <div class="tabs">
      <button class="tab active" data-tab="ficha">Ficha</button>
      <button class="tab" data-tab="precos">Preços</button>
      <button class="tab" data-tab="quantidade">Quantidade</button>
      ${!state.isNovo ? '<button class="tab" data-tab="fiscal">Fiscal</button>' : ''}
      ${showGrade || showSerial || showLote ? '<button class="tab" data-tab="controle">Grade / Lote</button>' : ''}
    </div>
    <div class="tab-pane" data-pane="ficha">
      <div class="form-grid side-by-side">
        <label>ID Estoque<input value="${it.id_estoque ?? 'Novo'}" disabled /></label>
        <label>ID Identificador<input value="${it.id_identificador ?? 'Novo'}" disabled /></label>
        <label class="full">Descrição<input id="f-descricao" maxlength="120" value="${escapeAttr(it.descricao)}" ${editarFicha || state.isNovo ? '' : 'disabled'} /></label>
        ${!state.isNovo ? `<div class="full"><button type="button" class="btn small" id="btn-condicionais-prod" ${Number(it.qtd_reserv) > 0 ? '' : 'disabled'}>Condicionais${Number(it.qtd_reserv) > 0 ? ` (${fmtNum(it.qtd_reserv)})` : ''}</button></div>` : ''}
        <label class="full grupo-field">Grupo
          <div class="input-row">
            <select id="f-grupo" ${editarFicha || state.isNovo ? '' : 'disabled'}>
              <option value="">Selecione o grupo</option>
              ${state.grupos.map((g) => `<option value="${g.id_grupo}" ${Number(g.id_grupo) === Number(it.id_grupo) ? 'selected' : ''}>${escapeHtml(g.descricao)}</option>`).join('')}
            </select>
            <button type="button" class="btn small" id="btn-novo-grupo" title="Cadastrar grupo" ${editarFicha || state.isNovo ? '' : 'disabled'}>+</button>
          </div>
        </label>
        ${state.isNovo ? '<p class="hint full">Escolha um grupo já cadastrado ou use + para cadastrar na hora.</p>' : ''}
        <label>Unid. medida
          <select id="f-un" ${editarFicha || state.isNovo ? '' : 'disabled'}>
            ${optionsUnidades(it.uni_medida)}
          </select>
        </label>
        <div class="ficha-cod-status">
          <div class="field">
            <span>Cód. barras</span>
            <div class="input-row barcode-row">
              <input id="f-barras" maxlength="18" inputmode="numeric" autocomplete="off" value="${escapeAttr(it.cod_barras)}" ${editarFicha ? '' : 'disabled'} />
              ${editarFicha ? `<button type="button" id="btn-scan-ficha-barras" class="btn icon-cam" title="Ler código de barras" aria-label="Ler código de barras">${CAMERA_ICON_SVG}</button>` : ''}
            </div>
          </div>
          <label class="ficha-status">Status
            <select id="f-status" ${editarFicha || state.isNovo ? '' : 'disabled'}>
              <option value="A" ${String(it.status || 'A').toUpperCase() !== 'I' ? 'selected' : ''}>Ativo</option>
              <option value="I" ${String(it.status || 'A').toUpperCase() === 'I' ? 'selected' : ''}>Inativo</option>
            </select>
          </label>
        </div>
        <label class="full">Referência<input id="f-ref" maxlength="18" value="${escapeAttr(it.referencia)}" ${editarFicha ? '' : 'disabled'} /></label>
        <label class="full">Desc. complementar<input id="f-cmpl" maxlength="30" value="${escapeAttr(it.desc_cmpl)}" ${editarFicha ? '' : 'disabled'} /></label>
        ${!state.isNovo && editarFicha ? `
        <div class="full status-actions">
          <button type="button" class="btn ${String(it.status || 'A').toUpperCase() === 'I' ? 'ok' : 'outline'}" id="btn-toggle-status">
            ${String(it.status || 'A').toUpperCase() === 'I' ? 'Ativar produto' : 'Inativar produto'}
          </button>
          <span class="hint">Altera o campo STATUS na base (Clipp e ManagePro).</span>
        </div>` : ''}
      </div>
    </div>
    <div class="tab-pane" data-pane="precos" hidden>
      <div class="form-grid side-by-side">
        <label>Preço de venda<input id="p-venda" inputmode="decimal" value="${escapeAttr(fmtMoney2(it.prc_venda))}" ${editarVenda ? '' : 'disabled'} /></label>
        <label>Preço de custo
          <input id="p-custo" inputmode="decimal"
            value="${verCusto ? escapeAttr(fmtMoney2(it.prc_custo)) : '****'}" ${editarCusto ? '' : 'disabled'} class="${verCusto ? '' : 'masked'}" />
        </label>
        <p class="hint full">${verCusto ? `Margem: ${fmtMargem(it.prc_venda, it.prc_custo)}` : 'Custo oculto pela permissão do usuário.'}</p>
      </div>
    </div>
    <div class="tab-pane" data-pane="quantidade" hidden>
      <input id="q-atual" type="hidden" value="${escapeAttr(fmtMoney2(it.qtd_atual))}" ${editarQtd ? '' : 'disabled'} />
      <input id="q-add" type="hidden" value="${escapeAttr(fmtMoney2(0))}" />
      <input id="q-rem" type="hidden" value="${escapeAttr(fmtMoney2(0))}" />
      <div class="qty-hero">
        <span>Quantidade atual</span>
        <strong id="q-hero">${fmtNum(qtd)} ${uni}</strong>
        ${!state.isNovo ? `<small class="qty-ultima" id="q-ultima">${escapeHtml(textoUltimaAlteracao(it.ultima_alteracao))}</small>` : ''}
      </div>
      <p class="hint" style="margin:0 0 0.35rem;font-size:0.7rem;letter-spacing:.06em;text-transform:uppercase;font-weight:700">Ajustar</p>
      <div class="qty-stepper">
        <button type="button" id="q-minus" ${editarQtd ? '' : 'disabled'}>−</button>
        <div class="qty-delta" id="q-delta-lbl">0</div>
        <button type="button" id="q-plus" ${editarQtd ? '' : 'disabled'}>+</button>
      </div>
      <div class="qty-pair">
        <label>Nova quantidade
          <input id="q-nova" inputmode="decimal" value="${escapeAttr(fmtMoney2(it.qtd_atual))}" ${editarQtd ? '' : 'disabled'} />
        </label>
        <div id="q-diff" class="diff-box">Diferença: 0</div>
      </div>
      <label class="qty-obs">Observação (opcional)
        <input id="q-obs" maxlength="120" placeholder="Contagem de prateleira" ${editarQtd ? '' : 'disabled'} />
      </label>
      ${!desktop ? `<div class="qty-sticky-save"><button type="button" class="btn primary" id="btn-salvar-contagem">Salvar contagem</button></div>` : ''}
    </div>
    ${!state.isNovo ? `
    <div class="tab-pane" data-pane="fiscal" hidden>
      <div id="trib-host" class="trib-host"><p class="hint">Carregando última entrada e parâmetros…</p></div>
      <div id="ref-host" class="trib-host" style="margin-top:1rem"></div>
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
    ${desktop ? `
    <div class="ficha-aside-actions">
      <button type="button" class="btn" id="btn-cancelar-produto-aside">Cancelar</button>
      <button type="button" class="btn primary" id="btn-salvar-produto-aside">Salvar contagem</button>
    </div>` : ''}
  `;

  $$('.tab', $('#estoque-detalhe')).forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.tab', $('#estoque-detalhe')).forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      $$('.tab-pane', $('#estoque-detalhe')).forEach((p) => {
        p.hidden = p.dataset.pane !== tab.dataset.tab;
      });
      if (tab.dataset.tab === 'fiscal' || tab.dataset.tab === 'tributos' || tab.dataset.tab === 'reforma') loadTributosProduto(it, editarFicha);
    });
  });

  const qAtual = $('#q-atual');
  const qAdd = $('#q-add');
  const qRem = $('#q-rem');
  const qNova = $('#q-nova');
  const qDeltaLbl = $('#q-delta-lbl');
  const base = Number(it.qtd_atual || 0);
  const uniTxt = it.uni_medida || 'UN';
  let syncing = false;
  state.qtdModo = 'delta';

  function paintDiff(delta) {
    const box = $('#q-diff');
    const d = Number.isFinite(delta) ? delta : 0;
    if (box) {
      box.textContent = d === 0 ? '0' : `${d > 0 ? '+' : ''}${fmtNum(d)} ${uniTxt}`;
      box.className = `diff-box ${d > 0 ? 'pos' : d < 0 ? 'neg' : ''}`;
    }
    if (qDeltaLbl) {
      qDeltaLbl.textContent = d === 0 ? '0' : `${d > 0 ? '+' : ''}${fmtNum(d)}`;
      qDeltaLbl.classList.toggle('is-neg', d < 0);
    }
  }

  let deltaAtual = 0;
  function applyDelta(delta, { manterNova = false } = {}) {
    const d = Number.isFinite(delta) ? Number(delta.toFixed(6)) : 0;
    deltaAtual = d;
    syncing = true;
    if (qAdd) qAdd.value = fmtMoney2(d > 0 ? d : 0);
    if (qRem) qRem.value = fmtMoney2(d < 0 ? Math.abs(d) : 0);
    if (qAtual) qAtual.value = fmtMoney2(base + d);
    if (qNova && !manterNova) qNova.value = fmtMoney2(base + d);
    syncing = false;
    paintDiff(d);
  }

  function updateDiffFromAddRem() {
    if (syncing) return;
    const add = parseBrMoney(qAdd?.value ?? 0);
    const rem = parseBrMoney(qRem?.value ?? 0);
    applyDelta(add - rem);
  }

  function updateAddRemFromAtual() {
    if (syncing || !qAtual) return;
    applyDelta(parseBrMoney(qAtual.value) - base);
  }

  qAdd?.addEventListener('input', () => { state.qtdModo = 'delta'; updateDiffFromAddRem(); });
  qRem?.addEventListener('input', () => { state.qtdModo = 'delta'; updateDiffFromAddRem(); });
  qAtual?.addEventListener('input', () => { state.qtdModo = 'absoluto'; updateAddRemFromAtual(); });
  // O campo é do usuário enquanto ele digita (pode ficar vazio); só formata ao sair.
  qNova?.addEventListener('focus', () => qNova.select());
  qNova?.addEventListener('input', () => {
    if (syncing) return;
    state.qtdModo = 'absoluto';
    const vazio = !String(qNova.value).trim();
    applyDelta(vazio ? 0 : parseBrMoney(qNova.value) - base, { manterNova: true });
  });
  qNova?.addEventListener('blur', () => {
    if (!String(qNova.value).trim()) state.qtdModo = 'delta';
    applyDelta(deltaAtual);
  });
  $('#q-plus')?.addEventListener('click', () => {
    state.qtdModo = 'delta';
    applyDelta(deltaAtual + 1);
  });
  $('#q-minus')?.addEventListener('click', () => {
    state.qtdModo = 'delta';
    applyDelta(deltaAtual - 1);
  });
  $('#btn-salvar-contagem')?.addEventListener('click', () => $('#btn-salvar-produto')?.click());
  $('#btn-salvar-produto-aside')?.addEventListener('click', () => $('#btn-salvar-produto')?.click());
  $('#btn-cancelar-produto-aside')?.addEventListener('click', () => $('#btn-cancelar-produto')?.click());
  applyDelta(0);

  if (!desktop && !state.isNovo) {
    const qTab = $('#estoque-detalhe .tab[data-tab="quantidade"]');
    qTab?.click();
  }

  $('#btn-toggle-status')?.addEventListener('click', async () => {
    const atual = String(it.status || 'A').toUpperCase() === 'I' ? 'I' : 'A';
    const proximo = atual === 'I' ? 'A' : 'I';
    const ok = confirm(proximo === 'I'
      ? 'Inativar este produto na base (STATUS = I)?'
      : 'Ativar este produto na base (STATUS = A)?');
    if (!ok) return;
    const res = await api(`/estoque/${it.id_identificador}`, {
      method: 'PUT',
      body: { status: proximo },
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

  $('#btn-condicionais-prod')?.addEventListener('click', () => {
    if (Number(it.qtd_reserv) > 0) window.Condicionais?.abrirDoProduto(it.id_identificador);
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
  state.mudaOnline = res.mudaOnline;
  renderUsuarios();
}

function renderUsuarios() {
  const box = $('#usuarios-lista');
  box.innerHTML = state.usuarios.map((u, idx) => `
    <div class="user-card" data-idx="${idx}">
      <div class="grid-2">
        <label>Nome<input value="${escapeAttr(u.nome)}" disabled /></label>
        <label>Nova senha<input type="text" class="senha-mascarada" data-field="senha" autocomplete="off" data-1p-ignore="true" data-lpignore="true" placeholder="${u.mtEntradas ? 'Conferida pela MT Automações' : u.supervisor ? 'Definida pela MT Automações' : (u.temSenha ? '••••••' : 'Definir senha')}" ${u.supervisor || u.mtEntradas ? 'disabled' : ''} /></label>
      </div>
      <div class="perm-grid">
        <label>Acesso Estoque
          <select data-perm="estoque.acesso" ${u.supervisor || u.mtEntradas ? 'disabled' : ''}>
            <option value="true" ${u.permissoes?.estoque?.acesso ? 'selected' : ''}>Sim</option>
            <option value="false" ${!u.permissoes?.estoque?.acesso ? 'selected' : ''}>Não</option>
          </select>
        </label>
        <label>Ficha
          <select data-perm="estoque.ficha" ${u.supervisor || u.mtEntradas ? 'disabled' : ''}>
            ${permOptions(['nenhum', 'visualizar', 'editar'], u.permissoes?.estoque?.ficha || 'nenhum')}
          </select>
        </label>
        <label>Preços
          <select data-perm="estoque.precos" ${u.supervisor || u.mtEntradas ? 'disabled' : ''}>
            ${permOptions(['nenhum', 'visualizar', 'editar', 'total'], u.permissoes?.estoque?.precos || 'nenhum')}
          </select>
        </label>
        <label>Quantidades
          <select data-perm="estoque.quantidades" ${u.supervisor || u.mtEntradas ? 'disabled' : ''}>
            ${permOptions(['nenhum', 'visualizar', 'editar'], u.permissoes?.estoque?.quantidades || 'nenhum')}
          </select>
        </label>
        <label>Relatório Alterações
          <select data-perm="alteracoes.acesso" ${u.supervisor || u.mtEntradas ? 'disabled' : ''}>
            <option value="true" ${u.permissoes?.alteracoes?.acesso ? 'selected' : ''}>Sim</option>
            <option value="false" ${!u.permissoes?.alteracoes?.acesso ? 'selected' : ''}>Não</option>
          </select>
        </label>
        <label>Usuários
          <select data-perm="usuarios.acesso" ${u.supervisor || u.mtEntradas ? 'disabled' : ''}>
            <option value="true" ${u.permissoes?.usuarios?.acesso ? 'selected' : ''}>Sim</option>
            <option value="false" ${!u.permissoes?.usuarios?.acesso ? 'selected' : ''}>Não</option>
          </select>
        </label>
        <label>Notas de entrada
          <select data-perm="importacao.acesso" ${u.supervisor || u.mtEntradas ? 'disabled' : ''}>
            <option value="true" ${u.permissoes?.importacao?.acesso ? 'selected' : ''}>Sim</option>
            <option value="false" ${!u.permissoes?.importacao?.acesso ? 'selected' : ''}>Não</option>
          </select>
        </label>
        ${state.modulos?.online ? `<label>Acesso online
          <select data-perm="online.acesso" ${state.mudaOnline === false ? 'disabled title="Só na rede da loja"' : ''}>
            <option value="true" ${u.permissoes?.online?.acesso ? 'selected' : ''}>Sim</option>
            <option value="false" ${!u.permissoes?.online?.acesso ? 'selected' : ''}>Não</option>
          </select>
        </label>` : ''}
        <label>Consultar Compras
          <select data-perm="compras.acesso" ${u.supervisor || u.mtEntradas ? 'disabled' : ''}>
            <option value="true" ${u.permissoes?.compras?.acesso ? 'selected' : ''}>Sim</option>
            <option value="false" ${!u.permissoes?.compras?.acesso ? 'selected' : ''}>Não</option>
          </select>
        </label>
        <label>Condicionais
          <select data-perm="condicionais.acesso" ${u.supervisor || u.mtEntradas ? 'disabled' : ''}>
            <option value="true" ${u.permissoes?.condicionais?.acesso !== false ? 'selected' : ''}>Sim</option>
            <option value="false" ${u.permissoes?.condicionais?.acesso === false ? 'selected' : ''}>Não</option>
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
        compras: {
          acesso: $('[data-perm="compras.acesso"]', card)?.value === 'true',
        },
      },
    };
    const selOnline = $('[data-perm="online.acesso"]', card);
    if (selOnline) next.permissoes.online = { acesso: selOnline.value === 'true' };
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
  state.mudaOnline = res.mudaOnline;
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
  const res = await api(`/importacao/notas/${id}/resumo`);
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
  if (scanControls?.hintTimer) clearTimeout(scanControls.hintTimer);
  if (scanControls?.zx?.stop) {
    try { scanControls.zx.stop(); } catch { /* ignore */ }
  }
  if (scanControls?.reader?.reset) {
    try { scanControls.reader.reset(); } catch { /* ignore */ }
  }
  if (scanControls?.stream) {
    scanControls.stream.getTracks().forEach((t) => t.stop());
  }
  scanControls = null;
  const video = $('#scan-video');
  if (video) video.srcObject = null;
  mostrarScanAoVivo(false);
}

function extractChaveNfe44(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';

  // QR da DANFE / consulta SEFAZ: chNFe=, chave=, p=CHAVE|...
  const fromQuery = text.match(/(?:chNFe|chave|chAce|chaveAcesso)=(\d{44})/i)
    || text.match(/[?&]p=(\d{44})(?:\||&|$)/i)
    || text.match(/(?:NFe|NFCe)?(\d{44})/i);
  if (fromQuery) {
    const c = fromQuery[1] || fromQuery[0];
    const digitsOnly = String(c).replace(/\D/g, '');
    if (digitsOnly.length >= 44) return digitsOnly.slice(0, 44);
  }

  const digits = text.replace(/\D/g, '');
  if (digits.length === 44) return digits;
  if (digits.length > 44) {
    const run = digits.match(/\d{44}/);
    if (run) return run[0];
  }
  const compact = text.replace(/[\s\-._]/g, '');
  const run = compact.match(/\d{44}/);
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

async function applyScannedCode(value, { live = false } = {}) {
  if (state.scanTarget === 'importacao') {
    const digits = String(value || '').replace(/\D/g, '');
    const chave = extractChaveNfe44(value) || (digits.length >= 44 ? digits.slice(0, 44) : '');
    if (chave.length === 44 && window.ImportacaoNfe?.applyScannedChave?.(chave)) {
      stopScanner();
      $('#dlg-scan')?.close();
      state.scanTarget = 'search';
      return true;
    }
    if (value && !live) {
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
      inp.value = String(code || '').slice(0, 18);
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
window.applyScannedCodeFromApp = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  const chave = extractChaveNfe44(value) || (digits.length >= 44 ? digits.slice(0, 44) : '');
  const pageImp = document.getElementById('page-importacao');
  const onImportacao = pageImp && !pageImp.hidden;
  if (chave.length === 44 && onImportacao) {
    state.scanTarget = 'importacao';
    if (window.ImportacaoNfe?.applyScannedChave?.(chave)) {
      state.scanTarget = 'search';
      return true;
    }
  }
  return applyScannedCode(value);
};

function getZxingHints(forChave = false) {
  const Z = window.ZXingBrowser || window.ZXing;
  const hints = new Map();
  const BF = Z?.BarcodeFormat;
  const formats = [];
  // Chave NF-e: CODE_128/ITF (DANFE). Também CODE_39 como fallback.
  const names = forChave
    ? ['CODE_128', 'ITF', 'CODE_39', 'QR_CODE', 'CODABAR', 'EAN_13']
    : ['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'CODE_39'];
  if (BF) {
    for (const name of names) {
      if (BF[name] != null) formats.push(BF[name]);
    }
  }
  const DHT = Z?.DecodeHintType;
  if (formats.length) hints.set(DHT?.POSSIBLE_FORMATS ?? 2, formats);
  if (forChave) {
    hints.set(DHT?.TRY_HARDER ?? 3, true);
  }
  return hints;
}

function getZxingReader(forChave = isChaveScanTarget(), unrestricted = false) {
  const ZXing = window.ZXingBrowser || window.ZXing;
  if (!ZXing?.BrowserMultiFormatReader) return null;
  try {
    if (unrestricted) return new ZXing.BrowserMultiFormatReader();
    return new ZXing.BrowserMultiFormatReader(getZxingHints(forChave));
  } catch {
    return new ZXing.BrowserMultiFormatReader();
  }
}

const BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'codabar', 'qr_code'];

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
  const maxEdge = heavy ? 2400 : 1400;
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

async function detectWithBarcodeDetector(source, forChave = false) {
  if (!('BarcodeDetector' in window)) return [];
  const formatSets = forChave
    ? [
      ['code_128', 'qr_code'],
      ['code_128', 'qr_code', 'itf', 'code_39'],
      BARCODE_FORMATS,
    ]
    : [BARCODE_FORMATS];
  for (const formats of formatSets) {
    try {
      const detector = new BarcodeDetector({ formats });
      const codes = await detector.detect(source);
      const vals = codes.map((c) => c.rawValue).filter(Boolean);
      if (vals.length) return vals;
    } catch { /* formato não suportado neste Safari — tenta próximo */ }
  }
  return [];
}

async function detectWithZxingCanvas(canvas, forChave = isChaveScanTarget()) {
  const readers = [
    getZxingReader(forChave, false),
    forChave ? getZxingReader(false, true) : null,
  ].filter(Boolean);
  for (const reader of readers) {
    try {
      const result = await reader.decodeFromCanvas(canvas);
      const text = result?.getText?.() || result?.text || '';
      if (text) return [text, normalizeBarcodeNumber(text)].filter(Boolean);
    } catch { /* tenta próximo reader */ }
  }
  return [];
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
    if (heavy) {
      for (const c of candidates) {
        const chave = extractChaveNfe44(c);
        if (chave.length === 44) return chave;
      }
      const joined = candidates.map((c) => String(c || '').replace(/\D/g, '')).join('');
      const chave = extractChaveNfe44(joined);
      return chave.length === 44 ? chave : '';
    }
    return pickBestBarcode(candidates) || '';
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

  pushTexts(await detectWithBarcodeDetector(img, heavy));
  try {
    const bitmap = oriented || await createImageBitmap(img);
    pushTexts(await detectWithBarcodeDetector(bitmap, heavy));
    if (!oriented) bitmap.close?.();
  } catch { /* ignore */ }

  for (const unrestricted of [false, true]) {
    try {
      const reader = getZxingReader(heavy, unrestricted);
      if (reader) {
        const result = await reader.decodeFromImageUrl(url);
        const text = result?.getText?.() || result?.text || '';
        if (text) pushTexts([text]);
      }
    } catch { /* ignore */ }
    try {
      const reader = getZxingReader(heavy, unrestricted);
      if (reader?.decodeFromImageElement && img instanceof HTMLImageElement) {
        const result = await reader.decodeFromImageElement(img);
        const text = result?.getText?.() || result?.text || '';
        if (text) pushTexts([text]);
      }
    } catch { /* ignore */ }
    if (takeIfReady()) break;
  }

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
      pushTexts(await detectWithBarcodeDetector(canvas, heavy));
      pushTexts(await detectWithZxingCanvas(canvas, heavy));
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
  // APK: câmera nativa (produto = ZXing; chave = ML Kit contínuo)
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

  const canLive = canUseLiveCamera();
  if (liveBtn) liveBtn.hidden = !canLive;

  if (canLive && isIOS()) {
    if (liveBtn) liveBtn.hidden = true;
    startLiveScanner();
    return;
  }

  if (isChaveScanTarget()) {
    // iPhone: foto + decode no servidor Windows (Safari falha no CODE_128 longo)
    msg.textContent = 'Fotografe a faixa da chave (barra) ou o QR da DANFE, bem perto e nítida.';
    // click síncrono — iOS exige gesto do usuário para abrir a câmera
    try { $('#scan-file')?.click(); } catch { /* ignore */ }
    return;
  }

  msg.textContent = 'Toque em “Abrir câmera”, foque só no código de barras e confirme a foto.';
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Falha ao ler imagem'));
    reader.readAsDataURL(file);
  });
}

/** iPhone de 24/48 MP gera foto maior que o limite da API (10 MB em base64): envia no máximo 2400 px. */
async function fotoReduzidaDataUrl(file, maxLado = 2400) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Não abri a foto'));
      el.src = url;
    });
    const escala = Math.min(1, maxLado / Math.max(img.naturalWidth, img.naturalHeight));
    if (escala >= 1 && file.size < 4 * 1024 * 1024) return fileToDataUrl(file);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * escala);
    canvas.height = Math.round(img.naturalHeight * escala);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.92);
  } catch {
    return fileToDataUrl(file);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function decodeChaveViaServidor(file) {
  const dataUrl = await fotoReduzidaDataUrl(file);
  const res = await api('/importacao/decode-chave', {
    method: 'POST',
    body: { image: dataUrl },
  });
  if (res?.ok && res.chave) return res.chave;
  throw new Error(res?.error || 'Servidor não leu a chave');
}

async function startLiveScanner() {
  const video = $('#scan-video');
  const msg = $('#scan-msg');
  const preview = $('#scan-preview');
  if (!video || !msg) return;

  if (!canUseLiveCamera() && !window.isSecureContext && !window.__GESTOR_APP__) {
    msg.textContent = 'Leitura ao vivo indisponível neste endereço. Use “Abrir câmera / galeria”.';
    return;
  }

  const forChave = isChaveScanTarget();
  try {
    if (preview) preview.hidden = true;
    mostrarScanAoVivo(true, forChave);
    msg.textContent = 'Abrindo câmera ao vivo…';
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();

    const reader = getZxingReader(forChave);
    const detector = criarBarcodeDetector(forChave);
    if (!reader?.decodeFromCanvas && !detector) {
      stream.getTracks().forEach((t) => t.stop());
      mostrarScanAoVivo(false);
      msg.textContent = 'Leitura ao vivo indisponível neste navegador. Use a foto do código.';
      return;
    }
    scanControls = { stream, reader, timer: null };
    msg.textContent = forChave
      ? 'Coloque a barra da chave (ou o QR) dentro da faixa, bem perto e sem reflexo.'
      : 'Coloque o código de barras dentro da faixa.';
    lerQuadrosAoVivo(video, { forChave, reader, detector });
    if (forChave) {
      scanControls.hintTimer = setTimeout(() => {
        if (scanControls) msg.textContent = 'Não leu ainda? Afaste/aproxime devagar até a barra ficar nítida, ou toque em “Abrir câmera / galeria” para fotografar.';
      }, 15000);
    }
  } catch (err) {
    mostrarScanAoVivo(false);
    msg.textContent = `Não foi possível abrir a câmera ao vivo: ${err.message}. Use “Abrir câmera / galeria”.`;
  }
}

function mostrarScanAoVivo(ativo, forChave = false) {
  const box = $('#scan-live');
  if (box) box.hidden = !ativo;
  $('#scan-guia')?.classList.toggle('chave', !!forChave);
  $('#dlg-scan')?.classList.toggle('scan-ao-vivo', !!ativo);
}

function criarBarcodeDetector(forChave) {
  if (!('BarcodeDetector' in window)) return null;
  const opcoes = forChave
    ? [['code_128', 'qr_code', 'itf', 'code_39'], ['code_128', 'qr_code']]
    : [['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'], ['ean_13', 'code_128']];
  for (const formats of opcoes) {
    try { return new BarcodeDetector({ formats }); } catch { /* tenta o próximo */ }
  }
  return null;
}

/** Retângulo da faixa de mira em pixels do vídeo (o vídeo é exibido com object-fit: cover). */
function regiaoDaMira(video) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const caixa = video.getBoundingClientRect();
  const mira = $('#scan-guia')?.getBoundingClientRect();
  if (!mira || !caixa.width || !caixa.height) {
    return { sx: 0, sy: Math.round(vh * 0.3), sw: vw, sh: Math.round(vh * 0.4) };
  }
  const escala = Math.max(caixa.width / vw, caixa.height / vh);
  const ox = (vw * escala - caixa.width) / 2;
  const oy = (vh * escala - caixa.height) / 2;
  let sx = (mira.left - caixa.left + ox) / escala;
  let sy = (mira.top - caixa.top + oy) / escala;
  let sw = mira.width / escala;
  let sh = mira.height / escala;
  // Folga em volta: a barra pode passar um pouco da faixa.
  sx -= sw * 0.06;
  sw *= 1.12;
  sy -= sh * 0.25;
  sh *= 1.5;
  sx = Math.max(0, sx);
  sy = Math.max(0, sy);
  sw = Math.min(vw - sx, sw);
  sh = Math.min(vh - sy, sh);
  return { sx: Math.round(sx), sy: Math.round(sy), sw: Math.round(sw), sh: Math.round(sh) };
}

/**
 * Lê só a faixa de mira, ampliada: a barra longa da chave (44 dígitos) ocupa pouco do quadro inteiro.
 * Alterna imagem normal e com contraste; na chave, manda um quadro ao servidor a cada 3 s.
 */
function lerQuadrosAoVivo(video, { forChave, reader, detector }) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let volta = 0;
  let ocupado = false;
  let servidorOcupado = false;
  let ultimoServidor = Date.now();
  const larguraAlvo = forChave ? 1800 : 1200;

  const recortar = (ampliar) => {
    const r = regiaoDaMira(video);
    if (r.sw < 16 || r.sh < 16) return false;
    const escala = ampliar ? Math.min(2.5, Math.max(1, larguraAlvo / r.sw)) : 1;
    canvas.width = Math.round(r.sw * escala);
    canvas.height = Math.round(r.sh * escala);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(video, r.sx, r.sy, r.sw, r.sh, 0, 0, canvas.width, canvas.height);
    return true;
  };

  const tentarServidor = () => {
    if (!forChave || servidorOcupado || Date.now() - ultimoServidor < 3000) return;
    if (!recortar(false)) return;
    servidorOcupado = true;
    ultimoServidor = Date.now();
    const image = canvas.toDataURL('image/jpeg', 0.9);
    api('/importacao/decode-chave', { method: 'POST', body: { image } })
      .then((res) => {
        if (res?.ok && res.chave && scanControls) applyScannedCode(res.chave, { live: true });
      })
      .catch(() => {})
      .finally(() => { servidorOcupado = false; });
  };

  scanControls.timer = setInterval(async () => {
    if (ocupado || !scanControls || video.readyState < 2 || !video.videoWidth) return;
    ocupado = true;
    try {
      tentarServidor();
      if (!recortar(true)) return;
      if (volta % 2 === 1) applyMono(ctx, canvas.width, canvas.height, 'contrast');
      volta += 1;
      let texto = '';
      if (detector) {
        try {
          const codes = await detector.detect(canvas);
          texto = codes[0]?.rawValue || '';
        } catch { /* tenta o ZXing */ }
      }
      if (!texto && reader?.decodeFromCanvas) {
        try { texto = reader.decodeFromCanvas(canvas)?.getText() || ''; } catch { /* nada nesta volta */ }
      }
      if (texto && scanControls) await applyScannedCode(texto, { live: true });
    } finally {
      ocupado = false;
    }
  }, 200);
}

async function onScanFileSelected(file) {
  const msg = $('#scan-msg');
  const preview = $('#scan-preview');
  if (!file) return;
  msg.textContent = isChaveScanTarget()
    ? 'Lendo chave… (pode usar o PC se o iPhone não conseguir)'
    : 'Lendo número do código…';
  const url = URL.createObjectURL(file);
  if (preview) {
    preview.src = url;
    preview.hidden = false;
  }
  stopScanner();
  try {
    let code;
    if (isChaveScanTarget()) {
      // Chave: lê no servidor. A leitura local amplia a foto em dezenas de canvas e trava o Safari do iPhone.
      msg.textContent = 'Lendo a chave no servidor (barra ou os 44 números)…';
      try {
        code = await decodeChaveViaServidor(file);
      } catch (err) {
        msg.textContent = err.message || 'Não li a chave. Tire outra foto mais perto da barra ou do QR.';
        return;
      }
    } else {
      code = await decodeBarcodeFromImageUrl(url, file);
    }
    if (!await applyScannedCode(code)) {
      msg.textContent = isChaveScanTarget()
        ? 'Não encontrei os 44 dígitos. Fotografe só a faixa da chave ou o QR, bem perto.'
        : 'Não encontrei o número. Tire outra foto mais perto, com boa luz e só o código.';
    }
  } catch (err) {
    msg.textContent = `Não foi possível ler o número do código. Tire outra foto mais perto. (${err.message || 'erro'})`;
  } finally {
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
/** Ex.: "Alterado Celular 31/10/2026 13:25:25 · JOÃO" */
function textoUltimaAlteracao(u) {
  if (!u || !u.data_hora) return 'Sem alteração de quantidade registrada';
  const quem = u.usuario ? ` · ${u.usuario}` : '';
  return `Alterado ${u.origem || 'Clipp'} ${u.data_hora}${quem}`;
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
  openConfig: (tab) => {
    showPage('preferencias');
    setCfgTab(tab || 'tributos');
    if (!cfgMontada) {
      cfgMontada = true;
      window.ImportacaoNfe?.mountConfig?.();
    }
  },
  isSupervisor: () => !!state.usuario?.supervisor,
  getUsuario: () => state.usuario,
});

window.Compras?.init({
  api,
  showMsg,
  showToast,
  escapeHtml,
  fmtMoney,
  openImportacao: () => showPage('importacao'),
});

window.Condicionais?.init({ api });

(function ligarQuadroPdf() {
  const dlg = $('#dlg-danfe');
  const frame = $('#dlg-danfe-frame');
  if (!dlg || !frame || dlg.dataset.gestorPdf === '1') return;
  dlg.dataset.gestorPdf = '1';

  const fechar = () => {
    frame.removeAttribute('srcdoc');
    frame.src = 'about:blank';
    try { if (dlg.open) dlg.close(); } catch { /* ignore */ }
  };

  const imprimir = () => {
    const html = frame.getAttribute('srcdoc') || '';
    const src = frame.getAttribute('src') || '';
    const tmp = document.createElement('iframe');
    tmp.setAttribute('aria-hidden', 'true');
    tmp.style.cssText = 'position:fixed;width:0;height:0;border:0;left:0;bottom:0';
    const disparar = () => {
      try {
        tmp.contentWindow.focus();
        tmp.contentWindow.print();
      } catch { /* ignore */ }
      setTimeout(() => tmp.remove(), 1500);
    };
    tmp.addEventListener('load', disparar, { once: true });
    document.body.appendChild(tmp);
    if (html) tmp.srcdoc = html;
    else if (src && src !== 'about:blank') tmp.src = src;
    else {
      tmp.remove();
      try { frame.contentWindow?.focus(); frame.contentWindow?.print(); } catch { /* ignore */ }
    }
  };

  $('#dlg-danfe-fechar')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    fechar();
  });
  $('#dlg-danfe-print')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    imprimir();
  });
  window.addEventListener('message', (ev) => {
    if (ev.origin !== location.origin) return;
    if (ev.data?.tipo === 'gestor-imprimir') imprimir();
    if (ev.data?.tipo === 'gestor-fechar-pdf') fechar();
  });
})();

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
  const pageCompras = $('#page-compras');
  if (pageCompras && !pageCompras.hidden) {
    showPage('dashboard');
    return true;
  }
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
