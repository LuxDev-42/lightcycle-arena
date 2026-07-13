// Serialização do estado da partida pro LAN (host-autoritativo). Funções PURAS
// (só mexem em arrays de player) → testáveis isoladas no Node. O host serializa a
// cada frame mandando só o delta da trilha (células novas); o cliente aplica.
// Cor/glow/label/id são estáticos (definidos no start dos dois lados) — não vão aqui.

// Host → snapshot dos players. `lens` guarda o tamanho de trilha já enviado por
// player (mutado aqui); assim só mandamos as células acrescentadas desde o último frame.
export function serializePlayers(players, lens) {
  return players.map((p, i) => {
    const prev = lens[i] || 0;
    const add = [];
    for (let k = prev; k < p.trail.length; k++) add.push([p.trail[k].x, p.trail[k].y]);
    lens[i] = p.trail.length;
    return { x: p.x, y: p.y, px: p.prevX, py: p.prevY, pr: p.progress, dir: p.dir, alive: p.alive, ft: p.fadeTimer, tg: p.trailGone, add };
  });
}

// Cliente ← aplica o snapshot nos players locais (já criados idênticos no resetRound).
export function applyPlayers(players, snap) {
  for (let i = 0; i < snap.length && i < players.length; i++) {
    const s = snap[i], p = players[i];
    for (const c of s.add) p.trail.push({ x: c[0], y: c[1] });
    p.x = s.x; p.y = s.y; p.prevX = s.px; p.prevY = s.py; p.progress = s.pr;
    p.dir = s.dir; p.alive = s.alive; p.fadeTimer = s.ft; p.trailGone = s.tg;
  }
}
