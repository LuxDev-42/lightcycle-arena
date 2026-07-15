// Placar dinâmico (chips/pílulas coloridas). FFA = uma pílula por jogador;
// Times = uma pílula por time. Só lê o `state` — não muda nada.
import { state } from "../core/state.js";
import { el } from "./dom.js";
import { TEAM_HUES } from "./teams.js";

function playerChip(player, winnerId) {
  const hue = player.hue, win = player.id === winnerId;
  const glow = `0 0 12px hsla(${hue},100%,60%,.35)` + (win ? `, 0 0 26px hsla(${hue},100%,60%,.6)` : "");
  return `<span class="chip${win ? " win" : ""}" style="border-color:hsl(${hue},100%,62%);`
    + `background:hsla(${hue},100%,55%,.12);box-shadow:${glow}">`
    + `<span class="chip-dot" style="background:hsl(${hue},100%,62%);box-shadow:0 0 8px hsl(${hue},100%,62%)"></span>`
    + `<span class="chip-name" style="color:hsl(${hue},100%,74%)">${player.label}</span>`
    + `<span class="chip-score">${state.scores[player.id - 1]}</span>`
    + `</span>`;
}

function teamChip(team, winTeam) {
  const hue = TEAM_HUES[team], win = team === winTeam;
  const glow = `0 0 12px hsla(${hue},100%,60%,.35)` + (win ? `, 0 0 26px hsla(${hue},100%,60%,.6)` : "");
  return `<span class="chip${win ? " win" : ""}" style="border-color:hsl(${hue},100%,62%);`
    + `background:hsla(${hue},100%,55%,.12);box-shadow:${glow}">`
    + `<span class="chip-dot" style="background:hsl(${hue},100%,62%);box-shadow:0 0 8px hsl(${hue},100%,62%)"></span>`
    + `<span class="chip-name" style="color:hsl(${hue},100%,74%)">Time ${team === 0 ? "A" : "B"}</span>`
    + `<span class="chip-score">${state.teamScores[team]}</span></span>`;
}

export function teamScoreChips(winTeam = -1) { return teamChip(0, winTeam) + teamChip(1, winTeam); }
export function scoreChips(winnerId = null) { return state.players.map((p) => playerChip(p, winnerId)).join(""); }

export function renderScoreboard() {
  if (!state.players) return;
  el.scoreboard.innerHTML = state.gameMode === "teams" ? teamScoreChips() : scoreChips();
}
