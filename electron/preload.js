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

contextBridge.exposeInMainWorld("lan", {
  create: (opts) => ipcRenderer.invoke("lan:create", opts),
  find: () => ipcRenderer.invoke("lan:find"),
  stopFind: () => ipcRenderer.invoke("lan:stopFind"),
  join: (session, opts) => ipcRenderer.invoke("lan:join", session, opts),
  setColor: (c) => ipcRenderer.invoke("lan:setColor", c),
  setName: (n) => ipcRenderer.invoke("lan:setName", n),
  setMatch: (cfg) => ipcRenderer.invoke("lan:setMatch", cfg),
  returnLobby: () => ipcRenderer.invoke("lan:returnLobby"),
  setReady: (r) => ipcRenderer.invoke("lan:setReady", r),
  sendInput: (dir) => ipcRenderer.invoke("lan:sendInput", dir),
  sendState: (snap) => ipcRenderer.invoke("lan:sendState", snap),
  leave: () => ipcRenderer.invoke("lan:leave"),
  on: (cb) => ipcRenderer.on("lan:event", (_e, msg) => cb(msg)),
});
