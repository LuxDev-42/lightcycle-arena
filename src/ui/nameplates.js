// Balões "quem é quem" no início do round: acima de cada humano — P1/P2 com os
// controles (WASD/setas) no local; nome (+ "você") no LAN. Camada DOM por cima de
// tudo, posicionada a cada frame (filosofia select: vira cima/baixo, clamp na tela);
// some via opacidade. Só aparece durante uma partida de fato.
import { state } from "../core/state.js";
import { app } from "../core/app.js";
import { el } from "./dom.js";
import { renderer } from "../engines.js";
import { CELL, COUNTDOWN_MS } from "../core/config.js";
import { playerUsesGamepad } from "../input/input.js";
import { KB_ICON, PAD_ICON } from "./icons.js";

const NAMEPLATE_MS = COUNTDOWN_MS + 600;   // dura a contagem + um respiro, com fade no fim
let nameplateEls = [];

// `lanLocalSlot`: índice do jogador local numa partida LAN; `null` no local (SP/MP local).
export function setNameplates(lanLocalSlot = null) {
  for (const p of state.players) { p.tag = null; p.tagKeys = null; }
  if (lanLocalSlot != null) {
    state.players.forEach((p, i) => { if (!p.isAI) p.tag = p.label + (i === lanLocalSlot ? " · você" : ""); });
  } else {   // local: cpu = "Você"; multiplayer local = P1..PN (teclado P1/P2; gamepad P3/P4)
    const solo = state.mode === "cpu";
    state.players.forEach((p, i) => {
      if (p.isAI) return;
      p.tag = solo ? "Você" : `P${i + 1}`;
      // teclas do i-ésimo humano: P1=WASD, P2=setas, P3+ só gamepad; ou "controle" se num gamepad
      p.tagKeys = playerUsesGamepad(i) ? "gamepad" : (i === 0 ? "wasd" : i === 1 ? "arrows" : "gamepad");
    });
  }
  state.nameplateTimer = NAMEPLATE_MS;
  buildNameplates();
}

// Cria os elementos DOM dos balões (um por jogador com tag). Posicionados a cada frame.
function buildNameplates() {
  el.nameplates.innerHTML = "";
  nameplateEls = [];
  el.nameplates.style.opacity = "0";
  state.players.forEach((p, i) => {
    if (!p.tag) return;
    const np = document.createElement("div");
    np.className = "nameplate";
    np.style.setProperty("--pc", p.color);
    const label = document.createElement("div"); label.className = "np-label"; label.textContent = p.tag;
    np.appendChild(label);
    if (p.tagKeys) {
      const row = document.createElement("div"); row.className = "np-keys";
      if (p.tagKeys === "gamepad") {
        row.innerHTML = PAD_ICON;   // ícone de controle
      } else {
        const keys = p.tagKeys === "wasd" ? ["W", "A", "S", "D"] : ["↑", "←", "↓", "→"];
        row.innerHTML = KB_ICON + keys.map((k) => `<kbd>${k}</kbd>`).join("");   // ícone de teclado + teclas
      }
      np.appendChild(row);
    }
    el.nameplates.appendChild(np);
    nameplateEls.push({ el: np, i });
  });
}

// Posiciona os balões a cada frame (segue a moto; vira pra baixo se não couber em
// cima; nunca sai da tela na horizontal). Só durante uma partida (nunca menu/resultado/pausa).
export function updateNameplates() {
  if (!nameplateEls.length) return;
  const inMatch = app.running && !app.paused && (state.phase === "countdown" || state.phase === "playing" || state.phase === "dying");
  if (!inMatch || state.nameplateTimer <= 0) { el.nameplates.style.opacity = "0"; return; }
  el.nameplates.style.opacity = String(Math.min(1, state.nameplateTimer / 600));   // fade nos últimos 600ms
  const viewportWidth = window.innerWidth;
  for (const np of nameplateEls) {
    const p = state.players[np.i];
    if (!p || !p.alive) { np.el.style.display = "none"; continue; }
    np.el.style.display = "";
    const progress = p.progress || 0;
    const worldX = (p.prevX + (p.x - p.prevX) * progress + 0.5) * CELL;
    const worldY = (p.prevY + (p.y - p.prevY) * progress + 0.5) * CELL;
    const screen = renderer.worldToScreen(worldX, worldY);
    const width = np.el.offsetWidth, height = np.el.offsetHeight;
    const gap = 22, topMargin = 44;
    const below = (screen.y - gap - height) < topMargin;                 // pouco respiro no topo → vira pra baixo
    np.el.classList.toggle("below", below);
    np.el.style.left = Math.max(width / 2 + 6, Math.min(viewportWidth - width / 2 - 6, screen.x)) + "px";   // clamp horizontal
    np.el.style.top = (below ? screen.y + gap : screen.y - gap) + "px";
  }
}

export function hideNameplates() { if (el.nameplates) el.nameplates.style.opacity = "0"; }
