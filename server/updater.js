'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');
const { app, dialog, BrowserWindow, shell } = require('electron');
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

function httpsDownload(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const follow = (u, redirects = 0) => {
      if (redirects > 8) return reject(new Error('Muitos redirecionamentos'));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const file = fs.createWriteStream(dest);
      const cleanup = () => {
        try { file.close(); } catch { /* ignore */ }
        try { fs.unlinkSync(dest); } catch { /* ignore */ }
      };
      const req = https.get(u, {
        headers: { 'User-Agent': 'GestorEstoque-Updater' },
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          cleanup();
          follow(res.headers.location, redirects + 1);
          res.resume();
          return;
        }
        if (res.statusCode && res.statusCode >= 400) {
          cleanup();
          reject(new Error(`Download HTTP ${res.statusCode}`));
          return;
        }
        const total = Number(res.headers['content-length'] || 0);
        let received = 0;
        res.on('data', (chunk) => {
          received += chunk.length;
          if (onProgress && total) onProgress(received / total);
        });
        res.on('error', (err) => {
          cleanup();
          reject(err);
        });
        file.on('error', (err) => {
          cleanup();
          reject(err);
        });
        res.pipe(file);
        file.on('finish', () => {
          file.close((err) => {
            if (err) {
              cleanup();
              reject(err);
              return;
            }
            try {
              const st = fs.statSync(dest);
              if (!st.size) {
                cleanup();
                reject(new Error('Arquivo baixado está vazio'));
                return;
              }
            } catch (e) {
              reject(e);
              return;
            }
            resolve(dest);
          });
        });
      });
      req.on('error', (err) => {
        cleanup();
        reject(err);
      });
    };
    follow(url);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function launchInstaller(exePath) {
  if (!fs.existsSync(exePath)) {
    throw new Error(`Instalador não encontrado: ${exePath}`);
  }

  // Pequena pausa para o Windows liberar o arquivo após o download
  await sleep(600);

  // 1) API nativa do Electron (mais estável no Windows)
  try {
    const openErr = await shell.openPath(exePath);
    if (!openErr) return { ok: true, method: 'openPath' };
  } catch {
    /* tenta próximo */
  }

  // 2) start via cmd (evita EACCES do spawn direto em alguns PCs)
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(
        process.env.ComSpec || 'cmd.exe',
        ['/d', '/s', '/c', `start "" "${exePath}"`],
        {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          shell: false,
        }
      );
      child.once('error', reject);
      child.unref();
      setTimeout(resolve, 400);
    });
    return { ok: true, method: 'cmd-start' };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
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

async function fetchReleaseAssetByTag(version) {
  const tag = String(version || '').replace(/^v/i, '').trim();
  if (!tag) return null;
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/releases/tags/v${tag}`;
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
  const gitVersion = String(remotePkg.version || '').trim() || '0.0.0';

  // Preferência: release com a mesma versão do package.json da main
  let release = await fetchReleaseAssetByTag(gitVersion);
  let exactReleaseMissing = !release?.asset;

  // Fallback: latest só se for MAIS NOVA que a instalada (nunca mascara código novo sem instalador)
  if (!release?.asset) {
    const latest = await fetchLatestReleaseAsset();
    if (latest?.asset && cmpVersion(latest.tag, localVersion) > 0) {
      release = latest;
    } else if (!release && latest) {
      release = latest;
    }
  }

  const hasInstallerNewer = !!(release?.asset && cmpVersion(release.tag, localVersion) > 0);
  const gitNewer = cmpVersion(gitVersion, localVersion) > 0;
  // Código no Git à frente, mas sem .exe no Release dessa versão
  const pendingPublish = gitNewer && exactReleaseMissing && !hasInstallerNewer;

  return {
    available: hasInstallerNewer,
    pendingPublish,
    localVersion,
    remoteVersion: hasInstallerNewer ? release.tag : gitVersion,
    gitVersion,
    release,
    downloadUrl: hasInstallerNewer ? release.asset.url : null,
    assetName: hasInstallerNewer ? release.asset.name : null,
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
    if (info.pendingPublish) {
      const win = parentWindow && !parentWindow.isDestroyed() ? parentWindow : BrowserWindow.getFocusedWindow();
      await dialog.showMessageBox(win || undefined, {
        type: 'warning',
        buttons: ['OK'],
        defaultId: 0,
        title: 'Instalador ainda não publicado',
        message: `Há versão ${info.gitVersion} no GitHub, mas o instalador ainda não foi publicado.`,
        detail: [
          `Versão instalada: ${info.localVersion}`,
          `Versão no package.json (main): ${info.gitVersion}`,
          '',
          'No PC de build (Windows):',
          '1) git pull',
          '2) npm run build',
          `3) Criar Release v${info.gitVersion} anexando dist\\GestorEstoque-Setup-${info.gitVersion}.exe`,
        ].join('\n'),
        noLink: true,
      });
      return { ok: true, updated: false, pendingPublish: true, info };
    }
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

  const updatesDir = path.join(app.getPath('userData'), 'updates');
  fs.mkdirSync(updatesDir, { recursive: true });
  const dest = path.join(updatesDir, info.assetName || 'GestorEstoque-Setup.exe');

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

  let launched = false;
  try {
    const launch = await launchInstaller(dest);
    launched = !!launch.ok;
    if (!launch.ok) throw new Error(launch.error || 'Falha ao abrir o instalador');
  } catch (err) {
    const { response: r2 } = await dialog.showMessageBox(win || undefined, {
      type: 'warning',
      buttons: ['Abrir pasta do instalador', 'OK'],
      defaultId: 0,
      cancelId: 1,
      title: 'Atualização baixada',
      message: 'O download concluiu, mas não foi possível iniciar o instalador automaticamente.',
      detail: `${err.message || err}\n\nArquivo:\n${dest}\n\nAbra a pasta e execute o instalador manualmente.`,
      noLink: true,
    });
    if (r2 === 0) {
      try { shell.showItemInFolder(dest); } catch { /* ignore */ }
    }
    return { ok: true, updated: false, manual: true, path: dest, info };
  }

  // Só encerra se o instalador abriu de fato
  if (launched) {
    setTimeout(() => {
      try { app.quit(); } catch { /* ignore */ }
    }, 800);
  }
  return { ok: true, updated: true, info, path: dest };
}

module.exports = {
  cmpVersion,
  checkForGitUpdate,
  promptAndUpdate,
  getLocalVersion,
  GH_OWNER,
  GH_REPO,
};
