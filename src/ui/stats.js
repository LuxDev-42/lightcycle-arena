// Estatísticas locais do jogador (P1), persistidas em localStorage. Conta só partidas
// LOCAIS terminadas (singleplayer / multiplayer local); LAN tem caminho próprio e não entra.
// Fica na UI (não em core/) porque usa localStorage — o core roda headless sem DOM.
const KEY = "lc.stats";
const EMPTY = { played: 0, wins: 0, losses: 0, streak: 0, best: 0, byChamp: {} };

let stats = load();
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    if (s && typeof s === "object") return { ...EMPTY, ...s, byChamp: { ...(s.byChamp || {}) } };
  } catch {}
  return { ...EMPTY, byChamp: {} };
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(stats)); } catch {} }

// Fim de uma partida local. `won` = P1 (ou o time do P1) levou. `championLabel` = quem
// venceu (programa/jogador) para a tábua "mais venceu"; passe null quando não fizer sentido (Times).
export function recordMatch(won, championLabel) {
  stats.played++;
  if (won) { stats.wins++; stats.streak++; if (stats.streak > stats.best) stats.best = stats.streak; }
  else { stats.losses++; stats.streak = 0; }
  if (championLabel) stats.byChamp[championLabel] = (stats.byChamp[championLabel] || 0) + 1;
  save();
}
export function getStats() { return { ...stats, byChamp: { ...stats.byChamp } }; }
// [label, contagem] de quem mais venceu (null se nada registrado).
export function topChampion() {
  const entries = Object.entries(stats.byChamp);
  if (!entries.length) return null;
  return entries.reduce((a, b) => (b[1] > a[1] ? b : a));
}
export function resetStats() { stats = { ...EMPTY, byChamp: {} }; save(); }
