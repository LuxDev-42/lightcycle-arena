// IA da CPU. Pura: recebe a grade e os jogadores, devolve a direção escolhida.
import { DIRS, OPPOSITE, COLS, ROWS, idx, inBounds, isFree, clamp } from "./config.js";

// Conta quantas células livres dá pra alcançar a partir de (startCol,startRow),
// até no máximo maxCells (flood fill) — serve de medida de "espaço aberto".
function floodFreeCount(grid, startCol, startRow, maxCells) {
  if (!isFree(grid, startCol, startRow)) return 0;
  const visited = new Uint8Array(COLS * ROWS);
  const stack = [idx(startCol, startRow)];
  visited[idx(startCol, startRow)] = 1;
  let reachable = 0;
  while (stack.length && reachable < maxCells) {
    const cellIndex = stack.pop();
    reachable++;
    const col = cellIndex % COLS, row = (cellIndex - col) / COLS;
    const neighbors = [[col+1,row],[col-1,row],[col,row+1],[col,row-1]];
    for (const [nCol, nRow] of neighbors) {
      if (inBounds(nCol, nRow) && grid[idx(nCol, nRow)] === 0 && !visited[idx(nCol, nRow)]) {
        visited[idx(nCol, nRow)] = 1;
        stack.push(idx(nCol, nRow));
      }
    }
  }
  return reachable;
}

// Oponente vivo mais próximo (Manhattan), ou null se não houver.
function nearestOpponent(bot, players) {
  let nearest = null, bestDist = Infinity;
  for (const p of players) {
    if (p === bot || !p.alive) continue;
    const dist = Math.abs(p.x - bot.x) + Math.abs(p.y - bot.y);
    if (dist < bestDist) { bestDist = dist; nearest = p; }
  }
  return nearest;
}

// Decide a próxima direção do `bot`. Retorna a string da direção, ou null se
// não houver saída (aí o chamador mantém a direção atual).
export function chooseDirection(bot, players, grid, violence = 0.2) {
  const opponent = nearestOpponent(bot, players);   // a fuga de rastro já é global (grade)
  const candidateDirs = Object.keys(DIRS).filter(dir => dir !== OPPOSITE[bot.dir]);
  const scoredDirs = [];
  for (const dir of candidateDirs) {
    const nextCol = bot.x + DIRS[dir].x;
    const nextRow = bot.y + DIRS[dir].y;
    if (!isFree(grid, nextCol, nextRow)) continue;
    const openSpace = floodFreeCount(grid, nextCol, nextRow, 400);  // espaço aberto após o movimento
    let score = openSpace;
    if (dir === bot.dir) score += 6;                                // leve preferência por seguir reto
    if (opponent && openSpace > 120) {                              // perseguição leve quando sobra espaço
      const dist = Math.abs(nextCol - opponent.x) + Math.abs(nextRow - opponent.y);
      score += Math.max(0, 18 - dist) * 0.6;
    }
    score += Math.random() * 5;                                     // ruído: tira o viés fixo e varia as curvas
    scoredDirs.push({ dir, score, openSpace });
  }
  if (!scoredDirs.length) return null;
  scoredDirs.sort((a, b) => b.score - a.score);

  // curva espontânea: de vez em quando dobra mesmo sem obstáculo
  const MIN_SAFE_SPACE = 60;
  const safeDirs = scoredDirs.filter(entry => entry.openSpace >= MIN_SAFE_SPACE);
  if (safeDirs.length >= 2 && Math.random() < 0.035) {
    const safeTurns = safeDirs.filter(entry => entry.dir !== bot.dir);
    if (safeTurns.length) {
      // violência enviesa a curva pro oponente mais próximo:
      // P(em direção ao oponente) = 0.5 + violência/2  (ARES 0.8 -> 90%)
      const towardChance = clamp(0.5 + violence / 2, 0, 1);
      if (opponent && Math.random() < towardChance) {
        let best = safeTurns[0], bestDist = Infinity;
        for (const turn of safeTurns) {
          const nx = bot.x + DIRS[turn.dir].x, ny = bot.y + DIRS[turn.dir].y;
          const dist = Math.abs(nx - opponent.x) + Math.abs(ny - opponent.y);
          if (dist < bestDist) { bestDist = dist; best = turn; }
        }
        return best.dir;
      }
      return safeTurns[(Math.random() * safeTurns.length) | 0].dir;
    }
  }
  return scoredDirs[0].dir;
}
