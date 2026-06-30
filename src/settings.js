// Registro genérico de preferências persistidas (localStorage). Cada setting é
// definido uma vez com { ls, def, min, max, vol, apply }; o registry cuida de
// carregar, validar/clampar, salvar e chamar apply(valor) (que faz UI + efeito).
// Adicionar uma config nova = 1 defineSetting + o stepper/slider no HTML.
import { clamp } from "./config.js";

function load(key, def, min, max, vol) {
  try {
    const raw = localStorage.getItem(key);
    if (vol) { const v = parseFloat(raw); return Number.isFinite(v) ? clamp(v, 0, 1) : def; }
    const v = parseInt(raw, 10); return Number.isFinite(v) ? clamp(v, min, max) : def;
  } catch (e) { return def; }
}
export function save(key, v) { try { localStorage.setItem(key, String(v)); } catch (e) {} }

const defs = new Map();        // key -> { ls, min, max, vol, apply }
export const settings = {};    // key -> valor atual

// vol=true → valor contínuo 0..1 (sliders de volume); senão inteiro [min,max].
export function defineSetting(key, { ls, def, min = 0, max = 0, vol = false, apply }) {
  const value = load(ls, def, min, max, vol);
  settings[key] = value;
  defs.set(key, { ls, min, max, vol, apply });
  apply(value);                                  // aplica o valor carregado (UI + efeito)
}
export function setSetting(key, v) {
  const d = defs.get(key);
  if (!d) return;
  const value = d.vol ? clamp(v, 0, 1) : clamp(Math.round(v), d.min, d.max);
  settings[key] = value;
  save(d.ls, value);
  d.apply(value);
}
export function stepSetting(key, delta) { setSetting(key, settings[key] + delta); }
