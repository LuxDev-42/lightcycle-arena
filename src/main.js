// Entrada do jogo: cria o estado, conecta DOM/áudio/cores/menus/input e roda o
// game loop, orquestrando os módulos de lógica, IA (via lógica) e gráficos.
import {
  COLS, ROWS, OPPOSITE, DIRS, createGrid, idx, isFree, clamp,
  WIN_SCORE, COUNTDOWN_MS, ARES_CHANCE, ARES_HOLD_MS, ARES_FADE_MS, ARES_HUE,
  SHAKE_DEATH, NEARMISS_COOLDOWN_MS, STEPTICK_MIN_MS, ARENA_LAYOUTS, ARENA_NAMES,
} from "./config.js";
import { makePlayer, advance, updateParticles, spawnLayout, applyArena, clearSpawnRunways } from "./logic.js";
import { Renderer } from "./graphics.js";
import { AudioEngine } from "./sound.js";
import { MusicPlayer } from "./music.js";

// ---- Canvas / renderer / áudio (SFX) ----
const canvas = document.getElementById("game");
const renderer = new Renderer(canvas);
const audio = new AudioEngine();

// ---- DOM ----
const scoreboardEl = document.getElementById("scoreboard");
const menuEl = document.getElementById("menu");
const optionsMenuEl = document.getElementById("options-menu");
const colorsMenuEl = document.getElementById("colors-menu");
const audioMenuEl = document.getElementById("audio-menu");
const advMenuEl = document.getElementById("adversaries-menu");
const mapsMenuEl = document.getElementById("maps-menu");
const mapValEl = document.getElementById("map-val");
const mapAuxEl = document.getElementById("map-aux");
const graphicsMenuEl = document.getElementById("graphics-menu");
const gfxValEl = document.getElementById("gfx-val");
const gfxAuxEl = document.getElementById("gfx-aux");
const resultEl = document.getElementById("result");
const touchControlsEl = document.getElementById("touch-controls");
const resultTitle = document.getElementById("result-title");
const resultScore = document.getElementById("result-score");
const keysInfo = document.getElementById("keys-info");
const hue1El = document.getElementById("hue1");
const hue2El = document.getElementById("hue2");
const swatch1El = document.getElementById("sw1");
const swatch2El = document.getElementById("sw2");
const cdot1El = document.getElementById("cdot1");   // bolinhas do ícone do botão "Cores"
const cdot2El = document.getElementById("cdot2");
const btnCpuEl = document.getElementById("btn-cpu");   // herda a cor do P1 (ver refreshColorUI)
const btn2pEl = document.getElementById("btn-2p");     // herda a cor do P2
const bgm = document.getElementById("bgm");
const musicVolEl = document.getElementById("music-vol");
const sfxVolEl = document.getElementById("sfx-vol");
const musicValEl = document.getElementById("music-val");
const sfxValEl = document.getElementById("sfx-val");
const spValEl = document.getElementById("sp-val");
const mpValEl = document.getElementById("mp-val");
const diffValEl = document.getElementById("diff-val");
const diffAuxEl = document.getElementById("diff-aux");
const aresIntroEl = document.getElementById("ares-intro");
const aresTitleEl = document.getElementById("ares-title");
const aresSubEl = document.getElementById("ares-sub");
const aresTerminalEl = document.getElementById("ares-terminal");
const aresTerminalLinesEl = document.getElementById("ares-terminal-lines");
const countdownEl = document.getElementById("countdown");
const countdownNumEl = document.getElementById("countdown-num");
const fadeEl = document.getElementById("fade");

// ---- Áudio (música) — playlist aleatória da pasta music/ (ou dangerMusic no ARES) ----
const music = new MusicPlayer(bgm);
function startMusic(danger) { music.start(danger); }
function stopMusic() { music.stop(); }

// ---- Preferências persistidas (localStorage) ----
const LS_MUSIC = "lc.musicVol", LS_SFX = "lc.sfxVol", LS_SP = "lc.spCpus", LS_MP = "lc.mpCpus", LS_DIFF = "lc.diff", LS_MAP = "lc.map", LS_GFX = "lc.gfx";
function loadVol(key, def) {
  try { const v = parseFloat(localStorage.getItem(key)); return Number.isFinite(v) ? clamp(v, 0, 1) : def; }
  catch (e) { return def; }
}
function loadInt(key, def, min, max) {
  try { const v = parseInt(localStorage.getItem(key), 10); return Number.isFinite(v) ? clamp(v, min, max) : def; }
  catch (e) { return def; }
}
function save(key, v) { try { localStorage.setItem(key, String(v)); } catch (e) {} }

const MUSIC_VOLUME_MULT = 0.5;        // multiplicador permanente do volume da música (50%)
function applyMusicVol(v) {            // v em 0..1 (valor do slider; saída real = v * MULT)
  music.setVolume(v * MUSIC_VOLUME_MULT);
  musicVolEl.value = Math.round(v * 100);
  musicValEl.textContent = Math.round(v * 100);
  save(LS_MUSIC, v);
}
function applySfxVol(v) {
  audio.setMasterVolume(v);
  sfxVolEl.value = Math.round(v * 100);
  sfxValEl.textContent = Math.round(v * 100);
  save(LS_SFX, v);
}

