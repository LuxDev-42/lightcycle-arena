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
    for (let k = prev; k < p.trail.length; k++) { const c = p.trail[k]; add.push(c ? [c.x, c.y] : null); }   // null = buraco (teleporte/bomba)
    lens[i] = p.trail.length;
    return { x: p.x, y: p.y, px: p.prevX, py: p.prevY, pr: p.progress, dir: p.dir, alive: p.alive, ft: p.fadeTimer, tg: p.trailGone, add,
      ts: Math.round(p.tickMs),                                        // duração do passo → cliente interpola na taxa certa
      ek: p.effectKind, bm: p.bomb ? 1 : 0, tc: p.teleportCharges };   // power-ups: efeito ativo + bomba + cargas de teleporte
  });
}

// Cliente ← aplica o snapshot nos players locais (já criados idênticos no resetRound).
export function applyPlayers(players, snap) {
  for (let i = 0; i < snap.length && i < players.length; i++) {
    const s = snap[i], p = players[i];
    for (const c of s.add) p.trail.push(c ? { x: c[0], y: c[1] } : null);   // preserva os buracos
    p.x = s.x; p.y = s.y; p.prevX = s.px; p.prevY = s.py; p.progress = s.pr;
    p.dir = s.dir; p.alive = s.alive; p.fadeTimer = s.ft; p.trailGone = s.tg;
    if (s.ts) p.tickMs = s.ts;                                       // duração do passo (interpolação no cliente)
    p.effectKind = s.ek || null; p.bomb = !!s.bm; p.teleportCharges = s.tc || 0;   // efeitos (render das auras/anéis)
  }
}
