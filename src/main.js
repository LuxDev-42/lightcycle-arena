// Orquestrador: cria o estado, define settings/menus, conecta o input e roda o
// game loop, costurando os módulos (lógica, IA via lógica, gráficos, áudio).
// Os subsistemas vivem em módulos próprios: dom, state, app, engines, colors,
// settings, menu-nav, ares-intro, input. Aqui fica só a cola + o fluxo + o loop.
import {
  CELL, COLS, DIRS, OPPOSITE, createGrid, idx, isFree,
  WIN_SCORE, COUNTDOWN_MS, ARES_CHANCE, ARES_FADE_MS,
  SHAKE_DEATH, NEARMISS_COOLDOWN_MS, STEPTICK_MIN_MS, TRAIL_WINDUP_MS,
  ARENA_NAMES, ARENA_SIZES, ARENA_SIZE_NAMES, buildArenaLayout, setArenaSize,
} from "./config.js";
import { makePlayer, advance, updateParticles, spawnLayout, applyArena, clearSpawnRunways } from "./logic.js";
import { el } from "./dom.js";
import { app } from "./app.js";
import { state } from "./state.js";
import { renderer, audio, music } from "./engines.js";
import { refreshColorUI, applyColors, skinForIndex, aresSkin, hueColor, hueGlow } from "./colors.js";
import { defineSetting, setSetting, stepSetting, settings } from "./settings.js";
import { registerMenu, bindHover, showOnly, navBtn, navSlider, navStepper, navInput, syncNavTo, refreshNav } from "./menu-nav.js";
import { showAresIntro, updateAresTerminal, isTerminalActive, stopTerminal, loadAresTerminalLines } from "./ares-intro.js";
import { initInput, setLanSteer, setTeamSelect } from "./input.js";
import { playIntro, skipIntro } from "./title-intro.js";
import { serializePlayers, applyPlayers } from "./lan-sync.js";

// ---- Settings: definições (label + persistência + efeito) ----
const MUSIC_VOLUME_MULT = 0.5;                              // teto permanente do volume da música (50%)
const DIFF_NAMES = ["", "fácil", "médio", "difícil"];
const DIFF_COLORS = ["", "#46e07a", "#e8eef3", "#ff8a1e"]; // 1 verde · 2 neutro · 3 laranja
const GFX_MODES = ["auto", "alto", "baixo"];
const GFX_NAMES = ["Auto", "Alto", "Baixo"];
const GFX_HINTS = ["detecta o aparelho", "tudo ligado", "mais FPS"];

// O layout dos obstáculos depende do MAPA e do TAMANHO da arena; recalcula os dois.
function applyArenaConfig() {
  setArenaSize(ARENA_SIZES[settings.arenaSize ?? 1]);     // muda COLS/ROWS/W/H
  state.arenaLayout = buildArenaLayout(settings.map ?? 0, COLS);
}
// Reflete a arena no fundo do menu na hora (só fora de partida e com roster montado).
function previewArena() {
  if (!app.running && state.roster.length) {
    resetRound();
    renderer.updateCamera(state, 0);
    renderer.render(state);
  }
}

function defineSettings() {
  defineSetting("music", { ls: "lc.musicVol", def: 0.6, vol: true, apply: (v) => {
    music.setVolume(v * MUSIC_VOLUME_MULT);
    el.musicVol.value = Math.round(v * 100);
    el.musicVal.textContent = Math.round(v * 100);
  } });
  defineSetting("sfx", { ls: "lc.sfxVol", def: 0.6, vol: true, apply: (v) => {
    audio.setMasterVolume(v);
    el.sfxVol.value = Math.round(v * 100);
    el.sfxVal.textContent = Math.round(v * 100);
  } });
  defineSetting("spCpus", { ls: "lc.spCpus", def: 1, min: 1, max: 9, apply: (v) => { el.spVal.textContent = v; } });
  defineSetting("mpCpus", { ls: "lc.mpCpus", def: 0, min: 0, max: 8, apply: (v) => { el.mpVal.textContent = v; } });
  defineSetting("difficulty", { ls: "lc.diff", def: 2, min: 1, max: 3, apply: (v) => {
    state.difficulty = v;
    el.diffVal.textContent = v;
    el.diffAux.textContent = DIFF_NAMES[v];
    const color = DIFF_COLORS[v];                          // cor segue a dificuldade (stepper todo)
    el.diffVal.style.color = color;
    el.diffVal.style.textShadow = `0 0 12px ${color}`;
    el.diffVal.style.borderLeftColor = `${color}59`;
    el.diffVal.style.borderRightColor = `${color}59`;
    el.diffAux.style.color = color;
    const stepper = el.diffVal.closest(".stepper");
    if (stepper) {
      stepper.style.borderColor = color;
      stepper.style.boxShadow = `0 0 16px ${color}3a, inset 0 0 16px ${color}14`;
      for (const btn of stepper.querySelectorAll(".step-btn")) btn.style.color = color;
    }
  } });
  defineSetting("map", { ls: "lc.map", def: 0, min: 0, max: ARENA_NAMES.length - 1, apply: (v) => {
    el.mapVal.textContent = ARENA_NAMES[v];                // nome do mapa
    el.mapAux.textContent = "";
    if (!app.running) { applyArenaConfig(); previewArena(); }   // em partida: só vale na próxima (não mexe no grid vivo)
  } });
  defineSetting("arenaSize", { ls: "lc.arenaSize", def: 1, min: 0, max: ARENA_SIZES.length - 1, apply: (v) => {
    el.sizeVal.textContent = ARENA_SIZE_NAMES[v];
    el.sizeAux.textContent = ARENA_SIZES[v] + "²";         // ex.: 180²
    if (!app.running) { applyArenaConfig(); previewArena(); }   // idem: muda COLS/ROWS só fora da partida
  } });
  defineSetting("gfx", { ls: "lc.gfx", def: 0, min: 0, max: 2, apply: (v) => {
    el.gfxVal.textContent = GFX_NAMES[v];
    el.gfxAux.textContent = GFX_HINTS[v];
    renderer.setQuality(GFX_MODES[v]);                     // lowFx / DPR / ratchet
    if (!app.running && state.roster.length) renderer.render(state);   // reflete na hora (o resize limpou o canvas)
  } });
  defineSetting("gameMode", { ls: "lc.gameMode", def: 0, min: 0, max: 1, apply: (v) => {
    el.modeFfa.classList.toggle("active", v === 0);   // pílulas no menu principal
    el.modeTeams.classList.toggle("active", v === 1);
    if (!app.running) state.gameMode = v === 1 ? "teams" : "ffa";   // em partida: só vale na próxima
  } });
}

// ---- Roster / round ----
// Monta o roster a partir do modo + nº de CPUs (ARES força 1 CPU).
const TEAM_HUES = [205, 28];   // Time A (azul-ciano), Time B (laranja)
function teamSkin(team, idx) {
  const base = TEAM_HUES[team] ?? 205;
  const h = (base + (idx % 4) * 8) % 360;   // leve variação pra distinguir companheiros do mesmo time
  return { color: hueColor(h), glow: hueGlow(h), hue: h };
}

function configureRoster(mode) {
  state.mode = mode;
  state.difficulty = settings.difficulty;
  state.gameMode = (!state.ares && settings.gameMode === 1) ? "teams" : "ffa";   // ARES é sempre FFA
  const humans = mode === "2p" ? 2 : 1;
  const cpus = state.ares ? 1 : (mode === "2p" ? settings.mpCpus : settings.spCpus);
  const total = humans + cpus;
  const cpuCount = total - humans;
  state.roster = [];
  for (let i = 0; i < total; i++) {
    const isAI = i >= humans;
    const label = !isAI ? `P${i + 1}` : (state.ares ? "ARES" : (cpuCount > 1 ? `CPU ${i - humans + 1}` : "CPU"));
    state.roster.push({ isAI, label, team: state.gameMode === "teams" ? (i % 2) : -1 });   // times alternados
  }
  state.scores = new Array(total).fill(0);
  state.teamScores = [0, 0];
}

