// Overlay de debug (Ctrl+D+B): visualiza o "pathfinding" da IA por cima da cena.
// Vive fora do Renderer pra não inflar o desenho normal; recebe o renderer (`r`)
// pra usar o contexto e a câmera. Dev-only — não entra no caminho de jogo.
import { CELL, COLS, ROWS, DIRS, BASE_TICK, MIN_TICK, clamp } from "./config.js";

// Buffers reaproveitados entre frames (sem realocar).
let dbgOwner = null, dbgDist = null, dbgQ = null;
let pPrev = null, pSeen = null, pQ = null, pGen = 0;

// Território (Voronoi multi-fonte): cada célula livre fica com a cor de quem
// chega primeiro a partir das cabeças; empate = cinza. É a base da decisão da IA.
function territory(state) {
  const n = COLS * ROWS;
  if (!dbgOwner || dbgOwner.length !== n) {
    dbgOwner = new Int16Array(n); dbgDist = new Int32Array(n); dbgQ = new Int32Array(n);
  }
  const owner = dbgOwner, dist = dbgDist, q = dbgQ, grid = state.grid, players = state.players;
  owner.fill(-2);                                  // -2 não visitada · -1 contestada · >=0 índice do jogador
  const connected = players.map(() => false);      // a região deste jogador encosta na de outro?
  let tail = 0;
  for (let i = 0; i < players.length; i++) {
    const p = players[i]; if (!p.alive) continue;
    const k = p.y * COLS + p.x; if (owner[k] === -2) { owner[k] = i; dist[k] = 0; q[tail++] = k; }
  }
  for (let head = 0; head < tail; head++) {
    const k = q[head], o = owner[k], c = k % COLS, r = (k - c) / COLS, nd = dist[k] + 1;
    const relax = (nk) => {
      if (grid[nk] !== 0) return;
      if (owner[nk] === -2) { owner[nk] = o; dist[nk] = nd; q[tail++] = nk; }
      else if (owner[nk] !== o) {
        if (o >= 0 && owner[nk] >= 0) { connected[o] = true; connected[owner[nk]] = true; }
        if (dist[nk] === nd && owner[nk] !== -1) owner[nk] = -1;
      }
    };
    if (c + 1 < COLS) relax(k + 1); if (c > 0) relax(k - 1);
    if (r + 1 < ROWS) relax(k + COLS); if (r > 0) relax(k - COLS);
  }
  return { owner, connected };
}

// Caminho mais curto (BFS) da cabeça do bot até encostar no oponente — o
// "traçado": se existe, o bot ainda alcança o alvo; se não, está isolado.
function path(grid, sx, sy, tx, ty) {
  const n = COLS * ROWS;
  if (!pPrev || pPrev.length !== n) { pPrev = new Int32Array(n); pSeen = new Int32Array(n); pQ = new Int32Array(n); pGen = 0; }
  const prev = pPrev, seen = pSeen, q = pQ, gen = ++pGen;
  const sk = sy * COLS + sx; seen[sk] = gen; prev[sk] = -1; let tail = 0; q[tail++] = sk;
  let found = -1;
  for (let head = 0; head < tail; head++) {
    const k = q[head], c = k % COLS, r = (k - c) / COLS;
    if (Math.abs(c - tx) + Math.abs(r - ty) === 1) { found = k; break; }   // encostou no alvo
    const tryN = (nk) => { if (grid[nk] !== 0 || seen[nk] === gen) return; seen[nk] = gen; prev[nk] = k; q[tail++] = nk; };
    if (c + 1 < COLS) tryN(k + 1); if (c > 0) tryN(k - 1);
    if (r + 1 < ROWS) tryN(k + COLS); if (r > 0) tryN(k - COLS);
  }
  if (found < 0) return null;
  const out = []; for (let cur = found; cur !== -1; cur = prev[cur]) out.push({ x: cur % COLS, y: (cur - cur % COLS) / COLS });
  return out;
}