// nº de Programas (CPUs): singleplayer 1..9, multiplayer 0..8; dificuldade 1..3
const DIFF_NAMES = ["", "fácil", "médio", "difícil"];
const DIFF_COLORS = ["", "#46e07a", "#e8eef3", "#ff8a1e"];   // 1 verde · 2 neutro · 3 laranja
const settings = {
  spCpus: loadInt(LS_SP, 1, 1, 9),
  mpCpus: loadInt(LS_MP, 0, 0, 8),
  difficulty: loadInt(LS_DIFF, 2, 1, 3),
  map: loadInt(LS_MAP, 0, 0, ARENA_LAYOUTS.length - 1),   // mapa escolhido (0 = Vazio)
  gfx: loadInt(LS_GFX, 0, 0, 2),                          // qualidade gráfica (0 = Auto)
};
function setSpCpus(v) { settings.spCpus = clamp(Math.round(v), 1, 9); spValEl.textContent = settings.spCpus; save(LS_SP, settings.spCpus); }
function setMpCpus(v) { settings.mpCpus = clamp(Math.round(v), 0, 8); mpValEl.textContent = settings.mpCpus; save(LS_MP, settings.mpCpus); }
function setDifficulty(v) {
  settings.difficulty = clamp(Math.round(v), 1, 3);
  state.difficulty = settings.difficulty;
  diffValEl.textContent = settings.difficulty;
  diffAuxEl.textContent = DIFF_NAMES[settings.difficulty];
  const color = DIFF_COLORS[settings.difficulty];   // cor muda com a dificuldade (botão todo)
  diffValEl.style.color = color;
  diffValEl.style.textShadow = `0 0 12px ${color}`;
  diffValEl.style.borderLeftColor = `${color}59`;
  diffValEl.style.borderRightColor = `${color}59`;
  diffAuxEl.style.color = color;
  const stepper = diffValEl.closest(".stepper");
  if (stepper) {
    stepper.style.borderColor = color;
    stepper.style.boxShadow = `0 0 16px ${color}3a, inset 0 0 16px ${color}14`;
    for (const btn of stepper.querySelectorAll(".step-btn")) btn.style.color = color;
  }
  save(LS_DIFF, settings.difficulty);
}
function setMap(v) {
  settings.map = clamp(Math.round(v), 0, ARENA_LAYOUTS.length - 1);
  mapValEl.textContent = ARENA_NAMES[settings.map];    // mostra o NOME do mapa
  mapAuxEl.textContent = "";
  state.arenaLayout = ARENA_LAYOUTS[settings.map];     // aplica a escolha já
  save(LS_MAP, settings.map);
  if (!running && state.roster.length) {               // preview ao vivo no fundo do menu
    resetRound();
    renderer.updateCamera(state, 0);
    renderer.render(state);
  }
}
const GFX_MODES = ["auto", "alto", "baixo"];
const GFX_NAMES = ["Auto", "Alto", "Baixo"];
const GFX_HINTS = ["detecta o aparelho", "tudo ligado", "mais FPS"];
function setGfx(v) {
  settings.gfx = clamp(Math.round(v), 0, GFX_MODES.length - 1);
  gfxValEl.textContent = GFX_NAMES[settings.gfx];
  gfxAuxEl.textContent = GFX_HINTS[settings.gfx];
  save(LS_GFX, settings.gfx);
  renderer.setQuality(GFX_MODES[settings.gfx]);        // aplica no renderer (lowFx / DPR / ratchet)
  if (!running && state.roster.length) renderer.render(state);   // reflete na hora (o resize limpou o canvas)
}

// ---- Cores ----
function hueColor(hue) { return `hsl(${hue}, 100%, 60%)`; }
function hueGlow(hue)  { return `hsla(${hue}, 100%, 60%, 0.9)`; }
let playerColors = [hueColor(190), hueColor(30)];   // só p/ os swatches; o resto vem de skinForIndex

function applyColors() {
  playerColors = [hueColor(+hue1El.value), hueColor(+hue2El.value)];
}
function refreshColorUI() {
  applyColors();
  const title1Els = document.querySelectorAll(".title-1");
  const title2Els = document.querySelectorAll(".title-2");
  swatch1El.style.background = playerColors[0];
  swatch1El.style.boxShadow = `0 0 8px ${playerColors[0]}`;
  swatch2El.style.background = playerColors[1];
  swatch2El.style.boxShadow = `0 0 8px ${playerColors[1]}`;
  if (cdot1El) { cdot1El.style.background = playerColors[0]; cdot1El.style.boxShadow = `0 0 6px ${playerColors[0]}`; }
  if (cdot2El) { cdot2El.style.background = playerColors[1]; cdot2El.style.boxShadow = `0 0 6px ${playerColors[1]}`; }
  hue1El.style.setProperty("--thumb", playerColors[0]);
  hue2El.style.setProperty("--thumb", playerColors[1]);
  for (const el of title1Els) { el.style.color = playerColors[0]; el.style.textShadow = `0 0 12px ${playerColors[0]}, 0 0 30px ${playerColors[0]}`; }
  for (const el of title2Els) { el.style.color = playerColors[1]; el.style.textShadow = `0 0 12px ${playerColors[1]}, 0 0 30px ${playerColors[1]}`; }
  // botões 1/2 Jogadores herdam as cores do P1/P2: sobrescreve a var de cor do botão
  // (cor, borda, hover e glow passam a seguir o tom escolhido — igual ao título).
  if (btnCpuEl) btnCpuEl.style.setProperty("--cyan", playerColors[0]);
  if (btn2pEl) btn2pEl.style.setProperty("--orange", playerColors[1]);
}

