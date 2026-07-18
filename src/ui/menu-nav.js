// Motor de menus/navegação (mouse + teclado WASD/setas). Genérico: o main
// registra cada overlay com seus itens (botões, sliders, steppers) e o engine
// cuida de mostrar/esconder, foco, navegação e hover. Adicionar um menu = 1
// registerMenu + o overlay no HTML.
import { audio } from "../engines.js";

// Flash vermelho de "negado" (funciona sem o loop de jogo — ex.: cor de outro jogador no lobby).
function flashError() {
  audio.error();
  const f = document.getElementById("err-flash");
  if (f) { f.classList.remove("on"); void f.offsetWidth; f.classList.add("on"); }   // reinicia a animação
}

const overlays = [];          // todos os overlays registrados (alvos do showOnly)
const configs = new Map();    // overlayEl -> [navItem]
let items = null, index = 0, current = null;
let multi = null;   // multi-cursor (lobby local): { colors: Map<pid,cor>, cursors: Map<pid,index> } ou null

// ---- Fábricas de item de navegação ----
export function navBtn(id) {
  const el = document.getElementById(id);
  return { el, type: "button", run: () => el.click() };
}
export function navSlider(el, step, owner = null) {
  return {
    el, type: "value", owner,   // owner: pid dono (multi-cursor) — só ele ajusta (ex.: slider de cor)
    dec: () => { el.value = Math.max(+el.min, +el.value - step); el.dispatchEvent(new Event("input")); },
    inc: () => { el.value = Math.min(+el.max, +el.value + step); el.dispatchEvent(new Event("input")); },
  };
}
export function navStepper(el, dec, inc) { return { el, type: "value", dec, inc }; }
export function navInput(el) { return { el, type: "input", run: () => el.focus() }; }   // campo de texto: Enter entra em edição

// ---- Registro ----
export function registerMenu(overlayEl, navItems) {
  if (!overlays.includes(overlayEl)) overlays.push(overlayEl);   // idempotente (menus dinâmicos re-registram)
  configs.set(overlayEl, navItems);
}
// Liga o hover (foca o item sob o mouse). Chamar depois de registrar todos.
export function bindHover() {
  for (const its of configs.values())
    its.forEach((item, i) => item.el.addEventListener("mouseenter", () => { if (items === its) setIndex(i); }));
}

// ---- Estado de foco / navegação ----
function setIndex(i) {
  if (!items || !items.length) return;
  const next = (i % items.length + items.length) % items.length;
  const current = items[index];
  if (next === index && current && current.el.classList.contains("nav-focus")) return;   // já focado: sem som
  if (current) current.el.classList.remove("nav-focus");
  index = next;
  items[index].el.classList.add("nav-focus");
  audio.uiMove();
}
export function moveNav(delta) { setIndex(index + delta); }   // linear (compat / hover)

