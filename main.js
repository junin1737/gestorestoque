'use strict';
const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, shell } = require('electron');
const path = require('path');

const NOME_APP = (() => {
  try {
    return require('./server/edicao').NOME;
  } catch {
    return 'Gestor Estoque';
  }
})();
/** Aberto pelo Windows ao ligar o computador: começa direto na bandeja, sem janela. */
const ARG_OCULTO = '--oculto';
const iniciouOculto = process.argv.includes(ARG_OCULTO);

process.env.GESTOR_PACKAGED = app.isPackaged ? '1' : '0';
process.env.GESTOR_RESOURCES = process.resourcesPath || path.join(__dirname);

const { ensureFirebirdClientPath } = require('./server/nativePath');
ensureFirebirdClientPath();

const { promptAndUpdate, checkForGitUpdate, getLocalVersion } = require('./server/updater');

const { PORT } = require('./server/config');
let mainWindow;
let tray = null;
let encerrando = false;
let avisouBandeja = false;
let updateCheckStarted = false;

function mostrarJanela() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function encerrarApp() {
  encerrando = true;
  app.quit();
}

function esconderNaBandeja() {
  if (!mainWindow) return;
  mainWindow.hide();
  if (!avisouBandeja && tray) {
    avisouBandeja = true;
    try {
      tray.displayBalloon({
        iconType: 'info',
        title: NOME_APP,
        content: 'O servidor continua funcionando aqui, perto do relógio. Clique com o botão direito para abrir ou encerrar.',
      });
    } catch { /* balão é opcional */ }
  }
}

function criarBandeja() {
  tray = new Tray(path.join(__dirname, 'Painel', 'icons', 'favicon.ico'));
  tray.setToolTip(`${NOME_APP} — servidor em execução`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Restaurar janela', click: mostrarJanela },
    { type: 'separator' },
    { label: 'Encerrar', click: encerrarApp },
  ]));
  tray.on('click', mostrarJanela);
  tray.on('double-click', mostrarJanela);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', mostrarJanela);
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
  encerrarApp();
});

ipcMain.handle('app:getVersion', () => getLocalVersion());

/** O Windows guarda a entrada com os argumentos: a leitura precisa usar os mesmos. */
const itemLogin = { path: process.execPath, args: [ARG_OCULTO] };
const itemLoginAntigo = { path: process.execPath, args: [] };

function iniciaComWindows() {
  return !!app.getLoginItemSettings(itemLogin).openAtLogin;
}

function definirIniciarComWindows(ativo) {
  app.setLoginItemSettings({ ...itemLoginAntigo, openAtLogin: false });
  app.setLoginItemSettings({ ...itemLogin, openAtLogin: !!ativo });
  return iniciaComWindows();
}

ipcMain.handle('app:getOpenAtLogin', () => ({ openAtLogin: iniciaComWindows() }));

ipcMain.handle('app:setOpenAtLogin', (_e, enabled) => ({ ok: true, openAtLogin: definirIniciarComWindows(enabled) }));

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
    icon: path.join(__dirname, 'Painel', 'icons', 'icon-512.png'),
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.on('close', (e) => {
    if (encerrando) return;
    e.preventDefault();
    esconderNaBandeja();
  });
  mainWindow.on('minimize', (e) => {
    e.preventDefault();
    esconderNaBandeja();
  });

  mainWindow.once('ready-to-show', () => {
    if (!iniciouOculto) mainWindow.show();
    if (!updateCheckStarted) {
      updateCheckStarted = true;
      setTimeout(() => {
        promptAndUpdate(mainWindow.isVisible() ? mainWindow : null).catch((err) => {
          console.warn('Falha na verificação de atualização:', err?.message || err);
        });
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
  // Evita fechar o app por erro não tratado no spawn do instalador
  process.on('uncaughtException', (err) => {
    console.error('uncaughtException:', err);
    try {
      dialog.showErrorBox(
        'Gestor Estoque',
        `Ocorreu um erro inesperado, mas o serviço continua.\n\n${err && err.message ? err.message : err}`
      );
    } catch { /* ignore */ }
  });

  app.on('before-quit', () => { encerrando = true; });
  app.whenReady().then(() => {
    // Quem já tinha ativado antes: passa a abrir direto na bandeja.
    if (app.getLoginItemSettings(itemLoginAntigo).openAtLogin) definirIniciarComWindows(true);
    criarBandeja();
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
