// Orquestrador do jogo: cria o estado, define settings/menus, conecta o input e roda
// o game loop. Os subsistemas vivem em módulos próprios sob src/ (core, render, audio,
// ui, input, intro, net); aqui fica só a cola + o fluxo + o loop. LAN (net/lan-client)
// e lobby (ui/lobby) são desacoplados por injeção: recebem os callbacks daqui via
// initLan/initLobby e não importam este arquivo.
import {
  COLS, DIRS, OPPOSITE, createGrid, idx, isFree,
  WIN_SCORE, COUNTDOWN_MS, ARES_CHANCE, ARES_FADE_MS,
  SHAKE_DEATH, NEARMISS_COOLDOWN_MS, STEPTICK_MIN_MS, TRAIL_WINDUP_MS,
  ARENA_NAMES, ARENA_SIZES, ARENA_SIZE_NAMES, buildArenaLayout, setArenaSize,
  CPU_CHARACTERS, CPU_FILLERS,
  SPEED_NAMES, SPEED_SCALES, setSpeedScale,
  PICKUP_SPAWN_MS,
} from "./core/config.js";
import { makePlayer, advance, updateParticles, spawnLayout, applyArena, clearSpawnRunways } from "./core/logic.js";
import { el } from "./ui/dom.js";
import { app } from "./core/app.js";
import { state } from "./core/state.js";
import { renderer, audio, music } from "./engines.js";
import { refreshColorUI, applyColors, skinForIndex, aresSkin, cpuSkin, hueColor, hueGlow } from "./ui/colors.js";
import { recordMatch, getStats, topChampion, resetStats } from "./ui/stats.js";
import { TEAM_HUES, teamSkin } from "./ui/teams.js";
import { renderScoreboard, scoreChips, teamScoreChips } from "./ui/scoreboard.js";
import { setNameplates, updateNameplates, hideNameplates } from "./ui/nameplates.js";
import { toggleFullscreen, syncFullscreenLabel } from "./ui/fullscreen.js";
import { buildSoundTests, soundTestNav } from "./ui/sound-tests.js";
import { buildControls, resetControls, controlsNav } from "./ui/controls.js";
import {
  lan, lanAvailable, currentMatchConfig, getProfileName, setProfileName,
  createSession, startFindSessions, exitLanFind, leaveLan,
  onPauseResume, lanEscPause, lanSendSnapshot, lanAfterReset, initLan,
} from "./net/lan-client.js";
import {
  openLobby, openLocalLobby, onModeChange, refreshModeSwatches, onLobbyReady, onLobbyLeave,
  lobbyHueInput, lobbyNameInput, renderLobby, renderLocalRoster, lobbyKind, initLobby,
} from "./ui/lobby.js";
import { defineSetting, setSetting, stepSetting, settings } from "./ui/settings.js";
import { registerMenu, bindHover, showOnly, navBtn, navSlider, navStepper, navInput, syncNavTo, refreshNav } from "./ui/menu-nav.js";
import { showAresIntro, updateAresTerminal, isTerminalActive, stopTerminal, loadAresTerminalLines } from "./intro/ares-intro.js";
import { initInput, setLanSteer, setTeamSelect, connectedGamepadCount } from "./input/input.js";
import { playIntro, skipIntro } from "./intro/title-intro.js";
import { serializePlayers, applyPlayers } from "./net/lan-sync.js";

