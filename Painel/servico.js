'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

async function api(path, options = {}) {
  try {
    const res = await fetch(`/api${path}`, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
      body: options.body != null ? JSON.stringify(options.body) : undefined,
    });
    return await res.json();
  } catch (err) {
    return { ok: false, offline: true, error: err.message || 'Serviço offline' };
  }
}

function setPanel(name) {
  $$('.svc-nav[data-panel]').forEach((b) => b.classList.toggle('active', b.dataset.panel === name));
  $('#panel-conexao').hidden = name !== 'conexao';
  $('#panel-config').hidden = name !== 'config';

  const titles = {
    conexao: ['Conexão', 'Acesso ao painel pelo celular ou navegador'],
    config: ['Configuração', 'Banco, certificado digital e preferências do serviço'],
  };
  const [t, s] = titles[name] || titles.conexao;
  if ($('#svc-page-title')) $('#svc-page-title').textContent = t;
  if ($('#svc-page-sub')) $('#svc-page-sub').textContent = s;

  if (name === 'config') {
    setConfigTab(stateConfigTab || 'banco');
  }
}

let stateConfigTab = 'banco';

function setConfigTab(tab) {
  stateConfigTab = tab;
  $$('.svc-tab[data-config-tab]').forEach((b) => {
    b.classList.toggle('active', b.dataset.configTab === tab);
  });
  $$('.config-tab-pane').forEach((pane) => {
    pane.hidden = pane.id !== `config-tab-${tab}`;
  });
  if (tab === 'fiscal') loadFiscal();
  if (tab === 'banco') refreshDbMaintenance();
  if (tab === 'sistema') loadSobre();
}

$$('.svc-tab[data-config-tab]').forEach((btn) => {
  btn.addEventListener('click', () => setConfigTab(btn.dataset.configTab));
});

$$('.svc-nav[data-panel]').forEach((btn) => {
  btn.addEventListener('click', () => setPanel(btn.dataset.panel));
});

async function refreshNetwork() {
  const net = await api('/network');
  if (!net.ok) {
    $('#status-dot').className = 'dot off';
    $('#status-text').textContent = 'Servidor indisponível';
    return;
  }

  const url = net.primaryUrl || net.localUrl;
  $('#svc-ip').textContent = net.primaryIp || '127.0.0.1';
  $('#svc-porta').value = String(net.port || 5077);
  $('#svc-host').textContent = net.hostname || '—';
  const link = $('#svc-url');
  link.href = url;
  link.textContent = url;

  const alts = (net.addresses || [])
    .filter((a) => a.url !== url)
    .map((a) => `${a.address} (${a.interface})`)
    .join(' · ');
  $('#svc-alts').textContent = alts ? `Outros IPs: ${alts}` : '';

  const qr = await api(`/qrcode?data=${encodeURIComponent(url)}`);
  if (qr.ok) {
    $('#svc-qr').src = qr.dataUrl;
  }

  $('#status-dot').className = 'dot on';
  $('#status-text').textContent = 'Servidor em execução…';
}

function fillBanco(cfg) {
  $('#cfg-database').value = cfg.database || '';
  $('#cfg-host').value = cfg.host || '127.0.0.1';
  $('#cfg-port').value = cfg.port || 3050;
  $('#cfg-sistema').value = cfg.sistema || 'clipp';
}

async function loadBanco() {
  const res = await api('/config');
  if (res.ok) fillBanco(res.config);
  await refreshDbMaintenance();
}

async function refreshDbMaintenance() {
  const res = await api('/database/status');
  const st = $('#banco-manutencao-status');
  const btnLib = $('#btn-liberar-base');
  const btnRet = $('#btn-retomar-base');
  if (!st) return;
  if (res.ok && res.active) {
    st.textContent = `Status: LIBERADA — ${res.reason || 'substitua o .FDB e retome'}`;
    st.style.color = 'var(--danger)';
    if (btnLib) btnLib.hidden = true;
    if (btnRet) btnRet.hidden = false;
  } else {
    st.textContent = 'Status: operação normal';
    st.style.color = '';
    if (btnLib) btnLib.hidden = false;
    if (btnRet) btnRet.hidden = true;
  }
}

