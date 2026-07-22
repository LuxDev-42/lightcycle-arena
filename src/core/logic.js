// Lógica específica do jogo: fábrica de jogador, simulação (movimento +
// colisão por moto), física das partículas e resolução do round.
// Cada moto tem velocidade própria: acelera com o tempo e cada curva corta
// a velocidade pela metade, re-acelerando até o máximo de novo.
// Opera sobre um objeto `state` (criado e mantido pelo main.js).
import {
  CELL, COLS, ROWS, DIRS, OPPOSITE, BASE_TICK, MIN_TICK, MAX_TICK, SPEEDUP, TURN_SPEED_KEEP,
  VICTORY_MS, TRAIL_LINGER_MS, ARES_VIOLENCE, ARES_SPEEDUP, ARES_SPEED_MULT, WALL, idx, inBounds, isFree, clamp,
  ZONE_GRACE_MS, ZONE_STEP_MS, ZONE_MAX_INSET_FRAC,
  PICKUP_SPAWN_MS, PICKUP_MAX, PICKUP_BOOST_MS, PICKUP_BLAST_RADIUS, BOOST_SPEED, TELEPORT_CELLS, TELEPORT_CHARGES,
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
    fadeTimer: 0,       // (morto) ms restantes do whiten (morte → corte); 0 = viva ou já sumiu
    trailGone: false,   // (morto) trilha já apagada da grade?
    effectKind: null,   // power-up temporizado ativo: "boost" | null
    effectMs: 0,        // ms restantes do efeito ativo
    bomb: false,        // carrega uma Bomba (detona ao encostar num rastro, salvando)
    teleportCharges: 0, // usos de teleporte guardados (power-up)
  };
}

// Marca os retângulos de obstáculo como WALL na grade.
export function applyArena(grid, rects) {
  if (!rects) return;
  for (const r of rects)
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++)
        if (inBounds(x, y)) grid[idx(x, y)] = WALL;
}

