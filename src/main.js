// Orquestrador: cria o estado, define settings/menus, conecta o input e roda o
// game loop, costurando os módulos (lógica, IA via lógica, gráficos, áudio).
// Os subsistemas vivem em módulos próprios: dom, state, app, engines, colors,
// settings, menu-nav, ares-intro, input. Aqui fica só a cola + o fluxo + o loop.
import {
  COLS, DIRS, OPPOSITE, createGrid, idx, isFree,
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
import { registerMenu, bindHover, showOnly, navBtn, navSlider, navStepper, refreshNav } from "./menu-nav.js";
import { showAresIntro, updateAresTerminal, isTerminalActive, stopTerminal, loadAresTerminalLines } from "./ares-intro.js";
import { initInput, setLanSteer } from "./input.js";
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
}

// ---- Roster / round ----
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
      : (lanHues && lanHues[i] != null ? { color: hueColor(lanHues[i]), glow: hueGlow(lanHues[i]), hue: lanHues[i] }  // LAN: cor do lobby (humanos)
      : skinForIndex(i, total));                                                // CPUs / local: matiz espalhada
    return makePlayer(i + 1, layout[i].col, layout[i].row, layout[i].dir, r.isAI, skin, r.label);
  });
  for (const player of state.players) state.grid[idx(player.x, player.y)] = player.id;
  clearSpawnRunways(state.grid, state.players);           // abre pista segura à frente de cada spawn
  prevAlive = state.players.map(() => true);
  prevTrailGone = state.players.map(() => false);
  windupFired = state.players.map(() => false);
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
  if (state.players) el.scoreboard.innerHTML = scoreChips();
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
    if (lanRole === "host" && lanAvailable()) window.lan.setMatch(currentMatchConfig());   // host: atualiza a config da partida
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
  if (!(state.phase === "playing" || state.phase === "dying" || state.phase === "countdown")) return;
  app.paused = true;
  music.pause();
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
const currentMatchConfig = () => ({ map: settings.map ?? 0, size: settings.arenaSize ?? 1, difficulty: settings.difficulty ?? 2, cpus: settings.mpCpus ?? 0 });

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

function openLobby() {
  el.lobbyName.value = getProfileName();
  el.lobbyHue.value = lanState.myHue;
  applyLobbyColor(false);
  el.btnLobbyOptions.style.display = lanState.isHost ? "" : "none";   // só o host configura a partida
  if (lanState.isHost && lanAvailable()) window.lan.setMatch(currentMatchConfig());
  registerLobbyNav();
  showOnly(el.lobby);
  renderLobby();
}
function leaveLan() { lanState.active = false; lanRole = null; lanHues = null; setLanSteer(null); if (lanAvailable()) window.lan.leave(); showOnly(el.lanMenu); }
function lanReturnToLobby() { if (lanRole) { app.running = false; openLobby(); } }   // "return" da rede → rematch no lobby

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
  registerMenu(el.lobby, [navSlider(el.lobbyHue, 8), navBtn("btn-lobby-ready"), navBtn("btn-lobby-options"), navBtn("btn-lobby-leave")]);
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
  const cpus = Math.max(0, Math.min(m.cpus ?? 0, 8 - players.length));   // CPUs (IA rodada no host) cabendo no limite
  state.roster = [
    ...players.map((p, i) => ({ isAI: false, label: p.name || `P${i + 1}` })),
    ...Array.from({ length: cpus }, (_, k) => ({ isAI: true, label: cpus > 1 ? `CPU ${k + 1}` : "CPU" })),
  ];
  state.difficulty = m.difficulty ?? settings.difficulty;
  state.scores = new Array(state.roster.length).fill(0);
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
    round: lanRoundHost, sc: state.scores.slice(),
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
    const champ = state.players.find((p) => state.scores[p.id - 1] >= WIN_SCORE) || state.players[0];
    showVictory(champ);
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
  else if (msg.type === "disconnect") { if (lanRole) goMenu(); else if (lanState.active) leaveLan(); }
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
  if (state.phase === "menu") {
    if (!el.quitConfirm.classList.contains("hidden")) { audio.uiBack(); backToMenu(); }        // cancela a confirmação de saída
    else if (!el.lobby.classList.contains("hidden")) { audio.uiBack(); leaveLan(); }           // sai do lobby (fecha a sessão)
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
    if (lanRole) { audio.uiBack(); goMenu(); return; }                                        // LAN: Esc sai da partida (pausa LAN = futuro)
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
  bindHover();
}

// ---- Wiring de botões/sliders (cliques pontuais) ----
function wireControls() {
  document.getElementById("btn-cpu").addEventListener("click", () => {
    el.keysInfo.innerHTML = '<b class="p1">P1</b>: <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> ou <kbd>↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd>';
    startMatch("cpu");
  });
  document.getElementById("btn-multiplayer").addEventListener("click", openMultiplayer);
  document.getElementById("btn-mp-local").addEventListener("click", () => startMatch("2p"));
  document.getElementById("btn-mp-lan").addEventListener("click", openLan);
  document.getElementById("btn-mp-back").addEventListener("click", backToMenu);
  document.getElementById("btn-lan-create").addEventListener("click", createSession);
  document.getElementById("btn-lan-find").addEventListener("click", openLanFind);
  document.getElementById("btn-lan-back").addEventListener("click", backToMultiplayer);
  document.getElementById("btn-lan-refresh").addEventListener("click", startFindSessions);
  document.getElementById("btn-lan-find-back").addEventListener("click", exitLanFind);
  el.btnLobbyReady.addEventListener("click", toggleReady);
  el.btnLobbyLeave.addEventListener("click", leaveLan);
  el.btnLobbyOptions.addEventListener("click", lobbyOptions);
  el.lobbyHue.addEventListener("input", lobbyHueInput);
  el.lobbyName.addEventListener("input", lobbyNameInput);
  document.getElementById("btn-options").addEventListener("click", openOptions);
  el.btnQuit.addEventListener("click", openQuitConfirm);
  document.getElementById("btn-quit-yes").addEventListener("click", quitApp);
  document.getElementById("btn-quit-no").addEventListener("click", backToMenu);
  if (!isDesktop()) el.btnQuit.style.display = "none";   // browser não fecha app: esconde (menu-nav auto-exclui itens display:none)
  document.getElementById("btn-options-back").addEventListener("click", closeOptions);
  document.getElementById("btn-pause-resume").addEventListener("click", resumeGame);
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

  el.hue1.addEventListener("input", refreshColorUI);
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
renderer.render(state);                  // desenha a cena do menu (fica atrás da intro)
state.phase = "intro";
playIntro(() => { showOnly(el.menu); state.phase = "menu"; });   // abertura → revela o menu interativo
