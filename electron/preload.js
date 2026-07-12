// Ponte mínima e segura (contextIsolation) pro renderer alternar a tela cheia
// nativa da janela do Electron. O jogo (src/main.js) usa window.electronFS se existir.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronFS", {
  toggle: () => ipcRenderer.invoke("fs-toggle"),
  isFullscreen: () => ipcRenderer.invoke("fs-is"),
});

contextBridge.exposeInMainWorld("electronApp", {
  quit: () => ipcRenderer.invoke("app-quit"),
});
