// Constantes do jogo, vetores de direção e utilidades da grade.
// Módulo "folha": não importa nada, todos os outros importam daqui.

export const CELL = 12;        // unidade de mundo (px) por célula
export const COLS = 180;
export const ROWS = 180;
export const W = COLS * CELL;  // largura do mundo (px)
export const H = ROWS * CELL;  // altura do mundo (px)

export const BASE_TICK = 70;    // ms por passo (menor = mais rápido)
export const MIN_TICK = 42;           // intervalo mínimo = velocidade máxima
export const MAX_TICK = 150;          // intervalo máximo = velocidade mínima (piso ao virar muito)
export const SPEEDUP = 0.980;         // fator de aceleração por passo (mais perto de 1 = recupera devagar)
export const TURN_SPEED_KEEP = 0.85;   // ao virar: mantém esta fração da velocidade atual (curvas seguidas acumulam)
export const VICTORY_MS = 1000;// tempo até congelar e mostrar o painel
export const MAX_ZOOM = 2.1;   // limite de aproximação quando estão pertinho

export const WIN_SCORE = 5;      // melhor de 10: o primeiro a 5 vitórias leva a partida
export const COUNTDOWN_MS = 3000;// contagem 3-2-1 antes de cada round começar

// ---- Modo ARES (easter egg) ----
export const ARES_CHANCE = 0.05; // chance de ARES no singleplayer (multiplayer = /10)
export const ARES_HOLD_MS = 3000;// tempo do título ARES parado na tela
export const ARES_FADE_MS = 2000;// fade-out do título ARES (sobreposto à contagem)
export const ARES_HUE = 0;       // matiz vermelha (grid + programa ARES)
export const ARES_VIOLENCE = 1;   // violência da IA no modo ARES
export const ARES_SPEEDUP = 0.95;    // aceleração do programa ARES (bem mais rápida que SPEEDUP)
export const ARES_SPEED_MULT = 1.1;  // topo de velocidade do ARES = 10% acima do normal (minTick ÷ 1.1)

// ---- Camera ----
export const CAM_PAN_TAU = 200;      // const. de tempo (ms) do PAN — menor = acompanha mais rapido (sem teto de velocidade)
export const CAM_ZOOM_TAU = 650;     // const. de tempo (ms) do ZOOM — maior = entra/sai mais suave
export const CAM_PADDING_CELLS = 26; // folga (em celulas) ao redor das motos — maior = mais margem p/ reagir a paredes

// ---- Juice (feedback visual/sonoro) ----
export const SHAKE_DEATH = 16;           // tremor de tela na morte (px) — 0 desliga
export const SHAKE_DECAY_MS = 120;       // decaimento do tremor (const. de tempo)
export const FLASH_DECAY_MS = 160;       // decaimento do flash/vinheta
export const NEARMISS_COOLDOWN_MS = 320; // intervalo minimo entre vinhetas de quase-acidente
export const STEPTICK_MIN_MS = 85;       // intervalo minimo do tique de passo do jogador (anti-spam)

export const DIRS = {
  up:    { x: 0, y: -1 },
  down:  { x: 0, y: 1 },
  left:  { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
export const OPPOSITE = { up: "down", down: "up", left: "right", right: "left" };

// Trilha sonora: playlist EXPLÍCITA (robusta — toca em qualquer servidor, sem
// depender de listagem de diretório). Só liste o nome dos arquivos que estão nas
// pastas; os caminhos/encode são montados no music.js. Se uma lista ficar vazia,
// o music.js cai na varredura automática do diretório (precisa de listagem HTTP).
export const MUSIC_DIR = "music/";
export const MUSIC_DANGER_DIR = "music/dangerMusic/";   // trilha do modo ARES
export const MUSIC_EXTS = [".mp3", ".ogg", ".wav", ".m4a", ".aac", ".opus", ".flac"];
export const MUSIC_TRACKS = [                            // trilha normal (arquivos em music/)
  "Nine Inch Nails - Building Better Worlds Official Visualizer.mp3",
  "Nine Inch Nails - I Know You Can Feel It Working Mens Club Remix.mp3",
  "TRON Legacy - The Son of Flynn Synth Cover.mp3",
];
export const MUSIC_DANGER_TRACKS = [                     // trilha do ARES (arquivos em music/dangerMusic/)
  "Nine Inch Nails - Target Identified Official Visualizer.mp3",
];

export function clamp(value, lo, hi) { return value < lo ? lo : (value > hi ? hi : value); }

// ---- Grade (ocupação por célula: 0 = vazia, 1 = P1, 2 = P2) ----
export function createGrid() { return new Array(COLS * ROWS).fill(0); }
export function idx(col, row) { return row * COLS + col; }
export function inBounds(col, row) { return col >= 0 && col < COLS && row >= 0 && row < ROWS; }
export function isFree(grid, col, row) { return inBounds(col, row) && grid[idx(col, row)] === 0; }
