// Tudo gráfico: canvas, câmera e desenho da cena (arena, rastro, farol,
// partículas). Lê o `state` mas não o modifica (a câmera é estado próprio).
import { CELL, COLS, ROWS, W, H, DIRS, MAX_ZOOM, CAM_PAN_SMOOTH, CAM_PAN_REF, CAM_ZOOM_SMOOTH, CAM_ZOOM_REF, CAM_SMOOTH_MIN, CAM_PADDING_CELLS, SHAKE_DECAY_MS, FLASH_DECAY_MS, TRAIL_LINGER_MS, clamp } from "../core/config.js";
import { drawDebug } from "./debug-overlay.js";

// Suavização criticamente amortecida (SmoothDamp, à la Unity): persegue `target`
// mantendo a VELOCIDADE como estado (em velObj[key]) → muda de direção sem
// solavanco e converge sem overshoot. `smoothTime` em segundos, `dt` em segundos.
function smoothDamp(current, target, velObj, key, smoothTime, dt) {
  const omega = 2 / smoothTime;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (velObj[key] + omega * change) * dt;
  velObj[key] = (velObj[key] - omega * temp) * exp;
  return target + (change + temp) * exp;
}

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
    this.camVel = { x: 0, y: 0, zoom: 0 };   // velocidade da câmera (estado do SmoothDamp)
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
      this.camX = target.x; this.camY = target.y; this.camZoom = target.zoom;
      this.camVel.x = this.camVel.y = this.camVel.zoom = 0;   // zera a inércia ao saltar (início de round)
      this.snap = false;
      return;
    }
    // Pan (centro) e zoom seguem o alvo via SmoothDamp — velocidade contínua, sem jerk na virada.
    // O smoothTime encurta com a distância → velocidade cresce ~quadraticamente (longe = mais rápido).
    const dts = dt / 1000;
    const dx = target.x - this.camX, dy = target.y - this.camY;
    const distC = Math.hypot(dx, dy);
    const stC = Math.max(CAM_SMOOTH_MIN, CAM_PAN_SMOOTH / (1 + distC / CAM_PAN_REF));
    this.camX = smoothDamp(this.camX, target.x, this.camVel, "x", stC, dts);
    this.camY = smoothDamp(this.camY, target.y, this.camVel, "y", stC, dts);   // mesma smoothTime nos 2 eixos (coerente)
    const distZ = Math.abs(target.zoom - this.camZoom);
    const stZ = Math.max(CAM_SMOOTH_MIN, CAM_ZOOM_SMOOTH / (1 + distZ / CAM_ZOOM_REF));
    this.camZoom = smoothDamp(this.camZoom, target.zoom, this.camVel, "zoom", stZ, dts);
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
    // No clarão (whiteout) a cor TRANSICIONA da cor da moto até o branco (não troca seco):
    // dessatura (100%→0%) e clareia (60%→100%) em HSL, com ease-in (smooth in) a partir da morte.
    const white = !player.alive && player.fadeTimer > 0;
    let coreColor = player.color, glowColor = player.glow, glowAlpha = 0.45;
    if (white) {
      let wp = clamp(1 - player.fadeTimer / TRAIL_LINGER_MS, 0, 1);   // 0 (morte) → 1 (corte)
      wp = wp * wp;                                                   // ease-in: "smooth in" a partir da morte
      coreColor = `hsl(${player.hue}, ${100 * (1 - wp)}%, ${60 + 40 * wp}%)`;
      glowColor = coreColor;
      glowAlpha = 0.45 + 0.35 * wp;   // glow intensifica conforme branqueia
    }
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

    // glow externo (sem shadow, barato) — pulado no lowFx; no clarão sempre desenha
    if (!this.lowFx || white) {
      ctx.globalAlpha = glowAlpha;
      ctx.strokeStyle = glowColor;
      ctx.lineWidth = CELL * 1.35;
      ctx.stroke();
    }

    // núcleo
    ctx.globalAlpha = 1;
    ctx.strokeStyle = coreColor;
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
    if (state.players) for (const player of state.players) if (player.alive || !player.trailGone) this.drawTrail(player);   // trilha persiste ~2s após a morte, depois some
    this.drawParticles(state.particles);
    if (this.debug) drawDebug(this, state);

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

  // Converte coords de mundo → tela (CSS px) — pra posicionar UI (balões) sobre o canvas.
  worldToScreen(wx, wy) {
    return { x: (wx - this.camX) * this.camZoom + this.viewW / 2, y: (wy - this.camY) * this.camZoom + this.viewH / 2 };
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
}
