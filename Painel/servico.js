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
  ['conexao', 'banco', 'sobre'].forEach((p) => {
    const el = $(`#panel-${p}`);
    if (el) el.hidden = p !== name;
  });
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
  $('#cfg-user').value = cfg.user || 'SYSDBA';
  $('#cfg-password').value = '';
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
    user: $('#cfg-user').value.trim(),
    password: $('#cfg-password').value,
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
