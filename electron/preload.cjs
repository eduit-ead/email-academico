const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('consultaApi', {
  consultar: (cpf) => ipcRenderer.invoke('consultar', cpf),
  chromeInstalado: () => ipcRenderer.invoke('chrome-instalado'),
  modoSimulacaoUi: () => ipcRenderer.invoke('modo-simulacao-ui'),
  simularResultado: (status) => ipcRenderer.invoke('simular-resultado', status),
});
