// Tudo gráfico: canvas, câmera e desenho da cena (arena, rastro, farol,
// partículas). Lê o `state` mas não o modifica (a câmera é estado próprio).
import { CELL, COLS, ROWS, W, H, DIRS, MAX_ZOOM, BASE_TICK, MIN_TICK, CAM_PAN_TAU, CAM_ZOOM_TAU, CAM_PADDING_CELLS, SHAKE_DECAY_MS, FLASH_DECAY_MS, clamp } from "./config.js";

// Telas de toque (pixels densos + GPU mais fraca) entram no modo econômico: menos pixels e sem shadowBlur caro.
const COARSE = (typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches)
  || (typeof navigator !== "undefined" && (navigator.maxTouchPoints || 0) > 0);
const MAX_DPR_FULL = 2;     // desktop: teto de resolução (≤2x = sem mudança visual perceptível)
const MAX_DPR_LOW = 1.5;    // toque: pixels minúsculos, 1.5x já fica nítido e corta MUITO o custo de pixel

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.dpr = 1;
    this.viewW = 0;
    this.viewH = 0;
    // Câmera (coordenadas de mundo)
    this.camX = W / 2;
    this.camY = H / 2;
    this.camZoom = 1;
    this.snap = true;
    this.debug = false;
    this.shake = 0;            // intensidade atual do tremor de tela (px)
    this.flashAlpha = 0;       // alpha atual da vinheta de flash
    this.flashColor = "#ffffff";
    // Qualidade adaptativa: começa econômico em telas de toque; o monitor de FPS pode baixar mais (só desce).
    this.lowFx = COARSE;
    this.maxDpr = COARSE ? MAX_DPR_LOW : MAX_DPR_FULL;
    this.quality = "auto";     // "auto" | "alto" | "baixo" — controlado por Opções > Gráficos
    this.adaptive = true;      // ratchet de FPS só atua no modo "auto"
    this._obLayout = null;     // cache da geometria dos obstáculos (Path2D), reconstruído só ao trocar de mapa
    this._ftAccum = 0; this._ftCount = 0; this._lastFrameT = 0; this._lastDrop = 0;   // monitor de FPS
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    this.viewW = window.innerWidth;
    this.viewH = window.innerHeight;
    this.canvas.width = Math.max(1, Math.floor(this.viewW * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(this.viewH * this.dpr));
    this.canvas.style.width = this.viewW + "px";
    this.canvas.style.height = this.viewH + "px";
  }

  // Faz a próxima atualização saltar direto para o enquadramento (sem suavizar).
  snapToTarget() { this.snap = true; }

  // Qualidade gráfica (Opções > Gráficos): "auto" detecta toque + ratchet de FPS;
  // "alto" liga tudo; "baixo" fixa o modo econômico. Reaplica o DPR (resize).
  setQuality(mode) {
    this.quality = mode;
    this.adaptive = (mode === "auto");
    if (mode === "alto")       { this.lowFx = false;  this.maxDpr = MAX_DPR_FULL; }
    else if (mode === "baixo") { this.lowFx = true;   this.maxDpr = MAX_DPR_LOW; }
    else                       { this.lowFx = COARSE; this.maxDpr = COARSE ? MAX_DPR_LOW : MAX_DPR_FULL; }
    this.resize();
  }

  // ---- Câmera ----
  headWorld(player) {
    const progress = player.alive ? player.progress : 1;
    return {
      x: (player.prevX + (player.x - player.prevX) * progress + 0.5) * CELL,
      y: (player.prevY + (player.y - player.prevY) * progress + 0.5) * CELL,
    };
  }

  // Pan estéreo (-1..1) pela posição horizontal da moto NA TELA.
  screenPan(player) {
    const progress = player.alive ? player.progress : 1;   // só precisamos do X (sem alocar objeto)
    const worldX = (player.prevX + (player.x - player.prevX) * progress + 0.5) * CELL;
    const screenX = (worldX - this.camX) * this.camZoom + this.viewW / 2;
    return clamp((screenX / this.viewW) * 2 - 1, -1, 1);
  }

  cameraTarget(state) {
    // enquadra as motos vivas (ou todas, se a rodada já acabou) — inline, sem alocar arrays/objetos
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, count = 0;
    for (let pass = 0; pass < 2 && count === 0; pass++) {
      for (const p of state.players) {
        if (pass === 0 && !p.alive) continue;          // 1ª passada: só vivas; 2ª (se ninguém vivo): todas
        const progress = p.alive ? p.progress : 1;
        const hx = (p.prevX + (p.x - p.prevX) * progress + 0.5) * CELL;
        const hy = (p.prevY + (p.y - p.prevY) * progress + 0.5) * CELL;
        if (hx < minX) minX = hx;
        if (hx > maxX) maxX = hx;
        if (hy < minY) minY = hy;
        if (hy > maxY) maxY = hy;
        count++;
      }
    }
    const padding = CAM_PADDING_CELLS * CELL;        // folga ao redor das motos (config)
    const fitMargin = 6 * CELL;                      // margem ao enquadrar a arena inteira
    const frameW = (maxX - minX) + padding * 2;
    const frameH = (maxY - minY) + padding * 2;
    // pode afastar até ver a arena inteira + uma margem (pra a borda respirar)
    const minZoom = Math.min(this.viewW / (W + fitMargin * 2), this.viewH / (H + fitMargin * 2));
    let zoom = Math.min(this.viewW / frameW, this.viewH / frameH);
    zoom = clamp(zoom, minZoom, MAX_ZOOM);
    const halfViewW = (this.viewW / 2) / zoom;
    const halfViewH = (this.viewH / 2) / zoom;
    let centerX = (minX + maxX) / 2;
    let centerY = (minY + maxY) / 2;
    // segue o ponto médio livremente — a câmera PODE vazar além das paredes,
    // deixando a borda da arena visível; só recentraliza no eixo em que a
    // arena já cabe inteira na tela
    if (W <= halfViewW * 2) centerX = W / 2;
    if (H <= halfViewH * 2) centerY = H / 2;
    return { x: centerX, y: centerY, zoom };
  }

  updateCamera(state, dt) {
    // decai os efeitos de juice (tremor/flash) — sempre, mesmo sem jogadores
    this.shake *= Math.exp(-dt / SHAKE_DECAY_MS); if (this.shake < 0.3) this.shake = 0;
    this.flashAlpha *= Math.exp(-dt / FLASH_DECAY_MS); if (this.flashAlpha < 0.01) this.flashAlpha = 0;
    if (!state.players) return;
    const target = this.cameraTarget(state);
    if (this.snap) {
      this.camX = target.x; this.camY = target.y; this.camZoom = target.zoom; this.snap = false;
      return;
    }
    // pan responsivo (acompanha as motos) + zoom mais suave; suavizacao exponencial
    // SEM teto de velocidade (move proporcional a distancia: longe = rapido, perto = lento)
    const panSmooth = 1 - Math.exp(-dt / CAM_PAN_TAU);
    const zoomSmooth = 1 - Math.exp(-dt / CAM_ZOOM_TAU);
    this.camX += (target.x - this.camX) * panSmooth;
    this.camY += (target.y - this.camY) * panSmooth;
    this.camZoom += (target.zoom - this.camZoom) * zoomSmooth;
  }

  // ---- Desenho ----
  drawArena(ares) {
    const ctx = this.ctx;
    ctx.save();
    const halfViewW = (this.viewW / 2) / this.camZoom;
    const halfViewH = (this.viewH / 2) / this.camZoom;
    const colStart = Math.max(0, Math.floor((this.camX - halfViewW) / CELL));
    const colEnd = Math.min(COLS, Math.ceil((this.camX + halfViewW) / CELL));
    const rowStart = Math.max(0, Math.floor((this.camY - halfViewH) / CELL));
    const rowEnd = Math.min(ROWS, Math.ceil((this.camY + halfViewH) / CELL));

    // grade fina (a que as motos percorrem), 1px de tela — vermelha no modo ARES
    ctx.lineWidth = 1 / this.camZoom;
    ctx.strokeStyle = ares ? "rgba(255,40,40,0.13)" : "rgba(25,120,160,0.10)";
    ctx.beginPath();
    for (let col = colStart; col <= colEnd; col++) { ctx.moveTo(col*CELL, rowStart*CELL); ctx.lineTo(col*CELL, rowEnd*CELL); }
    for (let row = rowStart; row <= rowEnd; row++) { ctx.moveTo(colStart*CELL, row*CELL); ctx.lineTo(colEnd*CELL, row*CELL); }
    ctx.stroke();

    // grade decorativa maior (a cada MAJOR células) — linhas brilham um pouco mais
    const MAJOR = 10;
    ctx.beginPath();
    for (let col = Math.floor(colStart / MAJOR) * MAJOR; col <= colEnd; col += MAJOR) { ctx.moveTo(col*CELL, rowStart*CELL); ctx.lineTo(col*CELL, rowEnd*CELL); }
    for (let row = Math.floor(rowStart / MAJOR) * MAJOR; row <= rowEnd; row += MAJOR) { ctx.moveTo(colStart*CELL, row*CELL); ctx.lineTo(colEnd*CELL, row*CELL); }
    // SEM shadowBlur (caríssimo num path que cobre a tela toda, todo frame):
    // glow fingido por camadas — halo largo e fraco + núcleo brilhante.
    ctx.lineWidth = 4 / this.camZoom;
    ctx.strokeStyle = ares ? "rgba(255,40,40,0.10)" : "rgba(25,224,255,0.09)";
    ctx.stroke();
    ctx.lineWidth = 1.4 / this.camZoom;
    ctx.strokeStyle = ares ? "rgba(255,70,70,0.34)" : "rgba(60,200,235,0.30)";
    ctx.stroke();

    // borda da arena (as paredes) — glow por shadowBlur (full) ou camada larga barata (lowFx)
    if (this.lowFx) {
      ctx.lineWidth = 7 / this.camZoom;
      ctx.strokeStyle = ares ? "rgba(255,40,40,0.16)" : "rgba(25,224,255,0.15)";
      ctx.strokeRect(0, 0, W, H);
    } else {
      ctx.shadowColor = ares ? "rgba(255,40,40,0.65)" : "rgba(25,224,255,0.6)";
      ctx.shadowBlur = 18;
    }
    ctx.lineWidth = 3 / this.camZoom;
    ctx.strokeStyle = ares ? "rgba(255,40,40,0.6)" : "rgba(25,224,255,0.55)";
    ctx.strokeRect(0, 0, W, H);
    ctx.restore();
  }

  // Monta (uma vez por layout) a geometria dos obstáculos como Path2D: a UNIÃO
  // preenchida e a SILHUETA externa (arestas de fronteira fundidas em segmentos
  // longos). Cacheado — antes isso rodava todo frame (Set + ~8k iterações), pesado no mobile.
  _buildObstacles(rects) {
    const fill = new Path2D();
    for (const r of rects) fill.rect(r.x * CELL, r.y * CELL, r.w * CELL, r.h * CELL);

    const occ = new Set();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of rects) {
      for (let y = r.y; y < r.y + r.h; y++)
        for (let x = r.x; x < r.x + r.w; x++) occ.add(y * COLS + x);
      if (r.x < minX) minX = r.x;
      if (r.y < minY) minY = r.y;
      if (r.x + r.w > maxX) maxX = r.x + r.w;
      if (r.y + r.h > maxY) maxY = r.y + r.h;
    }
    const has = (x, y) => occ.has(y * COLS + x);

    const stroke = new Path2D();
    for (let gy = minY; gy <= maxY; gy++) {            // arestas horizontais, por gridline
      let run = -1;
      for (let x = minX; x < maxX; x++) {
        const edge = has(x, gy - 1) !== has(x, gy);    // ocupada de um lado só = fronteira
        if (edge && run < 0) run = x;
        else if (!edge && run >= 0) { stroke.moveTo(run * CELL, gy * CELL); stroke.lineTo(x * CELL, gy * CELL); run = -1; }
      }
      if (run >= 0) { stroke.moveTo(run * CELL, gy * CELL); stroke.lineTo(maxX * CELL, gy * CELL); }
    }
    for (let gx = minX; gx <= maxX; gx++) {            // arestas verticais, por gridline
      let run = -1;
      for (let y = minY; y < maxY; y++) {
        const edge = has(gx - 1, y) !== has(gx, y);
        if (edge && run < 0) run = y;
        else if (!edge && run >= 0) { stroke.moveTo(gx * CELL, run * CELL); stroke.lineTo(gx * CELL, y * CELL); run = -1; }
      }
      if (run >= 0) { stroke.moveTo(gx * CELL, run * CELL); stroke.lineTo(gx * CELL, maxY * CELL); }
    }
    this._obFill = fill; this._obStroke = stroke; this._obLayout = rects;
  }

  // Desenha os obstáculos como UM objeto sólido: união preenchida + silhueta externa
  // (sem arestas internas). Glow por shadowBlur (full) ou camada larga barata (lowFx).
  drawObstacles(state) {
    const rects = state.arenaLayout;
    if (!rects || !rects.length) { this._obLayout = rects; return; }
    if (rects !== this._obLayout) this._buildObstacles(rects);   // recalcula só quando o mapa muda
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = "#03060c";                         // tampa a grade dentro do bloco
    ctx.fill(this._obFill);
    ctx.lineCap = "square";
    if (this.lowFx) {                                  // glow barato: passada larga e fraca + núcleo
      ctx.lineWidth = 6 / this.camZoom;
      ctx.strokeStyle = state.ares ? "rgba(255,40,40,0.16)" : "rgba(25,224,255,0.15)";
      ctx.stroke(this._obStroke);
    } else {
      ctx.shadowColor = state.ares ? "rgba(255,40,40,0.65)" : "rgba(25,224,255,0.6)";
      ctx.shadowBlur = 18;
    }
    ctx.lineWidth = 3 / this.camZoom;
    ctx.strokeStyle = state.ares ? "rgba(255,40,40,0.6)" : "rgba(25,224,255,0.55)";
    ctx.stroke(this._obStroke);
    ctx.restore();
  }

  drawHeadlight(player, headX, headY) {
    // Cone de luz — a luz projetada do farol (atrás do bloco)
    const ctx = this.ctx;
    const dir = DIRS[player.dir];
    const side = { x: -dir.y, y: dir.x };            // vetor perpendicular à direção
    const coneLength = 7.8 * CELL;                   // alcance do facho
    const coneHalfWidth = 2 * CELL;                  // meia-largura na ponta (cone estreito)
    const baseHalfWidth = CELL * 0.45;               // meia-largura na origem (quase um ponto)
    const baseX = headX + dir.x * CELL * 0.4;
    const baseY = headY + dir.y * CELL * 0.4;
    const tipX = headX + dir.x * coneLength;
    const tipY = headY + dir.y * coneLength;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";        // luz aditiva: brilha sobre o fundo escuro
    const coneGradient = ctx.createRadialGradient(headX, headY, CELL * 0.3, headX, headY, coneLength);
    coneGradient.addColorStop(0,    `hsla(${player.hue}, 100%, 78%, 0.55)`);
    coneGradient.addColorStop(0.45, `hsla(${player.hue}, 100%, 62%, 0.20)`);
    coneGradient.addColorStop(1,    `hsla(${player.hue}, 100%, 55%, 0)`);
    ctx.fillStyle = coneGradient;
    ctx.beginPath();
    ctx.moveTo(baseX + side.x * baseHalfWidth, baseY + side.y * baseHalfWidth);
    ctx.lineTo(tipX  + side.x * coneHalfWidth, tipY  + side.y * coneHalfWidth);
    ctx.lineTo(tipX  - side.x * coneHalfWidth, tipY  - side.y * coneHalfWidth);
    ctx.lineTo(baseX - side.x * baseHalfWidth, baseY - side.y * baseHalfWidth);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawHeadlightBar(player, headX, headY) {
    // Lâmpada do farol: barra perpendicular à direção, dentro do bloco (por cima)
    const ctx = this.ctx;
    const dir = DIRS[player.dir];
    const side = { x: -dir.y, y: dir.x };
    const barX = headX + dir.x * CELL * 0.3;         // levemente à frente, ainda dentro do bloco
    const barY = headY + dir.y * CELL * 0.3;
    const halfLength = CELL * 0.42;
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.96)";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    if (!this.lowFx) { ctx.shadowColor = `hsla(${player.hue}, 100%, 72%, 0.95)`; ctx.shadowBlur = 8; }
    ctx.beginPath();
    ctx.moveTo(barX + side.x * halfLength, barY + side.y * halfLength);
    ctx.lineTo(barX - side.x * halfLength, barY - side.y * halfLength);
    ctx.stroke();
    ctx.restore();
  }

  drawTrail(player) {
    const ctx = this.ctx;
    const trail = player.trail;
    const len = trail.length;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    ctx.beginPath();
    ctx.moveTo((trail[0].x + 0.5) * CELL, (trail[0].y + 0.5) * CELL);
    const wallEnd = player.alive ? len - 1 : len;    // vivo: parede até a célula anterior (cabeça é interpolada)
    for (let i = 1; i < wallEnd; i++) {
      ctx.lineTo((trail[i].x + 0.5) * CELL, (trail[i].y + 0.5) * CELL);
    }
    let headX = (player.x + 0.5) * CELL, headY = (player.y + 0.5) * CELL;
    if (player.alive) {
      headX = (player.prevX + (player.x - player.prevX) * player.progress + 0.5) * CELL;
      headY = (player.prevY + (player.y - player.prevY) * player.progress + 0.5) * CELL;
      ctx.lineTo(headX, headY);
    }

    // glow externo (sem shadow, barato) — pulado no lowFx p/ não dobrar o custo do rastro
    if (!this.lowFx) {
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = player.glow;
      ctx.lineWidth = CELL * 1.35;
      ctx.stroke();
    }

    // núcleo
    ctx.globalAlpha = 1;
    ctx.strokeStyle = player.color;
    ctx.lineWidth = CELL - 2;
    ctx.stroke();
    ctx.restore();

    // cabeça brilhante (só vivo) — o bloco do derrotado some, a trilha fica
    if (player.alive) {
      if (!this.lowFx) this.drawHeadlight(player, headX, headY);   // cone de luz (gradiente + lighter): caro no mobile
      ctx.save();
      if (this.lowFx) {
        // bloom barato sem shadowBlur: halo translúcido + núcleo branco + miolo colorido
        ctx.globalAlpha = 0.5; ctx.fillStyle = player.glow;
        const glowSize = CELL + 8;
        ctx.fillRect(headX - glowSize / 2, headY - glowSize / 2, glowSize, glowSize);
        ctx.globalAlpha = 1;
      } else {
        ctx.shadowColor = player.glow;
        ctx.shadowBlur = 18;
      }
      ctx.fillStyle = "#ffffff";
      const outerSize = CELL + 2;
      ctx.fillRect(headX - outerSize / 2, headY - outerSize / 2, outerSize, outerSize);
      if (!this.lowFx) ctx.shadowBlur = 24;
      ctx.fillStyle = player.color;
      const innerSize = CELL - 1;
      ctx.fillRect(headX - innerSize / 2, headY - innerSize / 2, innerSize, innerSize);
      ctx.restore();
      this.drawHeadlightBar(player, headX, headY);   // lâmpada perpendicular, por cima do bloco
    }
  }

  drawParticles(particles) {
    if (!particles.length) return;
    const ctx = this.ctx;
    ctx.save();
    const low = this.lowFx;
    if (low) ctx.globalCompositeOperation = "lighter";   // glow aditivo barato no lugar do shadowBlur por partícula
    for (const particle of particles) {
      ctx.globalAlpha = Math.max(0, particle.life);
      if (!low) { ctx.shadowColor = particle.color; ctx.shadowBlur = 10; }
      ctx.fillStyle = particle.color;
      const drawSize = particle.size * (0.5 + particle.life * 0.5);
      ctx.fillRect(particle.x - drawSize / 2, particle.y - drawSize / 2, drawSize, drawSize);
    }
    ctx.restore();
  }

  render(state) {
    const ctx = this.ctx;
    this._monitorPerf();   // qualidade adaptativa (ratchet) durante o jogo
    // base em coordenadas de tela (com devicePixelRatio)
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = "#03060c";
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    // aplica a câmera (+ tremor de tela)
    const sx = this.shake ? (Math.random() * 2 - 1) * this.shake : 0;
    const sy = this.shake ? (Math.random() * 2 - 1) * this.shake : 0;
    ctx.translate(this.viewW / 2 + sx, this.viewH / 2 + sy);
    ctx.scale(this.camZoom, this.camZoom);
    ctx.translate(-this.camX, -this.camY);

    this.drawArena(state.ares);
    this.drawObstacles(state);
    if (state.players) for (const player of state.players) this.drawTrail(player);
    this.drawParticles(state.particles);
    if (this.debug) this.drawDebug(state);

    if (this.flashAlpha > 0) {                         // vinheta de flash (quase-acidente/morte)
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const cx = this.viewW / 2, cy = this.viewH / 2;
      const g = ctx.createRadialGradient(cx, cy, Math.min(this.viewW, this.viewH) * 0.35, cx, cy, Math.max(this.viewW, this.viewH) * 0.62);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, this.flashColor);
      ctx.globalAlpha = this.flashAlpha;
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.viewW, this.viewH);
      ctx.globalAlpha = 1;
    }
  }

  // Monitora o FPS durante o jogo e baixa a qualidade se ficar lento de forma
  // sustentada (ratchet: só desce, sem oscilar). 1º corta os FX caros, depois a resolução.
  _monitorPerf() {
    const now = performance.now();
    const last = this._lastFrameT;
    this._lastFrameT = now;
    if (!this.adaptive || !last) return;
    const ft = now - last;
    if (ft > 100) { this._ftAccum = 0; this._ftCount = 0; return; }   // gap (menu/idle) → não conta
    this._ftAccum += ft; this._ftCount++;
    if (this._ftCount < 45) return;
    const avg = this._ftAccum / this._ftCount;
    this._ftAccum = 0; this._ftCount = 0;
    if (avg > 22 && now - this._lastDrop > 1500) {     // < ~45 FPS sustentado → baixa um nível
      this._lastDrop = now;
      if (!this.lowFx) this.lowFx = true;              // passo 1: corta os efeitos caros (shadowBlur etc.)
      else if (this.maxDpr > 1) { this.maxDpr = Math.max(1, this.maxDpr - 0.5); this.resize(); }  // passo 2: baixa a resolução
    }
  }

  setDebug(v) { this.debug = v; }

  // ---- Juice: tremor de tela + vinheta de flash (disparados pelo main.js) ----
  addShake(px) { if (px > this.shake) this.shake = px; }
  addFlash(alpha, color = "#ffffff") { if (alpha > this.flashAlpha) { this.flashAlpha = alpha; this.flashColor = color; } }

  // ===== Modo debug (Ctrl+D+B): visualiza o "pathfinding" da IA =====
  // Território (Voronoi multi-fonte): cada célula livre fica com a cor de quem
  // chega primeiro a partir das cabeças; empate = cinza. É a base da decisão da IA.
  _debugTerritory(state) {
    const n = COLS * ROWS;
    if (!this._dbgOwner || this._dbgOwner.length !== n) {
      this._dbgOwner = new Int16Array(n); this._dbgDist = new Int32Array(n); this._dbgQ = new Int32Array(n);
    }
    const owner = this._dbgOwner, dist = this._dbgDist, q = this._dbgQ, grid = state.grid, players = state.players;
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
  _debugPath(grid, sx, sy, tx, ty) {
    const n = COLS * ROWS;
    if (!this._pPrev || this._pPrev.length !== n) { this._pPrev = new Int32Array(n); this._pSeen = new Int32Array(n); this._pQ = new Int32Array(n); this._pGen = 0; }
    const prev = this._pPrev, seen = this._pSeen, q = this._pQ, gen = ++this._pGen;
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
    const path = []; for (let cur = found; cur !== -1; cur = prev[cur]) path.push({ x: cur % COLS, y: (cur - cur % COLS) / COLS });
    return path;
  }

  drawDebug(state) {
    const ctx = this.ctx;
    if (!state.players) return;
    const { owner, connected } = this._debugTerritory(state);
    const halfW = (this.viewW / 2) / this.camZoom, halfH = (this.viewH / 2) / this.camZoom;
    const c0 = Math.max(0, Math.floor((this.camX - halfW) / CELL)), c1 = Math.min(COLS, Math.ceil((this.camX + halfW) / CELL));
    const r0 = Math.max(0, Math.floor((this.camY - halfH) / CELL)), r1 = Math.min(ROWS, Math.ceil((this.camY + halfH) / CELL));

    // 1) tinta do território (só a área visível)
    ctx.save();
    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) {
        const o = owner[r * COLS + c];
        if (o === -2) continue;
        if (o === -1) { ctx.globalAlpha = 1; ctx.fillStyle = "rgba(150,170,190,0.10)"; }
        else { ctx.globalAlpha = 0.16; ctx.fillStyle = state.players[o].color; }
        ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
      }
    }
    ctx.restore();

    // 2) por jogador: anel de alcance, traçado até o oponente, seta de decisão
    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i]; if (!p.alive) continue;
      const hx = (p.x + 0.5) * CELL, hy = (p.y + 0.5) * CELL;
      ctx.beginPath(); ctx.arc(hx, hy, CELL * 0.95, 0, Math.PI * 2);
      ctx.lineWidth = 2 / this.camZoom; ctx.strokeStyle = connected[i] ? "#46e07a" : "#ff3b3b"; ctx.stroke();
      if (!p.isAI) continue;
      let tgt = null, bd = Infinity;
      for (const o of state.players) { if (o === p || !o.alive) continue; const d = Math.abs(o.x - p.x) + Math.abs(o.y - p.y); if (d < bd) { bd = d; tgt = o; } }
      if (tgt) {
        const path = this._debugPath(state.grid, p.x, p.y, tgt.x, tgt.y);
        if (path && path.length) {
          ctx.beginPath(); ctx.moveTo((path[0].x + 0.5) * CELL, (path[0].y + 0.5) * CELL);
          for (const cell of path) ctx.lineTo((cell.x + 0.5) * CELL, (cell.y + 0.5) * CELL);
          ctx.lineWidth = CELL * 0.28; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.stroke();
        }
      }
      const d = DIRS[p.nextDir];
      if (d) {
        const ex = hx + d.x * CELL * 2.4, ey = hy + d.y * CELL * 2.4;
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(ex, ey);
        ctx.lineWidth = 3 / this.camZoom; ctx.strokeStyle = "#ffe14d"; ctx.stroke();
        ctx.beginPath(); ctx.arc(ex, ey, CELL * 0.35, 0, Math.PI * 2); ctx.fillStyle = "#ffe14d"; ctx.fill();
      }
    }

    // 3) HUD (espaço de tela): velocidade, território e alcance por moto
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
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
}