// Cor de cada moto: P1/P2 vêm dos sliders; CPUs extras ganham matizes espalhadas.
function hueForIndex(i, total) {
  if (i === 0) return +hue1El.value;
  if (i === 1) return +hue2El.value;
  const extras = Math.max(1, total - 2);
  return Math.round(((i - 2) + 0.5) / extras * 360);
}
function skinForIndex(i, total) {
  const hue = hueForIndex(i, total);
  return { color: hueColor(hue), glow: hueGlow(hue), hue };
}
function aresSkin() { return { color: hueColor(ARES_HUE), glow: hueGlow(ARES_HUE), hue: ARES_HUE }; }

// ---- Estado ----
const state = {
  grid: null,
  arenaLayout: [],          // obstaculos da partida (sorteado em startMatch)
  players: null,
  particles: [],
  mode: "cpu",            // "cpu" (1 humano) | "2p" (2 humanos)
  roster: [],             // [{ isAI, label }]
  phase: "menu",          // "menu" | "aresintro" | "countdown" | "playing" | "dying" | "result" | "fade"
  scores: [],
  roundWinner: null,
  dyingTimer: 0,
  difficulty: settings.difficulty,
  ares: false,            // modo ARES ativo (só sai ao voltar pro menu)
  introTimer: 0,          // título ARES na tela
  countdownTimer: 0,      // contagem 3-2-1
  countShown: -1,
};
let running = false;
let paused = false;
let debug = false;                 // modo debug (Ctrl+D+B): overlay do pathfinding
const heldKeys = new Set();        // teclas seguradas agora (p/ detectar o chord)
let lastTime = 0;
let prevAlive = [];
let nearMissCd = 0;        // cooldown da vinheta de quase-acidente (ms)
let stepTickCd = 0;        // cooldown do tique de passo (ms)
let lastHeadKey = [];      // ultima celula da cabeca por jogador humano (detecta passo)
let aresEscAllowed = false; // ARES: Esc de saida so libera apos a 1a morte/derrota
let aresTerminalLines = [];
let aresTerminalActive = false;
let aresTerminalIndex = 0;
let aresTerminalTimer = 0;
let aresTerminalHoldActive = false;
let aresTerminalHoldTimer = 0;
const ARES_TERMINAL_LINE_MS = 18;    // intervalo entre linhas do log (rápido, estilo boot)
const ARES_TERMINAL_HOLD_MS = 1500;   // pausa após a última linha, antes da tela do ARES
const ARES_TERMINAL_DRAMA_MS = 1000;  // pausa de 1s antes da antepenúltima linha (suspense)
const ARES_TERMINAL_PAIR_MS = 350;    // beat curto depois; as 2 últimas linhas saem juntas

// Monta o roster a partir do modo + nº de CPUs (ARES força 1 CPU).
function configureRoster(mode) {
  state.mode = mode;
  state.difficulty = settings.difficulty;
  const humans = mode === "2p" ? 2 : 1;
  const cpus = state.ares ? 1 : (mode === "2p" ? settings.mpCpus : settings.spCpus);
  const total = humans + cpus;
  const cpuCount = total - humans;
  state.roster = [];
  for (let i = 0; i < total; i++) {
    const isAI = i >= humans;
    const label = !isAI ? `P${i + 1}` : (state.ares ? "ARES" : (cpuCount > 1 ? `CPU ${i - humans + 1}` : "CPU"));
    state.roster.push({ isAI, label });
  }
  state.scores = new Array(total).fill(0);
}

function resetRound() {
  applyColors();
  state.grid = createGrid();
  applyArena(state.grid, state.arenaLayout);   // marca os obstaculos do layout da partida
  state.particles = [];
  const total = state.roster.length;
  const layout = spawnLayout(total);
  state.players = state.roster.map((r, i) => {
    const skin = (state.ares && r.isAI) ? aresSkin() : skinForIndex(i, total);  // ARES = programa vermelho
    return makePlayer(i + 1, layout[i].col, layout[i].row, layout[i].dir, r.isAI, skin, r.label);
  });
  for (const player of state.players) state.grid[idx(player.x, player.y)] = player.id;
  clearSpawnRunways(state.grid, state.players);   // abre pista segura à frente de cada spawn
  prevAlive = state.players.map(() => true);
  state.roundWinner = null;
  state.dyingTimer = 0;
  renderer.snapToTarget();
  renderScoreboard();
}

// ---- Placar dinâmico (chips/pílulas coloridas) ----
function playerChip(p, winnerId) {
  const h = p.hue, win = p.id === winnerId;
  const glow = `0 0 12px hsla(${h},100%,60%,.35)` + (win ? `, 0 0 26px hsla(${h},100%,60%,.6)` : "");
  return `<span class="chip${win ? " win" : ""}" style="border-color:hsl(${h},100%,62%);`
    + `background:hsla(${h},100%,55%,.12);box-shadow:${glow}">`
    + `<span class="chip-dot" style="background:hsl(${h},100%,62%);box-shadow:0 0 8px hsl(${h},100%,62%)"></span>`
    + `<span class="chip-name" style="color:hsl(${h},100%,74%)">${p.label}</span>`
    + `<span class="chip-score">${state.scores[p.id - 1]}</span>`
    + `</span>`;
}
function scoreChips(winnerId = null) {
  return state.players.map(p => playerChip(p, winnerId)).join("");
}
function renderScoreboard() {
  if (state.players) scoreboardEl.innerHTML = scoreChips();
}

