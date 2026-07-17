// Tela de remapear teclas (Opções > Controles). Clique num bind e a próxima tecla vira
// o novo (Esc cancela). Cada tecla serve a uma ação só — um rebind em conflito limpa a
// outra ação. A lógica de captura/persistência vive no input.js; aqui é só a UI.
import { el } from "./dom.js";
import { getBind, bindKey, resetBinds, captureKey } from "../input/input.js";
import { navBtn } from "./menu-nav.js";

const ACTIONS = [
  ["p1-up", "P1 ↑"], ["p1-left", "P1 ←"], ["p1-down", "P1 ↓"], ["p1-right", "P1 →"],
  ["p2-up", "P2 ↑"], ["p2-left", "P2 ←"], ["p2-down", "P2 ↓"], ["p2-right", "P2 →"],
];
const KEY_LABEL = { arrowup: "↑", arrowleft: "←", arrowdown: "↓", arrowright: "→", " ": "Espaço", spacebar: "Espaço" };
const keyLabel = (key) => !key ? "—" : (KEY_LABEL[key] || key.toUpperCase());

const rows = [];   // { action, btn }
let capturing = false;

export function buildControls() {
  el.controlsList.innerHTML = ""; rows.length = 0;
  for (const [action, label] of ACTIONS) {
    const row = document.createElement("div"); row.className = "ctl-bind";
    const lab = document.createElement("span"); lab.className = "ctl-bind-label"; lab.textContent = label;
    const btn = document.createElement("button"); btn.className = "neutral ctl-key"; btn.textContent = keyLabel(getBind(action));
    btn.addEventListener("click", () => startRebind(action, btn));
    row.append(lab, btn);
    el.controlsList.appendChild(row);
    rows.push({ action, btn });
  }
}

function startRebind(action, btn) {
  if (capturing) return;
  capturing = true;
  btn.textContent = "…"; btn.classList.add("capturing");
  captureKey((key) => {
    capturing = false; btn.classList.remove("capturing");
    if (key) bindKey(action, key);
    refreshControls();   // re-render tudo: um conflito pode ter limpado outra ação
  });
}
function refreshControls() { for (const { action, btn } of rows) btn.textContent = keyLabel(getBind(action)); }
export function resetControls() { resetBinds(); refreshControls(); }

// Itens de navegação do submenu (os binds + restaurar + voltar). Chamar após buildControls().
export function controlsNav() {
  return [
    ...rows.map(({ btn }) => ({ el: btn, type: "button", run: () => btn.click() })),
    navBtn("btn-controls-reset"), navBtn("btn-controls-back"),
  ];
}
