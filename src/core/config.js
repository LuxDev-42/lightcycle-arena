// Constantes do jogo, vetores de direção e utilidades da grade.
// Módulo "folha": não importa nada, todos os outros importam daqui.

export const CELL = 12;        // unidade de mundo (px) por célula
// Arena quadrada — dimensões MUTÁVEIS (Opções > Mapas > Tamanho), atualizadas por
// setArenaSize(). São `let` exportadas: os importadores veem o valor atual (live binding).
// Quem cacheia tamanho (buffers da IA) precisa realocar quando isso muda.
export let COLS = 180;
export let ROWS = 180;
export let W = COLS * CELL;    // largura do mundo (px) — derivada
export let H = ROWS * CELL;    // altura do mundo (px) — derivada

// Ticks de velocidade: mutáveis via setSpeedScale (opção "Velocidade" da partida).
// São `let` de propósito — o reassign propaga pros imports (live bindings), igual COLS.
const TICK_NORMAL = Object.freeze({ base: 70, min: 42, max: 150 });   // referência = velocidade "Normal"
export let BASE_TICK = TICK_NORMAL.base;    // ms por passo (menor = mais rápido)
export let MIN_TICK = TICK_NORMAL.min;      // intervalo mínimo = velocidade máxima
export let MAX_TICK = TICK_NORMAL.max;      // intervalo máximo = velocidade mínima (piso ao virar muito)
// scale > 1 = mais rápido (ticks proporcionalmente menores). Escala os três juntos
// pra preservar a dinâmica de aceleração/curva em qualquer velocidade.
export function setSpeedScale(scale) {
  BASE_TICK = Math.round(TICK_NORMAL.base / scale);
  MIN_TICK = Math.round(TICK_NORMAL.min / scale);
  MAX_TICK = Math.round(TICK_NORMAL.max / scale);
}
export const SPEED_NAMES = ["Lenta", "Normal", "Rápida", "Turbo"];   // índice → rótulo
export const SPEED_SCALES = [0.82, 1.0, 1.22, 1.5];                  // índice → fator (Normal = 1.0)
export const SPEEDUP = 0.980;         // fator de aceleração por passo (mais perto de 1 = recupera devagar)
export const TURN_SPEED_KEEP = 0.85;   // ao virar: mantém esta fração da velocidade atual (curvas seguidas acumulam)
export const VICTORY_MS = 3000;// tempo até congelar e mostrar o painel / ir pra próxima rodada
export const TRAIL_LINGER_MS = 2000;// trilha de moto morta: whiten suave por isto (desde a morte) até o corte abrupto
export const TRAIL_WINDUP_MS = 1000;// windup do de-rez (som): dura isto e começa a ESTE tempo antes do corte/pop
export const MAX_ZOOM = 2.1;   // limite de aproximação quando estão pertinho

export const WIN_SCORE = 3;      // default/fallback de vitórias (configurável em Opções > Partida, 1–10)
export const COUNTDOWN_MS = 3000;// contagem 3-2-1 antes de cada round começar

// Zona que encolhe (anti-empate): após a carência, a borda avança marcando WALL, anel
// por anel, forçando o encontro. O anel de fronteira acende como aviso antes de fechar.
export const ZONE_GRACE_MS = 10000;   // carência antes de começar a fechar
export const ZONE_STEP_MS = 700;      // tempo por anel (1 célula) fechado
export const ZONE_MAX_INSET_FRAC = 0.42;   // fecha até esta fração de cada lado (deixa um miolo, não zera)

// ---- Modo ARES (easter egg) ----
export const ARES_CHANCE = 0.05; // chance de ARES no singleplayer (multiplayer = /10)
export const ARES_HOLD_MS = 3000;// tempo do título ARES parado na tela
export const ARES_FADE_MS = 2000;// fade-out do título ARES (sobreposto à contagem)
export const ARES_HUE = 0;       // matiz vermelha (grid + programa ARES)
export const ARES_VIOLENCE = 1;   // violência da IA no modo ARES
export const ARES_SPEEDUP = 0.95;    // aceleração do programa ARES (bem mais rápida que SPEEDUP)
export const ARES_SPEED_MULT = 1.1;  // topo de velocidade do ARES = 10% acima do normal (minTick ÷ 1.1)

// ---- Camera ----
// O "atual" persegue o "alvo" (centro + zoom) com SmoothDamp (criticamente
// amortecido): a velocidade é um ESTADO suavizado → muda de direção sem solavanco
// e converge sem overshoot. O smoothTime ENCURTA com a distância, então a velocidade
// cresce ~QUADRATICAMENTE com ela: longe = bem mais rápido, perto = bem suave.
//   smoothTime(d) = max(MIN, SMOOTH / (1 + d/REF))   // velocidade ≈ d / smoothTime(d)
export const CAM_PAN_SMOOTH = 0.50;   // suavização do CENTRO perto do alvo (s) — maior = mais suave de perto
export const CAM_PAN_REF = 30 * CELL; // distância (px) onde o smoothTime do centro cai à metade (ramp quadrática)
export const CAM_ZOOM_SMOOTH = 0.60;  // suavização do ZOOM perto do alvo (s)
export const CAM_ZOOM_REF = 0.4;      // distância (em zoom) onde o smoothTime do zoom cai à metade
export const CAM_SMOOTH_MIN = 0.08;   // piso do smoothTime (s) — evita ficar instantâneo em distâncias enormes
export const CAM_PADDING_CELLS = 26; // folga (em celulas) ao redor das motos — maior = mais margem p/ reagir a paredes

