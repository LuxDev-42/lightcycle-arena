// Cores das motos e sincronização da UI de cores. P1/P2 vêm dos sliders de matiz;
// CPUs extras ganham matizes espalhadas; o ARES é sempre vermelho.
import { el } from "./dom.js";
import { ARES_HUE } from "../core/config.js";

export function hueColor(hue) { return `hsl(${hue}, 100%, 60%)`; }
export function hueGlow(hue)  { return `hsla(${hue}, 100%, 60%, 0.9)`; }

let playerColors = [hueColor(190), hueColor(30)];   // só p/ os swatches; o resto vem de skinForIndex
export function getPlayerColors() { return playerColors; }

export function applyColors() {
  playerColors = [hueColor(+el.hue1.value), hueColor(+el.hue2.value)];
}

// Reflete as cores escolhidas em toda a UI (título, swatches, ícone de Cores,
// thumbs dos sliders e os botões 1/2 Jogadores, que herdam o tom do P1/P2).
export function refreshColorUI() {
  applyColors();
  const title1Els = document.querySelectorAll(".title-1");
  const title2Els = document.querySelectorAll(".title-2");
  el.sw1.style.background = playerColors[0];
  el.sw1.style.boxShadow = `0 0 8px ${playerColors[0]}`;
  el.sw2.style.background = playerColors[1];
  el.sw2.style.boxShadow = `0 0 8px ${playerColors[1]}`;
  if (el.cdot1) { el.cdot1.style.background = playerColors[0]; el.cdot1.style.boxShadow = `0 0 6px ${playerColors[0]}`; }
  if (el.cdot2) { el.cdot2.style.background = playerColors[1]; el.cdot2.style.boxShadow = `0 0 6px ${playerColors[1]}`; }
  el.hue1.style.setProperty("--thumb", playerColors[0]);
  el.hue2.style.setProperty("--thumb", playerColors[1]);
  for (const e of title1Els) { e.style.color = playerColors[0]; e.style.textShadow = `0 0 12px ${playerColors[0]}, 0 0 30px ${playerColors[0]}`; }
  for (const e of title2Els) { e.style.color = playerColors[1]; e.style.textShadow = `0 0 12px ${playerColors[1]}, 0 0 30px ${playerColors[1]}`; }
  if (el.btnCpu) el.btnCpu.style.setProperty("--cyan", playerColors[0]);
  if (el.btn2p) el.btn2p.style.setProperty("--orange", playerColors[1]);
  // "Entrar numa sala" (Encontrar sessão + entradas da lista) segue a cor do P1
  if (el.btnLanFind) el.btnLanFind.style.setProperty("--cyan", playerColors[0]);
  if (el.lanFind) el.lanFind.style.setProperty("--cyan", playerColors[0]);
}

// Matiz de cada moto: P1/P2 dos sliders; CPUs extras espalhadas pelo círculo.
export function hueForIndex(i, total) {
  if (i === 0) return +el.hue1.value;
  if (i === 1) return +el.hue2.value;
  const extras = Math.max(1, total - 2);
  return Math.round(((i - 2) + 0.5) / extras * 360);
}
export function skinForIndex(i, total) {
  const hue = hueForIndex(i, total);
  return { color: hueColor(hue), glow: hueGlow(hue), hue };
}
export function aresSkin() { return { color: hueColor(ARES_HUE), glow: hueGlow(ARES_HUE), hue: ARES_HUE }; }