// Abre uma pista segura à frente de cada spawn (limpa só onde for parede) pra
// ninguém nascer preso nem morrer de cara num obstáculo.
export function clearSpawnRunways(grid, players, ahead = 8) {
  for (const p of players) {
    grid[idx(p.x, p.y)] = p.id;                       // garante o spawn livre
    const d = DIRS[p.dir];
    for (let k = 1; k <= ahead; k++) {
      const cx = p.x + d.x * k, cy = p.y + d.y * k;
      if (inBounds(cx, cy) && grid[idx(cx, cy)] === WALL) grid[idx(cx, cy)] = 0;
    }
  }
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

// Estouro de partículas ao longo da trilha quando ela some (de-rez do rastro).
function spawnTrailBurst(particles, player) {
  const trail = player.trail;
  const stride = Math.max(1, Math.floor(trail.length / 14));   // ~14 pontos ao longo do rastro
  for (let i = 0; i < trail.length; i += stride) {
    if (!trail[i]) continue;                                   // pula buracos do Estouro
    const ox = (trail[i].x + 0.5) * CELL, oy = (trail[i].y + 0.5) * CELL;
    for (let k = 0; k < 3; k++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 160;
      particles.push({
        x: ox, y: oy,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: 1, decay: 0.9 + Math.random() * 0.9,
        size: 2.5 + Math.random() * 3, color: "#ffffff",
      });
    }
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

  const tx = player.x + DIRS[player.dir].x, ty = player.y + DIRS[player.dir].y;
  const cell = inBounds(tx, ty) ? state.grid[idx(tx, ty)] : WALL;   // fora da arena = bloqueado
  if (cell !== 0) {                        // alvo não está livre
    // Bomba (power-up): detona ao ENCOSTAR num rastro (id > 0) — abre o rastro no raio e sobrevive.
    // Só reage a rastro: contra obstáculo do mapa/zona (WALL) ou borda, morre normal.
    if (player.bomb && cell > 0) {
      blastAround(state, tx, ty);          // limpa os rastros ao redor (o alvo vira livre)
      player.bomb = false;                 // consome a bomba
    } else {
      player.alive = false;
      spawnExplosion(state.particles, (tx + 0.5) * CELL, (ty + 0.5) * CELL, player.color);
      player.fadeTimer = TRAIL_LINGER_MS;  // a trilha some só após o delay (visual + libera a grade juntos)
      return;
    }
  }

  player.prevX = player.x; player.prevY = player.y;
  player.x = tx; player.y = ty;
  state.grid[idx(player.x, player.y)] = player.id;
  player.trail.push({ x: player.x, y: player.y });
  collectPickup(state, player);            // pega power-up se a cabeça caiu num item

  // boost (power-up): fixa a moto na velocidade de boost; senão, aceleração normal
  if (player.effectKind === "boost") {
    player.tickMs = MIN_TICK * BOOST_SPEED;
  } else {
    // o programa ARES acelera mais rápido e tem topo de velocidade 10% maior
    const aresMoto = state.ares && player.isAI;
    const minTick = aresMoto ? MIN_TICK / ARES_SPEED_MULT : MIN_TICK;
    const speedup = aresMoto ? ARES_SPEEDUP : SPEEDUP;
    player.tickMs = Math.max(minTick, player.tickMs * speedup);   // acelera de novo
  }
}

// Uma célula está na região JÁ FECHADA da zona (nos `inset` anéis externos)?
export function inClosedZone(x, y, inset) {
  return x < inset || x >= COLS - inset || y < inset || y >= ROWS - inset;
}
// Zona que encolhe: avança a borda em função do tempo de round e mata quem for pego.
function updateZone(state, dt) {
  if (!state.zoneEnabled || state.phase !== "playing") return;
  state.roundTime += dt;
  const maxInset = Math.floor(Math.min(COLS, ROWS) * ZONE_MAX_INSET_FRAC);
  const target = Math.min(maxInset, Math.floor((state.roundTime - ZONE_GRACE_MS) / ZONE_STEP_MS));
  while (state.zoneInset < target) { closeRing(state, state.zoneInset); state.zoneInset++; }
}
// Marca o anel `inset` como WALL e mata quem estiver vivo em cima dele.
function closeRing(state, inset) {
  const grid = state.grid, loC = inset, hiC = COLS - 1 - inset, loR = inset, hiR = ROWS - 1 - inset;
  if (loC > hiC || loR > hiR) return;
  for (let c = loC; c <= hiC; c++) { grid[idx(c, loR)] = WALL; grid[idx(c, hiR)] = WALL; }
  for (let r = loR; r <= hiR; r++) { grid[idx(loC, r)] = WALL; grid[idx(hiC, r)] = WALL; }
  for (const p of state.players) {
    if (p.alive && (p.x === loC || p.x === hiC || p.y === loR || p.y === hiR)) {
      p.alive = false;
      spawnExplosion(state.particles, (p.x + 0.5) * CELL, (p.y + 0.5) * CELL, p.color);
      p.fadeTimer = TRAIL_LINGER_MS;   // mesmo de-rez de uma colisão normal
    }
  }
}

// Power-ups: cronômetro de aparição; solta um item numa célula livre longe das cabeças.
const PICKUP_KINDS = ["boost", "bomb", "teleport"];
function updatePickups(state, dt) {
  if (!state.pickupsEnabled || state.phase !== "playing") return;
  state.pickupTimer -= dt;
  if (state.pickupTimer > 0) return;
  state.pickupTimer = PICKUP_SPAWN_MS;
  if (state.pickups.length >= PICKUP_MAX) return;
  for (let tries = 0; tries < 30; tries++) {
    const x = 1 + Math.floor(Math.random() * (COLS - 2));
    const y = 1 + Math.floor(Math.random() * (ROWS - 2));
    if (state.grid[idx(x, y)] !== 0) continue;                               // só célula livre (fora de parede/rastro/zona)
    if (state.pickups.some((p) => p.x === x && p.y === y)) continue;
    let tooClose = false;                                                    // não nascer em cima de alguém
    for (const pl of state.players) if (pl.alive && Math.abs(pl.x - x) + Math.abs(pl.y - y) < 6) { tooClose = true; break; }
    if (tooClose) continue;
    state.pickups.push({ x, y, kind: PICKUP_KINDS[Math.floor(Math.random() * PICKUP_KINDS.length)] });
    return;
  }
}
// Coleta o item na célula da cabeça (se houver) e aplica o efeito.
function collectPickup(state, player) {
  const arr = state.pickups;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i].x === player.x && arr[i].y === player.y) {
      const kind = arr[i].kind;
      arr.splice(i, 1);
      if (kind === "boost") { player.effectKind = "boost"; player.effectMs = PICKUP_BOOST_MS; }
      else if (kind === "teleport") player.teleportCharges = TELEPORT_CHARGES;   // 3 usos guardados
      else player.bomb = true;                        // Bomba: guardada; detona ao encostar num rastro
      return;
    }
  }
}
// Estouro (power-up): quebra RASTROS (grade > 0) num raio ao redor de (cx,cy) — abre espaço.
// Marca os pontos de rastro no raio como `null` (buraco limpo no desenho). Não toca em
// obstáculos do mapa nem na zona (WALL = -1), que são desenhados fora da grade.
function blastAround(state, cx, cy) {
  const R = PICKUP_BLAST_RADIUS, R2 = R * R, grid = state.grid;
  for (let y = Math.max(0, cy - R); y <= Math.min(ROWS - 1, cy + R); y++)
    for (let x = Math.max(0, cx - R); x <= Math.min(COLS - 1, cx + R); x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= R2 && grid[idx(x, y)] > 0) grid[idx(x, y)] = 0;   // só rastros (id > 0)
    }
  for (const p of state.players) {                 // abre o buraco também no desenho do rastro
    const t = p.trail;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (!c) continue;
      const dx = c.x - cx, dy = c.y - cy;
      if (dx * dx + dy * dy <= R2) t[i] = null;
    }
  }
  spawnExplosion(state.particles, (cx + 0.5) * CELL, (cy + 0.5) * CELL, "#ff5c7a");
}
// Teleporte (duplo-toque na direção atual): blink de TELEPORT_CELLS células à frente, se o
// destino estiver livre. Deixa um buraco no rastro (sem trilha no meio) e reposiciona a moto.
// Retorna true se teleportou. `input.js` chama isto ao detectar o duplo-toque.
export function teleport(state, player) {
  if (!player.alive) return false;
  const d = DIRS[player.dir];
  const dx = player.x + d.x * TELEPORT_CELLS, dy = player.y + d.y * TELEPORT_CELLS;
  if (!isFree(state.grid, dx, dy)) return false;   // destino ocupado/fora da arena → não teleporta (evita suicídio acidental)
  spawnExplosion(state.particles, (player.x + 0.5) * CELL, (player.y + 0.5) * CELL, player.color);   // saída
  player.trail.push(null);                         // quebra: sem rastro no meio do salto
  player.x = dx; player.y = dy; player.prevX = dx; player.prevY = dy;
  state.grid[idx(dx, dy)] = player.id;
  player.trail.push({ x: dx, y: dy });
  player.acc = 0;                                   // recomeça o passo a partir do novo ponto
  spawnExplosion(state.particles, (dx + 0.5) * CELL, (dy + 0.5) * CELL, player.color);              // chegada
  return true;
}

