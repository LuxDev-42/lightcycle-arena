// Sequência de invasão do ARES: revela um log estilo terminal linha a linha,
// segura um beat e então mostra a tela "ARES invadiu o sistema" (e só aí começa
// a música/motores). O game loop (main) chama updateAresTerminal(dt) enquanto
// isTerminalActive() e, quando acaba, segura introTimer e dispara a contagem.
import { state } from "./state.js";
import { el } from "./dom.js";
import { audio, music } from "./engines.js";
import { ARES_HOLD_MS } from "./config.js";

const LINE_MS = 18;     // intervalo entre linhas do log (rápido, estilo boot)
const HOLD_MS = 1500;   // pausa após a última linha, antes da tela do ARES
const DRAMA_MS = 1000;  // pausa de 1s antes da antepenúltima linha (suspense)
const PAIR_MS = 350;    // beat curto depois; as 2 últimas linhas saem juntas

let lines = [];
let active = false;
let lineIndex = 0;
let timer = 0;
let holdActive = false;
let holdTimer = 0;

export function isTerminalActive() { return active; }
export function stopTerminal() { active = false; }

// Ajusta "invadiu o jogo" pra ocupar a mesma largura de "ARES".
function fitAresSub() {
  el.aresSub.style.fontSize = "100px";
  const titleW = el.aresTitle.getBoundingClientRect().width;
  const subW = el.aresSub.getBoundingClientRect().width;
  if (subW > 0) el.aresSub.style.fontSize = (100 * (titleW / subW)) + "px";
}

export async function loadAresTerminalLines() {
  try {
    const response = await fetch("src/ares-terminal.txt");
    const text = await response.text();
    lines = text.replace(/\n+$/, "").split(/\r?\n/);   // mantém linhas em branco internas
  } catch (e) {
    lines = [
      "[ERR] containment breach detected",
      "[ERR] hostile protocol signature identified",
      "[ERR] threat level: CRITICAL",
    ];
  }
}

function startTerminalSequence() {
  active = true;
  lineIndex = 0;
  timer = 0;
  holdActive = false;
  holdTimer = 0;
  el.aresTerminalLines.innerHTML = "";
  el.aresTerminal.classList.remove("hidden");
  el.aresTitle.classList.add("hidden");
  el.aresSub.classList.add("hidden");
  el.aresTitle.style.opacity = "0";
  el.aresSub.style.opacity = "0";
}

// Revela o log linha a linha. Ao acabar, pausa e então mostra a tela do ARES.
export function updateAresTerminal(dt) {
  if (!active) return;
  if (holdActive) {
    holdTimer -= dt;
    if (holdTimer <= 0) finishAresTerminal();
    return;
  }
  timer -= dt;
  while (timer <= 0 && lineIndex < lines.length) {
    const line = document.createElement("div");
    line.className = "terminal-line";
    line.textContent = lines[lineIndex++];
    el.aresTerminalLines.appendChild(line);
    // noise: intervalo irregular (bursts rápidos + pausas esporádicas) p/ não subir liso.
    // Clímax: 1s antes da antepenúltima; depois as 2 últimas linhas saem juntas (mesmo frame).
    const r = Math.random();
    const n = lines.length;
    let wait;
    if (lineIndex === n - 3) wait = DRAMA_MS;          // 1s antes da antepenúltima
    else if (lineIndex === n - 2) wait = PAIR_MS;      // beat curto antes do par final
    else if (lineIndex >= n - 1) wait = 0;             // última no mesmo frame da penúltima
    else wait = LINE_MS * (0.2 + r * r * 3);           // resto: rápido c/ noise
    timer += wait;
  }
  if (lineIndex >= lines.length) {
    holdActive = true;
    holdTimer = HOLD_MS;
  }
}

function finishAresTerminal() {
  active = false;
  el.aresTerminal.classList.add("hidden");
  el.aresTitle.classList.remove("hidden");
  el.aresSub.classList.remove("hidden");
  el.aresTitle.style.opacity = "1";
  el.aresSub.style.opacity = "1";
  fitAresSub();
  audio.aresStinger();
  audio.setEnginesActive(true);   // motores voltam a soar junto com a tela do ARES
  music.start(true);              // a música começa quando a tela "ARES invadiu o sistema" aparece
}

export function showAresIntro() {
  state.phase = "aresintro";
  state.introTimer = ARES_HOLD_MS;
  el.aresIntro.style.transition = "none";
  el.aresIntro.style.opacity = "1";
  el.aresIntro.classList.remove("hidden");
  el.aresTitle.classList.add("hidden");
  el.aresSub.classList.add("hidden");
  el.aresTitle.style.opacity = "0";
  el.aresSub.style.opacity = "0";
  startTerminalSequence();
}
