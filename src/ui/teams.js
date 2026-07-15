// Cores de time (constantes) + skin de time — usadas pelo modo Times (placar,
// skins das motos e pílulas do seletor de modo).
import { hueColor, hueGlow } from "./colors.js";

export const TEAM_HUES = [205, 28];   // Time A (azul-ciano), Time B (laranja)

export function teamSkin(team, idx) {
  const base = TEAM_HUES[team] ?? 205;
  const hue = (base + (idx % 4) * 8) % 360;   // leve variação pra distinguir companheiros do mesmo time
  return { color: hueColor(hue), glow: hueGlow(hue), hue };
}
