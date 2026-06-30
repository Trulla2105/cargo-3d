// preload.js — puente seguro entre la pantalla y la base de datos.
// Solo expone las funciones necesarias, nada mas.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('store:load'),
  save: (store) => ipcRenderer.invoke('store:save', store),
  exportBackup: () => ipcRenderer.invoke('backup:export'),
  dbInfo: () => ipcRenderer.invoke('db:info'),
  openDbFolder: () => ipcRenderer.invoke('db:openFolder'),
  pickExcel: () => ipcRenderer.invoke('excel:pick'),
  importExcel: (filePath) => ipcRenderer.invoke('excel:import', filePath),
  viewerWorkerCode: () => ipcRenderer.invoke('viewer:workerCode'),
  viewerTest: () => ipcRenderer.invoke('viewer:test'),
  viewerPhoneLink: () => ipcRenderer.invoke('viewer:phoneLink')
});