// Centro (px de tela) de um item — base da navegação espacial.
function itemCenter(it) { const r = it.el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

// Navegação ESPACIAL: vai pro item mais próximo NA DIREÇÃO pedida (não pela ordem
// da lista). Assim uma grade 2x2 anda pro vizinho de fato (lado/cima/baixo).
function overlap(a1, a2, b1, b2) { return Math.min(a2, b2) - Math.max(a1, b1); }   // >0 = faixas se sobrepõem
export function navMove(dir) { const t = navTarget(index, dir); if (t >= 0) setIndex(t); }
// Índice do item mais próximo de `from` NA DIREÇÃO pedida (por bordas + beam). -1 se nada.
function navTarget(from, dir) {
  if (!items || items.length < 2) return -1;
  const cur = items[from].el.getBoundingClientRect();
  const horiz = dir === "left" || dir === "right";
  const sign = (dir === "right" || dir === "down") ? 1 : -1;
  const SLOP = 4;
  let best = -1, bestScore = Infinity;
  for (let i = 0; i < items.length; i++) {
    if (i === from) continue;
    const r = items[i].el.getBoundingClientRect();
    const primary = dir === "right" ? r.left - cur.right
      : dir === "left" ? cur.left - r.right
      : dir === "down" ? r.top - cur.bottom
      : cur.top - r.bottom;
    if (primary < -SLOP) continue;                            // item não está nessa direção
    const ov = horiz ? overlap(cur.top, cur.bottom, r.top, r.bottom)
                     : overlap(cur.left, cur.right, r.left, r.right);
    const perp = ov > 0 ? 0 : -ov;
    const score = (perp > 0 ? 1e6 : 0) + Math.max(0, primary) + perp;   // alinhado sempre vence; senão o mais próximo
    if (score < bestScore) { bestScore = score; best = i; }
  }
  if (best < 0) best = navWrapIndex(from, dir, itemCenter(items[from]), horiz, sign);   // nada na direção → dá a volta
  return best;
}
function navWrapIndex(from, dir, c, horiz, sign) {
  let ext = null;
  for (let i = 0; i < items.length; i++) {
    if (i === from) continue;
    const a = horiz ? itemCenter(items[i]).x : itemCenter(items[i]).y;
    if (ext === null || (sign > 0 ? a < ext : a > ext)) ext = a;   // extremo oposto ao movimento
  }
  if (ext === null) return -1;
  let best = -1, bestPerp = Infinity;
  for (let i = 0; i < items.length; i++) {
    if (i === from) continue;
    const p = itemCenter(items[i]);
    if (Math.abs((horiz ? p.x : p.y) - ext) > 2) continue;
    const perp = horiz ? Math.abs(p.y - c.y) : Math.abs(p.x - c.x);
    if (perp < bestPerp) { bestPerp = perp; best = i; }
  }
  return best;
}

// ---- Multi-cursor (só no lobby local): um cursor por jogador, outline dividido em cores ----
export function isMultiCursor() { return !!multi; }
export function enableMultiCursor(colorsByPid, prev) {
  if (!items) return;
  if (items[index]) items[index].el.classList.remove("nav-focus");   // some o foco único
  multi = { colors: new Map(Object.entries(colorsByPid).map(([k, v]) => [+k, v])), cursors: new Map() };
  for (const pid of multi.colors.keys()) {   // preserva a posição do cursor (prev) — senão começa no topo
    const seed = prev && prev[pid] != null ? prev[pid] : index;
    multi.cursors.set(pid, Math.min(Math.max(0, seed), items.length - 1));
  }
  renderMulti();
}
export function getMultiCursors() {
  if (!multi) return null;
  const o = {};
  for (const [pid, idx] of multi.cursors) o[pid] = idx;
  return o;
}
export function disableMultiCursor() {
  if (!multi) return;
  for (const it of items || []) { it.el.classList.remove("nav-multi"); it.el.style.removeProperty("box-shadow"); }
  multi = null;
}
export function navMovePlayer(pid, dir) {
  if (!multi || !items) return;
  const t = navTarget(multi.cursors.get(pid) ?? 0, dir);
  if (t >= 0) { multi.cursors.set(pid, t); renderMulti(); audio.uiMove(); }
}
export function navHorizontalPlayer(pid, delta) {   // ←/→: ajusta valor; slider de outro = erro; senão navega lateral
  if (!multi || !items) return;
  const it = items[multi.cursors.get(pid) ?? 0];
  if (!it) return;
  if (it.type === "value") {
    if (it.owner == null || it.owner === pid) { (delta < 0 ? it.dec : it.inc)(); audio.uiMove(); return; }   // modo/qtd/própria cor → ajusta
    flashError();   // cor de OUTRO jogador → "negado" (flash vermelho + som), sem navegar
    return;
  }
  navMovePlayer(pid, delta < 0 ? "left" : "right");   // botão etc. → navega pro item ao lado
}
export function activatePlayer(pid) {
  if (!multi || !items) return;
  const it = items[multi.cursors.get(pid) ?? 0];
  if (it && (it.type === "button" || it.type === "input")) it.run();
}
function renderMulti() {
  if (!multi || !items) return;
  for (let i = 0; i < items.length; i++) {
    const pids = [];
    for (const [pid, idx] of multi.cursors) if (idx === i) pids.push(pid);
    const it = items[i];
    if (!pids.length) { it.el.classList.remove("nav-multi"); it.el.style.removeProperty("box-shadow"); continue; }
    pids.sort((a, b) => a - b);
    // anéis concêntricos com respiro: 2px de gap do botão + 2px de anel + 2px de gap entre cada.
    // box-shadow: 1º da lista fica por cima; gaps opacos (cor ≈ fundo) "cortam" os anéis de trás.
    const GAP = "#070b13", T = 2;
    const parts = [`0 0 0 ${T}px ${GAP}`];
    pids.forEach((pid, k) => {
      parts.push(`0 0 0 ${T * (2 * k + 2)}px ${multi.colors.get(pid)}`);
      parts.push(`0 0 0 ${T * (2 * k + 3)}px ${GAP}`);
    });
    it.el.style.boxShadow = parts.join(", ");
    it.el.classList.add("nav-multi");
  }
}
export function navHorizontal(delta) {
  const item = items && items[index];
  if (!item) return;
  if (item.type === "value") { (delta < 0 ? item.dec : item.inc)(); audio.uiMove(); }
  else navMove(delta < 0 ? "left" : "right");
}
export function activateNav() {
  const item = items && items[index];
  if (item && (item.type === "button" || item.type === "input")) item.run();
}
export function isNavActive() { return !!items; }   // há um menu navegável aberto?
// Alinha o realce da navegação a um elemento que ganhou foco por fora (ex.: clicar no campo de nome).
export function syncNavTo(el) {
  if (!items) return;
  const i = items.findIndex((it) => it.el === el);
  if (i >= 0) setIndex(i);
}

// Mostra só o overlay `target` (ou nenhum) e ativa a navegação por teclado nele.
export function showOnly(target) {
  if (multi) disableMultiCursor();   // multi-cursor é só do lobby local; trocar de tela volta pro cursor único
  for (const ov of overlays) ov.classList.toggle("hidden", ov !== target);
  if (items && items[index]) items[index].el.classList.remove("nav-focus");
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  current = target;
  const cfg = target ? configs.get(target) : null;
  // só navega itens VISÍVEIS — descarta os escondidos (ex.: opções debug-only com o debug off)
  items = cfg ? cfg.filter((it) => getComputedStyle(it.el).display !== "none") : null;
  index = 0;
  if (items && items.length) items[0].el.classList.add("nav-focus");
}

// Re-filtra o menu atual (ex.: ao ligar/desligar o debug, que revela itens debug-only).
export function refreshNav() { if (current) showOnly(current); }