$('#btn-liberar-base')?.addEventListener('click', async () => {
  if (!confirm('Liberar a base? O painel/celular não acessará o Firebird até você clicar em Retomar base.')) return;
  const msg = $('#banco-msg');
  if (msg) { msg.hidden = false; msg.textContent = 'Liberando base…'; }
  const res = await api('/database/liberar', { method: 'POST', body: {} });
  if (msg) {
    msg.hidden = false;
    if (res.ok) {
      msg.textContent = res.hint || `Base liberada. Anexos encerrados: ${res.disconnected || 0}.`;
      if (res.warning) msg.textContent += ` ${res.warning}`;
    } else {
      msg.textContent = res.error || 'Falha ao liberar';
    }
  }
  await refreshDbMaintenance();
});

$('#btn-retomar-base')?.addEventListener('click', async () => {
  const res = await api('/database/retomar', { method: 'POST', body: {} });
  const msg = $('#banco-msg');
  if (msg) {
    msg.hidden = false;
    msg.textContent = res.ok ? 'Base retomada. Testando conexão…' : (res.error || 'Falha');
  }
  await refreshDbMaintenance();
  if (res.ok) await testOrSave(false);
});

$('#cfg-browse').addEventListener('click', async () => {
  if (window.desktop?.openFile) {
    const file = await window.desktop.openFile({
      properties: ['openFile'],
      filters: [{ name: 'Firebird', extensions: ['fdb', 'FDB'] }],
    });
    if (file) $('#cfg-database').value = file;
  } else {
    alert('Cole o caminho completo do arquivo .FDB.');
  }
});

function readBanco() {
  return {
    database: $('#cfg-database').value.trim(),
    host: $('#cfg-host').value.trim(),
    port: Number($('#cfg-port').value) || 3050,
    user: 'SYSDBA',
    password: 'masterkey',
    sistema: $('#cfg-sistema').value,
  };
}

async function testOrSave(connectAfterSave) {
  const body = readBanco();
  $('#banco-msg').hidden = false;
  $('#banco-msg').textContent = connectAfterSave ? 'Salvando…' : 'Testando…';
  const saved = await api('/config', { method: 'POST', body });
  if (!saved.ok) {
    $('#banco-msg').textContent = saved.error || 'Falha ao salvar';
    return;
  }
  const conn = await api('/connect', { method: 'POST', body });
  if (conn.ok) {
    $('#banco-emitente').hidden = false;
    $('#banco-empresa').textContent = conn.emitente?.nome_fanta || 'Conectado';
    $('#banco-fb').textContent = `Firebird ${conn.fbVersion} · ${conn.sistema}`;
    $('#banco-msg').textContent = connectAfterSave
      ? `Configuração salva. Empresa: ${conn.emitente?.nome_fanta || '—'}`
      : `Conexão OK (Firebird ${conn.fbVersion}).`;
  } else {
    $('#banco-emitente').hidden = true;
    $('#banco-msg').textContent = connectAfterSave
      ? `Salvo, mas conexão falhou: ${conn.error || 'erro'}`
      : (conn.error || 'Falha na conexão');
  }
}

$('#cfg-testar').addEventListener('click', () => testOrSave(false));
$('#form-banco').addEventListener('submit', async (e) => {
  e.preventDefault();
  await testOrSave(true);
});

function toggleFiscalTipo() {
  const tipo = $('#fiscal-tipo').value;
  const a1 = $('#fiscal-a1-fields');
  const win = $('#fiscal-win-fields');
  if (a1) a1.hidden = tipo !== 'a1';
  if (win) win.hidden = tipo !== 'windows';
}

function readFiscal() {
  const tipo = $('#fiscal-tipo').value;
  const body = {
    tipo,
    ambiente: $('#fiscal-ambiente').value,
    arquivoPfx: $('#fiscal-arquivo').value.trim(),
    thumbprint: '',
    certStore: 'Cert:\\CurrentUser\\My',
  };
  const senha = $('#fiscal-senha').value;
  if (senha) body.senha = senha;

  if (tipo === 'windows') {
    const sel = $('#fiscal-cert-list');
    const opt = sel?.selectedOptions?.[0];
    body.thumbprint = sel?.value || '';
    body.certStore = opt?.dataset?.store || 'Cert:\\CurrentUser\\My';
    delete body.arquivoPfx;
  }
  return body;
}

function showFiscalMsg(text, ok) {
  const el = $('#fiscal-msg');
  if (!el) return;
  el.hidden = !text;
  el.textContent = text || '';
  el.style.color = ok === false ? 'var(--danger)' : ok === true ? 'var(--ok)' : '';
}

function showFiscalResultado(titulo, detalhe, visible) {
  const card = $('#fiscal-resultado');
  if (!card) return;
  card.hidden = !visible;
  if (visible) {
    $('#fiscal-res-titulo').textContent = titulo;
    $('#fiscal-res-detalhe').textContent = detalhe;
  }
}