// ---- Settings: definições (label + persistência + efeito) ----
const MUSIC_VOLUME_MULT = 0.5;                              // teto permanente do volume da música (50%)
const DIFF_NAMES = ["", "fácil", "médio", "difícil", "sádico"];
const DIFF_COLORS = ["", "#46e07a", "#e8eef3", "#ff8a1e", "#ff2a4d"]; // 1 verde · 2 neutro · 3 laranja · 4 carmesim (sádico)
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
  defineSetting("difficulty", { ls: "lc.diff", def: 2, min: 1, max: 4, apply: (v) => {   // 4 = sádico (violence 0.8 → liga o minimax)
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
  defineSetting("winScore", { ls: "lc.winScore", def: WIN_SCORE, min: 1, max: 10, apply: (v) => {
    state.winScore = v;                    // primeiro a `v` vitórias leva a partida
    el.winVal.textContent = v;
  } });
  defineSetting("speed", { ls: "lc.speed", def: 1, min: 0, max: SPEED_NAMES.length - 1, apply: (v) => {
    setSpeedScale(SPEED_SCALES[v]);        // escala os ticks (vale na próxima moto criada)
    el.speedVal.textContent = SPEED_NAMES[v];
  } });
  defineSetting("zone", { ls: "lc.zone", def: 0, min: 0, max: 1, apply: (v) => {   // zona que encolhe (anti-empate) — padrão desligado
    el.btnZone.classList.toggle("on", !!v);                        // bolinha p/ a direita quando ligado
    el.btnZone.setAttribute("aria-checked", v ? "true" : "false");
  } });
  defineSetting("powerups", { ls: "lc.powerups", def: 0, min: 0, max: 1, apply: (v) => {   // power-ups na arena — padrão desligado
    el.btnPowerups.classList.toggle("on", !!v);
    el.btnPowerups.setAttribute("aria-checked", v ? "true" : "false");
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

function configureRoster(mode, keepIdentities = false) {
  state.mode = mode;
  state.difficulty = settings.difficulty;
  state.winScore = settings.winScore;
  setSpeedScale(SPEED_SCALES[settings.speed ?? 1]);   // garante a velocidade local (uma partida LAN pode ter mudado)
  state.gameMode = (!state.ares && settings.gameMode === 1) ? "teams" : "ffa";   // ARES é sempre FFA
  const humans = mode === "2p" ? Math.min(4, 2 + connectedGamepadCount()) : 1;   // 2 (teclado) + 1 por gamepad conectado
  state.humans = humans;
  const cpus = state.ares ? 1 : (mode === "2p" ? settings.mpCpus : settings.spCpus);
  const total = humans + cpus;
  // Identidades de CPU são sorteadas ao ENTRAR no lobby; a partida reaproveita (mesmo formato,
  // sem ARES) pra o nome/cor do jogo baterem com o preview. ARES/mudança de formato → sorteia de novo.
  const prevCpu = (state.roster || []).filter((r) => r.isAI).map((r) => ({ label: r.label, hue: r.hue, white: r.white }));
  const reuseCpu = keepIdentities && !state.ares && prevCpu.length === cpus && !prevCpu.some((c) => c.label === "ARES");
  state.roster = [];
  for (let i = 0; i < total; i++) {
    const isAI = i >= humans;
    state.roster.push({ isAI, label: isAI ? "" : `P${i + 1}`, team: state.gameMode === "teams" ? (i % 2) : -1 });   // times alternados
  }
  if (reuseCpu) {                          // mantém nome/cor escolhidos no lobby
    let k = 0;
    for (const r of state.roster) if (r.isAI) { const s = prevCpu[k++]; r.label = s.label; r.hue = s.hue; r.white = s.white; }
  } else {
    assignCpuIdentities();                 // sorteia nome (personagem/filler) + cor → personalidade de cada CPU
  }
  state.scores = new Array(total).fill(0);
  state.teamScores = [0, 0];
}

// Distância angular entre matizes (na roda de 360°) — pra manter os fillers distintos.
function hueDistance(a, b) { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); }
// Matiz aleatória a ≥28° das já usadas (algumas tentativas; senão aceita a última).
function pickFillerHue(used) {
  let hue = 0;
  for (let tries = 0; tries < 24; tries++) { hue = Math.round(Math.random() * 360); if (!used.some((u) => hueDistance(hue, u) < 28)) break; }
  return hue;
}
// Nome + cor de cada CPU. Personagens têm cor assinatura (→ personalidade); fillers têm
// cor aleatória distinta. ARES é sempre "ARES" (skin própria). Sorteado por partida.
function assignCpuIdentities() {
  const bots = state.roster.filter((r) => r.isAI);
  if (state.ares) { bots.forEach((r) => { r.label = "ARES"; r.white = false; }); return; }
  const characters = CPU_CHARACTERS.map((c) => ({ name: c.name, hue: c.hue, white: !!c.white }));
  const fillers = CPU_FILLERS.map((name) => ({ name, hue: null, white: false }));
  const pool = [...characters, ...fillers].sort(() => Math.random() - 0.5);   // sabor sorteado
  const usedHues = [];
  bots.forEach((r, k) => {
    const pick = pool[k] || { name: `CPU ${k + 1}`, hue: null, white: false };
    r.label = pick.name;
    r.white = pick.white;
    r.hue = pick.hue != null ? pick.hue : pickFillerHue(usedHues);   // filler: matiz distinta
    usedHues.push(r.hue);
  });
}

let prevAlive = [];
let prevTrailGone = [];   // p/ disparar o pop do de-rez quando a trilha some
let windupFired = [];     // p/ disparar o windup uma vez, 1s antes do corte
function resetRound() {
  applyColors();
  state.grid = createGrid();
  applyArena(state.grid, state.arenaLayout);              // marca os obstáculos do layout da partida
  state.particles = [];
  state.roundTime = 0; state.zoneInset = 0;               // zona recomeça a cada round
  state.zoneEnabled = !!settings.zone && !lan.role;       // por ora só no jogo local (LAN não sincroniza a zona)
  state.pickups = []; state.pickupTimer = PICKUP_SPAWN_MS;
  state.pickupsEnabled = !!settings.powerups && !lan.role;   // idem: power-ups só no local por ora
  const total = state.roster.length;
  const layout = spawnLayout(total);
  state.players = state.roster.map((r, i) => {
    const skin = (state.ares && r.isAI) ? aresSkin()                            // ARES = programa vermelho
      : (state.gameMode === "teams" ? teamSkin(r.team, i)                       // modo times: cor do time
      : (lan.hues && lan.hues[i] != null ? { color: hueColor(lan.hues[i]), glow: hueGlow(lan.hues[i]), hue: lan.hues[i] }  // LAN: cor do lobby (humanos)
      : (r.isAI && r.hue != null ? cpuSkin(r)                                   // CPU: personagem/filler (cor define a personalidade; TRON = branco)
      : skinForIndex(i, total))));                                              // humanos locais: matiz das cores escolhidas
    const p = makePlayer(i + 1, layout[i].col, layout[i].row, layout[i].dir, r.isAI, skin, r.label);
    p.team = r.team ?? -1;
    return p;
  });
  for (const player of state.players) state.grid[idx(player.x, player.y)] = player.id;
  clearSpawnRunways(state.grid, state.players);           // abre pista segura à frente de cada spawn
  prevAlive = state.players.map(() => true);
  prevTrailGone = state.players.map(() => false);
  windupFired = state.players.map(() => false);
  setNameplates(lan.role ? lan.state.mySlot : null);   // balões "quem é quem" (somem logo após o início)
  state.roundWinner = null;
  state.dyingTimer = 0;
  renderer.snapToTarget();
  renderScoreboard();
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
  const seconds = Math.max(1, Math.ceil(state.countdownTimer / 1000));   // 3, 2, 1
  if (seconds !== state.countShown) {
    state.countShown = seconds;
    el.countdownNum.textContent = seconds;
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
    if (lan.role === "client") {
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
        const headKey = p.y * COLS + p.x;
        if (headKey === lastHeadKey[i]) continue;      // só dispara quando anda uma célula
        lastHeadKey[i] = headKey;
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
  if (lan.role === "host") lanSendSnapshot();      // host transmite o estado a cada frame
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
  lan.role = null; lan.hues = null; setLanSteer(null);   // partida local: garante que o modo LAN está desligado
  const chance = mode === "2p" ? ARES_CHANCE / 10 : ARES_CHANCE;
  state.ares = Math.random() < chance;     // sorteia o modo ARES
  aresEscAllowed = false;                  // re-arma o trava-ESC do ARES (libera só após a 1ª morte)
  configureRoster(mode, true);             // ARES força 1 CPU; senão mantém os CPUs escolhidos no lobby
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
    const token = document.createElement("div");
    token.className = "ts-token" + (r.isAI ? " ai" : "");
    token.innerHTML = `<span class="ts-dot" style="background:hsl(${hue},100%,62%);box-shadow:0 0 8px hsl(${hue},100%,62%)"></span>`
      + `<span>${r.label}</span>` + (r.isAI ? "" : `<span class="ts-hint">${i === 0 ? "A / D" : "← / →"}</span>`);
    col.appendChild(token);
  });
}

function again() {   // "Again" local = nova partida; no LAN = "Continuar" → rematch (volta pro lobby)
  if (lan.role) { if (lanAvailable() && window.lan.returnLobby) window.lan.returnLobby(); return; }
  startMatch(state.mode);
}

function goMenu() {
  app.running = false;
  app.paused = false;
  if (lan.role) { if (lanAvailable()) window.lan.leave(); lan.role = null; lan.hues = null; setLanSteer(null); }   // encerra a sessão LAN
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
    else if (lan.state.isHost && lanAvailable()) window.lan.setMatch(currentMatchConfig()); // host: atualiza a config da partida
    return;
  }
  showOnly(el.menu);
}function openAudio()       { showOnly(el.audioMenu); }
function openAdversaries() { showOnly(el.advMenu); }
function openMatch()       { showOnly(el.matchMenu); }
function openStats()       { resetArmed = false; renderStats(); showOnly(el.statsMenu); }

// Preenche as linhas do submenu Estatísticas com o recorde local atual.
function renderStats() {
  const s = getStats();
  const rate = s.played ? Math.round((s.wins / s.played) * 100) : 0;
  const top = topChampion();
  const rows = [
    ["Partidas", s.played],
    ["Vitórias", `${s.wins} (${rate}%)`],
    ["Derrotas", s.losses],
    ["Sequência atual", s.streak],
    ["Melhor sequência", s.best],
    ["Mais venceu", top ? `${top[0]} (${top[1]})` : "—"],
  ];
  el.statsList.innerHTML = rows.map(([k, v]) =>
    `<div class="stat-row"><span class="stat-k">${k}</span><span class="stat-v">${v}</span></div>`).join("");
  el.btnStatsReset.textContent = resetArmed ? "Confirmar?" : "Zerar";
}
// Zerar exige 2 cliques (arma → confirma) pra não perder o recorde sem querer.
let resetArmed = false;
function statsReset() {
  if (!resetArmed) { resetArmed = true; el.btnStatsReset.textContent = "Confirmar?"; audio.uiMove(); return; }
  resetStats(); resetArmed = false; renderStats(); audio.uiBack();
}
function openMaps()        { showOnly(el.mapsMenu); previewArena(); }   // mostra a arena atrás (preview)
function openGraphics()    { showOnly(el.graphicsMenu); previewArena(); }   // mostra a arena atrás (preview)
function openSounds()      { showOnly(el.soundsMenu); }
function openControls()    { showOnly(el.controlsMenu); }
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

// Fim de round: alguém chegou às vitórias necessárias → fim de partida; senão, próximo round.
function endRound() {
  const winScore = state.winScore || WIN_SCORE;
  if (state.gameMode === "teams") {
    const winTeam = state.teamScores.findIndex((s) => s >= winScore);
    if (winTeam >= 0) {
      recordMatch(winTeam === (state.roster[0] && state.roster[0].team), null);   // recorde do P1 (Times não entra na tábua de programas)
      showVictoryTeam(winTeam);
    } else nextRound();
    return;
  }
  const champ = state.players.find(p => state.scores[p.id - 1] >= winScore);
  if (champ) {
    recordMatch(champ.id === 1, champ.label);   // P1 é o jogador id 1; label do campeão vai pra "mais venceu"
    if (state.ares) aresEnd();
    else showVictory(champ);
  } else {
    nextRound();
  }
}
function nextRound() {
  resetRound();              // mesmo roster/placar/ARES; novas posições
  if (lan.role === "host") { lan.roundHost++; lanAfterReset(); }   // novo round → sincroniza o reset com os clientes
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
  if (againLbl) againLbl.textContent = lan.role ? "Continuar" : "Again";
  if (menuLbl) menuLbl.textContent = lan.role ? "Sair" : "Menu";
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
  if (againLbl) againLbl.textContent = lan.role ? "Continuar" : "Again";
  if (menuLbl) menuLbl.textContent = lan.role ? "Sair" : "Menu";
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
const isOpenSub = () => !el.audioMenu.classList.contains("hidden")
  || !el.advMenu.classList.contains("hidden")
  || !el.matchMenu.classList.contains("hidden")
  || !el.statsMenu.classList.contains("hidden")
  || !el.mapsMenu.classList.contains("hidden")
  || !el.graphicsMenu.classList.contains("hidden")
  || !el.soundsMenu.classList.contains("hidden")
  || !el.controlsMenu.classList.contains("hidden");

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
    if (lan.role) { lanEscPause(); return; }                                                   // LAN: Esc pausa (sincronizado)
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

function buildNav() {
  registerMenu(el.menu, [navBtn("btn-cpu"), navBtn("btn-multiplayer"), navBtn("btn-options"), navBtn("btn-quit")]);
  registerMenu(el.quitConfirm, [navBtn("btn-quit-no"), navBtn("btn-quit-yes")]);
  registerMenu(el.multiplayerMenu, [navBtn("btn-mp-local"), navBtn("btn-mp-lan"), navBtn("btn-mp-back")]);
  registerMenu(el.lanMenu, [navBtn("btn-lan-create"), navBtn("btn-lan-find"), navBtn("btn-lan-back")]);
  registerMenu(el.lanFind, [navBtn("btn-lan-refresh"), navBtn("btn-lan-find-back")]);
  registerMenu(el.lobby, [navSlider(el.lobbyHue, 8), navBtn("btn-lobby-ready"), navBtn("btn-lobby-leave")]);
  registerMenu(el.optionsMenu, [navBtn("btn-adversaries"), navBtn("btn-match"), navBtn("btn-maps"), navBtn("btn-graphics"), navBtn("btn-audio"), navBtn("btn-stats"), navBtn("btn-sounds"), navBtn("btn-controls"), navBtn("btn-options-back")]);
  registerMenu(el.statsMenu, [navBtn("btn-stats-reset"), navBtn("btn-stats-back")]);
  registerMenu(el.matchMenu, [
    navStepper(el.winVal.closest(".stepper"), () => stepSetting("winScore", -1), () => stepSetting("winScore", 1)),
    navStepper(el.speedVal.closest(".stepper"), () => stepSetting("speed", -1), () => stepSetting("speed", 1)),
    navBtn("btn-zone"),
    navBtn("btn-powerups"),
    navBtn("btn-match-back"),
  ]);
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
  registerMenu(el.controlsMenu, controlsNav());
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
  document.getElementById("btn-match").addEventListener("click", openMatch);
  document.getElementById("btn-match-back").addEventListener("click", backToOptions);
  document.getElementById("btn-stats").addEventListener("click", openStats);
  document.getElementById("btn-stats-back").addEventListener("click", backToOptions);
  document.getElementById("btn-stats-reset").addEventListener("click", statsReset);
  document.getElementById("win-dec").addEventListener("click", () => stepSetting("winScore", -1));
  document.getElementById("win-inc").addEventListener("click", () => stepSetting("winScore", 1));
  document.getElementById("speed-dec").addEventListener("click", () => stepSetting("speed", -1));
  document.getElementById("speed-inc").addEventListener("click", () => stepSetting("speed", 1));
  el.btnZone.addEventListener("click", () => { setSetting("zone", settings.zone ? 0 : 1); audio.uiMove(); });
  el.btnPowerups.addEventListener("click", () => { setSetting("powerups", settings.powerups ? 0 : 1); audio.uiMove(); });
  document.getElementById("btn-audio").addEventListener("click", openAudio);
  document.getElementById("btn-audio-back").addEventListener("click", backToOptions);
  document.getElementById("btn-again").addEventListener("click", again);
  document.getElementById("btn-menu").addEventListener("click", goMenu);
  document.getElementById("btn-sounds").addEventListener("click", openSounds);
  document.getElementById("btn-sounds-back").addEventListener("click", backToOptions);
  document.getElementById("btn-controls").addEventListener("click", openControls);
  document.getElementById("btn-controls-back").addEventListener("click", backToOptions);
  document.getElementById("btn-controls-reset").addEventListener("click", resetControls);

  document.getElementById("sp-dec").addEventListener("click", () => stepSetting("spCpus", -1));
  document.getElementById("sp-inc").addEventListener("click", () => stepSetting("spCpus", 1));
  document.getElementById("mp-dec").addEventListener("click", () => stepSetting("mpCpus", -1));
  document.getElementById("mp-inc").addEventListener("click", () => stepSetting("mpCpus", 1));
  document.getElementById("diff-dec").addEventListener("click", () => stepSetting("difficulty", -1));
  document.getElementById("diff-inc").addEventListener("click", () => stepSetting("difficulty", 1));
  el.modeFfa.addEventListener("click", () => onModeChange(0));
  el.modeTeams.addEventListener("click", () => onModeChange(1));

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
buildControls();
buildNav();
wireControls();
initInput({ onEscape: handleEscape });
setTeamSelect((pid, action) => { if (action === "confirm") teamSelectConfirm(); else teamSelectMove(pid, action); });
// Injeta nos módulos LAN/lobby os callbacks de fluxo/menu (quebra o import circular).
initLobby({ startMatch, configureRoster });
initLan({
  resetRound, beginCountdown, updateCountdown, frame, showVictory, showVictoryTeam,
  openLobby, renderLobby, openLanFind, backToLan, isOpenSub, backToOptions, closeOptions, resumeGame,
});
renderer.render(state);                  // desenha a cena do menu (fica atrás da intro)
state.phase = "intro";
playIntro(() => { showOnly(el.menu); state.phase = "menu"; });   // abertura → revela o menu interativo
