// Input do jogador: teclado (WASD / setas) + toque (botões de virar). Converte
// tudo em steer() sobre o jogador humano. A navegação de menu é delegada ao
// menu-nav; o único callback de fluxo injetado é onEscape (sair/voltar).
import { state } from "./state.js";
import { app } from "./app.js";
import { audio, renderer, music } from "./engines.js";
import { DIRS, OPPOSITE } from "./config.js";
import { moveNav, navHorizontal, activateNav, isNavActive, refreshNav } from "./menu-nav.js";

const KEYMAP = {
  "w": [1, "up"], "a": [1, "left"], "s": [1, "down"], "d": [1, "right"],
  "arrowup": [2, "up"], "arrowleft": [2, "left"], "arrowdown": [2, "down"], "arrowright": [2, "right"],
};
const TURN_LEFT  = { up: "left", left: "down", down: "right", right: "up" };    // giro anti-horário (relativo ao rumo)
const TURN_RIGHT = { up: "right", right: "down", down: "left", left: "up" };    // giro horário (relativo ao rumo)

const heldKeys = new Set();        // teclas seguradas agora (p/ detectar o chord)
const isPlayable = () => state.phase === "playing" || state.phase === "dying";
const canSteer = () => isPlayable() || state.phase === "countdown";   // dá pra pré-virar na contagem

// Partida LAN: se setado, o steer local é roteado pra este handler (host aplica no
// próprio slot; cliente envia pro host) em vez de mexer direto no jogador local.
let lanSteer = null;
export function setLanSteer(fn) { lanSteer = fn; }

// Aplica uma direção ABSOLUTA a um jogador humano (teclado e toque).
function steer(playerId, dir) {
  if (!canSteer() || app.paused) return;
  if (lanSteer) { lanSteer(dir); return; }                   // partida LAN: roteia (host/rede)
  const player = state.players[playerId - 1];
  if (!player || !player.alive || player.isAI) return;
  if (dir !== OPPOSITE[player.dir]) player.nextDir = dir;     // sem ré
}
// Curva RELATIVA ao rumo atual (botões de toque): esquerda/direita = 90°.
function steerTurn(playerId, side) {
  const player = state.players[playerId - 1];
  if (!player) return;
  const base = player.nextDir || player.dir;
  steer(playerId, side === "left" ? TURN_LEFT[base] : TURN_RIGHT[base]);
}

let onEscape = () => {};
let teamSelectFn = null;
export function setTeamSelect(fn) { teamSelectFn = fn; }   // seleção de time (modo Times)

function onKeyDown(event) {
  const key = event.key.toLowerCase();
  audio.resume();   // tecla = gesto: destrava o contexto de áudio (sons de UI/jogo)

  const ae = document.activeElement;   // campo de texto focado (ex.: nome no lobby): deixa digitar
  if (ae && ae.tagName === "INPUT" && (ae.type === "text" || ae.type === "")) {
    if (key === "escape" || key === "enter") { event.preventDefault(); ae.blur(); }
    return;
  }

  heldKeys.add(key);
  if (event.ctrlKey && (key === "d" || key === "b")) {        // chord Ctrl+D+B → liga/desliga debug
    event.preventDefault();
    if (heldKeys.has("d") && heldKeys.has("b")) {
      app.debug = !app.debug;
      renderer.setDebug(app.debug);
      document.body.classList.toggle("debug", app.debug);   // mostra/esconde opções debug-only no menu
      refreshNav();                                          // re-filtra a nav (entra/sai o item debug-only)
      renderer.render(state);
    }
    return;                                                   // não trata Ctrl+D/Ctrl+B como input de jogo
  }
  if (key === "m") { audio.toggleMute(); return; }
  if (key === "escape") { onEscape(); return; }
  if (state.phase === "teamselect") {   // seleção de time: cada humano vai pra esquerda (A) ou direita (B)
    event.preventDefault();
    if (key === "enter" || key === " " || key === "spacebar") { teamSelectFn && teamSelectFn(0, "confirm"); return; }
    const b = KEYMAP[key];
    if (b) {
      let [pid, dir] = b;
      if (state.mode === "cpu" && pid === 2) pid = 1;   // no single, setas também são do P1
      if (dir === "left") teamSelectFn && teamSelectFn(pid, 0);
      else if (dir === "right") teamSelectFn && teamSelectFn(pid, 1);
    }
    return;
  }
  if (isNavActive()) {   // navegação dos menus
    if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur) document.activeElement.blur();
    if (key === "w" || key === "arrowup") { event.preventDefault(); moveNav(-1); }
    else if (key === "s" || key === "arrowdown") { event.preventDefault(); moveNav(1); }
    else if (key === "a" || key === "arrowleft") { event.preventDefault(); navHorizontal(-1); }
    else if (key === "d" || key === "arrowright") { event.preventDefault(); navHorizontal(1); }
    else if (key === "enter" || key === " " || key === "spacebar") { event.preventDefault(); activateNav(); }
    return;
  }
  if (key === "p" && isPlayable() && !state.ares) {   // ARES não pausa
    app.paused = !app.paused;
    if (app.paused) music.pause(); else music.resume();   // pausa/retoma a trilha junto com o jogo
    return;
  }

  const binding = KEYMAP[key];
  if (!binding || !canSteer() || app.paused) return;
  event.preventDefault();
  let [playerId, dir] = binding;
  if (state.mode === "cpu" && playerId === 2) playerId = 1;   // setas também guiam o P1 no singleplayer
  steer(playerId, dir);
}

function bindTurn(id, playerId, side) {
  const el = document.getElementById(id);
  if (el) el.addEventListener("pointerdown", (e) => { e.preventDefault(); audio.resume(); steerTurn(playerId, side); });
}

// Liga todos os listeners de input. `handlers.onEscape` = sair/voltar (depende da fase).
export function initInput(handlers) {
  onEscape = handlers.onEscape;

  // Detecta toque e liga o HUD; cada botão dispara uma curva relativa (pointerdown = baixa latência).
  if (("ontouchstart" in window) || navigator.maxTouchPoints > 0 || matchMedia("(pointer: coarse)").matches) {
    document.body.classList.add("touch");
  }
  bindTurn("t-p1-l", 1, "left");  bindTurn("t-p1-r", 1, "right");
  bindTurn("t-p2-l", 2, "left");  bindTurn("t-p2-r", 2, "right");
  const touchExitEl = document.getElementById("touch-exit");
  if (touchExitEl) touchExitEl.addEventListener("pointerdown", (e) => { e.preventDefault(); onEscape(); });

  window.addEventListener("keydown", onKeyDown, { passive: false });
  window.addEventListener("keyup", (event) => heldKeys.delete(event.key.toLowerCase()));
  window.addEventListener("blur", () => heldKeys.clear());   // evita teclas "presas" ao perder o foco
}
