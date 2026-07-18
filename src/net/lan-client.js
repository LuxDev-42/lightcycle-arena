// Cliente LAN: descoberta na rede, lobby de rede e a partida host-autoritativa
// (o host simula e transmite o estado; o cliente renderiza e envia input). É o dono
// do estado da sessão LAN.
//
// Desacoplado do orquestrador por INJEÇÃO: não importa o main. Os callbacks de fluxo
// e de menu (resetRound, showVictory, openLobby…) chegam via initLan(deps) — então o
// acoplamento é de uma direção só (main → lan-client), sem imports circulares.
import { state } from "../core/state.js";
import { app } from "../core/app.js";
import { audio, music, renderer } from "../engines.js";
import { OPPOSITE, WIN_SCORE, SHAKE_DEATH, ARENA_SIZES, COLS, buildArenaLayout, setArenaSize } from "../core/config.js";
import { hueColor, getHumanHue } from "../ui/colors.js";
import { settings } from "../ui/settings.js";
import { el } from "../ui/dom.js";
import { showOnly, registerMenu, navBtn, refreshNav } from "../ui/menu-nav.js";
import { renderScoreboard } from "../ui/scoreboard.js";
import { setLanSteer } from "../input/input.js";
import { serializePlayers, applyPlayers } from "./lan-sync.js";