// ---- Contagem / intro ARES ----
function fitAresSub() {
  // ajusta "invadiu o jogo" pra ocupar a mesma largura de "ARES"
  aresSubEl.style.fontSize = "100px";
  const titleW = aresTitleEl.getBoundingClientRect().width;
  const subW = aresSubEl.getBoundingClientRect().width;
  if (subW > 0) aresSubEl.style.fontSize = (100 * (titleW / subW)) + "px";
}
async function loadAresTerminalLines() {
  try {
    const response = await fetch("src/ares-terminal.txt");
    const text = await response.text();
    aresTerminalLines = text.replace(/\n+$/, "").split(/\r?\n/);   // mantém linhas em branco internas
  } catch (e) {
    aresTerminalLines = [
      "[ERR] containment breach detected",
      "[ERR] hostile protocol signature identified",
      "[ERR] threat level: CRITICAL",
    ];
  }
}
function startAresTerminalSequence() {
  aresTerminalActive = true;
  aresTerminalIndex = 0;
  aresTerminalTimer = 0;
  aresTerminalHoldActive = false;
  aresTerminalHoldTimer = 0;
  aresTerminalLinesEl.innerHTML = "";
  aresTerminalEl.classList.remove("hidden");
  aresTitleEl.classList.add("hidden");
  aresSubEl.classList.add("hidden");
  aresTitleEl.style.opacity = "0";
  aresSubEl.style.opacity = "0";
}
// Revela o log linha a linha (rápido, estilo terminal Linux). Ao acabar, pausa
// e então mostra a tela "ARES invadiu o sistema" — e SÓ AÍ começa a música.
function updateAresTerminal(dt) {
  if (!aresTerminalActive) return;
  if (aresTerminalHoldActive) {
    aresTerminalHoldTimer -= dt;
    if (aresTerminalHoldTimer <= 0) finishAresTerminal();
    return;
  }
  aresTerminalTimer -= dt;
  while (aresTerminalTimer <= 0 && aresTerminalIndex < aresTerminalLines.length) {
    const line = document.createElement("div");
    line.className = "terminal-line";
    line.textContent = aresTerminalLines[aresTerminalIndex++];
    aresTerminalLinesEl.appendChild(line);
    // noise: intervalo irregular (bursts rápidos + pausas esporádicas) p/ não subir liso.
    // Clímax: 1s antes da antepenúltima; depois as 2 últimas linhas saem juntas (mesmo frame).
    const r = Math.random();
    const n = aresTerminalLines.length;
    let wait;
    if (aresTerminalIndex === n - 3) wait = ARES_TERMINAL_DRAMA_MS;       // 1s antes da antepenúltima
    else if (aresTerminalIndex === n - 2) wait = ARES_TERMINAL_PAIR_MS;   // beat curto antes do par final
    else if (aresTerminalIndex >= n - 1) wait = 0;                        // última no mesmo frame da penúltima
    else wait = ARES_TERMINAL_LINE_MS * (0.2 + r * r * 3);                // resto: rápido c/ noise
    aresTerminalTimer += wait;
  }
  if (aresTerminalIndex >= aresTerminalLines.length) {
    aresTerminalHoldActive = true;
    aresTerminalHoldTimer = ARES_TERMINAL_HOLD_MS;
  }
}
function finishAresTerminal() {
  aresTerminalActive = false;
  aresTerminalEl.classList.add("hidden");
  aresTitleEl.classList.remove("hidden");
  aresSubEl.classList.remove("hidden");
  aresTitleEl.style.opacity = "1";
  aresSubEl.style.opacity = "1";
  fitAresSub();
  audio.aresStinger();
  audio.setEnginesActive(true);  // motores voltam a soar junto com a tela do ARES
  startMusic(true);            // a música começa quando a tela "ARES invadiu o sistema" aparece
}
function showAresIntro() {
  state.phase = "aresintro";
  state.introTimer = ARES_HOLD_MS;
  aresIntroEl.style.transition = "none";
  aresIntroEl.style.opacity = "1";
  aresIntroEl.classList.remove("hidden");
  aresTitleEl.classList.add("hidden");
  aresSubEl.classList.add("hidden");
  aresTitleEl.style.opacity = "0";
  aresSubEl.style.opacity = "0";
  startAresTerminalSequence();
}
function beginCountdown(fromAres) {
  state.phase = "countdown";
  state.countdownTimer = COUNTDOWN_MS;
  state.countShown = -1;
  countdownEl.classList.toggle("ares", state.ares);   // contagem vermelha no modo ARES
  countdownEl.classList.remove("hidden");
  if (fromAres) {   // dispara o fade-out do título ARES, sobreposto à contagem
    aresIntroEl.style.transition = `opacity ${ARES_FADE_MS}ms ease`;
    aresIntroEl.style.opacity = "0";
    setTimeout(() => aresIntroEl.classList.add("hidden"), ARES_FADE_MS + 60);
  }
  showTouchControls();   // HUD de pilotagem entra junto com a contagem (só em telas de toque)
}
function updateCountdown() {
  const n = Math.max(1, Math.ceil(state.countdownTimer / 1000));   // 3, 2, 1
  if (n !== state.countShown) {
    state.countShown = n;
    countdownNumEl.textContent = n;
    countdownNumEl.style.animation = "none";
    void countdownNumEl.offsetWidth;          // reinicia a animação
    countdownNumEl.style.animation = "count-pop .4s ease";
    audio.tick(false);
  }
}