// Desenha o overlay completo usando o contexto/câmera do renderer `r`.
export function drawDebug(r, state) {
  const ctx = r.ctx;
  if (!state.players) return;
  const { owner, connected } = territory(state);
  const halfW = (r.viewW / 2) / r.camZoom, halfH = (r.viewH / 2) / r.camZoom;
  const c0 = Math.max(0, Math.floor((r.camX - halfW) / CELL)), c1 = Math.min(COLS, Math.ceil((r.camX + halfW) / CELL));
  const r0 = Math.max(0, Math.floor((r.camY - halfH) / CELL)), r1 = Math.min(ROWS, Math.ceil((r.camY + halfH) / CELL));

  // 1) tinta do território (só a área visível)
  ctx.save();
  for (let row = r0; row < r1; row++) {
    for (let c = c0; c < c1; c++) {
      const o = owner[row * COLS + c];
      if (o === -2) continue;
      if (o === -1) { ctx.globalAlpha = 1; ctx.fillStyle = "rgba(150,170,190,0.10)"; }
      else { ctx.globalAlpha = 0.16; ctx.fillStyle = state.players[o].color; }
      ctx.fillRect(c * CELL, row * CELL, CELL, CELL);
    }
  }
  ctx.restore();

  // 2) por jogador: anel de alcance, traçado até o oponente, seta de decisão
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i]; if (!p.alive) continue;
    const hx = (p.x + 0.5) * CELL, hy = (p.y + 0.5) * CELL;
    ctx.beginPath(); ctx.arc(hx, hy, CELL * 0.95, 0, Math.PI * 2);
    ctx.lineWidth = 2 / r.camZoom; ctx.strokeStyle = connected[i] ? "#46e07a" : "#ff3b3b"; ctx.stroke();
    if (!p.isAI) continue;
    let tgt = null, bd = Infinity;
    for (const o of state.players) { if (o === p || !o.alive) continue; const d = Math.abs(o.x - p.x) + Math.abs(o.y - p.y); if (d < bd) { bd = d; tgt = o; } }
    if (tgt) {
      const route = path(state.grid, p.x, p.y, tgt.x, tgt.y);
      if (route && route.length) {
        ctx.beginPath(); ctx.moveTo((route[0].x + 0.5) * CELL, (route[0].y + 0.5) * CELL);
        for (const cell of route) ctx.lineTo((cell.x + 0.5) * CELL, (cell.y + 0.5) * CELL);
        ctx.lineWidth = CELL * 0.28; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.stroke();
      }
    }
    const d = DIRS[p.nextDir];
    if (d) {
      const ex = hx + d.x * CELL * 2.4, ey = hy + d.y * CELL * 2.4;
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(ex, ey);
      ctx.lineWidth = 3 / r.camZoom; ctx.strokeStyle = "#ffe14d"; ctx.stroke();
      ctx.beginPath(); ctx.arc(ex, ey, CELL * 0.35, 0, Math.PI * 2); ctx.fillStyle = "#ffe14d"; ctx.fill();
    }
  }

  // 3) HUD (espaço de tela): velocidade, território e alcance por moto
  ctx.setTransform(r.dpr, 0, 0, r.dpr, 0, 0);
  const counts = state.players.map(() => 0);
  for (let k = 0; k < owner.length; k++) { const o = owner[k]; if (o >= 0) counts[o]++; }
  ctx.font = "12px monospace"; ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(8, 6, 340, 26 + state.players.length * 16);
  ctx.fillStyle = "#bff4ff"; ctx.fillText("DEBUG  territorio (cor) · tracado (branco) · decisao (amarelo)", 14, 12);
  let y = 30;
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    const spd = Math.round(clamp((BASE_TICK - p.tickMs) / (BASE_TICK - MIN_TICK), 0, 1) * 100);
    ctx.fillStyle = p.alive ? p.color : "#666";
    ctx.fillText(`${p.label || ("P" + p.id)}  vel ${spd}%  terr ${counts[i]}  ${connected[i] ? "ligado" : "ISOLADO"}${p.alive ? "" : "  morto"}`, 14, y);
    y += 16;
  }
}