async function loadFiscal() {
  const res = await api('/fiscal/config');
  if (!res.ok) return;
  const f = res.fiscal || {};
  $('#fiscal-tipo').value = f.tipo || 'a1';
  $('#fiscal-arquivo').value = f.arquivoPfx || '';
  $('#fiscal-ambiente').value = f.ambiente || 'homologacao';
  $('#fiscal-senha').value = '';
  const hint = $('#fiscal-senha-hint');
  if (hint) {
    hint.textContent = f.hasSenha
      ? 'Senha já configurada. Deixe em branco para manter a atual.'
      : 'A senha é guardada criptografada neste computador.';
  }
  toggleFiscalTipo();
  if (f.tipo === 'windows') await reloadCertList(f.thumbprint);
}

async function reloadCertList(selectThumb) {
  showFiscalMsg('Carregando certificados do Windows…');
  const res = await api('/fiscal/certificados');
  const sel = $('#fiscal-cert-list');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Selecione —</option>';
  if (!res.ok) {
    showFiscalMsg(res.error || 'Falha ao listar certificados', false);
    return;
  }
  for (const c of res.itens || []) {
    const opt = document.createElement('option');
    opt.value = c.thumbprint;
    opt.dataset.store = c.store;
    opt.textContent = `${c.label} · ${c.subject?.slice(0, 40) || ''}`;
    if (selectThumb && c.thumbprint === selectThumb) opt.selected = true;
    sel.appendChild(opt);
  }
  showFiscalMsg(`${(res.itens || []).length} certificado(s) com chave privada encontrado(s).`, true);
  setTimeout(() => showFiscalMsg(''), 3500);
}

$('#fiscal-tipo')?.addEventListener('change', toggleFiscalTipo);

$('#fiscal-browse')?.addEventListener('click', async () => {
  if (window.desktop?.openFile) {
    const file = await window.desktop.openFile({
      properties: ['openFile'],
      filters: [{ name: 'Certificado A1', extensions: ['pfx', 'p12', 'PFX', 'P12'] }],
    });
    if (file) $('#fiscal-arquivo').value = file;
  } else {
    alert('Informe o caminho completo do arquivo .pfx');
  }
});

$('#fiscal-recarregar')?.addEventListener('click', () => reloadCertList($('#fiscal-cert-list').value));

async function testarFiscal() {
  showFiscalResultado('', '', false);
  showFiscalMsg('Testando certificado…');
  const body = readFiscal();
  const res = await api('/fiscal/testar', { method: 'POST', body });
  if (res.ok) {
    const c = res.certificado || {};
    showFiscalMsg(res.message || 'Certificado OK', true);
    showFiscalResultado(
      c.subject || 'Certificado válido',
      `CNPJ ${c.cnpj || '—'} · válido até ${c.notAfter || '—'} · ${res.ambiente || ''}`,
      true
    );
  } else {
    showFiscalMsg(res.error || 'Falha no teste', false);
    if (res.certificado) {
      showFiscalResultado('Certificado encontrado', res.error, true);
    }
  }
}

$('#fiscal-testar')?.addEventListener('click', testarFiscal);

$('#form-fiscal')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  showFiscalMsg('Salvando…');
  const body = readFiscal();
  const saved = await api('/fiscal/config', { method: 'POST', body });
  if (!saved.ok) {
    showFiscalMsg(saved.error || 'Falha ao salvar', false);
    return;
  }
  $('#fiscal-senha').value = '';
  await loadFiscal();
  showFiscalMsg('Configuração fiscal salva.', true);
  await testarFiscal();
});

$('#btn-abrir-painel').addEventListener('click', async () => {
  const net = await api('/network');
  const url = (net && net.localUrl) || 'http://127.0.0.1:5077/';
  abrirPainelComLicenca(url);
});

$('#svc-url').addEventListener('click', (e) => {
  e.preventDefault();
  const url = e.currentTarget.href;
  if (url && !url.endsWith('#')) abrirPainelComLicenca(url);
});

$('#btn-toggle-svc').addEventListener('click', async () => {
  if (!confirm('Parar o serviço do Gestor Estoque? O acesso pelo celular será interrompido.')) return;
  if (window.desktop?.quit) {
    window.desktop.quit();
    return;
  }
  await api('/shutdown', { method: 'POST', body: {} });
  $('#status-dot').className = 'dot off';
  $('#status-text').textContent = 'Serviço parado';
});