let prevAlive = [];
let prevTrailGone = [];   // p/ disparar o pop do de-rez quando a trilha some
let windupFired = [];     // p/ disparar o windup uma vez, 1s antes do corte
function resetRound() {
  applyColors();
  state.grid = createGrid();
  applyArena(state.grid, state.arenaLayout);              // marca os obstáculos do layout da partida
  state.particles = [];
  const total = state.roster.length;
  const layout = spawnLayout(total);
  state.players = state.roster.map((r, i) => {
    const skin = (state.ares && r.isAI) ? aresSkin()                            // ARES = programa vermelho
      : (state.gameMode === "teams" ? teamSkin(r.team, i)                       // modo times: cor do time
      : (lanHues && lanHues[i] != null ? { color: hueColor(lanHues[i]), glow: hueGlow(lanHues[i]), hue: lanHues[i] }  // LAN: cor do lobby (humanos)
      : skinForIndex(i, total)));                                               // CPUs / local: matiz espalhada
    const p = makePlayer(i + 1, layout[i].col, layout[i].row, layout[i].dir, r.isAI, skin, r.label);
    p.team = r.team ?? -1;
    return p;
  });
  for (const player of state.players) state.grid[idx(player.x, player.y)] = player.id;
  clearSpawnRunways(state.grid, state.players);           // abre pista segura à frente de cada spawn
  prevAlive = state.players.map(() => true);
  prevTrailGone = state.players.map(() => false);
  windupFired = state.players.map(() => false);
  setNameplates();                         // balões "quem é quem" (somem logo após o início)
  state.roundWinner = null;
  state.dyingTimer = 0;
  renderer.snapToTarget();
  renderScoreboard();
}

// Balões de identificação no início do round: quem é quem na arena. No local,
// P1/P2 ganham a dica de controles (WASD / setas); no LAN, o nome de cada humano
// (com "· você" no seu). Somem sozinhos (nameplateTimer no frame).
const NAMEPLATE_MS = COUNTDOWN_MS + 600;   // dura a contagem + um respiro, com fade no fim
function setNameplates() {
  for (const p of state.players) { p.tag = null; p.tagKeys = null; }
  if (lanRole) {
    state.players.forEach((p, i) => { if (!p.isAI) p.tag = p.label + (i === lanState.mySlot ? " · você" : ""); });
  } else if (state.mode === "2p") {
    if (state.players[0]) { state.players[0].tag = "P1"; state.players[0].tagKeys = "wasd"; }
    if (state.players[1]) { state.players[1].tag = "P2"; state.players[1].tagKeys = "arrows"; }
  } else if (state.players[0]) {
    state.players[0].tag = "Você"; state.players[0].tagKeys = "wasd";
  }
  state.nameplateTimer = NAMEPLATE_MS;
  buildNameplates();
}
// Cria os elementos DOM dos balões (um por jogador com tag). Posicionados a cada frame.
let nameplateEls = [];
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
    const keys = p.tagKeys === "wasd" ? ["W", "A", "S", "D"] : p.tagKeys === "arrows" ? ["↑", "←", "↓", "→"] : null;
    if (keys) {
      const row = document.createElement("div"); row.className = "np-keys";
      for (const k of keys) { const kb = document.createElement("kbd"); kb.textContent = k; row.appendChild(kb); }
      np.appendChild(row);
    }
    el.nameplates.appendChild(np);
    nameplateEls.push({ el: np, i });
  });
}
// Posiciona os balões a cada frame (segue a moto; filosofia select: vira pra baixo
// se não couber em cima, e nunca sai da tela na horizontal). Some via opacidade.
function updateNameplates() {
  if (!nameplateEls.length) return;
  // só durante uma partida de fato (nunca no menu/resultado/pausa) — evento explícito de renderização
  const inMatch = app.running && !app.paused && (state.phase === "countdown" || state.phase === "playing" || state.phase === "dying");
  if (!inMatch || state.nameplateTimer <= 0) { el.nameplates.style.opacity = "0"; return; }
  el.nameplates.style.opacity = String(Math.min(1, state.nameplateTimer / 600));   // fade nos últimos 600ms
  const vw = window.innerWidth;
  for (const np of nameplateEls) {
    const p = state.players[np.i];
    if (!p || !p.alive) { np.el.style.display = "none"; continue; }
    np.el.style.display = "";
    const prog = p.progress || 0;
    const wx = (p.prevX + (p.x - p.prevX) * prog + 0.5) * CELL;
    const wy = (p.prevY + (p.y - p.prevY) * prog + 0.5) * CELL;
    const s = renderer.worldToScreen(wx, wy);
    const w = np.el.offsetWidth, h = np.el.offsetHeight;
    const gap = 22, topMargin = 44;
    const below = (s.y - gap - h) < topMargin;                           // pouco respiro no topo → vira pra baixo
    np.el.classList.toggle("below", below);
    np.el.style.left = Math.max(w / 2 + 6, Math.min(vw - w / 2 - 6, s.x)) + "px";   // clamp horizontal
    np.el.style.top = (below ? s.y + gap : s.y - gap) + "px";
  }
}
function hideNameplates() { if (el.nameplates) el.nameplates.style.opacity = "0"; }

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
function teamChip(team, winTeam) {
  const h = TEAM_HUES[team], win = team === winTeam;
  const glow = `0 0 12px hsla(${h},100%,60%,.35)` + (win ? `, 0 0 26px hsla(${h},100%,60%,.6)` : "");
  return `<span class="chip${win ? " win" : ""}" style="border-color:hsl(${h},100%,62%);`
    + `background:hsla(${h},100%,55%,.12);box-shadow:${glow}">`
    + `<span class="chip-dot" style="background:hsl(${h},100%,62%);box-shadow:0 0 8px hsl(${h},100%,62%)"></span>`
    + `<span class="chip-name" style="color:hsl(${h},100%,74%)">Time ${team === 0 ? "A" : "B"}</span>`
    + `<span class="chip-score">${state.teamScores[team]}</span></span>`;
}
function teamScoreChips(winTeam = -1) { return teamChip(0, winTeam) + teamChip(1, winTeam); }
function scoreChips(winnerId = null) {
  return state.players.map(p => playerChip(p, winnerId)).join("");
}
function renderScoreboard() {
  if (!state.players) return;
  el.scoreboard.innerHTML = state.gameMode === "teams" ? teamScoreChips() : scoreChips();
}

// ---- Contagem ----
function beginCountdown(fromAres) {
  state.phase = "countdown";
  state.countdownTimer = COUNTDOWN_MS;
  state.countShown = -1;
  el.countdown.classList.toggle("ares", state.ares);      // contagem vermelha no modo ARES
  el.countdown.classList.remove("hidden");
  if (fromAres) {   // dispara o fade-out do título ARES, sobreposto à contagem
    el.aresIntro.style.transition = `opacity ${ARES_FADE_MS}ms ease`;
    el.aresIntro.style.opacity = "0";
    setTimeout(() => el.aresIntro.classList.add("hidden"), ARES_FADE_MS + 60);
  }
  showTouchControls();   // HUD de pilotagem entra junto com a contagem (só em telas de toque)
}
function updateCountdown() {
  const n = Math.max(1, Math.ceil(state.countdownTimer / 1000));   // 3, 2, 1
  if (n !== state.countShown) {
    state.countShown = n;
    el.countdownNum.textContent = n;
    el.countdownNum.style.animation = "none";
    void el.countdownNum.offsetWidth;          // reinicia a animação
    el.countdownNum.style.animation = "count-pop .4s ease";
    audio.tick(false);
  }
}

// ---- Loop ----
let nearMissCd = 0;        // cooldown da vinheta de quase-acidente (ms)
let stepTickCd = 0;        // cooldown do tique de passo (ms)
const lastHeadKey = [];    // última célula da cabeça por jogador humano (detecta passo)
let aresEscAllowed = false; // ARES: Esc de saída só libera após a 1ª morte/derrota
const panScratch = [];     // reusado todo frame (evita alocar um array por frame p/ o pan estéreo)

