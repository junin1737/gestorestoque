'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  openFile: (options) => ipcRenderer.invoke('dialog:openFile', options),
  isElectron: true,
});
