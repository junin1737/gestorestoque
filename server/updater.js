'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');
const { app, dialog, BrowserWindow } = require('electron');
const { spawn } = require('child_process');

const GH_OWNER = 'junin1737';
const GH_REPO = 'gestorestoque';
const GH_BRANCH = 'main';

function cmpVersion(a, b) {
  const pa = String(a || '0').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d > 0) return 1;
    if (d < 0) return -1;
  }
  return 0;
}

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'GestorEstoque-Updater',
        Accept: 'application/vnd.github+json',
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpsGetJson(res.headers.location).then(resolve, reject);
        res.resume();
        return;
      }
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => {
      req.destroy(new Error('Timeout ao consultar GitHub'));
    });
  });
}

function httpsDownload(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const follow = (u, redirects = 0) => {
      if (redirects > 8) return reject(new Error('Muitos redirecionamentos'));
      const file = fs.createWriteStream(dest);
      const req = https.get(u, {
        headers: { 'User-Agent': 'GestorEstoque-Updater' },
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlink(dest, () => {});
          follow(res.headers.location, redirects + 1);
          res.resume();
          return;
        }
        if (res.statusCode && res.statusCode >= 400) {
          file.close();
          fs.unlink(dest, () => {});
          reject(new Error(`Download HTTP ${res.statusCode}`));
          return;
        }
        const total = Number(res.headers['content-length'] || 0);
        let received = 0;
        res.on('data', (chunk) => {
          received += chunk.length;
          if (onProgress && total) onProgress(received / total);
        });
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve(dest)));
      });
      req.on('error', (err) => {
        file.close();
        fs.unlink(dest, () => {});
        reject(err);
      });
    };
    follow(url);
  });
}

function httpsGetText(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'GestorEstoque-Updater' },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpsGetText(res.headers.location).then(resolve, reject);
        res.resume();
        return;
      }
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        resolve(data);
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => {
      req.destroy(new Error('Timeout ao consultar GitHub'));
    });
  });
}

async function fetchRemotePackageVersion() {
  const url = `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${GH_BRANCH}/package.json`;
  const text = await httpsGetText(url);
  const pkg = JSON.parse(text);
  return {
    version: String(pkg.version || '').trim(),
    name: pkg.name,
  };
}

async function fetchLatestReleaseAsset() {
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/releases/latest`;
  try {
    const release = await httpsGetJson(url);
    const assets = release.assets || [];
    const setup = assets.find((a) => /GestorEstoque-Setup-.*\.exe$/i.test(a.name))
      || assets.find((a) => /\.exe$/i.test(a.name));
    return {
      tag: String(release.tag_name || '').replace(/^v/i, ''),
      name: release.name || release.tag_name,
      body: release.body || '',
      htmlUrl: release.html_url,
      asset: setup
        ? {
          name: setup.name,
          url: setup.browser_download_url,
          size: setup.size,
        }
        : null,
    };
  } catch {
    return null;
  }
}

function getLocalVersion() {
  try {
    return app.getVersion();
  } catch {
    try {
      return require('../package.json').version;
    } catch {
      return '0.0.0';
    }
  }
}

async function checkForGitUpdate() {
  const localVersion = getLocalVersion();
  const remotePkg = await fetchRemotePackageVersion();
  const release = await fetchLatestReleaseAsset();

  const candidates = [remotePkg.version, release?.tag].filter(Boolean);
  let remoteVersion = remotePkg.version || '0.0.0';
  for (const v of candidates) {
    if (cmpVersion(v, remoteVersion) > 0) remoteVersion = v;
  }

  const available = cmpVersion(remoteVersion, localVersion) > 0;
  return {
    available,
    localVersion,
    remoteVersion,
    gitVersion: remotePkg.version,
    release,
    downloadUrl: release?.asset?.url || null,
    assetName: release?.asset?.name || null,
  };
}

async function promptAndUpdate(parentWindow) {
  let info;
  try {
    info = await checkForGitUpdate();
  } catch (err) {
    return { ok: false, skipped: true, error: err.message };
  }

  if (!info.available) {
    return { ok: true, updated: false, info };
  }

  const win = parentWindow && !parentWindow.isDestroyed() ? parentWindow : BrowserWindow.getFocusedWindow();
  const detail = [
    `Versão instalada: ${info.localVersion}`,
    `Versão no GitHub: ${info.remoteVersion}`,
    info.downloadUrl
      ? 'Ao confirmar, o instalador será baixado e a atualização iniciará automaticamente.'
      : 'Há versão nova no Git, mas o instalador ainda não foi publicado em Releases. Avise a MT Automações.',
  ].join('\n');

  const { response } = await dialog.showMessageBox(win || undefined, {
    type: 'info',
    buttons: info.downloadUrl ? ['Sim, atualizar', 'Agora não'] : ['OK'],
    defaultId: 0,
    cancelId: info.downloadUrl ? 1 : 0,
    title: 'Atualização disponível',
    message: 'Existe uma nova versão do Gestor Estoque. Deseja atualizar agora?',
    detail,
    noLink: true,
  });

  if (!info.downloadUrl || response !== 0) {
    return { ok: true, updated: false, declined: true, info };
  }

  const tmpDir = app.getPath('temp');
  const dest = path.join(tmpDir, info.assetName || 'GestorEstoque-Setup.exe');

  const progressWin = new BrowserWindow({
    width: 420,
    height: 140,
    resizable: false,
    minimizable: false,
    maximizable: false,
    parent: win || undefined,
    modal: !!win,
    autoHideMenuBar: true,
    title: 'Atualizando…',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  progressWin.setMenuBarVisibility(false);
  const html = encodeURIComponent(`<!doctype html><html><body style="font-family:Segoe UI,sans-serif;padding:20px;color:#152033">
    <h3 style="margin:0 0 10px">Baixando atualização…</h3>
    <div id="p">0%</div>
    <div style="height:10px;background:#e5eaf1;border-radius:6px;overflow:hidden;margin-top:10px">
      <div id="b" style="height:100%;width:0;background:#2f6fed"></div>
    </div>
  </body></html>`);
  await progressWin.loadURL(`data:text/html;charset=utf-8,${html}`);

  try {
    await httpsDownload(info.downloadUrl, dest, async (pct) => {
      const p = Math.round(pct * 100);
      try {
        await progressWin.webContents.executeJavaScript(
          `document.getElementById('p').textContent='${p}%';document.getElementById('b').style.width='${p}%';`
        );
      } catch { /* ignore */ }
    });
  } catch (err) {
    try { progressWin.close(); } catch { /* ignore */ }
    await dialog.showMessageBox(win || undefined, {
      type: 'error',
      title: 'Falha no download',
      message: 'Não foi possível baixar a atualização.',
      detail: err.message,
    });
    return { ok: false, error: err.message, info };
  }

  try { progressWin.close(); } catch { /* ignore */ }

  // Inicia o instalador e encerra o app para liberar arquivos
  spawn(dest, [], { detached: true, stdio: 'ignore' }).unref();
  setTimeout(() => app.quit(), 400);
  return { ok: true, updated: true, info };
}

module.exports = {
  cmpVersion,
  checkForGitUpdate,
  promptAndUpdate,
  getLocalVersion,
  GH_OWNER,
  GH_REPO,
};
