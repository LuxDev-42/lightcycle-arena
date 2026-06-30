// Lógica específica do jogo: fábrica de jogador, simulação (movimento +
// colisão por moto), física das partículas e resolução do round.
// Cada moto tem velocidade própria: acelera com o tempo e cada curva corta
// a velocidade pela metade, re-acelerando até o máximo de novo.
// Opera sobre um objeto `state` (criado e mantido pelo main.js).
import {
  CELL, COLS, ROWS, DIRS, OPPOSITE, BASE_TICK, MIN_TICK, MAX_TICK, SPEEDUP, TURN_SPEED_KEEP,
  VICTORY_MS, ARES_VIOLENCE, ARES_SPEEDUP, ARES_SPEED_MULT, idx, isFree, clamp,
} from "./config.js";
import { chooseDirection } from "./ai.js";

// Encaixa um vetor livre no cardinal (up/down/left/right) mais alinhado.
function nearestCardinal(vx, vy) {
  let best = "right", bestDot = -Infinity;
  for (const dir in DIRS) {
    const dot = vx * DIRS[dir].x + vy * DIRS[dir].y;
    if (dot > bestDot) { bestDot = dot; best = dir; }
  }
  return best;
}

// Distribui `n` motos uniformemente num círculo no centro da arena. Quanto mais
// motos, maior o raio (mais espalhadas). Cada uma sai virada na tangente
// (mesmo sentido), então mantêm o espaçamento sem colidir de cara.
export function spawnLayout(n) {
  const cx = COLS / 2, cy = ROWS / 2;
  const maxR = Math.min(COLS, ROWS) / 2 - 6;
  const spread = clamp((n - 2) / 8, 0, 1);            // 0 (2 motos) .. 1 (10 motos)
  const r = maxR * (0.55 + 0.42 * spread);
  const layout = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 - Math.PI / 2;  // começa no topo
    const col = clamp(Math.round(cx + r * Math.cos(ang)), 1, COLS - 2);
    const row = clamp(Math.round(cy + r * Math.sin(ang)), 1, ROWS - 2);
    layout.push({ col, row, dir: nearestCardinal(-Math.sin(ang), Math.cos(ang)) });
  }
  return layout;
}

// `skin` = { color, glow, hue }; `label` = nome curto p/ placar (ex.: "P1", "CPU 2").
export function makePlayer(id, startCol, startRow, dir, isAI, skin, label) {
  return {
    id,
    label,
    color: skin.color, glow: skin.glow, hue: skin.hue,
    x: startCol, y: startRow,         // célula atual da cabeça
    prevX: startCol, prevY: startRow, // célula anterior (p/ interpolação visual)
    dir,
    nextDir: dir,
    alive: true,
    isAI,
    desperate: false,   // (IA) isolada e perdendo -> acelera pra encerrar a partida logo
    trail: [{ x: startCol, y: startRow }],
    tickMs: BASE_TICK,  // intervalo entre passos desta moto (menor = mais rápido)
    acc: 0,             // acumulador de tempo desta moto (ms)
    progress: 0,        // 0..1: progresso visual entre um passo e o próximo
  };
}

export function spawnExplosion(particles, originX, originY, color) {
  for (let i = 0; i < 46; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 320;
    particles.push({
      x: originX, y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      decay: 0.7 + Math.random() * 0.9,
      size: 3 + Math.random() * 5,
      color,
    });
  }
}

export function updateParticles(state, dt) {
  if (!state.particles.length) return;
  const seconds = dt / 1000;
  const arr = state.particles;
  let w = 0;                                  // compacta in-place (descarta mortos sem alocar novo array)
  for (let r = 0; r < arr.length; r++) {
    const particle = arr[r];
    particle.x += particle.vx * seconds;
    particle.y += particle.vy * seconds;
    particle.vx *= 0.94;
    particle.vy *= 0.94;
    particle.life -= particle.decay * seconds;
    if (particle.life > 0) arr[w++] = particle;
  }
  arr.length = w;
}

// Avança UMA moto em uma célula: IA, curva (penalidade de velocidade),
// colisão e aceleração.
function stepPlayer(state, player) {
  if (player.isAI) {
    const violence = state.ares ? ARES_VIOLENCE : (state.difficulty || 1) * 0.2;
    const dir = chooseDirection(player, state.players, state.grid, violence);
    if (dir) player.nextDir = dir;
  }

  // curva de verdade (muda de direção, sem ser ré): perde uma fração da
  // velocidade ATUAL — uma curva custa pouco, curvas seguidas acumulam
  // (com piso de velocidade em MAX_TICK)
  if (player.nextDir !== player.dir && player.nextDir !== OPPOSITE[player.dir]) {
    player.dir = player.nextDir;
    player.tickMs = Math.min(MAX_TICK, player.tickMs / TURN_SPEED_KEEP);
  }

  const target = { x: player.x + DIRS[player.dir].x, y: player.y + DIRS[player.dir].y };
  if (!isFree(state.grid, target.x, target.y)) {
    player.alive = false;
    spawnExplosion(state.particles, (target.x + 0.5) * CELL, (target.y + 0.5) * CELL, player.color);
    return;
  }

  player.prevX = player.x; player.prevY = player.y;
  player.x = target.x; player.y = target.y;
  state.grid[idx(player.x, player.y)] = player.id;
  player.trail.push({ x: player.x, y: player.y });

  // o programa ARES acelera mais rápido e tem topo de velocidade 10% maior
  const aresMoto = state.ares && player.isAI;
  const minTick = aresMoto ? MIN_TICK / ARES_SPEED_MULT : MIN_TICK;
  const speedup = aresMoto ? ARES_SPEEDUP : SPEEDUP;
  player.tickMs = Math.max(minTick, player.tickMs * speedup);   // acelera de novo
}

// Avança a simulação por `dt` ms — cada moto no seu próprio ritmo.
// Retorna true se o round terminou neste avanço.
export function advance(state, dt) {
  for (const player of state.players) {
    if (!player.alive) continue;
    player.acc += dt;
    while (player.alive && player.acc >= player.tickMs) {
      player.acc -= player.tickMs;
      stepPlayer(state, player);
    }
    if (player.alive) player.progress = Math.min(1, player.acc / player.tickMs);
  }

  // decide o round apenas durante "playing"
  let roundEnded = false;
  if (state.phase === "playing") {
    let aliveCount = 0, survivor = null;                              // sem .filter()/.find() por frame
    for (const player of state.players) if (player.alive) { aliveCount++; survivor = player; }
    if (aliveCount <= 1) {
      if (survivor) { state.scores[survivor.id - 1]++; state.roundWinner = survivor.id; }
      else { state.roundWinner = 0; }
      state.phase = "dying";
      state.dyingTimer = VICTORY_MS;
      roundEnded = true;
    }
  }
  return roundEnded;
}
