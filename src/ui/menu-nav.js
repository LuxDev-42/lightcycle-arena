// Motor de menus/navegação (mouse + teclado WASD/setas). Genérico: o main
// registra cada overlay com seus itens (botões, sliders, steppers) e o engine
// cuida de mostrar/esconder, foco, navegação e hover. Adicionar um menu = 1
// registerMenu + o overlay no HTML.
import { audio } from "../engines.js";

const overlays = [];          // todos os overlays registrados (alvos do showOnly)
const configs = new Map();    // overlayEl -> [navItem]
let items = null, index = 0, current = null;

// ---- Fábricas de item de navegação ----
export function navBtn(id) {
  const el = document.getElementById(id);
  return { el, type: "button", run: () => el.click() };
}
export function navSlider(el, step) {
  return {
    el, type: "value",
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
export function navMove(dir) {
  if (!items || items.length < 2) return;
  const cur = items[index].el.getBoundingClientRect();
  const horiz = dir === "left" || dir === "right";
  const sign = (dir === "right" || dir === "down") ? 1 : -1;
  const SLOP = 4;
  let best = -1, bestScore = Infinity;
  for (let i = 0; i < items.length; i++) {
    if (i === index) continue;
    const r = items[i].el.getBoundingClientRect();
    // distância na direção, medida entre as BORDAS (não centros)
    const primary = dir === "right" ? r.left - cur.right
      : dir === "left" ? cur.left - r.right
      : dir === "down" ? r.top - cur.bottom
      : cur.top - r.bottom;
    if (primary < -SLOP) continue;                            // item não está nessa direção
    // sobreposição na perpendicular (mesma "linha" p/ horizontal, mesma "coluna" p/ vertical)
    const ov = horiz ? overlap(cur.top, cur.bottom, r.top, r.bottom)
                     : overlap(cur.left, cur.right, r.left, r.right);
    const perp = ov > 0 ? 0 : -ov;
    // alinhado (perp 0) sempre vence desalinhado; entre iguais, o mais próximo na direção
    const score = (perp > 0 ? 1e6 : 0) + Math.max(0, primary) + perp;
    if (score < bestScore) { bestScore = score; best = i; }
  }
  if (best < 0) best = navWrapIndex(dir, itemCenter(items[index]), horiz, sign);   // nada na direção → dá a volta
  if (best >= 0) setIndex(best);
}
function navWrapIndex(dir, c, horiz, sign) {
  let ext = null;
  for (let i = 0; i < items.length; i++) {
    if (i === index) continue;
    const a = horiz ? itemCenter(items[i]).x : itemCenter(items[i]).y;
    if (ext === null || (sign > 0 ? a < ext : a > ext)) ext = a;   // extremo oposto ao movimento
  }
  if (ext === null) return -1;
  let best = -1, bestPerp = Infinity;
  for (let i = 0; i < items.length; i++) {
    if (i === index) continue;
    const p = itemCenter(items[i]);
    if (Math.abs((horiz ? p.x : p.y) - ext) > 2) continue;   // só os do extremo
    const perp = horiz ? Math.abs(p.y - c.y) : Math.abs(p.x - c.x);
    if (perp < bestPerp) { bestPerp = perp; best = i; }       // mesmo linha/coluna (melhor alinhamento)
  }
  return best;
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
