// Botões de teste de SFX (submenu Sons, debug) — gerados a partir da lista de sons
// da engine de áudio. `soundTestNav` é preenchido por buildSoundTests() e consumido
// pelo registro de menu (registerMenu do submenu Sons).
import { audio } from "../engines.js";
import { el } from "./dom.js";

export const soundTestNav = [];

export function buildSoundTests() {
  const tests = [
    ["de-rez windup", () => audio.derezWindup()],
    ["de-rez pop", () => audio.trailDerez()],
    ["explosão", () => audio.explosion()],
    ["near-miss", () => audio.nearMiss()],
    ["move tick", () => audio.moveTick()],
    ["erro", () => audio.error()],
    ["contagem 3-2-1", () => audio.tick(false)],
    ["contagem GO", () => audio.tick(true)],
    ["vitória", () => audio.victory()],
    ["empate", () => audio.draw()],
    ["ARES stinger", () => audio.aresStinger()],
    ["blip (início)", () => audio.blip()],
    ["UI mover", () => audio.uiMove()],
    ["UI selecionar", () => audio.uiSelect()],
    ["UI voltar", () => audio.uiBack()],
  ];
  for (const [label, play] of tests) {
    const b = document.createElement("button");
    b.className = "neutral snd-test";
    b.textContent = label;
    b.addEventListener("click", () => { audio.resume(); play(); });
    el.soundList.appendChild(b);
    soundTestNav.push({ el: b, type: "button", run: () => b.click() });
  }
}