// ---- Loop ----
const panScratch = [];   // reusado todo frame (evita alocar um array novo por frame p/ o pan estéreo)
function frame(timestamp) {
  if (!lastTime) lastTime = timestamp;
  let dt = timestamp - lastTime;
  lastTime = timestamp;
  if (dt > 200) dt = 200;

  if (!paused) {
    updateParticles(state, dt);
    if (state.phase === "aresintro") {
      if (aresTerminalActive) {
        updateAresTerminal(dt);
      }
      if (!aresTerminalActive) {
        state.introTimer -= dt;
        if (state.introTimer <= 0) beginCountdown(true);
      }
    } else if (state.phase === "countdown") {
      state.countdownTimer -= dt;
      if (state.countdownTimer <= 0) {
        state.phase = "playing";
        countdownEl.classList.add("hidden");
        audio.tick(true);
      } else {
        updateCountdown();
      }
    } else if (state.phase === "playing" || state.phase === "dying") {
      if (advance(state, dt)) renderScoreboard();   // round terminou → placar
      for (let i = 0; i < state.players.length; i++) {
        if (prevAlive[i] && !state.players[i].alive) {
          audio.explosion(renderer.screenPan(state.players[i]));
          renderer.addShake(SHAKE_DEATH);              // tremor de tela na morte
          renderer.addFlash(0.22, "#ffffff");
          if (state.ares) aresEscAllowed = true;       // 1ª morte no ARES → libera o Esc de saída
        }
        prevAlive[i] = state.players[i].alive;
      }
      // juice do jogador HUMANO: tique de passo (feel de velocidade) + vinheta de quase-acidente
      nearMissCd -= dt; stepTickCd -= dt;
      for (let i = 0; i < state.players.length; i++) {
        const p = state.players[i];
        if (p.isAI || !p.alive) continue;
        const hk = p.y * COLS + p.x;
        if (hk === lastHeadKey[i]) continue;           // só dispara quando anda uma célula
        lastHeadKey[i] = hk;
        if (stepTickCd <= 0) { audio.moveTick(renderer.screenPan(p), p.tickMs); stepTickCd = STEPTICK_MIN_MS; }
        if (nearMissCd <= 0) {                          // parede/rastro logo ao lado (perpendicular ao rumo)?
          const d = DIRS[p.dir];
          const graze = !isFree(state.grid, p.x - d.y, p.y + d.x) || !isFree(state.grid, p.x + d.y, p.y - d.x);
          if (graze) {
            renderer.addFlash(0.3, "#ff2a2a"); renderer.addShake(4); audio.nearMiss(renderer.screenPan(p));
            nearMissCd = NEARMISS_COOLDOWN_MS;
          }
        }
      }
      if (state.phase === "dying") {
        state.dyingTimer -= dt;
        if (state.dyingTimer <= 0) endRound();
      }
    }
  }
  renderer.updateCamera(state, dt);
  let pans = null;
  if (state.players) {
    pans = panScratch;
    pans.length = state.players.length;
    for (let i = 0; i < state.players.length; i++) pans[i] = renderer.screenPan(state.players[i]);
  }
  audio.update(state, paused, pans);
  renderer.render(state);
  if (running) requestAnimationFrame(frame);
}

// ---- Navegação de menus (mouse + teclado WASD/setas) ----
const NAV_OVERLAYS = [menuEl, optionsMenuEl, colorsMenuEl, audioMenuEl, advMenuEl, mapsMenuEl, graphicsMenuEl, resultEl];
const navConfigs = new Map();
let navItems = null, navIndex = 0;

function navBtn(id) { const el = document.getElementById(id); return { el, type: "button", run: () => el.click() }; }
function navSlider(el, step) {
  return {
    el, type: "value",
    dec: () => { el.value = Math.max(+el.min, +el.value - step); el.dispatchEvent(new Event("input")); },
    inc: () => { el.value = Math.min(+el.max, +el.value + step); el.dispatchEvent(new Event("input")); },
  };
}
function navStepper(el, dec, inc) { return { el, type: "value", dec, inc }; }

