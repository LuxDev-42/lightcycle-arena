// IA da CPU. Pura: recebe a grade e os jogadores, devolve a direção escolhida.
//
// Estratégia: CONTROLE DE TERRITÓRIO (Voronoi por BFS multi-fonte). Pra cada
// movimento possível, mede quantas células o bot alcança ANTES dos oponentes
// (espaço próprio) e quantas eles alcançam antes (espaço deles). A agressividade
// (`violence`) decide o quanto o bot paga pra SUFOCAR o oponente em vez de só
// preservar o próprio espaço — daí o comportamento de cerco. Por cima, um
// "corte-surpresa" (escala com a violência) faz o bot lançar de vez em quando o
// golpe que mais fecha o espaço do oponente — é o susto do ARES de cortar do nada.
//
// A IA antiga (gulosa, flood-fill + viés de distância) está em ai-classic.js;
// pra voltar a ela, troque o import no logic.js para "./ai-classic.js".
import { DIRS, OPPOSITE, COLS, ROWS, isFree, clamp } from "./config.js";

const N = COLS * ROWS;
// Buffers reaproveitados entre chamadas (sem alocar/zerar a cada decisão): um
// "carimbo" de geração (_gen) marca o que foi visitado NESTA chamada da BFS, e
// _q é a fila (em vez de um array que cresce com push).
const _gen = new Int32Array(N);
const _owner = new Uint8Array(N);     // 1 = bot · 2 = oponente · 3 = contestada (empate de distância)
const _dist = new Int32Array(N);
const _q = new Int32Array(N);
let _curGen = 0;

const ALL_DIRS = Object.keys(DIRS);   // ["up","down","left","right"] — calculado uma vez só

const VORONOI_CAP = N;      // sem teto artificial: varre a regiao conexa inteira (mine/reachable corretos; a BFS e barata)
const MIN_SAFE_SPACE = 16;  // abaixo disso o movimento se enforca → forte penalidade
const TURN_PENALTY = 90;    // custo de VIRAR (perde velocidade na curva) — ↑ anda mais reto/rápido, menos loops
const CHASE_BONUS = 130;    // bônus por se APROXIMAR do oponente mais próximo (× violência) — ↑ mais caçador
const SEAL_PENALTY = 130;   // PATHFINDING: pune a manobra que ISOLA o bot do oponente (× violência) — > CHASE p/ ter prioridade
const NOISE = 8;            // ruído leve (bem menor que TURN_PENALTY de propósito: não dispara zigue-zague)
const KILL_THRESHOLD = 30;  // se um movimento deixa o oponente com <= isto de espaço, vai pro golpe de misericórdia
const CUT_GAIN_MIN = 60;    // corte situacional só dispara se sufocar o oponente em pelo menos isto a mais que o melhor
const WALL_HUG_BONUS = 4;   // (isolado) bônus por encostar em parede/rastro — preenche o espaço sem fragmentar
const FILL_TURN_FACTOR = 0.35; // (isolado) fração do TURN_PENALTY — curva mais livre p/ serpentear e preencher

// BFS multi-fonte a partir da cabeça do bot (myX,myY) E das cabeças oponentes ao
// mesmo tempo. Cada célula livre fica com quem chega primeiro; empate de distância
// = contestada (não conta p/ ninguém). Devolve { mine, theirs } em nº de células.
// Loop quente: fila em Int32Array, sem closures, idx/limites inline por offset.
function voronoi(grid, myX, myY, oppHeads) {
  const gen = ++_curGen;
  let tail = 0;
  let k = myY * COLS + myX;
  _gen[k] = gen; _owner[k] = 1; _dist[k] = 0; _q[tail++] = k;
  for (let i = 0; i < oppHeads.length; i++) {
    const h = oppHeads[i];
    k = h.y * COLS + h.x;                          // a cabeça pode estar ocupada pelo corpo: é fonte mesmo assim
    if (_gen[k] === gen) continue;                 // não sobrescreve o bot se as posições coincidirem
    _gen[k] = gen; _owner[k] = 2; _dist[k] = 0; _q[tail++] = k;
  }

  let mine = 0, theirs = 0, connected = false;
  for (let head = 0; head < tail && head < VORONOI_CAP; head++) {
    k = _q[head];
    const owner = _owner[k];
    if (owner === 1) mine++; else if (owner === 2) theirs++;   // 3 (contestada) não conta
    const c = k % COLS, r = (k - c) / COLS, nd = _dist[k] + 1;
    let nk;
    // 4 vizinhos: índice por offset (k±1, k±COLS) e limite inline; só expande célula livre
    if (c + 1 < COLS) { nk = k + 1;    if (grid[nk] === 0) { if (_gen[nk] !== gen) { _gen[nk] = gen; _owner[nk] = owner; _dist[nk] = nd; _q[tail++] = nk; } else if (_owner[nk] !== owner) { if (owner < 3 && _owner[nk] < 3) connected = true; if (_dist[nk] === nd && _owner[nk] !== 3) _owner[nk] = 3; } } }
    if (c > 0)        { nk = k - 1;    if (grid[nk] === 0) { if (_gen[nk] !== gen) { _gen[nk] = gen; _owner[nk] = owner; _dist[nk] = nd; _q[tail++] = nk; } else if (_owner[nk] !== owner) { if (owner < 3 && _owner[nk] < 3) connected = true; if (_dist[nk] === nd && _owner[nk] !== 3) _owner[nk] = 3; } } }
    if (r + 1 < ROWS) { nk = k + COLS; if (grid[nk] === 0) { if (_gen[nk] !== gen) { _gen[nk] = gen; _owner[nk] = owner; _dist[nk] = nd; _q[tail++] = nk; } else if (_owner[nk] !== owner) { if (owner < 3 && _owner[nk] < 3) connected = true; if (_dist[nk] === nd && _owner[nk] !== 3) _owner[nk] = 3; } } }
    if (r > 0)        { nk = k - COLS; if (grid[nk] === 0) { if (_gen[nk] !== gen) { _gen[nk] = gen; _owner[nk] = owner; _dist[nk] = nd; _q[tail++] = nk; } else if (_owner[nk] !== owner) { if (owner < 3 && _owner[nk] < 3) connected = true; if (_dist[nk] === nd && _owner[nk] !== 3) _owner[nk] = 3; } } }
  }
  return { mine, theirs, reachable: connected };
}

