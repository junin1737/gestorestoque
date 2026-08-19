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
  ['conexao', 'banco', 'fiscal', 'sobre'].forEach((p) => {
    const el = $(`#panel-${p}`);
    if (el) el.hidden = p !== name;
  });
  if (name === 'fiscal') loadFiscal();
}

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
}

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
  window.open(url, '_blank');
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
        status.textContent = `Você já está na versão mais recente (${res.info.localVersion}).`;
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

(async function boot() {
  await refreshNetwork();
  await loadBanco();
  await loadSobre();
  setInterval(refreshNetwork, 15000);
})();
