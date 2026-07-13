// Motor de menus/navegação (mouse + teclado WASD/setas). Genérico: o main
// registra cada overlay com seus itens (botões, sliders, steppers) e o engine
// cuida de mostrar/esconder, foco, navegação e hover. Adicionar um menu = 1
// registerMenu + o overlay no HTML.
import { audio } from "./engines.js";

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
export function moveNav(delta) { setIndex(index + delta); }
export function navHorizontal(delta) {
  const item = items && items[index];
  if (!item) return;
  if (item.type === "value") { (delta < 0 ? item.dec : item.inc)(); audio.uiMove(); }
  else moveNav(delta);
}
export function activateNav() {
  const item = items && items[index];
  if (item && item.type === "button") item.run();
}
export function isNavActive() { return !!items; }   // há um menu navegável aberto?

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