// ---- Juice (feedback visual/sonoro) ----
export const SHAKE_DEATH = 16;           // tremor de tela na morte (px) — 0 desliga
export const SHAKE_DECAY_MS = 120;       // decaimento do tremor (const. de tempo)
export const FLASH_DECAY_MS = 160;       // decaimento do flash/vinheta
export const NEARMISS_COOLDOWN_MS = 320; // intervalo minimo entre vinhetas de quase-acidente
export const STEPTICK_MIN_MS = 85;       // intervalo minimo do tique de passo do jogador (anti-spam)

// ---- Tamanho da arena (quadrada) ----
export const ARENA_SIZES = [120, 180, 240, 360];                        // células por lado (default = 180 = "Média")
export const ARENA_SIZE_NAMES = ["Pequena", "Média", "Grande", "Enorme"];
export function setArenaSize(n) { COLS = n; ROWS = n; W = n * CELL; H = n * CELL; }

// ---- Arena: obstáculos ----
// Layouts gerados PARAMETRICAMENTE em função do tamanho `n` (centro = n/2): ficam
// centrados e proporcionais em qualquer arena. Em n=180 reproduzem os layouts
// originais exatos. Mesma ordem dos nomes abaixo.
export const ARENA_NAMES = ["Vazio", "Núcleo", "Pilares", "Cruz"];

// "Personagens" de CPU com cor assinatura → a matiz define a personalidade
// (personalityForHue): vermelho/laranja = agressivo, amarelo/verde = territorial,
// ciano/azul = defensivo. TRON é o branco especial (defensor da grade, defensivo).
export const CPU_CHARACTERS = [
  { name: "SARK",    hue: 0   },              // vermelho → agressivo
  { name: "RINZLER", hue: 16  },              // laranja-avermelhado → agressivo
  { name: "CLU",     hue: 46  },              // laranja-amarelado → territorial
  { name: "QUORRA",  hue: 190 },              // ciano → defensivo
  { name: "TRON",    hue: 205, white: true }, // branco especial → defensivo (defensor da grade)
];
// Nomes genéricos: cor indiferente (matiz sorteada por partida). Completam quando
// há mais CPUs que personagens; entram no sorteio junto pra dar variedade.
// Mistura de programas do Tron + referências de software/games dos anos 80.
export const CPU_FILLERS = [
  "RAM", "YORI", "DUMONT", "CROM", "BIT", "MCP", "ABRAXAS", "GEM", "ANON", "BASELINE", "GIBSON",
  "ROBOTRON", "BERZERK", "ZAXXON", "DEFENDER", "GALAGA", "PARADROID", "XENON", "ELITE", "QIX",
  "ZORK", "KERMIT", "LOTUS", "WORDSTAR", "DBASE", "SIDEKICK", "TURBO", "NORTON", "DPAINT",
  "ULTIMA", "MULE", "VISICALC", "HYPERCARD",
];
export function buildArenaLayout(mapIndex, n) {
  const c = n / 2, R = Math.round;
  if (mapIndex === 1) {                                  // Núcleo: quadrado central
    const s = R(n / 6);
    return [{ x: R(c - s / 2), y: R(c - s / 2), w: s, h: s }];
  }
  if (mapIndex === 2) {                                  // Pilares: 4 quadrados
    const s = R(n / 15), o = R(n * 0.078);
    const a = R(c) - o - s, b = R(c) + o;
    return [
      { x: a, y: a, w: s, h: s }, { x: b, y: a, w: s, h: s },
      { x: a, y: b, w: s, h: s }, { x: b, y: b, w: s, h: s },
    ];
  }
  if (mapIndex === 3) {                                  // Cruz central
    const len = R(n * 0.355), th = R(n / 22);
    return [
      { x: R(c - th / 2), y: R(c - len / 2), w: th, h: len },
      { x: R(c - len / 2), y: R(c - th / 2), w: len, h: th },
    ];
  }
  return [];                                             // Vazio (0)
}

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
export const MENU_TRACK = "solar-sailer.mp3";           // tema do menu/intro (toca em loop; nome URL-safe p/ o webview)
export const MUSIC_DANGER_DIR = "music/dangerMusic/";   // trilha do modo ARES
export const MUSIC_EXTS = [".mp3", ".ogg", ".wav", ".m4a", ".aac", ".opus", ".flac"];
export const MUSIC_TRACKS = [                            // trilha normal (arquivos em music/; nomes URL-safe p/ o webview)
  "nin-mens-club-remix.mp3",
  "son-of-flynn.mp3",
  "the-game-has-changed.mp3",
  "nin-mens-club-remix.mp3"
];
export const MUSIC_DANGER_TRACKS = [                     // trilha do ARES (arquivos em music/dangerMusic/)
  "nin-target-identified.mp3",
  "nin-infiltrator.mp3",
];

export function clamp(value, lo, hi) { return value < lo ? lo : (value > hi ? hi : value); }

// ---- Grade (ocupação por célula: 0 = vazia, 1 = P1, 2 = P2) ----
export const WALL = -1;   // celula de obstaculo na grade (qualquer valor != 0 bloqueia colisao/IA)
export function createGrid() { return new Array(COLS * ROWS).fill(0); }
export function idx(col, row) { return row * COLS + col; }
export function inBounds(col, row) { return col >= 0 && col < COLS && row >= 0 && row < ROWS; }
export function isFree(grid, col, row) { return inBounds(col, row) && grid[idx(col, row)] === 0; }