function buildNav() {
  navConfigs.set(menuEl, [navBtn("btn-cpu"), navBtn("btn-2p"), navBtn("btn-options")]);
  navConfigs.set(optionsMenuEl, [navBtn("btn-adversaries"), navBtn("btn-maps"), navBtn("btn-graphics"), navBtn("btn-audio"), navBtn("btn-colors"), navBtn("btn-options-back")]);
  navConfigs.set(colorsMenuEl, [navSlider(hue1El, 8), navSlider(hue2El, 8), navBtn("btn-colors-back")]);
  navConfigs.set(audioMenuEl, [navSlider(musicVolEl, 5), navSlider(sfxVolEl, 5), navBtn("btn-audio-back")]);
  navConfigs.set(advMenuEl, [
    navStepper(spValEl.closest(".stepper"), () => setSpCpus(settings.spCpus - 1), () => setSpCpus(settings.spCpus + 1)),
    navStepper(mpValEl.closest(".stepper"), () => setMpCpus(settings.mpCpus - 1), () => setMpCpus(settings.mpCpus + 1)),
    navStepper(diffValEl.closest(".stepper"), () => setDifficulty(settings.difficulty - 1), () => setDifficulty(settings.difficulty + 1)),
    navBtn("btn-adv-back"),
  ]);
  navConfigs.set(mapsMenuEl, [
    navStepper(mapValEl.closest(".stepper"), () => setMap(settings.map - 1), () => setMap(settings.map + 1)),
    navBtn("btn-maps-back"),
  ]);
  navConfigs.set(graphicsMenuEl, [
    navStepper(gfxValEl.closest(".stepper"), () => setGfx(settings.gfx - 1), () => setGfx(settings.gfx + 1)),
    navBtn("btn-graphics-back"),
  ]);
  navConfigs.set(resultEl, [navBtn("btn-again"), navBtn("btn-menu")]);
  for (const items of navConfigs.values()) {
    items.forEach((item, i) => item.el.addEventListener("mouseenter", () => { if (navItems === items) setNavIndex(i); }));
  }
}

function setNavIndex(i) {
  if (!navItems || !navItems.length) return;
  const next = (i % navItems.length + navItems.length) % navItems.length;
  const current = navItems[navIndex];
  if (next === navIndex && current && current.el.classList.contains("nav-focus")) return;   // já focado: sem som
  if (current) current.el.classList.remove("nav-focus");
  navIndex = next;
  navItems[navIndex].el.classList.add("nav-focus");
  audio.uiMove();   // mudou o foco (nav por teclado ou hover do mouse)
}
function moveNav(delta) { setNavIndex(navIndex + delta); }
function navHorizontal(delta) {
  const item = navItems && navItems[navIndex];
  if (!item) return;
  if (item.type === "value") { (delta < 0 ? item.dec : item.inc)(); audio.uiMove(); }
  else moveNav(delta);
}
function activateNav() {
  const item = navItems && navItems[navIndex];
  if (item && item.type === "button") item.run();
}

// Mostra só o overlay `target` (ou nenhum) e ativa a navegação por teclado nele.
function showOnly(target) {
  for (const el of NAV_OVERLAYS) el.classList.toggle("hidden", el !== target);
  if (navItems && navItems[navIndex]) navItems[navIndex].el.classList.remove("nav-focus");
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  navItems = target ? (navConfigs.get(target) || null) : null;
  navIndex = 0;
  if (navItems && navItems.length) navItems[0].el.classList.add("nav-focus");
}

// ---- Fluxo ----
async function startMatch(mode) {
  const chance = mode === "2p" ? ARES_CHANCE / 10 : ARES_CHANCE;
  state.ares = Math.random() < chance;     // sorteia o modo ARES
  aresEscAllowed = false;                  // re-arma o trava-ESC do ARES (libera so apos a 1a morte)
  configureRoster(mode);                   // ARES força 1 CPU
  state.arenaLayout = ARENA_LAYOUTS[settings.map];   // mapa escolhido em Opcoes > Mapas (default Vazio)
  showOnly(null);
  resetRound();
  paused = false;
  running = true;
  lastTime = 0;
  audio.resume();                          // contexto de áudio precisa de um gesto (este clique)
  window.focus();
  if (state.ares) {
    music.prime();                         // destrava o áudio no gesto; a música só toca no fim do terminal
    // jogo fica em silêncio durante o terminal: motores e música ligam no finishAresTerminal
    await loadAresTerminalLines();
    showAresIntro();
  } else {
    audio.setEnginesActive(true);
    startMusic(false);                     // trilha normal já começa
    beginCountdown(false);
  }
  requestAnimationFrame(frame);
}

function again() { startMatch(state.mode); }   // "Again" = nova partida (re-sorteia ARES)

function goMenu() {
  running = false;
  hideTouchControls();
  state.phase = "menu";
  state.ares = false;                      // modo ARES só sai ao voltar pro menu
  aresTerminalActive = false;              // encerra a sequência do terminal se estava no meio
  aresIntroEl.classList.add("hidden");
  aresTerminalEl.classList.add("hidden");
  countdownEl.classList.add("hidden");
  resetRound();                            // limpa as trilhas (some o vermelho do ARES atrás do menu)
  renderer.updateCamera(state, 0);
  renderer.render(state);
  showOnly(menuEl);
  stopMusic();
  audio.setEnginesActive(false);
}

function openOptions()     { showOnly(optionsMenuEl); }
function openColors()      { showOnly(colorsMenuEl); }
function openAudio()       { showOnly(audioMenuEl); }
function openAdversaries() { showOnly(advMenuEl); }
function openMaps()        { showOnly(mapsMenuEl); }
function openGraphics()    { showOnly(graphicsMenuEl); }
function backToOptions()   { showOnly(optionsMenuEl); }
function backToMenu()      { showOnly(menuEl); }