function frame(timestamp) {
  if (!app.lastTime) app.lastTime = timestamp;
  let dt = timestamp - app.lastTime;
  app.lastTime = timestamp;
  if (dt > 200) dt = 200;

  if (!app.paused) {
    updateParticles(state, dt);
    if (state.nameplateTimer > 0) state.nameplateTimer -= dt;   // some com os balões "quem é quem"
    if (lanRole === "client") {
      /* partida LAN: o estado vem dos snapshots (lanApplySnapshot) — nada a simular aqui */
    } else if (state.phase === "aresintro") {
      if (isTerminalActive()) updateAresTerminal(dt);
      if (!isTerminalActive()) {
        state.introTimer -= dt;
        if (state.introTimer <= 0) beginCountdown(true);
      }
    } else if (state.phase === "countdown") {
      state.countdownTimer -= dt;
      if (state.countdownTimer <= 0) {
        state.phase = "playing";
        el.countdown.classList.add("hidden");
        audio.tick(true);
      } else {
        updateCountdown();
      }
    } else if (state.phase === "playing" || state.phase === "dying") {
      if (advance(state, dt)) renderScoreboard();   // round terminou → placar
      for (let i = 0; i < state.players.length; i++) {
        const p = state.players[i];
        if (prevAlive[i] && !p.alive) {
          audio.explosion(renderer.screenPan(p));
          renderer.addShake(SHAKE_DEATH);              // tremor de tela na morte
          renderer.addFlash(0.22, "#ffffff");
          if (state.ares) aresEscAllowed = true;       // 1ª morte no ARES → libera o Esc de saída
        }
        // windup do de-rez: dispara quando falta TRAIL_WINDUP_MS pro corte (1s antes do pop)
        if (!p.alive && !p.trailGone && !windupFired[i] && p.fadeTimer <= TRAIL_WINDUP_MS) {
          audio.derezWindup(renderer.screenPan(p), TRAIL_WINDUP_MS / 1000);
          windupFired[i] = true;
        }
        if (!prevTrailGone[i] && p.trailGone) audio.trailDerez(renderer.screenPan(p));   // corte: pop do de-rez (logo após o windup)
        prevAlive[i] = p.alive;
        prevTrailGone[i] = p.trailGone;
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
  if (lanRole === "host") lanSendSnapshot();      // host transmite o estado a cada frame
  renderer.updateCamera(state, dt);
  let pans = null;
  if (state.players) {
    pans = panScratch;
    pans.length = state.players.length;
    for (let i = 0; i < state.players.length; i++) pans[i] = renderer.screenPan(state.players[i]);
  }
  audio.update(state, app.paused, pans);
  renderer.render(state);
  updateNameplates();
  if (app.running) requestAnimationFrame(frame);
}

// ---- Fluxo ----
async function startMatch(mode) {
  lanRole = null; lanHues = null; setLanSteer(null);   // partida local: garante que o modo LAN está desligado
  const chance = mode === "2p" ? ARES_CHANCE / 10 : ARES_CHANCE;
  state.ares = Math.random() < chance;     // sorteia o modo ARES
  aresEscAllowed = false;                  // re-arma o trava-ESC do ARES (libera só após a 1ª morte)
  configureRoster(mode);                   // ARES força 1 CPU
  applyArenaConfig();                      // tamanho + mapa escolhidos em Opções > Mapas
  showOnly(null);
  if (state.gameMode === "teams" && !state.ares) { openTeamSelect(); return; }   // modo Times: escolhe os lados antes de começar
  await beginMatch();
}
async function beginMatch() {
  showOnly(null);                          // fecha a seleção de time / menus antes de começar
  resetRound();
  app.paused = false;
  app.running = true;
  app.lastTime = 0;
  audio.resume();                          // contexto de áudio precisa de um gesto (este clique)
  window.focus();
  if (state.ares) {
    music.prime();                         // destrava o áudio no gesto; a música só toca no fim do terminal
    await loadAresTerminalLines();
    showAresIntro();
  } else {
    audio.setEnginesActive(true);
    music.start(false);                    // trilha normal já começa
    beginCountdown(false);
  }
  requestAnimationFrame(frame);
}

// ---- Seleção de time (modo Times, antes da partida) ----
function openTeamSelect() {
  for (const r of state.roster) if (!r.isAI) r.team = -1;   // humanos começam neutros
  balanceCPUs();
  state.phase = "teamselect";
  renderTeamSelect();
  showOnly(el.teamSelect);
}
function balanceCPUs() {   // distribui os CPUs pro time menor (equilibra)
  const count = [0, 0];
  for (const r of state.roster) if (!r.isAI && r.team >= 0) count[r.team]++;
  for (const r of state.roster) if (r.isAI) { const t = count[0] <= count[1] ? 0 : 1; r.team = t; count[t]++; }
}
function teamSelectMove(playerId, team) {
  const r = state.roster[playerId - 1];
  if (!r || r.isAI) return;
  r.team = team;
  balanceCPUs();
  audio.uiMove();
  renderTeamSelect();
}
function teamSelectConfirm() {
  const humansNeutral = state.roster.some((r) => !r.isAI && r.team < 0);
  const bothTeams = state.roster.some((r) => r.team === 0) && state.roster.some((r) => r.team === 1);
  if (humansNeutral || !bothTeams) { renderer.addFlash(0.3, "#ff2a2a"); audio.error(); return; }   // falta alguém escolher / faltou um dos times
  beginMatch();
}
function renderTeamSelect() {
  el.teamColA.innerHTML = ""; el.teamColNeutral.innerHTML = ""; el.teamColB.innerHTML = "";
  state.roster.forEach((r, i) => {
    const col = r.team === 0 ? el.teamColA : r.team === 1 ? el.teamColB : el.teamColNeutral;
    const hue = r.team === 0 ? TEAM_HUES[0] : r.team === 1 ? TEAM_HUES[1] : 210;
    const t = document.createElement("div");
    t.className = "ts-token" + (r.isAI ? " ai" : "");
    t.innerHTML = `<span class="ts-dot" style="background:hsl(${hue},100%,62%);box-shadow:0 0 8px hsl(${hue},100%,62%)"></span>`
      + `<span>${r.label}</span>` + (r.isAI ? "" : `<span class="ts-hint">${i === 0 ? "A / D" : "← / →"}</span>`);
    col.appendChild(t);
  });
}

function again() {   // "Again" local = nova partida; no LAN = "Continuar" → rematch (volta pro lobby)
  if (lanRole) { if (lanAvailable() && window.lan.returnLobby) window.lan.returnLobby(); return; }
  startMatch(state.mode);
}

function goMenu() {
  app.running = false;
  app.paused = false;
  if (lanRole) { if (lanAvailable()) window.lan.leave(); lanRole = null; lanHues = null; setLanSteer(null); }   // encerra a sessão LAN
  hideTouchControls();
  state.phase = "menu";
  state.ares = false;                      // modo ARES só sai ao voltar pro menu
  stopTerminal();                          // encerra a sequência do terminal se estava no meio
  el.aresIntro.classList.add("hidden");
  el.aresTerminal.classList.add("hidden");
  el.countdown.classList.add("hidden");
  resetRound();                            // limpa as trilhas (some o vermelho do ARES atrás do menu)
  state.nameplateTimer = 0; hideNameplates();   // nada de balões no menu (o resetRound acima os rearma)
  renderer.updateCamera(state, 0);
  renderer.render(state);
  showOnly(el.menu);
  music.playMenu();                        // tema do menu (Solar Sailer, em loop)
  audio.setEnginesActive(false);
}

let optionsReturn = "menu";   // de onde as Opções foram abertas: menu principal, pausa ou lobby (LAN)
function openOptions()     { optionsReturn = "menu"; showOnly(el.optionsMenu); }
function pauseOptions()    { optionsReturn = "pause"; showOnly(el.optionsMenu); }
function lobbyOptions()    { optionsReturn = "lobby"; showOnly(el.optionsMenu); }
function closeOptions() {
  if (optionsReturn === "pause") { showOnly(el.pauseMenu); return; }
  if (optionsReturn === "lobby") {
    showOnly(el.lobby);
    if (lobbyKind === "local") renderLocalRoster();                                        // CPUs/mapa podem ter mudado
    else if (lanState.isHost && lanAvailable()) window.lan.setMatch(currentMatchConfig()); // host: atualiza a config da partida
    return;
  }
  showOnly(el.menu);
}
function openColors()      { showOnly(el.colorsMenu); }
function openAudio()       { showOnly(el.audioMenu); }
function openAdversaries() { showOnly(el.advMenu); }
function openMaps()        { showOnly(el.mapsMenu); }
function openGraphics()    { showOnly(el.graphicsMenu); }
function openSounds()      { showOnly(el.soundsMenu); }
function backToOptions()   { showOnly(el.optionsMenu); }
function backToMenu()      { showOnly(el.menu); }

// ---- Pausa (Esc durante a partida local) ----
function pauseGame() {
  if (state.ares) return;   // ARES não pausa
  if (!(state.phase === "playing" || state.phase === "dying" || state.phase === "countdown")) return;
  app.paused = true;
  music.pause();
  el.pauseTitle.textContent = "Pausado";                                     // reset (caso um jogo LAN tenha mudado)
  el.btnPauseResume.style.display = "";
  el.btnPauseOptions.style.display = "";
  el.btnPauseMenu.querySelector(".btn-label").textContent = "Menu principal";
  showOnly(el.pauseMenu);
}
function resumeGame() {
  app.paused = false;
  music.resume();
  showOnly(null);
}

// ---- Sair do jogo (com confirmação) ----
const isDesktop = () => !!window.electronApp;
function openQuitConfirm() { showOnly(el.quitConfirm); }
function quitApp() {
  if (window.electronApp?.quit) { window.electronApp.quit(); return; }   // Electron
  window.close();                                                        // fallback (browser)
}

// ---- Multiplayer (menu + LAN) ----
function openMultiplayer()   { showOnly(el.multiplayerMenu); }
function openLan()           { showOnly(el.lanMenu); }
function backToMultiplayer() { showOnly(el.multiplayerMenu); }
function backToLan()         { showOnly(el.lanMenu); }
function openLanFind()       { showOnly(el.lanFind); startFindSessions(); }

// Rede exposta pelo Electron (window.lan). No browser sem ponte, fica indisponível.
let lanState = { active: false, isHost: false, youId: null, players: [], myHue: 190, myColor: hueColor(190) };
const lanAvailable = () => !!window.lan;
const PROFILE_KEY = "lc.profile";
const getProfileName = () => { try { return (localStorage.getItem(PROFILE_KEY) || "").trim() || "Jogador"; } catch { return "Jogador"; } };
const setProfileName = (n) => { try { localStorage.setItem(PROFILE_KEY, n); } catch {} };
const currentMatchConfig = () => ({ map: settings.map ?? 0, size: settings.arenaSize ?? 1, difficulty: settings.difficulty ?? 2, cpus: settings.mpCpus ?? 0, gameMode: settings.gameMode ?? 0 });

async function createSession() {
  if (!lanAvailable()) return;
  const h = +el.hue1.value;
  lanState = { active: true, isHost: true, youId: null, players: [], myHue: h, myColor: hueColor(h) };
  const info = await window.lan.create({ name: "Sala de " + getProfileName(), playerName: getProfileName(), color: lanState.myColor,
    match: currentMatchConfig() });
  lanState.youId = info.youId;
  lanState.players = info.players || [];
  openLobby();
}
async function joinSessionEntry(session) {
  if (!lanAvailable()) return;
  const h = +el.hue2.value;
  lanState = { active: true, isHost: false, youId: null, players: [], myHue: h, myColor: hueColor(h) };
  await window.lan.join(session, { playerName: getProfileName(), color: lanState.myColor });
  openLobby();
}
let lanListSig = "";   // assinatura do conjunto de sessões exibido (evita reconstruir à toa)
function startFindSessions() {
  el.lanSessionList.innerHTML = "";
  lanListSig = "";                                            // força reconstruir na próxima render
  if (!lanAvailable()) { el.lanFindStatus.textContent = "LAN disponível só no app desktop (Electron)."; return; }
  el.lanFindStatus.textContent = "Procurando sessões na rede…";
  window.lan.find().then(renderSessions);
}
function exitLanFind() { if (lanAvailable()) window.lan.stopFind(); backToLan(); }

// Só reconstrói DOM/navegação quando o conjunto de sessões REALMENTE muda — senão a
// reconstrução a cada anúncio (~1/s) apagava o botão focado e o outline "sumia".
function renderSessions(list) {
  el.lanFindStatus.textContent = list.length ? "Selecione uma sessão para entrar:" : "Procurando sessões na rede…";
  const sig = list.map((s) => `${s.id}:${s.players}/${s.max}@${s.host}:${s.tcpPort}`).join("|");
  if (sig === lanListSig) return;                            // nada mudou → preserva foco/outline
  lanListSig = sig;
  el.lanSessionList.innerHTML = "";
  for (const s of list) {
    const b = document.createElement("button");
    b.className = "lan-session";
    const nm = document.createElement("span"); nm.textContent = s.name;
    const info = document.createElement("span"); info.className = "lan-host"; info.textContent = `${s.players}/${s.max} · ${s.host}`;
    b.append(nm, info);
    b.addEventListener("click", () => joinSessionEntry(s));
    el.lanSessionList.appendChild(b);
  }
  registerMenu(el.lanFind, [
    ...Array.from(el.lanSessionList.children).map((b) => ({ el: b, type: "button", run: () => b.click() })),
    navBtn("btn-lan-refresh"), navBtn("btn-lan-find-back"),
  ]);
  if (!el.lanFind.classList.contains("hidden")) refreshNav();
}

// A "sala de lobby" (#lobby) serve os dois fluxos: LAN (jogadores em rede) e local
// (singleplayer / multiplayer local). `lobbyKind` decide o que aparece e o que o
// botão "Pronto" faz (marcar pronto na rede vs. começar a partida local).
let lobbyKind = "lan";   // "lan" | "local"

function openLobby() {   // LAN
  lobbyKind = "lan";
  el.lobbyTitle.textContent = "Lobby";
  el.lobbyName.value = getProfileName();
  el.lobbyHue.value = lanState.myHue;
  applyLobbyColor(false);
  setLobbyKindUI();
  if (lanState.isHost && lanAvailable()) window.lan.setMatch(currentMatchConfig());
  registerLobbyNav();
  showOnly(el.lobby);
  renderLobby();
}

function openLocalLobby(mode) {   // singleplayer / multiplayer local
  lobbyKind = "local";
  lanRole = null; lanHues = null; setLanSteer(null);   // garante que o modo LAN está desligado
  state.mode = mode;
  el.lobbyTitle.textContent = mode === "2p" ? "Multiplayer Local" : "1 Jogador";
  setLobbyKindUI();
  renderLocalRoster();
  registerLobbyNav();
  showOnly(el.lobby);
}

// Ajusta o que aparece no lobby conforme o tipo (LAN x local) e o papel (host x cliente).
function setLobbyKindUI() {
  const isLan = lobbyKind === "lan";
  const showMode = !isLan || lanState.isHost;   // switch de modo: local sempre; LAN só o host
  el.lobbyNameField.style.display = isLan ? "" : "none";   // nome/cor de rede: só no LAN
  el.lobbyColors.style.display = isLan ? "" : "none";
  el.modeSeg.style.display = showMode ? "" : "none";
  el.btnLobbyOptions.style.display = showMode ? "" : "none";
  el.btnLobbyReady.textContent = isLan ? "Pronto" : "Começar";
  el.btnLobbyLeave.querySelector(".btn-label").textContent = isLan ? "Sair" : "Voltar";
}

// Preview do roster local (quem vai jogar) — mesmas cores da partida (skinForIndex).
function renderLocalRoster() {
  configureRoster(state.mode);   // monta state.roster + state.gameMode a partir das settings (a partida remonta depois)
  const teams = state.gameMode === "teams";
  const total = state.roster.length;
  el.lobbyPlayers.innerHTML = "";
  state.roster.forEach((r, i) => {
    const c = hueColor(skinForIndex(i, total).hue);
    const row = document.createElement("div"); row.className = "lobby-player";
    const dot = document.createElement("span"); dot.className = "pdot"; dot.style.background = c; dot.style.boxShadow = `0 0 8px ${c}`;
    const name = document.createElement("span"); name.className = "pname"; name.textContent = r.label;
    row.append(dot, name);
    el.lobbyPlayers.appendChild(row);
  });
  el.lobbyStatus.textContent = teams ? "No modo Times você escolhe os lados ao começar." : "Pronto para começar.";
}

function onModeChange(v) {
  setSetting("gameMode", v);   // apply acende as pílulas + ajusta state.gameMode (fora de partida)
  if (lobbyKind === "lan") { if (lanState.isHost && lanAvailable()) window.lan.setMatch(currentMatchConfig()); }
  else renderLocalRoster();
}
function refreshModeSwatches() {   // pílulas de modo herdam as cores reais: P1 (hue1) no FFA, TEAM_HUES no Times
  el.modeFfa.style.setProperty("--ffa-h", +el.hue1.value);
  el.modeTeams.style.setProperty("--a-h", TEAM_HUES[0]);
  el.modeTeams.style.setProperty("--b-h", TEAM_HUES[1]);
}
function onLobbyReady() { if (lobbyKind === "local") startMatch(state.mode); else toggleReady(); }
function onLobbyLeave() {
  if (lobbyKind === "local") { audio.uiBack(); showOnly(state.mode === "2p" ? el.multiplayerMenu : el.menu); }
  else leaveLan();
}
function leaveLan() { lanState.active = false; lanRole = null; lanHues = null; setLanSteer(null); if (lanAvailable()) window.lan.leave(); showOnly(el.lanMenu); }
function lanReturnToLobby() { if (lanRole) { app.running = false; openLobby(); } }   // "return" da rede → rematch no lobby

// Host caiu (cliente perdeu a conexão): no lobby, o próximo jogador do array assume
// como host e os demais reprocuram; no meio da partida, encerra a sessão limpo.
function lanHostLeft() {
  const others = (lanState.players || []).filter((p) => !p.isHost);   // clientes na ordem
  const iAmNext = others[0] && others[0].id === lanState.youId;       // sou o próximo → viro host
  const inMatch = app.running;
  app.running = false; app.paused = false; lanRole = null; lanHues = null; lanPausedBy = null;
  setLanSteer(null); lanState.active = false;
  if (inMatch) { console.log("%c[LAN]", "color:#ff8a1e", "host saiu no meio da partida — sessão encerrada"); showOnly(el.lanMenu); }
  else if (iAmNext) { console.log("%c[LAN]", "color:#7CFC00", "host saiu — assumindo como novo host"); createSession(); }
  else { console.log("%c[LAN]", "color:#19e0ff", "host saiu — procurando o novo host"); openLanFind(); }
}

// ---- Pausa LAN (sincronizada, host-autoritativa) ----
function lanRequestPause() { if (lanAvailable()) window.lan.pause(); }
function lanResume() { if (lanAvailable()) window.lan.resume(); }
function onPauseResume() { if (lanRole) lanResume(); else resumeGame(); }
function lanEscPause() {
  if (isOpenSub()) { audio.uiBack(); backToOptions(); return; }                                  // sub-opção → opções (host)
  if (!el.optionsMenu.classList.contains("hidden")) { audio.uiBack(); closeOptions(); return; }  // opções → pausa
  if (!el.pauseMenu.classList.contains("hidden")) {                                              // pausado
    const amPauser = lanPausedBy && lanPausedBy.id === lanState.youId;
    if (amPauser || lanRole === "host") { audio.uiBack(); lanResume(); }                         // pauser ou host retoma
    return;
  }
  lanRequestPause();                                                                             // rodando → pausa
}
function lanOnPause(data) { lanPausedBy = { id: data.by, name: data.name }; app.paused = true; music.pause(); showLanPauseMenu(); }
function lanOnResume() { lanPausedBy = null; app.paused = false; music.resume(); showOnly(null); }
function showLanPauseMenu() {
  const amPauser = lanPausedBy && lanPausedBy.id === lanState.youId;
  const isHost = lanRole === "host";
  el.pauseTitle.textContent = amPauser ? "Pausado" : `${(lanPausedBy && lanPausedBy.name) || "Jogador"} pausou`;
  el.btnPauseResume.style.display = (amPauser || isHost) ? "" : "none";       // só o pauser (ou o host) retoma
  el.btnPauseOptions.style.display = (isHost && amPauser) ? "" : "none";      // opções só p/ host que pausou
  el.btnPauseMenu.querySelector(".btn-label").textContent = "Sair";          // no LAN o botão vira "Sair"
  showOnly(el.pauseMenu);
}

function applyLobbyColor(sendNet) {
  const c = hueColor(lanState.myHue);
  lanState.myColor = c;
  el.lobbyHue.style.setProperty("--thumb", c);
  el.lobbySwatch.style.background = c; el.lobbySwatch.style.boxShadow = `0 0 8px ${c}`;
  if (sendNet && lanAvailable()) window.lan.setColor(c);
}
let lobbyColorTimer = null;
function lobbyHueInput() {
  lanState.myHue = +el.lobbyHue.value;
  applyLobbyColor(false);                                                    // visual imediato
  clearTimeout(lobbyColorTimer);
  lobbyColorTimer = setTimeout(() => { if (lanAvailable()) window.lan.setColor(hueColor(lanState.myHue)); }, 120);  // rede com debounce
}
let lobbyNameTimer = null;
function lobbyNameInput() {
  const n = el.lobbyName.value.slice(0, 16);
  setProfileName(n);                                                         // persiste local (localStorage)
  clearTimeout(lobbyNameTimer);
  lobbyNameTimer = setTimeout(() => { if (lanAvailable() && window.lan.setName) window.lan.setName(n.trim() || "Jogador"); }, 200);
}
function toggleReady() {
  const me = lanState.players.find((p) => p.id === lanState.youId);
  if (lanAvailable()) window.lan.setReady(!(me && me.ready));
}
function registerLobbyNav() {
  const nav = [];
  if (lobbyKind === "local" || lanState.isHost) nav.push(navStepper(el.modeSeg, () => onModeChange(0), () => onModeChange(1)));
  if (lobbyKind === "lan") { nav.push(navInput(el.lobbyName)); nav.push(navSlider(el.lobbyHue, 8)); }   // nome navegável por teclado (Enter edita)
  nav.push(navBtn("btn-lobby-ready"));
  if (lobbyKind === "local" || lanState.isHost) nav.push(navBtn("btn-lobby-options"));
  nav.push(navBtn("btn-lobby-leave"));
  registerMenu(el.lobby, nav);
}
function renderLobby() {
  el.lobbyPlayers.innerHTML = "";
  for (const p of lanState.players) {
    const row = document.createElement("div");
    row.className = "lobby-player" + (p.id === lanState.youId ? " me" : "");
    const dot = document.createElement("span"); dot.className = "pdot"; dot.style.background = p.color; dot.style.boxShadow = `0 0 8px ${p.color}`;
    const name = document.createElement("span"); name.className = "pname";
    name.textContent = p.name + (p.isHost ? " (host)" : "") + (p.id === lanState.youId ? " · você" : "");
    const rd = document.createElement("span"); rd.className = "pready " + (p.ready ? "on" : "off"); rd.textContent = p.ready ? "Pronto" : "Aguardando";
    row.append(dot, name, rd);
    el.lobbyPlayers.appendChild(row);
  }
  const me = lanState.players.find((p) => p.id === lanState.youId);
  el.btnLobbyReady.textContent = me && me.ready ? "Cancelar" : "Pronto";
  el.lobbyStatus.textContent = lanState.players.length < 2 ? "Aguardando outro jogador entrar…" : "Marque pronto para começar.";
}
// ---- Partida LAN (host-autoritativo: host simula e transmite estado; cliente renderiza + envia input) ----
let lanRole = null;              // "host" | "client" | null
let lanHues = null;              // matiz por slot na partida LAN (do lobby)
let lanSlotById = {};            // id do jogador → slot
const lanSyncLens = [];          // trilha já transmitida por player (host, delta)
let lanRoundHost = 0, lanClientRound = 0;
let lanPrevAlive = [];
let lanPausedBy = null;   // { id, name } de quem pausou (LAN), ou null
const hueOf = (c) => { const m = /hsl\((\d+)/.exec(c || ""); return m ? +m[1] : 190; };

function startLanMatch(payload) {
  lanRole = lanState.isHost ? "host" : "client";
  const players = payload.players.slice().sort((a, b) => a.slot - b.slot);
  lanHues = players.map((p) => hueOf(p.color));
  lanSlotById = {}; players.forEach((p) => { lanSlotById[p.id] = p.slot; });
  lanState.mySlot = lanSlotById[lanState.youId] ?? 0;
  state.ares = false;
  state.mode = "2p";
  const m = payload.match || {};
  state.gameMode = m.gameMode === 1 ? "teams" : "ffa";
  const cpus = Math.max(0, Math.min(m.cpus ?? 0, 8 - players.length));   // CPUs (IA rodada no host) cabendo no limite
  const roster = [
    ...players.map((p, i) => ({ isAI: false, label: p.name || `P${i + 1}` })),
    ...Array.from({ length: cpus }, (_, k) => ({ isAI: true, label: cpus > 1 ? `CPU ${k + 1}` : "CPU" })),
  ];
  // Times no LAN: alternado por ordem de slot — determinístico, host e cliente chegam
  // no MESMO resultado sem precisar de sincronização extra da escolha de times.
  roster.forEach((r, i) => { r.team = state.gameMode === "teams" ? (i % 2) : -1; });
  state.roster = roster;
  state.difficulty = m.difficulty ?? settings.difficulty;
  state.scores = new Array(state.roster.length).fill(0);
  state.teamScores = [0, 0];
  setArenaSize(ARENA_SIZES[m.size ?? 1]); state.arenaLayout = buildArenaLayout(m.map ?? 0, COLS);
  showOnly(null);
  lanRoundHost = 0; lanClientRound = 0;
  resetRound();
  lanAfterReset();
  app.paused = false; app.running = true; app.lastTime = 0;
  audio.resume(); audio.setEnginesActive(true); music.start(false);
  setLanSteer(lanLocalSteer);
  beginCountdown(false);          // os dois mostram a contagem; no cliente o timing vem dos snapshots
  requestAnimationFrame(frame);
}
function lanAfterReset() {        // host: reseta o rastreio de delta pós-resetRound (spawn já existe nos dois)
  lanSyncLens.length = 0;
  lanPrevAlive = state.players.map((p) => p.alive);
  state.players.forEach((p, i) => { lanSyncLens[i] = p.trail.length; });
}
function lanLocalSteer(dir) {     // input local → host aplica no próprio slot; cliente envia pro host
  const p = state.players && state.players[lanState.mySlot];
  if (!p || dir === OPPOSITE[p.dir]) return;
  if (lanRole === "host") p.nextDir = dir;
  else if (lanAvailable()) window.lan.sendInput(dir);
}
function lanHostInput(data) {     // host: aplica o input recebido de um cliente no slot dele
  const p = state.players && state.players[lanSlotById[data.id]];
  if (p && p.alive && data.dir !== OPPOSITE[p.dir]) p.nextDir = data.dir;
}
function lanSendSnapshot() {
  if (!lanAvailable() || !state.players) return;
  window.lan.sendState({
    ph: state.phase, rw: state.roundWinner, ct: state.countdownTimer, dy: state.dyingTimer,
    round: lanRoundHost, sc: state.scores.slice(), ts: state.teamScores.slice(),
    players: serializePlayers(state.players, lanSyncLens),
  });
}
function lanApplySnapshot(snap) {
  if (lanRole !== "client" || !snap || !state.players) return;
  if (snap.round !== lanClientRound) {          // host começou novo round → reconstrói idêntico
    lanClientRound = snap.round;
    resetRound();
    lanPrevAlive = state.players.map(() => true);
    state.countShown = -1;
  }
  state.scores = snap.sc; state.roundWinner = snap.rw;
  if (snap.ts) state.teamScores = snap.ts;
  state.countdownTimer = snap.ct; state.dyingTimer = snap.dy;
  applyPlayers(state.players, snap.players);
  const prevPhase = state.phase;
  state.phase = snap.ph;
  if (snap.ph === "countdown") { el.countdown.classList.remove("hidden"); updateCountdown(); }
  else el.countdown.classList.add("hidden");
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    if (lanPrevAlive[i] && !p.alive) { audio.explosion(renderer.screenPan(p)); renderer.addShake(SHAKE_DEATH); renderer.addFlash(0.22, "#ffffff"); }
    lanPrevAlive[i] = p.alive;
  }
  renderScoreboard();
  if (snap.ph === "result" && prevPhase !== "result") {
    if (state.gameMode === "teams") {
      const winTeam = state.teamScores.findIndex((s) => s >= WIN_SCORE);
      showVictoryTeam(winTeam >= 0 ? winTeam : 0);
    } else {
      const champ = state.players.find((p) => state.scores[p.id - 1] >= WIN_SCORE) || state.players[0];
      showVictory(champ);
    }
  }
}

// Eventos vindos do processo main (Electron). Registrado uma vez.
if (window.lan) window.lan.on((msg) => {
  if (msg.type === "log") { console.log("%c[LAN]", "color:#19e0ff;font-weight:bold", msg.data); return; }
  if (msg.type !== "state" && msg.type !== "input") console.log("%c[LAN]", "color:#7CFC00;font-weight:bold", msg.type, msg.data ?? "");
  if (msg.type === "sessions") renderSessions(msg.data);
  else if (msg.type === "welcome") { lanState.youId = msg.data.youId; renderLobby(); }
  else if (msg.type === "lobby") { lanState.players = msg.data.players; renderLobby(); }
  else if (msg.type === "start") startLanMatch(msg.data);
  else if (msg.type === "input") lanHostInput(msg.data);       // host: input de um cliente
  else if (msg.type === "state") lanApplySnapshot(msg.data);   // cliente: snapshot do host
  else if (msg.type === "return") lanReturnToLobby();          // rematch → todos voltam pro lobby
  else if (msg.type === "pause") lanOnPause(msg.data);         // alguém pausou → congela + overlay
  else if (msg.type === "resume") lanOnResume();
  else if (msg.type === "disconnect") { if (lanState.active && !lanState.isHost) lanHostLeft(); }   // host caiu → migração/rediscovery
});

// ---- Tela cheia (toggle no menu de gráficos) ----
// No app (Electron) usa o fullscreen NATIVO da janela: abre em tela cheia por default
// e o ESC NÃO sai dela — fica livre pro "voltar/pausar" do jogo. No browser cai na
// Fullscreen API padrão (onde o ESC sai, sem como evitar).
function fsElement() { return document.fullscreenElement || document.webkitFullscreenElement; }
function setFsSwitch(on) {
  el.btnFullscreen.classList.toggle("on", !!on);     // bolinha p/ a direita quando ligado
  el.btnFullscreen.setAttribute("aria-checked", on ? "true" : "false");
}
async function toggleFullscreen() {
  if (window.electronFS) { setFsSwitch(await window.electronFS.toggle()); return; }
  if (fsElement()) { (document.exitFullscreen || document.webkitExitFullscreen)?.call(document); return; }
  const r = document.documentElement;
  const p = (r.requestFullscreen || r.webkitRequestFullscreen)?.call(r);
  if (p && p.catch) p.catch(() => {});
}
async function syncFullscreenLabel() {
  if (window.electronFS) { setFsSwitch(await window.electronFS.isFullscreen()); return; }
  setFsSwitch(!!fsElement());
}

// Fim de round: alguém chegou a 5 → fim de partida; senão, próximo round.
function endRound() {
  if (state.gameMode === "teams") {
    const winTeam = state.teamScores.findIndex((s) => s >= WIN_SCORE);
    if (winTeam >= 0) showVictoryTeam(winTeam);
    else nextRound();
    return;
  }
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
  if (lanRole === "host") { lanRoundHost++; lanAfterReset(); }   // novo round → sincroniza o reset com os clientes
  beginCountdown(false);     // 3-2-1 e segue
}

function showVictory(champ) {
  state.phase = "result";
  app.running = false;
  hideTouchControls();
  hideNameplates();
  audio.setEnginesActive(false);
  audio.victory();
  el.resultTitle.textContent = `${champ.label} venceu`;
  el.resultTitle.style.color = champ.color;
  el.resultTitle.style.textShadow = `0 0 16px ${champ.color}`;
  el.resultScore.innerHTML = scoreChips(champ.id);
  const againLbl = document.querySelector("#btn-again .btn-label");   // LAN: "Continuar"/"Sair"; local: "Again"/"Menu"
  const menuLbl = document.querySelector("#btn-menu .btn-label");
  if (againLbl) againLbl.textContent = lanRole ? "Continuar" : "Again";
  if (menuLbl) menuLbl.textContent = lanRole ? "Sair" : "Menu";
  showOnly(el.result);
}
function showVictoryTeam(team) {
  state.phase = "result";
  app.running = false;
  hideTouchControls();
  hideNameplates();
  audio.setEnginesActive(false);
  audio.victory();
  const c = hueColor(TEAM_HUES[team]);
  el.resultTitle.textContent = `Time ${team === 0 ? "A" : "B"} venceu`;
  el.resultTitle.style.color = c;
  el.resultTitle.style.textShadow = `0 0 16px ${c}`;
  el.resultScore.innerHTML = teamScoreChips(team);
  const againLbl = document.querySelector("#btn-again .btn-label");
  const menuLbl = document.querySelector("#btn-menu .btn-label");
  if (againLbl) againLbl.textContent = lanRole ? "Continuar" : "Again";
  if (menuLbl) menuLbl.textContent = lanRole ? "Sair" : "Menu";
  showOnly(el.result);
}

// Fim do modo ARES: fade pra branco e tudo volta como era, de volta ao menu.
function aresEnd() {
  app.running = false;
  hideTouchControls();
  state.phase = "fade";
  audio.setEnginesActive(false);
  el.fade.style.transition = "opacity 900ms ease";
  el.fade.style.opacity = "1";
  setTimeout(() => {
    goMenu();                 // limpa ARES, para música, restaura tudo e mostra o menu
    el.fade.style.opacity = "0";   // revela o menu tirando o branco
  }, 950);
}

// Esc / botão de sair: depende da fase (no menu volta um nível; no ARES trava até a 1ª morte).
const isOpenSub = () => !el.colorsMenu.classList.contains("hidden")
  || !el.audioMenu.classList.contains("hidden")
  || !el.advMenu.classList.contains("hidden")
  || !el.mapsMenu.classList.contains("hidden")
  || !el.graphicsMenu.classList.contains("hidden")
  || !el.soundsMenu.classList.contains("hidden");

function handleEscape() {
  if (state.phase === "intro") { skipIntro(); return; }   // pula a abertura
  if (state.phase === "teamselect") { audio.uiBack(); goMenu(); return; }   // cancela a seleção de time
  if (state.phase === "menu") {
    if (!el.quitConfirm.classList.contains("hidden")) { audio.uiBack(); backToMenu(); }        // cancela a confirmação de saída
    else if (!el.lobby.classList.contains("hidden")) { audio.uiBack(); onLobbyLeave(); }         // sai do lobby (LAN fecha a sessão; local volta)
    else if (!el.lanFind.classList.contains("hidden")) { audio.uiBack(); exitLanFind(); }      // lista de sessões → LAN (para a descoberta)
    else if (!el.lanMenu.classList.contains("hidden")) { audio.uiBack(); backToMultiplayer(); } // LAN → multiplayer
    else if (!el.multiplayerMenu.classList.contains("hidden")) { audio.uiBack(); backToMenu(); } // multiplayer → menu
    else if (isOpenSub()) { audio.uiBack(); backToOptions(); }
    else if (!el.optionsMenu.classList.contains("hidden")) { audio.uiBack(); closeOptions(); }
  } else if (state.phase === "fade") {
    // já fazendo o fade — ignora
  } else if (state.ares) {
    if (aresEscAllowed) { audio.uiBack(); aresEnd(); }            // ARES: só sai após a 1ª morte/derrota
    else { renderer.addFlash(0.45, "#ff0000"); audio.error(); }   // antes disso: flash vermelho + som de erro
  } else {   // em partida (playing/dying/countdown)
    if (lanRole) { lanEscPause(); return; }                                                   // LAN: Esc pausa (sincronizado)
    if (isOpenSub()) { audio.uiBack(); backToOptions(); }                                      // sub-opção → opções
    else if (!el.optionsMenu.classList.contains("hidden")) { audio.uiBack(); closeOptions(); } // opções → menu de pausa
    else if (!el.pauseMenu.classList.contains("hidden")) { audio.uiBack(); resumeGame(); }     // pausa → continua
    else { pauseGame(); }                                                                      // continua → pausa
  }
}

// HUD de toque: visível só em telas de toque (classe `touch` no body) e durante o jogo.
function showTouchControls() {
  el.touchControls.classList.remove("m-cpu", "m-2p");
  el.touchControls.classList.add(state.mode === "2p" ? "m-2p" : "m-cpu", "active");
}
function hideTouchControls() { el.touchControls.classList.remove("active"); }

// ---- Registro de menus (cada um: overlay + itens navegáveis) ----
// Botões de teste de SFX (submenu Sons, debug) — gerados a partir da lista de sons da engine.
const soundTestNav = [];
function buildSoundTests() {
  const tests = [
    ["de-rez windup", () => audio.derezWindup()],
    ["de-rez pop", () => audio.trailDerez()],
    ["explosão", () => audio.explosion()],
    ["near-miss", () => audio.nearMiss()],
    ["move tick", () => audio.moveTick()],
    ["erro", () => audio.error()],
    ["contagem 3-2-1", () => audio.tick(false)],
    ["contagem GO", () => audio.tick(true)],
    ["vitória", () => audio.victory()],
    ["empate", () => audio.draw()],
    ["ARES stinger", () => audio.aresStinger()],
    ["blip (início)", () => audio.blip()],
    ["UI mover", () => audio.uiMove()],
    ["UI selecionar", () => audio.uiSelect()],
    ["UI voltar", () => audio.uiBack()],
  ];
  for (const [label, play] of tests) {
    const b = document.createElement("button");
    b.className = "neutral snd-test";
    b.textContent = label;
    b.addEventListener("click", () => { audio.resume(); play(); });
    el.soundList.appendChild(b);
    soundTestNav.push({ el: b, type: "button", run: () => b.click() });
  }
}

function buildNav() {
  registerMenu(el.menu, [navBtn("btn-cpu"), navBtn("btn-multiplayer"), navBtn("btn-options"), navBtn("btn-quit")]);
  registerMenu(el.quitConfirm, [navBtn("btn-quit-no"), navBtn("btn-quit-yes")]);
  registerMenu(el.multiplayerMenu, [navBtn("btn-mp-local"), navBtn("btn-mp-lan"), navBtn("btn-mp-back")]);
  registerMenu(el.lanMenu, [navBtn("btn-lan-create"), navBtn("btn-lan-find"), navBtn("btn-lan-back")]);
  registerMenu(el.lanFind, [navBtn("btn-lan-refresh"), navBtn("btn-lan-find-back")]);
  registerMenu(el.lobby, [navSlider(el.lobbyHue, 8), navBtn("btn-lobby-ready"), navBtn("btn-lobby-leave")]);
  registerMenu(el.optionsMenu, [navBtn("btn-adversaries"), navBtn("btn-maps"), navBtn("btn-graphics"), navBtn("btn-audio"), navBtn("btn-colors"), navBtn("btn-sounds"), navBtn("btn-options-back")]);
  registerMenu(el.colorsMenu, [navSlider(el.hue1, 8), navSlider(el.hue2, 8), navBtn("btn-colors-back")]);
  registerMenu(el.audioMenu, [navSlider(el.musicVol, 5), navSlider(el.sfxVol, 5), navBtn("btn-audio-back")]);
  registerMenu(el.advMenu, [
    navStepper(el.spVal.closest(".stepper"), () => stepSetting("spCpus", -1), () => stepSetting("spCpus", 1)),
    navStepper(el.mpVal.closest(".stepper"), () => stepSetting("mpCpus", -1), () => stepSetting("mpCpus", 1)),
    navStepper(el.diffVal.closest(".stepper"), () => stepSetting("difficulty", -1), () => stepSetting("difficulty", 1)),
    navBtn("btn-adv-back"),
  ]);
  registerMenu(el.mapsMenu, [
    navStepper(el.mapVal.closest(".stepper"), () => stepSetting("map", -1), () => stepSetting("map", 1)),
    navStepper(el.sizeVal.closest(".stepper"), () => stepSetting("arenaSize", -1), () => stepSetting("arenaSize", 1)),
    navBtn("btn-maps-back"),
  ]);
  registerMenu(el.graphicsMenu, [
    navStepper(el.gfxVal.closest(".stepper"), () => stepSetting("gfx", -1), () => stepSetting("gfx", 1)),
    navBtn("btn-fullscreen"),
    navBtn("btn-graphics-back"),
  ]);
  registerMenu(el.soundsMenu, [...soundTestNav, navBtn("btn-sounds-back")]);
  registerMenu(el.result, [navBtn("btn-again"), navBtn("btn-menu")]);
  registerMenu(el.pauseMenu, [navBtn("btn-pause-resume"), navBtn("btn-pause-options"), navBtn("btn-pause-menu")]);
  registerMenu(el.teamSelect, []);   // sem nav de menu: o input é por-jogador (esq/dir), tratado no input.js
  bindHover();
}

// ---- Wiring de botões/sliders (cliques pontuais) ----
function wireControls() {
  document.getElementById("btn-cpu").addEventListener("click", () => {
    el.keysInfo.innerHTML = '<b class="p1">P1</b>: <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> ou <kbd>↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd>';
    openLocalLobby("cpu");
  });
  document.getElementById("btn-multiplayer").addEventListener("click", openMultiplayer);
  document.getElementById("btn-mp-local").addEventListener("click", () => openLocalLobby("2p"));
  document.getElementById("btn-mp-lan").addEventListener("click", openLan);
  document.getElementById("btn-mp-back").addEventListener("click", backToMenu);
  document.getElementById("btn-lan-create").addEventListener("click", createSession);
  document.getElementById("btn-lan-find").addEventListener("click", openLanFind);
  document.getElementById("btn-lan-back").addEventListener("click", backToMultiplayer);
  document.getElementById("btn-lan-refresh").addEventListener("click", startFindSessions);
  document.getElementById("btn-lan-find-back").addEventListener("click", exitLanFind);
  el.btnLobbyReady.addEventListener("click", onLobbyReady);
  el.btnLobbyLeave.addEventListener("click", onLobbyLeave);
  el.btnLobbyOptions.addEventListener("click", lobbyOptions);
  el.lobbyHue.addEventListener("input", lobbyHueInput);
  el.lobbyName.addEventListener("input", lobbyNameInput);
  el.lobbyName.addEventListener("focus", () => syncNavTo(el.lobbyName));   // clicar/editar → realce da nav acompanha
  document.getElementById("btn-options").addEventListener("click", openOptions);
  el.btnQuit.addEventListener("click", openQuitConfirm);
  document.getElementById("btn-quit-yes").addEventListener("click", quitApp);
  document.getElementById("btn-quit-no").addEventListener("click", backToMenu);
  if (!isDesktop()) el.btnQuit.style.display = "none";   // browser não fecha app: esconde (menu-nav auto-exclui itens display:none)
  document.getElementById("btn-options-back").addEventListener("click", closeOptions);
  document.getElementById("btn-pause-resume").addEventListener("click", onPauseResume);
  document.getElementById("btn-pause-options").addEventListener("click", pauseOptions);
  document.getElementById("btn-pause-menu").addEventListener("click", goMenu);
  document.getElementById("btn-adversaries").addEventListener("click", openAdversaries);
  document.getElementById("btn-maps").addEventListener("click", openMaps);
  document.getElementById("btn-maps-back").addEventListener("click", backToOptions);
  document.getElementById("map-dec").addEventListener("click", () => stepSetting("map", -1));
  document.getElementById("map-inc").addEventListener("click", () => stepSetting("map", 1));
  document.getElementById("size-dec").addEventListener("click", () => stepSetting("arenaSize", -1));
  document.getElementById("size-inc").addEventListener("click", () => stepSetting("arenaSize", 1));
  document.getElementById("btn-graphics").addEventListener("click", openGraphics);
  document.getElementById("btn-graphics-back").addEventListener("click", backToOptions);
  document.getElementById("gfx-dec").addEventListener("click", () => stepSetting("gfx", -1));
  document.getElementById("gfx-inc").addEventListener("click", () => stepSetting("gfx", 1));
  el.btnFullscreen.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", syncFullscreenLabel);
  document.addEventListener("webkitfullscreenchange", syncFullscreenLabel);
  syncFullscreenLabel();
  document.getElementById("btn-adv-back").addEventListener("click", backToOptions);
  document.getElementById("btn-colors").addEventListener("click", openColors);
  document.getElementById("btn-colors-back").addEventListener("click", backToOptions);
  document.getElementById("btn-audio").addEventListener("click", openAudio);
  document.getElementById("btn-audio-back").addEventListener("click", backToOptions);
  document.getElementById("btn-again").addEventListener("click", again);
  document.getElementById("btn-menu").addEventListener("click", goMenu);
  document.getElementById("btn-sounds").addEventListener("click", openSounds);
  document.getElementById("btn-sounds-back").addEventListener("click", backToOptions);

  document.getElementById("sp-dec").addEventListener("click", () => stepSetting("spCpus", -1));
  document.getElementById("sp-inc").addEventListener("click", () => stepSetting("spCpus", 1));
  document.getElementById("mp-dec").addEventListener("click", () => stepSetting("mpCpus", -1));
  document.getElementById("mp-inc").addEventListener("click", () => stepSetting("mpCpus", 1));
  document.getElementById("diff-dec").addEventListener("click", () => stepSetting("difficulty", -1));
  document.getElementById("diff-inc").addEventListener("click", () => stepSetting("difficulty", 1));
  el.modeFfa.addEventListener("click", () => onModeChange(0));
  el.modeTeams.addEventListener("click", () => onModeChange(1));

  el.hue1.addEventListener("input", () => { refreshColorUI(); refreshModeSwatches(); });
  el.hue2.addEventListener("input", refreshColorUI);
  el.musicVol.addEventListener("input", () => setSetting("music", +el.musicVol.value / 100));
  el.sfxVol.addEventListener("input", () => setSetting("sfx", +el.sfxVol.value / 100));
  el.sfxVol.addEventListener("change", () => { audio.resume(); audio.blip(); });

  // Sons de UI no clique do mouse (e destrava o contexto de áudio — clique é gesto).
  // Cobre teclado também: activateNav faz el.click(), que cai aqui.
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    audio.resume();
    if (btn.classList.contains("snd-test")) return;          // botões de teste de som já tocam o próprio som (sem bip de UI por cima)
    if (btn.classList.contains("step-btn")) audio.uiMove();   // −/+ dos steppers = ajuste
    else if (btn.id.endsWith("-back")) audio.uiBack();        // botões "Voltar" = som grave
    else audio.uiSelect();                                    // demais botões = selecionar
  });

  window.addEventListener("resize", () => { renderer.resize(); renderer.render(state); });
}

// ---- Init ----
refreshColorUI();
refreshModeSwatches();
defineSettings();                        // carrega + aplica todas as preferências salvas
configureRoster("cpu");                  // roster padrão p/ a cena do menu
resetRound();
renderer.updateCamera(state, 0);
state.phase = "menu";
app.running = false;
buildSoundTests();
buildNav();
wireControls();
initInput({ onEscape: handleEscape });
setTeamSelect((pid, action) => { if (action === "confirm") teamSelectConfirm(); else teamSelectMove(pid, action); });
renderer.render(state);                  // desenha a cena do menu (fica atrás da intro)
state.phase = "intro";
playIntro(() => { showOnly(el.menu); state.phase = "menu"; });   // abertura → revela o menu interativo