// Decide a próxima direção do `bot`. Retorna a string da direção, ou null se não
// houver saída (aí o chamador mantém a direção atual).
export function chooseDirection(bot, players, grid, violence = 0.2) {
  // (1) PREVISÃO: o oponente não dá ré, então o passo provável é seguir reto.
  // Semeia a célula À FRENTE dele (se livre) em vez da atual → a IA "lê" o adversário
  // e mira onde ele VAI estar (melhor interceptação/corte).
  const oppHeads = [];
  let oppX = 0, oppY = 0, oppDist = Infinity, hasOpp = false;
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (p === bot || !p.alive) continue;
    const d = DIRS[p.dir];
    let hx = p.x + d.x, hy = p.y + d.y;
    if (!isFree(grid, hx, hy)) { hx = p.x; hy = p.y; }         // frente bloqueada → usa a posição atual
    oppHeads.push({ x: hx, y: hy });
    const md = Math.abs(hx - bot.x) + Math.abs(hy - bot.y);
    if (md < oppDist) { oppDist = md; oppX = hx; oppY = hy; hasOpp = true; }
  }

  const reverse = OPPOSITE[bot.dir];
  const cand = [];
  for (let i = 0; i < ALL_DIRS.length; i++) {
    const dir = ALL_DIRS[i];
    if (dir === reverse) continue;
    const v = DIRS[dir];
    const nx = bot.x + v.x, ny = bot.y + v.y;
    if (!isFree(grid, nx, ny)) continue;                       // movimento que mata na hora → fora
    const { mine, theirs, reachable } = voronoi(grid, nx, ny, oppHeads);
    let wallHug = 0;                                           // vizinhos ocupados/parede (p/ o modo isolado)
    if (!isFree(grid, nx + 1, ny)) wallHug++;
    if (!isFree(grid, nx - 1, ny)) wallHug++;
    if (!isFree(grid, nx, ny + 1)) wallHug++;
    if (!isFree(grid, nx, ny - 1)) wallHug++;
    const dNext = hasOpp ? Math.abs(nx - oppX) + Math.abs(ny - oppY) : 0;
    cand.push({ dir, isTurn: dir !== bot.dir, mine, theirs, reachable, wallHug, dNext });
  }
  if (!cand.length) return null;

  // (3) ISOLADO = nenhum movimento conecta ao oponente (arena dividida) → modo
  // SOBREVIVÊNCIA: esquece o ataque, maximiza o espaço próprio e gruda nas paredes
  // pra preencher a região sem fragmentá-la (vence mais finais).
  const isolated = !hasOpp || !cand.some(c => c.reachable);

  for (const c of cand) {
    let score;
    if (isolated) {
      score = c.mine + WALL_HUG_BONUS * c.wallHug;
      if (c.isTurn) score -= TURN_PENALTY * FILL_TURN_FACTOR;  // curva mais livre pra serpentear
    } else {
      score = c.mine - violence * c.theirs;                    // território próprio − (agressão × território deles)
      if (c.isTurn) score -= TURN_PENALTY;
      if (c.dNext < oppDist) score += violence * CHASE_BONUS;  // caça: aproximar-se compensa a curva
      if (!c.reachable) score -= violence * SEAL_PENALTY;      // pathfinding: não se isole do oponente
    }
    if (c.mine < MIN_SAFE_SPACE) score -= 5000;                // piso de sobrevivência: não se enforca
    c.score = score + Math.random() * NOISE;
  }
  cand.sort((a, b) => b.score - a.score);
  // desespero: isolada do oponente E perdendo o territorio -> ela "desiste": para de dobrar e
  // segue reto ate bater na primeira parede (encerra a partida perdida sem arrastar, e SEM mexer na velocidade).
  bot.desperate = hasOpp && isolated && cand[0].theirs > cand[0].mine;
  if (bot.desperate) return bot.dir;

  // (2) CORTES INTELIGENTES (só em combate): em vez de dado puro.
  if (!isolated && hasOpp) {
    // golpe de misericórdia: se um movimento seguro deixa o oponente quase sem espaço, fecha já.
    let killer = null;
    for (const c of cand) if (c.mine >= MIN_SAFE_SPACE && c.reachable && c.theirs <= KILL_THRESHOLD)
      if (!killer || c.theirs < killer.theirs) killer = c;
    if (killer) return killer.dir;
    // corte situacional: só dispara quando existe um movimento que sufoca o oponente BEM
    // mais que o equilibrado — com uma pitada de aleatório (variedade/surpresa, escala c/ violência).
    const best = cand[0];
    let cut = null;
    for (const c of cand) if (c.mine >= MIN_SAFE_SPACE && c.reachable)
      if (!cut || c.theirs < cut.theirs) cut = c;
    const cutChance = clamp(0.08 + violence * 0.35, 0, 0.55);
    if (cut && cut !== best && (cut.theirs <= best.theirs - CUT_GAIN_MIN || Math.random() < cutChance)) return cut.dir;
  }
  return cand[0].dir;
}
