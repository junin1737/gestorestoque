'use strict';
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');

const PORT = 5077;
let mainWindow;

require('./server/index.js');

ipcMain.handle('dialog:openFile', async (_e, options) => {
  const result = await dialog.showOpenDialog(mainWindow, options || {
    properties: ['openFile'],
    filters: [{ name: 'Firebird', extensions: ['fdb', 'FDB'] }],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    autoHideMenuBar: true,
    title: 'Gestor Estoque - MT Automações',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  const tryLoad = (attempts) => {
    const http = require('http');
    const req = http.get(`http://127.0.0.1:${PORT}`, () => {
      mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
    });
    req.on('error', () => {
      if (attempts > 0) setTimeout(() => tryLoad(attempts - 1), 400);
      else mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
    });
    req.end();
  };
  tryLoad(20);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
