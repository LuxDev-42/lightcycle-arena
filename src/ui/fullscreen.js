// Tela cheia (toggle no menu de Gráficos). No app (Electron) usa o fullscreen
// NATIVO da janela: abre em tela cheia por default e o ESC NÃO sai dela — fica
// livre pro "voltar/pausar" do jogo. No browser cai na Fullscreen API padrão
// (onde o ESC sai, sem como evitar).
import { el } from "./dom.js";

function fsElement() { return document.fullscreenElement || document.webkitFullscreenElement; }
function setFsSwitch(on) {
  el.btnFullscreen.classList.toggle("on", !!on);     // bolinha p/ a direita quando ligado
  el.btnFullscreen.setAttribute("aria-checked", on ? "true" : "false");
}
export async function toggleFullscreen() {
  if (window.electronFS) { setFsSwitch(await window.electronFS.toggle()); return; }
  if (fsElement()) { (document.exitFullscreen || document.webkitExitFullscreen)?.call(document); return; }
  const root = document.documentElement;
  const req = (root.requestFullscreen || root.webkitRequestFullscreen)?.call(root);
  if (req && req.catch) req.catch(() => {});
}
export async function syncFullscreenLabel() {
  if (window.electronFS) { setFsSwitch(await window.electronFS.isFullscreen()); return; }
  setFsSwitch(!!fsElement());
}