$('#btn-sair').addEventListener('click', () => {
  if (window.desktop?.quit) window.desktop.quit();
  else window.close();
});

async function loadSobre() {
  const verEl = $('#svc-versao');
  if (window.desktop?.getVersion) {
    try {
      const v = await window.desktop.getVersion();
      if (verEl) verEl.textContent = v || '—';
    } catch {
      if (verEl) verEl.textContent = '—';
    }
  } else if (verEl) {
    verEl.textContent = 'web';
  }

  const chk = $('#chk-inicio-windows');
  const msg = $('#inicio-windows-msg');
  if (!window.desktop?.getOpenAtLogin) {
    if (chk) chk.disabled = true;
    if (msg) msg.textContent = 'Disponível apenas no aplicativo instalado.';
    return;
  }
  try {
    const s = await window.desktop.getOpenAtLogin();
    if (chk) chk.checked = !!s.openAtLogin;
  } catch {
    if (msg) msg.textContent = 'Não foi possível ler a configuração de inicialização.';
  }
}

$('#chk-inicio-windows')?.addEventListener('change', async (e) => {
  const enabled = !!e.target.checked;
  const msg = $('#inicio-windows-msg');
  if (!window.desktop?.setOpenAtLogin) return;
  try {
    const res = await window.desktop.setOpenAtLogin(enabled);
    if (msg) {
      msg.textContent = res.openAtLogin
        ? 'Ativado: o serviço abrirá com o Windows.'
        : 'Desativado: não inicia automaticamente.';
    }
  } catch (err) {
    e.target.checked = !enabled;
    if (msg) msg.textContent = `Falha ao alterar: ${err.message || 'erro'}`;
  }
});

$('#btn-verificar-update')?.addEventListener('click', async () => {
  const status = $('#update-status');
  if (!window.desktop?.checkUpdate) {
    if (status) status.textContent = 'Atualização automática só no aplicativo instalado.';
    return;
  }
  if (status) status.textContent = 'Consultando GitHub…';
  try {
    const res = await window.desktop.checkUpdate({ silent: false });
    if (res?.updated) {
      if (status) status.textContent = 'Atualização iniciada. O instalador será aberto.';
      return;
    }
    if (res?.declined) {
      if (status) status.textContent = 'Atualização adiada.';
      return;
    }
    if (res?.info && !res.info.available) {
      if (status) {
        if (res.pendingPublish || res.info.pendingPublish) {
          status.textContent = `Há versão ${res.info.gitVersion} no Git, mas falta publicar o instalador (Release v${res.info.gitVersion}). Instalada: ${res.info.localVersion}.`;
        } else if (res.info.gitVersion && res.info.gitVersion !== res.info.localVersion) {
          status.textContent = `Git: ${res.info.gitVersion} · instalada: ${res.info.localVersion}. Sem instalador novo no Release.`;
        } else {
          status.textContent = `Você já está na versão mais recente (${res.info.localVersion}).`;
        }
      }
      return;
    }
    if (res?.ok === false) {
      if (status) status.textContent = res.error || 'Falha ao verificar atualização.';
      return;
    }
    if (status) status.textContent = 'Verificação concluída.';
  } catch (err) {
    if (status) status.textContent = err.message || 'Falha ao verificar.';
  }
});

const LIC_TITULOS = {
  liberado: 'Liberada',
  desativado: 'Controle de licença desativado nesta versão',
  verificando: 'Verificando…',
  pendente: 'Cadastro solicitado — aguardando aprovação da MT Automações',
  bloqueado: 'Bloqueada',
  vencido: 'Vencida',
  expirado: 'Não validada (sem contato com o servidor de licenças)',
  relogio: 'Data/hora do computador incorreta',
  outro_cnpj: 'Licença de outro CNPJ',
  sem_licenca: 'Não validada',
  nao_solicitado: 'Não registrada — a liberação é solicitada ao abrir o painel',
};

function fmtDataHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR');
}

function fmtDiaYmd(ymd) {
  const [a, m, d] = String(ymd || '').split('-');
  return d ? `${d}/${m}/${a}` : '—';
}

