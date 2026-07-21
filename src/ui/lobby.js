// A "sala de lobby" (#lobby) serve os dois fluxos: LAN (jogadores em rede) e local
// (singleplayer / multiplayer local). `lobbyKind` decide o que aparece e o que o botão
// "Pronto" faz (marcar pronto na rede vs. começar a partida local).
//
// Os callbacks de fluxo (startMatch, configureRoster) chegam por injeção (initLobby) —
// mesmo padrão do lan-client, pra não criar import circular com o orquestrador (main).
import { state } from "../core/state.js";
import { audio } from "../engines.js";
import { el } from "./dom.js";
import { hueColor, skinForIndex, cpuSkin, getHumanHue, setHumanHue } from "./colors.js";
import { TEAM_HUES, teamSkin } from "./teams.js";
import { setSetting } from "./settings.js";
import { registerMenu, showOnly, navBtn, navSlider, navStepper, navInput, refreshNav, enableMultiCursor, getMultiCursors } from "./menu-nav.js";
import { inputIcon } from "./icons.js";
import { setLanSteer, setLobbyJoin, setGamepadCountHandler, playerUsesGamepad } from "../input/input.js";
import { lan, lanAvailable, currentMatchConfig, getProfileName, setProfileName, leaveLan } from "../net/lan-client.js";

export let lobbyKind = "lan";   // "lan" | "local"

let deps = {};
export function initLobby(injected) { deps = injected; }   // { startMatch, configureRoster }


// Sliders de cor por humano (elementos) — pra montar os itens de navegação (um dono cada).
let humanColorEls = [];
// Multi-cursor no lobby local: um cursor por humano, na cor de cada um (preserva posições em `prev`).
function enableMultiForLobby(prev) {
  const colors = {};
  const humans = state.humans || 2;
  for (let i = 0; i < humans; i++) colors[i + 1] = hueColor(getHumanHue(i));
  enableMultiCursor(colors, prev);
}
// Refaz roster + nav quando muda nº de jogadores / modo — sem perder a posição do cursor de cada um.
function relayoutLocalLobby() {
  const prev = getMultiCursors();
  renderLocalRoster();
  registerLobbyNav();
  refreshNav();                                       // re-filtra os itens (sliders entram/saem)
  if (state.mode === "2p") enableMultiForLobby(prev);
}

export function openLobby() {   // LAN
  lobbyKind = "lan";
  setLobbyJoin(null); setGamepadCountHandler(null);   // recontar gamepad é só do multiplayer local
  el.lobbyTitle.textContent = "Lobby";
  el.lobbyName.value = getProfileName();
  el.lobbyHue.value = lan.state.myHue;
  applyLobbyColor(false);
  setLobbyKindUI();
  if (lan.state.isHost && lanAvailable()) window.lan.setMatch(currentMatchConfig());
  registerLobbyNav();
  showOnly(el.lobby);
  renderLobby();
}

export function openLocalLobby(mode) {   // singleplayer / multiplayer local
  lobbyKind = "local";
  lan.role = null; lan.hues = null; setLanSteer(null);   // garante que o modo LAN está desligado
  state.mode = mode;
  setLobbyJoin(null);
  setGamepadCountHandler(mode === "2p" ? relayoutLocalLobby : null);   // (des)conectar controle recompõe os jogadores
  el.lobbyTitle.textContent = mode === "2p" ? "Multiplayer Local" : "1 Jogador";
  setLobbyKindUI();
  renderLocalRoster();
  registerLobbyNav();
  showOnly(el.lobby);
  if (mode === "2p") enableMultiForLobby();   // multi-cursor (um por jogador); singleplayer = cursor único
}

// Ajusta o que aparece no lobby conforme o tipo (LAN x local) e o papel (host x cliente).
function setLobbyKindUI() {
  const isLan = lobbyKind === "lan";
  const showMode = !isLan || lan.state.isHost;   // switch de modo: local sempre; LAN só o host
  el.lobbyNameField.style.display = isLan ? "" : "none";   // nome/cor de rede: só no LAN
  el.lobbyColors.style.display = isLan ? "" : "none";
  el.modeSeg.style.display = showMode ? "" : "none";
  el.lobbyHumans.style.display = "none";   // nº de jogadores agora é automático (2 teclado + 1 por gamepad)
  el.btnLobbyOptions.style.display = showMode ? "" : "none";
  el.btnLobbyReady.textContent = isLan ? "Pronto" : "Começar";
  el.btnLobbyLeave.querySelector(".btn-label").textContent = isLan ? "Sair" : "Voltar";
}

// Preview do roster local (quem vai jogar) — mesmas cores da partida (skinForIndex).
export function renderLocalRoster() {
  deps.configureRoster(state.mode);   // monta state.roster + state.gameMode (a partida remonta depois)
  const teams = state.gameMode === "teams";
  const total = state.roster.length;
  el.lobbyPlayers.innerHTML = "";
  humanColorEls = [];
  state.roster.forEach((r, i) => {
    // mesma cor da partida: Times = cor do time; CPU = personagem/filler (branco do TRON); humano = cor escolhida
    const hue = teams ? teamSkin(r.team, i).hue : (r.isAI ? r.hue : skinForIndex(i, total).hue);
    const c = teams ? hueColor(hue) : (r.isAI ? cpuSkin(r).color : hueColor(hue));
    const row = document.createElement("div"); row.className = "lobby-player";
    const dot = document.createElement("span"); dot.className = "pdot"; dot.style.background = c; dot.style.boxShadow = `0 0 8px ${c}`;
    const name = document.createElement("span"); name.className = "pname"; name.textContent = r.label;
    row.append(dot, name);
    if (!r.isAI) {   // ícone do tipo de input (teclado ou controle)
      const ico = document.createElement("span"); ico.className = "pinput";
      ico.innerHTML = inputIcon(playerUsesGamepad(i) ? "gamepad" : "keyboard");
      row.appendChild(ico);
      if (!teams) {   // slider de cor próprio (no Times a cor é do time, sem escolha individual)
        const slider = document.createElement("input");
        slider.type = "range"; slider.min = "0"; slider.max = "360"; slider.className = "hue pcolor";
        slider.value = String(hue);
        slider.style.setProperty("--thumb", c);
        slider.addEventListener("input", () => {
          const h = +slider.value, cc = hueColor(h);
          setHumanHue(i, h);   // persiste + refreshColorUI (título/pílulas)
          slider.style.setProperty("--thumb", cc);
          dot.style.background = cc; dot.style.boxShadow = `0 0 8px ${cc}`;
        });
        row.appendChild(slider);
        humanColorEls[i] = slider;
      }
    }
    el.lobbyPlayers.appendChild(row);
  });
  el.lobbyStatus.textContent = teams ? "No modo Times você escolhe os lados ao começar."
    : state.mode === "2p" ? "Aperte um controle pra entrar · Começar quando prontos."
    : "Pronto para começar.";
}