// Fim de round: alguém chegou a 5 → fim de partida; senão, próximo round.
function endRound() {
  const champ = state.players.find(p => state.scores[p.id - 1] >= WIN_SCORE);
  if (champ) {
    if (state.ares) aresEnd();
    else showVictory(champ);
  } else {
    nextRound();
  }
}
function nextRound() {
  resetRound();              // mesmo roster/placar/ARES; novas posições
  beginCountdown(false);     // 3-2-1 e segue
}

function showVictory(champ) {
  state.phase = "result";
  running = false;
  hideTouchControls();
  audio.setEnginesActive(false);
  audio.victory();
  resultTitle.textContent = `${champ.label} venceu`;
  resultTitle.style.color = champ.color;
  resultTitle.style.textShadow = `0 0 16px ${champ.color}`;
  resultScore.innerHTML = scoreChips(champ.id);
  showOnly(resultEl);
}

// Fim do modo ARES: fade pra branco e tudo volta como era, de volta ao menu.
function aresEnd() {
  running = false;
  hideTouchControls();
  state.phase = "fade";
  audio.setEnginesActive(false);
  fadeEl.style.transition = "opacity 900ms ease";
  fadeEl.style.opacity = "1";
  setTimeout(() => {
    goMenu();                 // limpa ARES, para música, restaura tudo (settings) e mostra o menu
    fadeEl.style.opacity = "0";   // revela o menu tirando o branco
  }, 950);
}

// ---- Input ----
const KEYMAP = {
  "w": [1, "up"], "a": [1, "left"], "s": [1, "down"], "d": [1, "right"],
  "arrowup": [2, "up"], "arrowleft": [2, "left"], "arrowdown": [2, "down"], "arrowright": [2, "right"],
};
const isPlayable = () => state.phase === "playing" || state.phase === "dying";
const canSteer = () => isPlayable() || state.phase === "countdown";   // dá pra pré-virar na contagem
const isOpenSub = () => !colorsMenuEl.classList.contains("hidden")
  || !audioMenuEl.classList.contains("hidden")
  || !advMenuEl.classList.contains("hidden")
  || !mapsMenuEl.classList.contains("hidden")
  || !graphicsMenuEl.classList.contains("hidden");

const TURN_LEFT  = { up: "left", left: "down", down: "right", right: "up" };    // giro anti-horário (relativo ao rumo)
const TURN_RIGHT = { up: "right", right: "down", down: "left", left: "up" };    // giro horário (relativo ao rumo)

// Aplica uma direção ABSOLUTA a um jogador humano (compartilhado por teclado e toque).
function steer(playerId, dir) {
  if (!canSteer() || paused) return;
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

// Esc / botão de sair: depende da fase (no menu volta um nível; no ARES trava até a 1ª morte).
function handleEscape() {
  if (state.phase === "menu") {
    if (isOpenSub()) { audio.uiBack(); backToOptions(); }
    else if (!optionsMenuEl.classList.contains("hidden")) { audio.uiBack(); backToMenu(); }
  } else if (state.phase === "fade") {
    // já fazendo o fade — ignora
  } else if (state.ares) {
    if (aresEscAllowed) { audio.uiBack(); aresEnd(); }            // ARES: só sai após a 1ª morte/derrota
    else { renderer.addFlash(0.45, "#ff0000"); audio.error(); }   // antes disso: flash vermelho + som de erro
  } else {
    audio.uiBack(); goMenu();
  }
}

// HUD de toque: visível só em telas de toque (classe `touch` no body) e durante o jogo.
function showTouchControls() {
  touchControlsEl.classList.remove("m-cpu", "m-2p");
  touchControlsEl.classList.add(state.mode === "2p" ? "m-2p" : "m-cpu", "active");
}
function hideTouchControls() { touchControlsEl.classList.remove("active"); }

// Detecta toque e liga o HUD; cada botão dispara uma curva relativa (pointerdown = baixa latência).
if (("ontouchstart" in window) || navigator.maxTouchPoints > 0 || matchMedia("(pointer: coarse)").matches) {
  document.body.classList.add("touch");
}
function bindTurn(id, playerId, side) {
  const el = document.getElementById(id);
  if (el) el.addEventListener("pointerdown", (e) => { e.preventDefault(); audio.resume(); steerTurn(playerId, side); });
}
bindTurn("t-p1-l", 1, "left");  bindTurn("t-p1-r", 1, "right");
bindTurn("t-p2-l", 2, "left");  bindTurn("t-p2-r", 2, "right");
const touchExitEl = document.getElementById("touch-exit");
if (touchExitEl) touchExitEl.addEventListener("pointerdown", (e) => { e.preventDefault(); handleEscape(); });

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  audio.resume();   // tecla = gesto: destrava o contexto de áudio (sons de UI/jogo)

  heldKeys.add(key);
  if (event.ctrlKey && (key === "d" || key === "b")) {        // chord Ctrl+D+B → liga/desliga debug
    event.preventDefault();
    if (heldKeys.has("d") && heldKeys.has("b")) { debug = !debug; renderer.setDebug(debug); renderer.render(state); }
    return;                                                   // não trata Ctrl+D/Ctrl+B como input de jogo
  }
  if (key === "m") { audio.toggleMute(); return; }
  if (key === "escape") { handleEscape(); return; }
  if (navItems) {   // navegação dos menus
    if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur) document.activeElement.blur();
    if (key === "w" || key === "arrowup") { event.preventDefault(); moveNav(-1); }
    else if (key === "s" || key === "arrowdown") { event.preventDefault(); moveNav(1); }
    else if (key === "a" || key === "arrowleft") { event.preventDefault(); navHorizontal(-1); }
    else if (key === "d" || key === "arrowright") { event.preventDefault(); navHorizontal(1); }
    else if (key === "enter" || key === " " || key === "spacebar") { event.preventDefault(); activateNav(); }
    return;
  }
  if (key === "p" && isPlayable()) {
    paused = !paused;
    if (paused) music.pause(); else music.resume();   // pausa/retoma a trilha junto com o jogo
    return;
  }

  const binding = KEYMAP[key];
  if (!binding || !canSteer() || paused) return;
  event.preventDefault();
  let [playerId, dir] = binding;
  if (state.mode === "cpu" && playerId === 2) playerId = 1;   // setas também guiam o P1 no singleplayer
  steer(playerId, dir);
}, { passive: false });

