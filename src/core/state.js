// Estado do jogo: simulação + máquina de fases. Objeto único compartilhado —
// a lógica (logic.js) opera sobre ele por parâmetro; o resto importa daqui.
export const state = {
  grid: null,
  arenaLayout: [],          // obstáculos da partida (escolhido em Opções > Mapas)
  players: null,
  particles: [],
  mode: "cpu",              // "cpu" (1 humano, vs CPU) | "2p" (multiplayer local, 2-4 humanos)
  humans: 1,                // nº de jogadores humanos locais (1 no cpu; 2-4 no multiplayer local)
  gameMode: "ffa",          // "ffa" (todos contra todos) | "teams" (times)
  roster: [],               // [{ isAI, label, team }]
  phase: "menu",            // "menu" | "aresintro" | "countdown" | "playing" | "dying" | "result" | "fade"
  scores: [],
  teamScores: [0, 0],       // placar por time (modo "teams")
  roundWinner: null,
  dyingTimer: 0,
  difficulty: 2,            // definido de fato pelo setting "difficulty" no init
  ares: false,              // modo ARES ativo (só sai ao voltar pro menu)
  introTimer: 0,            // título ARES na tela
  countdownTimer: 0,        // contagem 3-2-1
  countShown: -1,
  nameplateTimer: 0,        // ms restantes dos balões "quem é quem" no início do round
  zoneEnabled: false,       // zona que encolhe ligada nesta partida (só local por ora)
  roundTime: 0,             // ms decorridos no "playing" deste round (dispara a zona)
  zoneInset: 0,             // nº de anéis já fechados a partir da borda (0 = arena cheia)
  pickupsEnabled: false,    // power-ups ligados nesta partida (só local por ora)
  pickups: [],              // itens no chão: [{ x, y, kind }]
  pickupTimer: 0,           // ms até a próxima aparição
  blasts: [],               // centros de estouro de bomba NESTE frame (host → cliente replica no LAN)
};