// Avança a simulação por `dt` ms — cada moto no seu próprio ritmo.
// Retorna true se o round terminou neste avanço.
export function advance(state, dt) {
  updateZone(state, dt);                    // zona fecha antes das motos moverem (colisões deste frame já veem a parede)
  updatePickups(state, dt);
  for (const player of state.players) {
    if (!player.alive) continue;
    if (player.effectMs > 0) { player.effectMs -= dt; if (player.effectMs <= 0) player.effectKind = null; }   // efeito é tempo de relógio
    player.acc += dt;
    while (player.alive && player.acc >= player.tickMs) {
      player.acc -= player.tickMs;
      stepPlayer(state, player);
    }
    if (player.alive) player.progress = Math.min(1, player.acc / player.tickMs);
  }

  // Trilha do morto: whiten suave (ease-in no desenho) por TRAIL_LINGER_MS a partir da
  // morte e, no fim, CORTE ABRUPTO — explode em partículas e some (libera a grade).
  // O som (explosão padrão) é disparado no main.js ao detectar o corte (trailGone).
  for (const player of state.players) {
    if (player.alive || player.trailGone) continue;
    player.fadeTimer -= dt;
    if (player.fadeTimer <= 0) {
      spawnTrailBurst(state.particles, player);
      for (const c of player.trail) if (c && !inClosedZone(c.x, c.y, state.zoneInset)) state.grid[idx(c.x, c.y)] = 0;   // pula buracos do Estouro; não reabre a zona
      player.trailGone = true;
    }
  }

  // decide o round apenas durante "playing"
  let roundEnded = false;
  if (state.phase === "playing") {
    if (state.gameMode === "teams") {
      let teams = new Set(), survivor = null;                         // fim quando sobra ≤ 1 time
      for (const player of state.players) if (player.alive) { teams.add(player.team); survivor = player; }
      if (teams.size <= 1) {
        if (survivor) { state.teamScores[survivor.team]++; state.roundWinner = survivor.id; }
        else state.roundWinner = 0;
        state.phase = "dying"; state.dyingTimer = VICTORY_MS; roundEnded = true;
      }
    } else {
      let aliveCount = 0, survivor = null;                            // FFA: sem .filter()/.find() por frame
      for (const player of state.players) if (player.alive) { aliveCount++; survivor = player; }
      if (aliveCount <= 1) {
        if (survivor) { state.scores[survivor.id - 1]++; state.roundWinner = survivor.id; }
        else { state.roundWinner = 0; }
        state.phase = "dying"; state.dyingTimer = VICTORY_MS; roundEnded = true;
      }
    }
  }
  return roundEnded;
}
