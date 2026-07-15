// Balões "quem é quem" no início do round: acima de cada humano — P1/P2 com os
// controles (WASD/setas) no local; nome (+ "você") no LAN. Camada DOM por cima de
// tudo, posicionada a cada frame (filosofia select: vira cima/baixo, clamp na tela);
// some via opacidade. Só aparece durante uma partida de fato.
import { state } from "../core/state.js";
import { app } from "../core/app.js";
import { el } from "./dom.js";
import { renderer } from "../engines.js";
import { CELL, COUNTDOWN_MS } from "../core/config.js";

const NAMEPLATE_MS = COUNTDOWN_MS + 600;   // dura a contagem + um respiro, com fade no fim
let nameplateEls = [];

// Um jogador local está usando gamepad? (mesmo mapeamento do input: single = qualquer
// controle guia o P1; 2p = controle 0→P1, 1→P2). Reavaliado a cada round.
function gamepadForLocal(humanIndex) {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  if (state.mode === "cpu") return Array.from(pads).some(Boolean);
  return !!pads[humanIndex];
}

// `lanLocalSlot`: índice do jogador local numa partida LAN; `null` no local (SP/MP local).
export function setNameplates(lanLocalSlot = null) {
  for (const p of state.players) { p.tag = null; p.tagKeys = null; }
  if (lanLocalSlot != null) {
    state.players.forEach((p, i) => { if (!p.isAI) p.tag = p.label + (i === lanLocalSlot ? " · você" : ""); });
  } else if (state.mode === "2p") {
    if (state.players[0]) { state.players[0].tag = "P1"; state.players[0].tagKeys = gamepadForLocal(0) ? "gamepad" : "wasd"; }
    if (state.players[1]) { state.players[1].tag = "P2"; state.players[1].tagKeys = gamepadForLocal(1) ? "gamepad" : "arrows"; }
  } else if (state.players[0]) {
    state.players[0].tag = "Você"; state.players[0].tagKeys = gamepadForLocal(0) ? "gamepad" : "wasd";
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
        const kb = document.createElement("kbd"); kb.className = "np-pad"; kb.textContent = "controle"; row.appendChild(kb);
      } else {
        const keys = p.tagKeys === "wasd" ? ["W", "A", "S", "D"] : ["↑", "←", "↓", "→"];
        for (const k of keys) { const kb = document.createElement("kbd"); kb.textContent = k; row.appendChild(kb); }
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
