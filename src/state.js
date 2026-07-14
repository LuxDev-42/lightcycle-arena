// Estado do jogo: simulação + máquina de fases. Objeto único compartilhado —
// a lógica (logic.js) opera sobre ele por parâmetro; o resto importa daqui.
export const state = {
  grid: null,
  arenaLayout: [],          // obstáculos da partida (escolhido em Opções > Mapas)
  players: null,
  particles: [],
  mode: "cpu",              // "cpu" (1 humano) | "2p" (2 humanos)
  gameMode: "ffa",          // "ffa" (todos contra todos) | "teams" (times) | "race" (corrida)
  roster: [],               // [{ isAI, label, team }]
  raceFinishCol: 0,         // coluna da linha de chegada (modo "race"; 0 = sem corrida)
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
};