window.addEventListener("keyup", (event) => heldKeys.delete(event.key.toLowerCase()));
window.addEventListener("blur", () => heldKeys.clear());   // evita teclas "presas" ao perder o foco

// ---- Botões ----
document.getElementById("btn-cpu").addEventListener("click", () => {
  keysInfo.innerHTML = '<b class="p1">P1</b>: <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> ou <kbd>↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd>';
  startMatch("cpu");
});
document.getElementById("btn-2p").addEventListener("click", () => startMatch("2p"));
document.getElementById("btn-options").addEventListener("click", openOptions);
document.getElementById("btn-options-back").addEventListener("click", backToMenu);
document.getElementById("btn-adversaries").addEventListener("click", openAdversaries);
document.getElementById("btn-maps").addEventListener("click", openMaps);
document.getElementById("btn-maps-back").addEventListener("click", backToOptions);
document.getElementById("map-dec").addEventListener("click", () => setMap(settings.map - 1));
document.getElementById("map-inc").addEventListener("click", () => setMap(settings.map + 1));
document.getElementById("btn-graphics").addEventListener("click", openGraphics);
document.getElementById("btn-graphics-back").addEventListener("click", backToOptions);
document.getElementById("gfx-dec").addEventListener("click", () => setGfx(settings.gfx - 1));
document.getElementById("gfx-inc").addEventListener("click", () => setGfx(settings.gfx + 1));
document.getElementById("btn-adv-back").addEventListener("click", backToOptions);
document.getElementById("btn-colors").addEventListener("click", openColors);
document.getElementById("btn-colors-back").addEventListener("click", backToOptions);
document.getElementById("btn-audio").addEventListener("click", openAudio);
document.getElementById("btn-audio-back").addEventListener("click", backToOptions);
document.getElementById("btn-again").addEventListener("click", again);
document.getElementById("btn-menu").addEventListener("click", goMenu);

document.getElementById("sp-dec").addEventListener("click", () => setSpCpus(settings.spCpus - 1));
document.getElementById("sp-inc").addEventListener("click", () => setSpCpus(settings.spCpus + 1));
document.getElementById("mp-dec").addEventListener("click", () => setMpCpus(settings.mpCpus - 1));
document.getElementById("mp-inc").addEventListener("click", () => setMpCpus(settings.mpCpus + 1));
document.getElementById("diff-dec").addEventListener("click", () => setDifficulty(settings.difficulty - 1));
document.getElementById("diff-inc").addEventListener("click", () => setDifficulty(settings.difficulty + 1));

hue1El.addEventListener("input", refreshColorUI);
hue2El.addEventListener("input", refreshColorUI);
musicVolEl.addEventListener("input", () => applyMusicVol(+musicVolEl.value / 100));
sfxVolEl.addEventListener("input", () => applySfxVol(+sfxVolEl.value / 100));
sfxVolEl.addEventListener("change", () => { audio.resume(); audio.blip(); });

// Sons de UI no clique do mouse (e destrava o contexto de áudio — clique é gesto).
// Cobre teclado também: activateNav faz el.click(), que cai aqui.
document.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  audio.resume();
  if (btn.classList.contains("step-btn")) audio.uiMove();   // −/+ dos steppers = ajuste
  else if (btn.id.endsWith("-back")) audio.uiBack();        // botões "Voltar" = som grave
  else audio.uiSelect();                                    // demais botões = selecionar
});

window.addEventListener("resize", () => { renderer.resize(); renderer.render(state); });

// ---- Init ----
refreshColorUI();
applyMusicVol(loadVol(LS_MUSIC, 0.6));
applySfxVol(loadVol(LS_SFX, 0.6));
setSpCpus(settings.spCpus);
setMpCpus(settings.mpCpus);
setDifficulty(settings.difficulty);
setMap(settings.map);
setGfx(settings.gfx);                     // aplica a qualidade gráfica salva (lowFx/DPR)
configureRoster("cpu");                  // roster padrão p/ a cena do menu
resetRound();
renderer.updateCamera(state, 0);
state.phase = "menu";
running = false;
buildNav();
showOnly(menuEl);
renderer.render(state);
