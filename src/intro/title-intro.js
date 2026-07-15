// Abertura do jogo: tela preta com "Um jogo de LuxDub" (fade in/out), depois o
// título gigante que VOA (translada + escala, via FLIP medindo a posição do título
// no menu) até o lugar dele no menu; então o menu faz fade-in e fica interativo.
// Tudo skipável (Esc — via handleEscape no main — ou clique). A música do menu
// (Solar Sailer) começa junto; no browser, autoplay só destrava no 1º gesto.
import { el } from "../ui/dom.js";
import { music } from "../engines.js";

// Tempos (ms) — levemente dramático, mas curto.
const CREDIT_IN = 900, CREDIT_HOLD = 1300, CREDIT_OUT = 600, GAP = 300;
const TITLE_IN = 700, TITLE_HOLD = 550, FLY = 1500, CROSSFADE = 750;

let timers = [];
let revealed = false, ended = false, onReveal = null, unlock = null;

function reveal() {                         // menu aparece (fade) e vira interativo
  if (revealed) return;
  revealed = true;
  el.menu.classList.remove("intro-pre");
  if (onReveal) onReveal();
}
function cleanup() {                        // fim/skip: revela o menu e remove a intro
  if (ended) return;
  ended = true;
  timers.forEach(clearTimeout); timers = [];
  music.playMenu();                         // garante a música (skip por gesto destrava o autoplay)
  reveal();
  el.intro.classList.add("hidden");
  el.intro.removeEventListener("click", cleanup);
  // NÃO remove o `unlock`: se ninguém interagiu durante a intro (autoplay bloqueado no
  // browser), o 1º gesto DEPOIS ainda destrava a música. O {once:true} se remove sozinho.
}
export function skipIntro() { cleanup(); }

export function playIntro(revealCb) {
  onReveal = revealCb;
  revealed = false; ended = false; timers = [];
  el.menu.classList.add("intro-pre");                     // medível, mas invisível/travado
  el.intro.classList.remove("hidden", "fade-out");
  el.introCredit.classList.remove("show");
  el.introTitle.classList.remove("show");
  el.introTitle.style.transition = "none";
  el.introTitle.style.transform = "none";

  music.playMenu();                                       // Electron: toca já; browser: destrava no gesto
  unlock = () => music.playMenu();
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
  el.intro.addEventListener("click", cleanup);            // clicar na intro = pular

  const at = (ms, fn) => timers.push(setTimeout(fn, ms));

  // Fase A — crédito
  at(300, () => el.introCredit.classList.add("show"));
  at(300 + CREDIT_IN + CREDIT_HOLD, () => el.introCredit.classList.remove("show"));

  // Fase B — título gigante entra e voa pro lugar do menu
  const tB = 300 + CREDIT_IN + CREDIT_HOLD + CREDIT_OUT + GAP;
  at(tB, () => el.introTitle.classList.add("show"));
  at(tB + TITLE_IN + TITLE_HOLD, () => {
    const a = el.introTitle.getBoundingClientRect();      // gigante, centrado
    const b = el.menuTitle.getBoundingClientRect();       // destino (título no menu)
    if (a.height && b.height) {
      const s = b.height / a.height;
      const dx = (b.left + b.width / 2) - (a.left + a.width / 2);
      const dy = (b.top + b.height / 2) - (a.top + a.height / 2);
      el.introTitle.style.transition = `transform ${FLY}ms cubic-bezier(.16,.84,.28,1)`;
      el.introTitle.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
    }
  });

  // Fase C — crossfade: menu entra, intro sai
  const tC = tB + TITLE_IN + TITLE_HOLD + FLY;
  at(tC, () => { reveal(); el.intro.classList.add("fade-out"); });
  at(tC + CROSSFADE, () => cleanup());
}
