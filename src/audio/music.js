// Trilha sonora modular: toca em ordem aleatória (sorteia ao iniciar a partida e
// a cada faixa que termina). Usa a playlist EXPLÍCITA do config (MUSIC_TRACKS /
// MUSIC_DANGER_TRACKS) — robusta, toca em qualquer servidor. Se uma lista estiver
// vazia, cai na varredura do diretório (precisa de listagem HTTP, p.ex. Live Server).
//   music/            -> trilha normal
//   music/dangerMusic -> trilha do modo ARES
import { MUSIC_DIR, MENU_TRACK, MUSIC_DANGER_DIR, MUSIC_EXTS, MUSIC_TRACKS, MUSIC_DANGER_TRACKS } from "../core/config.js";

function isAudio(href) {
  const h = href.toLowerCase();
  return MUSIC_EXTS.some(ext => h.endsWith(ext));
}

// Varre a listagem de diretório do servidor (Live Server etc.) de uma pasta.
async function discoverIn(dir) {
  try {
    const res = await fetch(dir, { cache: "no-store" });
    if (res.ok) {
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const names = [...doc.querySelectorAll("a[href]")]
        .map(a => decodeURIComponent(a.getAttribute("href").split("/").pop().split("?")[0]))
        .filter(isAudio);
      return [...new Set(names)].map(n => dir + encodeURIComponent(n));
    }
  } catch (e) { /* sem listagem de diretório */ }
  return [];
}

const toUrl = (dir, name) => dir + encodeURIComponent(name);

// Resolve a lista de uma trilha: usa a playlist explícita (se houver) e, só se ela
// estiver vazia, varre o diretório do servidor como fallback.
async function resolveTracks(explicit, dir) {
  if (explicit.length) return explicit.map(name => toUrl(dir, name));
  return discoverIn(dir);
}

export class MusicPlayer {
  constructor(audioEl) {
    this.el = audioEl;
    this.el.loop = false;                              // ao terminar, sorteia outra
    this.menuTrack = toUrl(MUSIC_DIR, MENU_TRACK);     // tema fixo do menu/intro
    this.tracks = [];                                  // trilha normal
    this.danger = [];                                  // trilha do modo ARES
    this.active = [];                                  // lista em uso agora
    this.current = null;
    this.volume = 1;                                   // volume alvo (configurado pelo usuário)
    this._fade = null;
    this._unlocked = false;                            // autoplay destravado por um gesto?
    this.el.addEventListener("ended", () => this.playRandom());
    // playlist explícita já fica pronta de imediato (sem await) → o play() roda
    // dentro do gesto do clique; só usa varredura assíncrona se a lista for vazia.
    if (MUSIC_TRACKS.length) this.tracks = MUSIC_TRACKS.map(name => toUrl(MUSIC_DIR, name));
    else discoverIn(MUSIC_DIR).then(t => { this.tracks = t; });
    if (MUSIC_DANGER_TRACKS.length) this.danger = MUSIC_DANGER_TRACKS.map(name => toUrl(MUSIC_DANGER_DIR, name));
    else discoverIn(MUSIC_DANGER_DIR).then(t => { this.danger = t; });
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (!this._fade) this.el.volume = this.volume;   // durante o fade-out, o ramp cuida do volume
  }

  _cancelFade() { if (this._fade) { clearInterval(this._fade); this._fade = null; } }

  // Destrava o autoplay tocando mudo por um instante (chamar DENTRO de um gesto
  // do usuário). Permite tocar a música depois, fora de um gesto (fim do terminal).
  prime() {
    if (this._unlocked) return;
    const track = this.tracks[0] || this.danger[0];
    if (!track) return;
    try {
      this.el.muted = true;
      this.el.src = track;
      const settle = () => { try { this.el.pause(); } catch (e) {} this.el.muted = false; this.el.currentTime = 0; this._unlocked = true; };
      const p = this.el.play();
      if (p && p.then) p.then(settle).catch(() => { this.el.muted = false; });
      else settle();
    } catch (e) { this.el.muted = false; }
  }

  // Início de partida: escolhe a lista (danger = ARES) e sorteia uma faixa.
  start(danger = false) {
    this._cancelFade();
    this.el.loop = false;                             // partida: as faixas rotacionam (sem loop)
    this.el.muted = false;
    this.el.volume = this.volume;                     // garante o volume cheio (caso viesse de um fade)
    const useList = () => {
      this.active = (danger ? this.danger : this.tracks);
      if (!this.active.length && danger) this.active = this.tracks;   // fallback se não houver danger
      this.playRandom();
    };
    const ready = danger ? this.danger.length : this.tracks.length;
    if (ready) useList();
    else resolveTracks(danger ? MUSIC_DANGER_TRACKS : MUSIC_TRACKS, danger ? MUSIC_DANGER_DIR : MUSIC_DIR)
      .then(t => { if (danger) this.danger = t; else this.tracks = t; useList(); });
  }

  // Para com fade-out suave (não corta bruscamente ao voltar pro menu).
  stop() {
    this._cancelFade();
    if (this.el.paused) return;
    const startVol = this.el.volume;
    const steps = 24;          // ~720ms (24 × 30ms)
    let i = 0;
    this._fade = setInterval(() => {
      i++;
      this.el.volume = Math.max(0, startVol * (1 - i / steps));
      if (i >= steps) {
        this._cancelFade();
        try { this.el.pause(); } catch (e) {}
        this.el.volume = this.volume;   // restaura p/ a próxima faixa
      }
    }, 30);
  }

  // Tema do menu/intro: toca a faixa fixa (Solar Sailer) em LOOP. Idempotente.
  playMenu() {
    this._cancelFade();
    this.el.muted = false;
    this.el.volume = this.volume;
    this.el.loop = true;
    this.active = [];
    if (this.current === this.menuTrack && !this.el.paused) return;   // já tocando
    this.current = this.menuTrack;
    this.el.src = this.menuTrack;
    this.el.currentTime = 0;
    const p = this.el.play();
    if (p && p.catch) p.catch(() => {});   // bloqueado por autoplay? destrava no 1º gesto
  }

  // Pausa a faixa atual mantendo a posição (Pause do jogo — sem fade).
  pause() {
    this._cancelFade();
    try { this.el.pause(); } catch (e) {}
  }

  // Retoma de onde parou (só se houver faixa carregada).
  resume() {
    if (!this.el.src) return;
    const p = this.el.play();
    if (p && p.catch) p.catch(() => {});
  }

  playRandom() {
    const list = this.active.length ? this.active : this.tracks;
    if (!list.length) return;
    let next = list[(Math.random() * list.length) | 0];
    if (list.length > 1) {
      let tries = 0;
      while (next === this.current && tries++ < 5) next = list[(Math.random() * list.length) | 0];
    }
    this.current = next;
    this.el.src = next;
    this.el.currentTime = 0;
    const p = this.el.play();
    if (p && p.catch) p.catch(() => {});
  }
}