export const lanAvailable = () => !!window.lan;
const hueOf = (color) => { const m = /hsl\((\d+)/.exec(color || ""); return m ? +m[1] : 190; };

const PROFILE_KEY = "lc.profile";
export const getProfileName = () => { try { return (localStorage.getItem(PROFILE_KEY) || "").trim() || "Jogador"; } catch { return "Jogador"; } };
export const setProfileName = (n) => { try { localStorage.setItem(PROFILE_KEY, n); } catch {} };
export const currentMatchConfig = () => ({
  map: settings.map ?? 0, size: settings.arenaSize ?? 1,
  difficulty: settings.difficulty ?? 2, cpus: settings.mpCpus ?? 0, gameMode: settings.gameMode ?? 0,
});

// Estado mutável da sessão. O main lê/escreve por PROPRIEDADE (lan.role, lan.state.*).
export const lan = {
  state: { active: false, isHost: false, youId: null, players: [], myHue: 190, myColor: hueColor(190), mySlot: 0 },
  role: null,          // "host" | "client" | null (null = partida local)
  hues: null,          // matiz por slot na partida (do lobby)
  slotById: {},        // id do jogador → slot
  syncLens: [],        // trilha já transmitida por player (delta, host)
  roundHost: 0,
  clientRound: 0,
  prevAlive: [],
  pausedBy: null,      // { id, name } de quem pausou, ou null
  listSig: "",         // assinatura da lista de sessões (evita reconstruir à toa)
};

// Callbacks de fluxo/menu injetados pelo main (quebram o import circular).
let deps = {};
export function initLan(injected) {
  deps = injected;
  if (window.lan) window.lan.on(onNetMessage);   // eventos vindos do processo main (Electron)
}

function onNetMessage(msg) {
  if (msg.type === "log") { console.log("%c[LAN]", "color:#19e0ff;font-weight:bold", msg.data); return; }
  if (msg.type !== "state" && msg.type !== "input") console.log("%c[LAN]", "color:#7CFC00;font-weight:bold", msg.type, msg.data ?? "");
  if (msg.type === "sessions") renderSessions(msg.data);
  else if (msg.type === "welcome") { lan.state.youId = msg.data.youId; deps.renderLobby(); }
  else if (msg.type === "lobby") { lan.state.players = msg.data.players; deps.renderLobby(); }
  else if (msg.type === "start") startLanMatch(msg.data);
  else if (msg.type === "input") lanHostInput(msg.data);       // host: input de um cliente
  else if (msg.type === "state") lanApplySnapshot(msg.data);   // cliente: snapshot do host
  else if (msg.type === "return") lanReturnToLobby();          // rematch → todos voltam pro lobby
  else if (msg.type === "pause") lanOnPause(msg.data);         // alguém pausou → congela + overlay
  else if (msg.type === "resume") lanOnResume();
  else if (msg.type === "disconnect") { if (lan.state.active && !lan.state.isHost) lanHostLeft(); }   // host caiu → migração/rediscovery
}

// ---- Descoberta / entrada ----
export async function createSession() {
  if (!lanAvailable()) return;
  const hue = getHumanHue(0);
  lan.state = { active: true, isHost: true, youId: null, players: [], myHue: hue, myColor: hueColor(hue), mySlot: 0 };
  const info = await window.lan.create({ name: "Sala de " + getProfileName(), playerName: getProfileName(), color: lan.state.myColor, match: currentMatchConfig() });
  lan.state.youId = info.youId;
  lan.state.players = info.players || [];
  deps.openLobby();
}
export async function joinSessionEntry(session) {
  if (!lanAvailable()) return;
  const hue = getHumanHue(0);
  lan.state = { active: true, isHost: false, youId: null, players: [], myHue: hue, myColor: hueColor(hue), mySlot: 0 };
  await window.lan.join(session, { playerName: getProfileName(), color: lan.state.myColor });
  deps.openLobby();
}
export function startFindSessions() {
  el.lanSessionList.innerHTML = "";
  lan.listSig = "";                                            // força reconstruir na próxima render
  if (!lanAvailable()) { el.lanFindStatus.textContent = "LAN disponível só no app desktop (Electron)."; return; }
  el.lanFindStatus.textContent = "Procurando sessões na rede…";
  window.lan.find().then(renderSessions);
}
export function exitLanFind() { if (lanAvailable()) window.lan.stopFind(); deps.backToLan(); }

// Só reconstrói DOM/navegação quando o conjunto de sessões REALMENTE muda — senão a
// reconstrução a cada anúncio (~1/s) apagava o botão focado e o outline "sumia".
function renderSessions(list) {
  el.lanFindStatus.textContent = list.length ? "Selecione uma sessão para entrar:" : "Procurando sessões na rede…";
  const sig = list.map((s) => `${s.id}:${s.players}/${s.max}@${s.host}:${s.tcpPort}`).join("|");
  if (sig === lan.listSig) return;                            // nada mudou → preserva foco/outline
  lan.listSig = sig;
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

export function leaveLan() {
  lan.state.active = false; lan.role = null; lan.hues = null; setLanSteer(null);
  if (lanAvailable()) window.lan.leave();
  showOnly(el.lanMenu);
}
function lanReturnToLobby() { if (lan.role) { app.running = false; deps.openLobby(); } }   // "return" da rede → rematch no lobby

// Host caiu (cliente perdeu a conexão): no lobby, o próximo jogador do array assume
// como host e os demais reprocuram; no meio da partida, encerra a sessão limpo.
function lanHostLeft() {
  const others = (lan.state.players || []).filter((p) => !p.isHost);   // clientes na ordem
  const iAmNext = others[0] && others[0].id === lan.state.youId;       // sou o próximo → viro host
  const inMatch = app.running;
  app.running = false; app.paused = false; lan.role = null; lan.hues = null; lan.pausedBy = null;
  setLanSteer(null); lan.state.active = false;
  if (inMatch) { console.log("%c[LAN]", "color:#ff8a1e", "host saiu no meio da partida — sessão encerrada"); showOnly(el.lanMenu); }
  else if (iAmNext) { console.log("%c[LAN]", "color:#7CFC00", "host saiu — assumindo como novo host"); createSession(); }
  else { console.log("%c[LAN]", "color:#19e0ff", "host saiu — procurando o novo host"); deps.openLanFind(); }
}

// ---- Pausa LAN (sincronizada, host-autoritativa) ----
export function lanRequestPause() { if (lanAvailable()) window.lan.pause(); }
export function lanResume() { if (lanAvailable()) window.lan.resume(); }
export function onPauseResume() { if (lan.role) lanResume(); else deps.resumeGame(); }
export function lanEscPause() {
  if (deps.isOpenSub()) { audio.uiBack(); deps.backToOptions(); return; }                          // sub-opção → opções (host)
  if (!el.optionsMenu.classList.contains("hidden")) { audio.uiBack(); deps.closeOptions(); return; } // opções → pausa
  if (!el.pauseMenu.classList.contains("hidden")) {                                                // pausado
    const amPauser = lan.pausedBy && lan.pausedBy.id === lan.state.youId;
    if (amPauser || lan.role === "host") { audio.uiBack(); lanResume(); }                          // pauser ou host retoma
    return;
  }
  lanRequestPause();                                                                               // rodando → pausa
}
function lanOnPause(data) { lan.pausedBy = { id: data.by, name: data.name }; app.paused = true; music.pause(); showLanPauseMenu(); }
function lanOnResume() { lan.pausedBy = null; app.paused = false; music.resume(); showOnly(null); }
function showLanPauseMenu() {
  const amPauser = lan.pausedBy && lan.pausedBy.id === lan.state.youId;
  const isHost = lan.role === "host";
  el.pauseTitle.textContent = amPauser ? "Pausado" : `${(lan.pausedBy && lan.pausedBy.name) || "Jogador"} pausou`;
  el.btnPauseResume.style.display = (amPauser || isHost) ? "" : "none";       // só o pauser (ou o host) retoma
  el.btnPauseOptions.style.display = (isHost && amPauser) ? "" : "none";      // opções só p/ host que pausou
  el.btnPauseMenu.querySelector(".btn-label").textContent = "Sair";          // no LAN o botão vira "Sair"
  showOnly(el.pauseMenu);
}

// ---- Partida LAN (host-autoritativo) ----
function startLanMatch(payload) {
  lan.role = lan.state.isHost ? "host" : "client";
  const players = payload.players.slice().sort((a, b) => a.slot - b.slot);
  lan.hues = players.map((p) => hueOf(p.color));
  lan.slotById = {}; players.forEach((p) => { lan.slotById[p.id] = p.slot; });
  lan.state.mySlot = lan.slotById[lan.state.youId] ?? 0;
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
  lan.roundHost = 0; lan.clientRound = 0;
  deps.resetRound();
  lanAfterReset();
  app.paused = false; app.running = true; app.lastTime = 0;
  audio.resume(); audio.setEnginesActive(true); music.start(false);
  setLanSteer(lanLocalSteer);
  deps.beginCountdown(false);          // os dois mostram a contagem; no cliente o timing vem dos snapshots
  requestAnimationFrame(deps.frame);
}
// host: reseta o rastreio de delta pós-resetRound (spawn já existe nos dois). Também
// chamado pelo main a cada novo round (nextRound).
export function lanAfterReset() {
  lan.syncLens.length = 0;
  lan.prevAlive = state.players.map((p) => p.alive);
  state.players.forEach((p, i) => { lan.syncLens[i] = p.trail.length; });
}
function lanLocalSteer(dir) {     // input local → host aplica no próprio slot; cliente envia pro host
  const p = state.players && state.players[lan.state.mySlot];
  if (!p || dir === OPPOSITE[p.dir]) return;
  if (lan.role === "host") p.nextDir = dir;
  else if (lanAvailable()) window.lan.sendInput(dir);
}
function lanHostInput(data) {     // host: aplica o input recebido de um cliente no slot dele
  const p = state.players && state.players[lan.slotById[data.id]];
  if (p && p.alive && data.dir !== OPPOSITE[p.dir]) p.nextDir = data.dir;
}
export function lanSendSnapshot() {
  if (!lanAvailable() || !state.players) return;
  window.lan.sendState({
    ph: state.phase, rw: state.roundWinner, ct: state.countdownTimer, dy: state.dyingTimer,
    round: lan.roundHost, sc: state.scores.slice(), ts: state.teamScores.slice(),
    players: serializePlayers(state.players, lan.syncLens),
  });
}
function lanApplySnapshot(snap) {
  if (lan.role !== "client" || !snap || !state.players) return;
  if (snap.round !== lan.clientRound) {          // host começou novo round → reconstrói idêntico
    lan.clientRound = snap.round;
    deps.resetRound();
    lan.prevAlive = state.players.map(() => true);
    state.countShown = -1;
  }
  state.scores = snap.sc; state.roundWinner = snap.rw;
  if (snap.ts) state.teamScores = snap.ts;
  state.countdownTimer = snap.ct; state.dyingTimer = snap.dy;
  applyPlayers(state.players, snap.players);
  const prevPhase = state.phase;
  state.phase = snap.ph;
  if (snap.ph === "countdown") { el.countdown.classList.remove("hidden"); deps.updateCountdown(); }
  else el.countdown.classList.add("hidden");
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    if (lan.prevAlive[i] && !p.alive) { audio.explosion(renderer.screenPan(p)); renderer.addShake(SHAKE_DEATH); renderer.addFlash(0.22, "#ffffff"); }
    lan.prevAlive[i] = p.alive;
  }
  renderScoreboard();
  if (snap.ph === "result" && prevPhase !== "result") {
    if (state.gameMode === "teams") {
      const winTeam = state.teamScores.findIndex((s) => s >= WIN_SCORE);
      deps.showVictoryTeam(winTeam >= 0 ? winTeam : 0);
    } else {
      const champ = state.players.find((p) => state.scores[p.id - 1] >= WIN_SCORE) || state.players[0];
      deps.showVictory(champ);
    }
  }
}
