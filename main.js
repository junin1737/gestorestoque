'use strict';
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');

process.env.GESTOR_PACKAGED = app.isPackaged ? '1' : '0';
process.env.GESTOR_RESOURCES = process.resourcesPath || path.join(__dirname);

const { ensureFirebirdClientPath } = require('./server/nativePath');
ensureFirebirdClientPath();

const { promptAndUpdate, checkForGitUpdate, getLocalVersion } = require('./server/updater');

const PORT = 5077;
let mainWindow;
let updateCheckStarted = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

require('./server/index.js');

ipcMain.handle('dialog:openFile', async (_e, options) => {
  const result = await dialog.showOpenDialog(mainWindow, options || {
    properties: ['openFile'],
    filters: [{ name: 'Firebird', extensions: ['fdb', 'FDB'] }],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('app:quit', () => {
  app.quit();
});

ipcMain.handle('app:getVersion', () => getLocalVersion());

ipcMain.handle('app:getOpenAtLogin', () => {
  const s = app.getLoginItemSettings();
  return { openAtLogin: !!s.openAtLogin, executableWillLaunchAtLogin: !!s.executableWillLaunchAtLogin };
});

ipcMain.handle('app:setOpenAtLogin', (_e, enabled) => {
  app.setLoginItemSettings({
    openAtLogin: !!enabled,
    path: process.execPath,
    args: [],
  });
  const s = app.getLoginItemSettings();
  return { ok: true, openAtLogin: !!s.openAtLogin };
});

ipcMain.handle('app:checkUpdate', async (_e, { silent } = {}) => {
  if (silent) {
    try {
      return { ok: true, ...(await checkForGitUpdate()) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  return promptAndUpdate(mainWindow);
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 900,
    minHeight: 640,
    autoHideMenuBar: true,
    title: 'Gestor Estoque — Serviço',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (!updateCheckStarted) {
      updateCheckStarted = true;
      // Aguarda a UI carregar e consulta o GitHub
      setTimeout(() => {
        promptAndUpdate(mainWindow).catch(() => {});
      }, 1800);
    }
  });

  const serviceUrl = `http://127.0.0.1:${PORT}/servico.html`;
  const tryLoad = (attempts) => {
    const http = require('http');
    const req = http.get(`http://127.0.0.1:${PORT}/api/health`, () => {
      mainWindow.loadURL(serviceUrl);
    });
    req.on('error', () => {
      if (attempts > 0) setTimeout(() => tryLoad(attempts - 1), 400);
      else mainWindow.loadURL(serviceUrl);
    });
    req.end();
  };
  tryLoad(30);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

if (gotLock) {
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
