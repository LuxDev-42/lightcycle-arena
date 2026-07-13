// Refs centralizadas do DOM: um único lugar pra pegar os elementos da página.
// Os botões avulsos (cliques pontuais) seguem usando $ direto no main/menu-nav.
export const $ = (id) => document.getElementById(id);

export const el = {
  canvas: $("game"),
  bgm: $("bgm"),
  scoreboard: $("scoreboard"),

  // Overlays de menu (controlados por showOnly)
  menu: $("menu"),
  optionsMenu: $("options-menu"),
  colorsMenu: $("colors-menu"),
  audioMenu: $("audio-menu"),
  advMenu: $("adversaries-menu"),
  mapsMenu: $("maps-menu"),
  graphicsMenu: $("graphics-menu"),
  soundsMenu: $("sounds-menu"),
  quitConfirm: $("quit-confirm"),
  pauseMenu: $("pause-menu"),
  multiplayerMenu: $("multiplayer-menu"),
  lanMenu: $("lan-menu"),
  lanFind: $("lan-find"),
  lanSessionList: $("lan-session-list"),
  lanFindStatus: $("lan-find-status"),
  lobby: $("lobby"),
  lobbyStatus: $("lobby-status"),
  lobbyPlayers: $("lobby-players"),
  lobbyHue: $("lobby-hue"),
  lobbySwatch: $("lobby-swatch"),
  btnLobbyReady: $("btn-lobby-ready"),
  btnLobbyLeave: $("btn-lobby-leave"),
  btnLobbyOptions: $("btn-lobby-options"),
  lobbyName: $("lobby-name"),
  soundList: $("sound-list"),
  result: $("result"),
  touchControls: $("touch-controls"),

  // Resultado / dicas
  resultTitle: $("result-title"),
  resultScore: $("result-score"),
  keysInfo: $("keys-info"),

  // Cores
  hue1: $("hue1"),
  hue2: $("hue2"),
  sw1: $("sw1"),
  sw2: $("sw2"),
  cdot1: $("cdot1"),
  cdot2: $("cdot2"),
  btnCpu: $("btn-cpu"),
  btn2p: $("btn-multiplayer"),   // botão Multiplayer herda o tom do P2 (config)
  btnLanFind: $("btn-lan-find"),

  // Áudio (sliders)
  musicVol: $("music-vol"),
  sfxVol: $("sfx-vol"),
  musicVal: $("music-val"),
  sfxVal: $("sfx-val"),

  // Steppers (Programas / Dificuldade / Mapas / Gráficos)
  spVal: $("sp-val"),
  mpVal: $("mp-val"),
  diffVal: $("diff-val"),
  diffAux: $("diff-aux"),
  mapVal: $("map-val"),
  mapAux: $("map-aux"),
  sizeVal: $("size-val"),
  sizeAux: $("size-aux"),
  gfxVal: $("gfx-val"),
  gfxAux: $("gfx-aux"),
  btnFullscreen: $("btn-fullscreen"),
  btnQuit: $("btn-quit"),

  // Intro do ARES + contagem
  aresIntro: $("ares-intro"),
  aresTitle: $("ares-title"),
  aresSub: $("ares-sub"),
  aresTerminal: $("ares-terminal"),
  aresTerminalLines: $("ares-terminal-lines"),
  countdown: $("countdown"),
  countdownNum: $("countdown-num"),
  fade: $("fade"),

  // Intro (abertura)
  intro: $("intro"),
  introCredit: $("intro-credit"),
  introTitle: $("intro-title"),
  menuTitle: $("menu-title"),
};