function fmtCnpj(v) {
  return String(v || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

/** Endereço do painel que o usuário tentou abrir; abre sozinho quando a licença for liberada. */
let licUrlPendente = null;

function preencherLicModal(l) {
  const modal = $('#lic-modal');
  let titulo = `Licença: ${LIC_TITULOS[l.status] || l.status}`;
  let msg = l.mensagem || '';
  const pedir = l.status === 'nao_solicitado';
  if (pedir) {
    titulo = 'Solicitar liberação';
    msg = 'Para usar o painel, este computador precisa ser liberado pela MT Automações. '
      + 'Informe o CNPJ da revenda e clique em Solicitar liberação. Os dados abaixo serão enviados junto.';
  } else if (l.status === 'pendente') {
    titulo = 'Registro solicitado';
    msg = `Este computador ainda não está liberado. A solicitação de registro foi enviada à MT Automações`
      + `${l.solicitado_em ? ` em ${fmtDataHora(l.solicitado_em)}` : ''} com os dados abaixo. `
      + 'Assim que for aprovada, o sistema libera sozinho em até 1 minuto.';
  } else if (l.status === 'sem_licenca') {
    titulo = 'Registro necessário';
  }
  $('#lic-modal-titulo').textContent = titulo;
  $('#lic-modal-msg').textContent = msg;
  $('#lic-modal-app').textContent = l.aplicacao || 'GestorEstoque';
  $('#lic-modal-empresa').textContent = l.fantasia || '—';
  $('#lic-modal-cnpj').textContent = fmtCnpj(l.cnpj) || '—';
  $('#lic-modal-nse').textContent = l.nse || '—';
  $('#lic-modal-maquina').textContent = l.maquina || '—';
  const temRevenda = !pedir && !!l.revenda_cnpj;
  $('#lic-modal-revenda-dt').hidden = !temRevenda;
  $('#lic-modal-revenda-dd').hidden = !temRevenda;
  $('#lic-modal-revenda-dd').textContent = fmtCnpj(l.revenda_cnpj) || '—';
  $('#lic-modal-revenda-box').hidden = !pedir;
  $('#lic-modal-solicitar').hidden = !pedir;
  $('#lic-modal-verificar').hidden = pedir;
  if (pedir && !$('#lic-modal-revenda').value && l.revenda_cnpj) $('#lic-modal-revenda').value = fmtCnpj(l.revenda_cnpj);
  modal.querySelector('.lic-modal-card').classList.toggle('pendente', l.status === 'pendente');
}

function abrirLicModal(l) {
  preencherLicModal(l);
  showLicModalStatus(l.status === 'nao_solicitado' && l.ultimo_erro ? `Falha: ${l.ultimo_erro}` : '', false);
  $('#lic-modal').hidden = false;
  if (l.status === 'nao_solicitado') $('#lic-modal-revenda').focus();
}

/** Janela aberta: acompanha a situação; liberou, fecha e abre o painel que o usuário pediu. */
function renderLicModal(l) {
  const modal = $('#lic-modal');
  if (!modal || modal.hidden) return;
  if (l.liberado || l.status === 'desativado') {
    modal.hidden = true;
    if (licUrlPendente) window.open(licUrlPendente, '_blank');
    licUrlPendente = null;
    return;
  }
  preencherLicModal(l);
}

async function abrirPainelComLicenca(url) {
  const res = await api('/licenca');
  const l = res.ok ? res.licenca : null;
  if (!l || l.liberado || l.status === 'desativado') {
    window.open(url, '_blank');
    return;
  }
  licUrlPendente = url;
  renderLicenca(l);
  abrirLicModal(l);
}

function renderLicenca(l) {
  if (!l) return;
  renderLicModal(l);
  let titulo = LIC_TITULOS[l.status] || l.status;
  if (l.liberado && l.teste && l.pago_ate) titulo = `Teste grátis até ${fmtDiaYmd(l.pago_ate)}`;
  const st = $('#lic-status');
  if (st) {
    st.textContent = titulo;
    st.style.color = l.liberado ? 'var(--ok)' : (l.status === 'pendente' ? 'var(--warn, #9a6400)' : 'var(--danger)');
  }
  const cnpj = fmtCnpj(l.cnpj);
  const partes = [];
  if (cnpj) partes.push(`CNPJ ${cnpj}`);
  if (l.nse) partes.push(`NSE ${l.nse}`);
  partes.push(`último contato ${fmtDataHora(l.ultimo_contato)}`);
  if (l.liberado && l.valido_ate) partes.push(`válida até ${fmtDataHora(l.valido_ate)}${l.tipo === 'offline' ? ' (código offline)' : ''}`);
  if (l.mensagem && !l.liberado) partes.push(l.mensagem);
  else if (l.ultimo_erro) partes.push(`Última falha: ${l.ultimo_erro}`);
  if ($('#lic-detalhe')) $('#lic-detalhe').textContent = partes.join(' · ');

  const alerta = $('#lic-alerta');
  if (alerta) {
    alerta.hidden = !!l.liberado || l.status === 'verificando' || l.status === 'nao_solicitado';
    $('#lic-alerta-titulo').textContent = `Licença: ${titulo}`;
    $('#lic-alerta-msg').textContent = l.mensagem || '';
  }
}

function showLicMsg(text, ok) {
  const el = $('#lic-msg');
  if (!el) return;
  el.hidden = !text;
  el.textContent = text || '';
  el.style.color = ok === false ? 'var(--danger)' : ok === true ? 'var(--ok)' : '';
}

async function refreshLicenca() {
  const res = await api('/licenca');
  if (res.ok) renderLicenca(res.licenca);
  return res.ok ? res.licenca : null;
}

function showLicModalStatus(text, ok) {
  const el = $('#lic-modal-status');
  if (!el) return;
  el.hidden = !text;
  el.textContent = text || '';
  el.style.color = ok === false ? 'var(--danger)' : ok === true ? 'var(--ok)' : '';
}

function fecharLicModal() {
  $('#lic-modal').hidden = true;
  licUrlPendente = null;
  showLicModalStatus('');
}

$('#lic-modal-revenda')?.addEventListener('input', (e) => {
  const d = e.target.value.replace(/\D/g, '').slice(0, 14);
  e.target.value = d.length === 14 ? fmtCnpj(d) : d;
});

$('#lic-modal-solicitar')?.addEventListener('click', async (e) => {
  const rev = $('#lic-modal-revenda').value.replace(/\D/g, '');
  if (rev.length !== 14) {
    showLicModalStatus('Informe o CNPJ da revenda (14 dígitos).', false);
    return;
  }
  e.target.disabled = true;
  showLicModalStatus('Enviando solicitação…');
  const res = await api('/licenca/solicitar', { method: 'POST', body: { revenda_cnpj: rev } });
  e.target.disabled = false;
  if (!res.ok) {
    showLicModalStatus(res.error || 'Falha ao solicitar.', false);
    return;
  }
  const l = res.licenca;
  renderLicenca(l);
  if (l.liberado) showLicModalStatus('');
  else if (l.ultimo_erro) showLicModalStatus(`Falha: ${l.ultimo_erro}`, false);
  else showLicModalStatus('Solicitação enviada à MT Automações.', true);
});

$('#lic-modal-fechar')?.addEventListener('click', fecharLicModal);

$('#lic-modal-codigo')?.addEventListener('click', () => {
  fecharLicModal();
  setPanel('config');
  setConfigTab('sistema');
  $('#lic-codigo')?.focus();
});

$('#lic-modal-verificar')?.addEventListener('click', async (e) => {
  e.target.disabled = true;
  showLicModalStatus('Consultando servidor de licenças…');
  const res = await api('/licenca/verificar', { method: 'POST', body: {} });
  e.target.disabled = false;
  if (!res.ok) {
    showLicModalStatus(res.error || 'Falha ao verificar.', false);
    return;
  }
  renderLicenca(res.licenca);
  if (res.licenca.liberado) showLicModalStatus('');
  else showLicModalStatus(res.licenca.ultimo_erro ? `Falha: ${res.licenca.ultimo_erro}` : 'Ainda aguardando aprovação.', false);
});

$('#btn-lic-verificar')?.addEventListener('click', async (e) => {
  const atual = await api('/licenca');
  if (atual.ok && atual.licenca?.status === 'nao_solicitado') {
    abrirLicModal(atual.licenca);
    return;
  }
  e.target.disabled = true;
  showLicMsg('Consultando servidor de licenças…');
  const res = await api('/licenca/verificar', { method: 'POST', body: {} });
  e.target.disabled = false;
  if (res.ok) {
    renderLicenca(res.licenca);
    showLicMsg(res.licenca.liberado ? 'Licença válida.' : (res.licenca.ultimo_erro || res.licenca.mensagem || ''), !!res.licenca.liberado);
  } else {
    showLicMsg(res.error || 'Falha ao verificar.', false);
  }
});

$('#btn-lic-aplicar')?.addEventListener('click', async () => {
  const codigo = $('#lic-codigo').value.trim();
  if (!codigo) {
    showLicMsg('Cole o código recebido da MT Automações.', false);
    return;
  }
  const res = await api('/licenca/aplicar', { method: 'POST', body: { codigo } });
  if (res.ok) {
    $('#lic-codigo').value = '';
    renderLicenca(res.licenca);
    showLicMsg(res.licenca.liberado ? 'Código aplicado. Licença liberada.' : (res.licenca.mensagem || 'Código aplicado.'), !!res.licenca.liberado);
  } else {
    showLicMsg(res.error || 'Código inválido.', false);
  }
});

let onlineQrDe = '';

function renderOnline(o) {
  if (!o) return;
  $('#chk-online').checked = !!o.ativo;
  const dot = $('#online-dot');
  const st = $('#online-status');
  if (!o.ativo) {
    dot.className = 'dot off';
    st.textContent = 'Desligado';
  } else if (o.conectado) {
    dot.className = 'dot on';
    st.textContent = `Conectado desde ${fmtDataHora(o.desde)}`;
  } else {
    dot.className = 'dot off';
    st.textContent = 'Conectando…';
  }
  const erro = $('#online-erro');
  erro.hidden = !(o.ativo && o.ultimo_erro);
  erro.textContent = o.ultimo_erro || '';
  erro.style.color = 'var(--danger)';
  $('#online-link-box').hidden = !o.ativo;
  $('#online-qr-card').hidden = !o.ativo;
  $('#btn-online-novo').hidden = !o.ativo;
  const link = $('#online-link');
  link.href = o.link;
  link.textContent = o.link;
  const qrLink = o.pareamento?.link;
  if (o.ativo && qrLink && onlineQrDe !== qrLink) {
    onlineQrDe = qrLink;
    api(`/qrcode?data=${encodeURIComponent(qrLink)}`).then((qr) => {
      if (qr.ok) $('#online-qr').src = qr.dataUrl;
    });
  }
  renderPedidos(o);
  renderAparelhos(o);
}

let pedidosRenderizados = '';

function renderPedidos(o) {
  const lista = o.ativo ? (o.pedidos || []) : [];
  $('#online-pedidos-box').hidden = !lista.length;
  const chave = JSON.stringify(lista);
  if (chave === pedidosRenderizados) return;
  pedidosRenderizados = chave;
  const ul = $('#online-pedidos');
  ul.textContent = '';
  for (const p of lista) {
    const li = document.createElement('li');
    const info = document.createElement('div');
    info.className = 'ap-info';
    const cod = document.createElement('div');
    cod.className = 'ap-codigo';
    cod.textContent = p.codigo;
    const det = document.createElement('div');
    det.className = 'ap-det';
    det.textContent = `${p.nome} · pedido às ${fmtDataHora(p.criado_em)}${p.ip ? ` · IP ${p.ip}` : ''}`;
    info.append(cod, det);
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'btn-teal small';
    ok.textContent = 'Autorizar';
    ok.addEventListener('click', async () => {
      if (!confirm(`Autorizar "${p.nome}"?\n\nConfira se o aparelho mostra o código ${p.codigo}. Ele passará a acessar pela internet (com usuário e senha do painel).`)) return;
      const res = await api('/online', { method: 'POST', body: { autorizarPedido: p.id } });
      if (res.ok) renderOnline(res.online);
    });
    const nao = document.createElement('button');
    nao.type = 'button';
    nao.className = 'btn-outline small';
    nao.textContent = 'Recusar';
    nao.addEventListener('click', async () => {
      const res = await api('/online', { method: 'POST', body: { recusarPedido: p.id } });
      if (res.ok) renderOnline(res.online);
    });
    li.append(info, ok, nao);
    ul.appendChild(li);
  }
}

let aparelhosRenderizados = '';

function textoDias(d) {
  return d === 1 ? '1 dia' : `${d} dias`;
}

function renderValidade(v) {
  const sel = $('#online-validade');
  if (!sel || !v || document.activeElement === sel) return;
  const chave = `${v.dias}|${(v.opcoes || []).join(',')}`;
  if (sel.dataset.chave === chave) return;
  sel.dataset.chave = chave;
  sel.textContent = '';
  for (const d of v.opcoes || []) {
    const opt = document.createElement('option');
    opt.value = String(d);
    opt.textContent = textoDias(d);
    opt.selected = d === v.dias;
    sel.appendChild(opt);
  }
}

$('#online-validade')?.addEventListener('change', async (e) => {
  const dias = Number(e.target.value);
  const res = await api('/online', { method: 'POST', body: { validadeDias: dias } });
  if (res.ok) {
    e.target.blur();
    renderOnline(res.online);
  }
});

function renderAparelhos(o) {
  const box = $('#online-aparelhos-box');
  box.hidden = !o.ativo;
  renderValidade(o.validade);
  const lista = o.aparelhos || [];
  const chave = JSON.stringify(lista);
  if (chave === aparelhosRenderizados) return;
  aparelhosRenderizados = chave;
  const ul = $('#online-aparelhos');
  ul.textContent = '';
  if (!lista.length) {
    const li = document.createElement('li');
    li.className = 'ap-vazio';
    li.textContent = 'Nenhum dispositivo confiável ainda.';
    ul.appendChild(li);
    return;
  }
  for (const a of lista) {
    const li = document.createElement('li');
    const info = document.createElement('div');
    info.className = 'ap-info';
    const nome = document.createElement('div');
    nome.className = 'ap-nome';
    nome.textContent = a.nome;
    const det = document.createElement('div');
    det.className = 'ap-det';
    det.append(`Autorizado em ${fmtDataHora(a.criado_em)} · `);
    const vence = document.createElement('span');
    const restaMs = new Date(a.expira_em).getTime() - Date.now();
    if (restaMs < 3 * 24 * 60 * 60 * 1000) vence.className = 'ap-vence';
    vence.textContent = `válido até ${fmtDataHora(a.expira_em)}`;
    det.append(vence, ` · último uso ${fmtDataHora(a.ultimo_uso)}`);
    info.append(nome, det);
    const renov = document.createElement('button');
    renov.type = 'button';
    renov.className = 'btn-outline small';
    renov.textContent = 'Renovar';
    renov.title = 'Estende a validade a partir de agora';
    renov.addEventListener('click', async () => {
      const dias = Number($('#online-validade')?.value) || o.validade?.dias;
      if (!confirm(`Renovar "${a.nome}" por mais ${textoDias(dias)} a partir de agora?`)) return;
      const res = await api('/online', { method: 'POST', body: { renovar: a.id } });
      if (res.ok) renderOnline(res.online);
    });
    const ren = document.createElement('button');
    ren.type = 'button';
    ren.className = 'btn-outline small';
    ren.textContent = 'Renomear';
    ren.addEventListener('click', async () => {
      const novo = prompt('Nome do aparelho (ex.: Celular do João):', a.nome);
      if (!novo || !novo.trim()) return;
      const res = await api('/online', { method: 'POST', body: { renomear: a.id, nome: novo.trim() } });
      if (res.ok) renderOnline(res.online);
    });
    const rem = document.createElement('button');
    rem.type = 'button';
    rem.className = 'btn-outline small';
    rem.textContent = 'Remover';
    rem.addEventListener('click', async () => {
      if (!confirm(`Remover "${a.nome}"? Ele perde o acesso online na hora e precisará ler o QR Code de novo.`)) return;
      const res = await api('/online', { method: 'POST', body: { revogar: a.id } });
      if (res.ok) renderOnline(res.online);
    });
    li.append(info, renov, ren, rem);
    ul.appendChild(li);
  }
}

async function refreshOnline() {
  const res = await api('/online');
  if (res.ok) renderOnline(res.online);
}

$('#chk-online')?.addEventListener('change', async (e) => {
  const ativo = !!e.target.checked;
  if (ativo && !confirm('Ligar o acesso pela internet? Os aparelhos autorizados pelo QR Code desta tela poderão entrar de fora da loja, com usuário e senha do painel.')) {
    e.target.checked = false;
    return;
  }
  e.target.disabled = true;
  const res = await api('/online', { method: 'POST', body: { ativo } });
  e.target.disabled = false;
  if (res.ok) renderOnline(res.online);
  setTimeout(refreshOnline, 2500);
});

$('#btn-online-novo')?.addEventListener('click', async () => {
  if (!confirm('Gerar um novo endereço online? O link atual para de funcionar e TODOS os aparelhos autorizados são removidos (precisarão ler o QR Code novo).')) return;
  const res = await api('/online', { method: 'POST', body: { novoEndereco: true } });
  if (res.ok) renderOnline(res.online);
  setTimeout(refreshOnline, 2500);
});

(async function boot() {
  await refreshNetwork();
  await refreshOnline();
  setInterval(refreshOnline, 3000);
  await loadBanco();
  await loadSobre();
  // Primeira consulta ao servidor de licenças roda logo após abrir: acompanha de perto até ter resposta.
  for (let i = 0; i < 15; i++) {
    const l = await refreshLicenca();
    if (l && l.status !== 'verificando') break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  setInterval(refreshNetwork, 15000);
  setInterval(refreshLicenca, 30000);
})();
