// Cores das motos + sincronização da UI. As cores dos HUMANOS (P1..P4) são escolhidas
// no lobby (um slider por jogador) e persistidas em localStorage. Os CPUs recebem cor
// aleatória na partida (main), e o ARES é sempre vermelho.
import { el } from "./dom.js";
import { ARES_HUE } from "../core/config.js";

export function hueColor(hue) { return `hsl(${hue}, 100%, 60%)`; }
export function hueGlow(hue)  { return `hsla(${hue}, 100%, 60%, 0.9)`; }

const HUES_KEY = "lc.humanHues";
const DEFAULT_HUES = [190, 30, 140, 280];   // P1 ciano · P2 laranja · P3 verde · P4 magenta
let humanHues = loadHues();
function loadHues() {
  try {
    const saved = JSON.parse(localStorage.getItem(HUES_KEY) || "null");
    if (Array.isArray(saved)) return DEFAULT_HUES.map((d, i) => (typeof saved[i] === "number" ? saved[i] : d));
  } catch {}
  return [...DEFAULT_HUES];
}
export function getHumanHue(i) { return humanHues[i] ?? DEFAULT_HUES[i] ?? 200; }
export function setHumanHue(i, hue) {
  humanHues[i] = ((Math.round(hue) % 360) + 360) % 360;
  try { localStorage.setItem(HUES_KEY, JSON.stringify(humanHues)); } catch {}
  refreshColorUI();
}

let playerColors = [hueColor(getHumanHue(0)), hueColor(getHumanHue(1))];
export function getPlayerColors() { return playerColors; }
export function applyColors() { playerColors = [hueColor(getHumanHue(0)), hueColor(getHumanHue(1))]; }

// Reflete as cores do P1/P2 na UI: título, botões 1 Jogador/Multiplayer e o tom da lista LAN.
export function refreshColorUI() {
  applyColors();
  for (const e of document.querySelectorAll(".title-1")) { e.style.color = playerColors[0]; e.style.textShadow = `0 0 12px ${playerColors[0]}, 0 0 30px ${playerColors[0]}`; }
  for (const e of document.querySelectorAll(".title-2")) { e.style.color = playerColors[1]; e.style.textShadow = `0 0 12px ${playerColors[1]}, 0 0 30px ${playerColors[1]}`; }
  if (el.btnCpu) el.btnCpu.style.setProperty("--cyan", playerColors[0]);
  if (el.btn2p) el.btn2p.style.setProperty("--orange", playerColors[1]);
  if (el.btnLanFind) el.btnLanFind.style.setProperty("--cyan", playerColors[0]);   // "Entrar numa sala" segue a cor do P1
  if (el.lanFind) el.lanFind.style.setProperty("--cyan", playerColors[0]);
}

export function hueForIndex(i) { return getHumanHue(i); }   // humanos: cor escolhida no lobby
export function skinForIndex(i) {
  const hue = hueForIndex(i);
  return { color: hueColor(hue), glow: hueGlow(hue), hue };
}
export function aresSkin() { return { color: hueColor(ARES_HUE), glow: hueGlow(ARES_HUE), hue: ARES_HUE }; }
