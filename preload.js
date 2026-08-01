'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  openFile: (options) => ipcRenderer.invoke('dialog:openFile', options),
  quit: () => ipcRenderer.invoke('app:quit'),
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getOpenAtLogin: () => ipcRenderer.invoke('app:getOpenAtLogin'),
  setOpenAtLogin: (enabled) => ipcRenderer.invoke('app:setOpenAtLogin', enabled),
  checkUpdate: (opts) => ipcRenderer.invoke('app:checkUpdate', opts || {}),
  isElectron: true,
});