export function onModeChange(v) {
  setSetting("gameMode", v);   // apply acende as pílulas + ajusta state.gameMode (fora de partida)
  if (lobbyKind === "lan") { if (lan.state.isHost && lanAvailable()) window.lan.setMatch(currentMatchConfig()); }
  else relayoutLocalLobby();
}
export function refreshModeSwatches() {   // pílulas de modo herdam as cores reais: P1 (hue1) no FFA, TEAM_HUES no Times
  el.modeFfa.style.setProperty("--ffa-h", getHumanHue(0));
  el.modeTeams.style.setProperty("--a-h", TEAM_HUES[0]);
  el.modeTeams.style.setProperty("--b-h", TEAM_HUES[1]);
}
export function onLobbyReady() { setGamepadCountHandler(null); if (lobbyKind === "local") deps.startMatch(state.mode); else toggleReady(); }
export function onLobbyLeave() {
  setLobbyJoin(null); setGamepadCountHandler(null);
  if (lobbyKind === "local") { audio.uiBack(); showOnly(state.mode === "2p" ? el.multiplayerMenu : el.menu); }
  else leaveLan();
}

function applyLobbyColor(sendNet) {
  const c = hueColor(lan.state.myHue);
  lan.state.myColor = c;
  el.lobbyHue.style.setProperty("--thumb", c);
  el.lobbySwatch.style.background = c; el.lobbySwatch.style.boxShadow = `0 0 8px ${c}`;
  if (sendNet && lanAvailable()) window.lan.setColor(c);
}
let lobbyColorTimer = null;
export function lobbyHueInput() {
  lan.state.myHue = +el.lobbyHue.value;
  applyLobbyColor(false);                                                    // visual imediato
  clearTimeout(lobbyColorTimer);
  lobbyColorTimer = setTimeout(() => { if (lanAvailable()) window.lan.setColor(hueColor(lan.state.myHue)); }, 120);  // rede com debounce
}
let lobbyNameTimer = null;
export function lobbyNameInput() {
  const n = el.lobbyName.value.slice(0, 16);
  setProfileName(n);                                                         // persiste local (localStorage)
  clearTimeout(lobbyNameTimer);
  lobbyNameTimer = setTimeout(() => { if (lanAvailable() && window.lan.setName) window.lan.setName(n.trim() || "Jogador"); }, 200);
}
function toggleReady() {
  const me = lan.state.players.find((p) => p.id === lan.state.youId);
  if (lanAvailable()) window.lan.setReady(!(me && me.ready));
}
function registerLobbyNav() {
  const nav = [];
  if (lobbyKind === "local" || lan.state.isHost) nav.push(navStepper(el.modeSeg, () => onModeChange(0), () => onModeChange(1)));   // ←/→ alterna o modo
  if (lobbyKind === "local") humanColorEls.forEach((sl, i) => { if (sl) nav.push(navSlider(sl, 8, i + 1)); });   // slider de cor de cada humano (dono = pid; outro → erro)
  if (lobbyKind === "lan") { nav.push(navInput(el.lobbyName)); nav.push(navSlider(el.lobbyHue, 8)); }   // nome navegável por teclado (Enter edita)
  nav.push(navBtn("btn-lobby-ready"));
  if (lobbyKind === "local" || lan.state.isHost) nav.push(navBtn("btn-lobby-options"));
  nav.push(navBtn("btn-lobby-leave"));
  registerMenu(el.lobby, nav);
}
export function renderLobby() {
  el.lobbyPlayers.innerHTML = "";
  for (const p of lan.state.players) {
    const row = document.createElement("div");
    row.className = "lobby-player" + (p.id === lan.state.youId ? " me" : "");
    const dot = document.createElement("span"); dot.className = "pdot"; dot.style.background = p.color; dot.style.boxShadow = `0 0 8px ${p.color}`;
    const name = document.createElement("span"); name.className = "pname";
    name.textContent = p.name + (p.isHost ? " (host)" : "") + (p.id === lan.state.youId ? " · você" : "");
    const rd = document.createElement("span"); rd.className = "pready " + (p.ready ? "on" : "off"); rd.textContent = p.ready ? "Pronto" : "Aguardando";
    row.append(dot, name, rd);
    el.lobbyPlayers.appendChild(row);
  }
  const me = lan.state.players.find((p) => p.id === lan.state.youId);
  el.btnLobbyReady.textContent = me && me.ready ? "Cancelar" : "Pronto";
  el.lobbyStatus.textContent = lan.state.players.length < 2 ? "Aguardando outro jogador entrar…" : "Marque pronto para começar.";
}
