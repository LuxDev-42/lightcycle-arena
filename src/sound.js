// Sound engine 100% procedural (Web Audio API), tema 16-bit/chiptune.
// Sintetiza os motores das motinhas, explosões e pequenos jingles —
// nenhum arquivo de áudio envolvido. A trilha musical é separada (main.js).
import { clamp, BASE_TICK, MIN_TICK } from "./config.js";

const ENGINE_SMOOTH = 0.03;   // suavização (s) da mudança de tom — baixa p/ não mascarar o vibrato

// =====================================================================
//  PARÂMETROS DO SOM — mexa à vontade pra "modular" o áudio.
//  Tudo que dá o caráter dos sons mora aqui.
// =====================================================================
export const SOUND = {
  masterVolume: 0.6,            // volume padrão dos SFX (0..1) — o slider/localStorage sobrescreve
  pitchVarCents: 10,            // variância aleatória de afinação por oscilador (±cents) — bem sutil, aplicada no root

  engine: {                    // motor de cada moto (voz contínua)
    baseFreqs: [98, 73],       // tom-base de cada motor (Hz) — G2/D2, zumbido serra estilo Tron clássico (P1/P2 distintos)
    sawType: "sawtooth",       // oscilador principal
    subType: "square",         // sub-oscilador (corpo)
    subRatio: 0.5,             // frequência do sub = fundamental * isto
    vibratoHz: 6,              // frequência do vibrato (+ até 2 Hz aleatório)
    vibratoCents: 50,          // profundidade do vibrato (cents)
    level: 0.055,              // volume de cada motor (fica sob a música)
    pitchRise: 1.1,            // quanto o tom sobe na velocidade máx (freq * (1 + isto))
    filterHz: 700,             // corte do passa-baixa com a moto parada
    filterRise: 1400,          // quanto o corte abre na velocidade máx
    filterQ: 6,                // ressonância do filtro (a "zoada" do motor)
  },

  explosion: {                 // estouro: "tch" (ruído) + "ouououm" (boom grave ondulando)
    noiseFrom: 3500, noiseTo: 80,    // sweep do passa-baixa: aberto no impacto (ouve o brown noise) e desce
    noiseLevel: 0.98, noiseDur: 0.28,// "tch" — crack curto pra a ondulação dominar (s)
    boomFrom: 100, boomTo: 10,       // tom do boom desce do impacto pro grave (Hz)
    boomLevel: 1.5, boomDur: 0.85,   // "ouououm" — cauda longa pra o vibrato tocar (s)
    boomVibHz: 16,                    // vibrato do boom (Hz) — wobble grave; MENOR = onda mais longa
    boomVibCents: 400,               // profundidade do vibrato (cents) — o quanto o tom oscila
  },

  derez: {                     // sumiço da trilha (de-rez): shimmer agudo descendo + faísca subindo
    windupFrom: 165, windupTo: 659, windupLevel: 0.055,  // WINDUP: tom serra SUBINDO; começa 1s antes do pop (dura 1s)
    from: 102, to: 16,       // varredura do tom (Hz): grave, mas audível (a serra sustenta com os harmônicos)
    dur: 2, level: 0.46,    // duração (s) e volume do shimmer
    detune: 60,               // 2ª voz destoada (cents) p/ brilho/coro cristalino
    vibHz: 64, vibCents: 10,  // vibrato (igual ao boom da explosão): LFO no detune das vozes
    sparkFrom: 100, sparkTo: 6000, sparkLevel: 0.3, sparkDur: 0.5,   // faísca: passa-alta ABRINDO (oposto da explosão) — baixa p/ não mascarar o tom
  },
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.engines = [];
    this.enginesActive = false;
    this.muted = false;
    this.masterVolume = SOUND.masterVolume;
  }

  // Cria o contexto e o grafo na primeira vez (precisa de gesto do usuário).
  ensure() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;

    // Variância de afinação no ROOT: cada oscilador nasce com um detune aleatório
    // sutil (±pitchVarCents). Afeta TODOS os sons — todos passam por createOscillator.
    const rawCreateOsc = ctx.createOscillator.bind(ctx);
    ctx.createOscillator = () => {
      const osc = rawCreateOsc();
      osc.detune.value = (Math.random() * 2 - 1) * SOUND.pitchVarCents;
      return osc;
    };

    // master → limitador → saída
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.masterVolume;
    const limiter = ctx.createDynamicsCompressor();
    this.master.connect(limiter);
    limiter.connect(ctx.destination);

    // buffer de BROWN NOISE (ruído marrom): energia concentrada nos graves
    // (-6 dB/oitava) — roar grave/encorpado em vez do chiado agudo do branco.
    const len = Math.floor(ctx.sampleRate * 0.6);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;   // integrador com leak = filtro -6 dB/oitava
      data[i] = last * 3.5;                   // normaliza a amplitude de volta pra ~[-1,1]
    }
    this.noiseBuffer = buf;

    // motores criados sob demanda conforme o nº de motos (ver ensureVoices)
    this.engines = [];
  }

  // Tom-base da voz `i`: usa baseFreqs nas primeiras, gera o resto distinto.
  _freqForIndex(i) {
    const E = SOUND.engine;
    if (i < E.baseFreqs.length) return E.baseFreqs[i];
    return 73 + ((i - E.baseFreqs.length) % 8) * 14;   // 73,87,101,… Hz (mesmo registro dos base)
  }

  // Garante pelo menos `n` vozes de motor (cria as que faltam; reaproveita).
  ensureVoices(n) {
    if (!this.ctx) return;
    while (this.engines.length < n) this.engines.push(this._createEngine(this._freqForIndex(this.engines.length)));
  }

  // Garante o contexto rodando (chamar a partir de um clique/tecla).
  resume() {
    this.ensure();
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  }

  // Volume geral dos SFX (0..1). Persiste mesmo antes do contexto existir.
  setMasterVolume(v) {
    this.masterVolume = clamp(v, 0, 1);
    if (this.ctx && !this.muted) this.master.gain.setTargetAtTime(this.masterVolume, this.ctx.currentTime, 0.02);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : this.masterVolume, this.ctx.currentTime, 0.02);
    return this.muted;
  }

  // ---- Motores ----
  _createEngine(baseFreq) {
    const ctx = this.ctx, E = SOUND.engine;
    const saw = ctx.createOscillator(); saw.type = E.sawType; saw.frequency.value = baseFreq;
    const sub = ctx.createOscillator(); sub.type = E.subType; sub.frequency.value = baseFreq * E.subRatio;
    const lfo = ctx.createOscillator(); lfo.type = "sine";    lfo.frequency.value = E.vibratoHz + Math.random() * 2;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = E.vibratoCents;
    lfo.connect(lfoGain); lfoGain.connect(saw.detune); lfoGain.connect(sub.detune);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass"; filter.frequency.value = E.filterHz; filter.Q.value = E.filterQ;
    const gain = ctx.createGain(); gain.gain.value = 0;       // começa mudo; o update controla
    const panner = ctx.createStereoPanner(); panner.pan.value = 0; // o update() seta pela posição na tela

    saw.connect(filter); sub.connect(filter); filter.connect(gain); gain.connect(panner); panner.connect(this.master);
    saw.start(); sub.start(); lfo.start();
    return { saw, sub, filter, gain, panner, baseFreq };
  }

  setEnginesActive(active) {
    this.enginesActive = active;
    if (!this.ctx) return;
    // o loop só sobe o ganho; ao desligar, abaixa aqui (o loop pode ter parado)
    if (!active) {
      const t = this.ctx.currentTime;
      for (const eng of this.engines) eng.gain.gain.setTargetAtTime(0, t, 0.08);
    }
  }

  // Chamado todo frame. Cada motor: tom acompanha a velocidade DA MOTA, pan
  // segue a posição dela na tela (pans[i] em -1..1); muta quem morreu/pausou.
  update(state, paused, pans) {
    if (!this.ctx || !state.players) return;
    this.ensureVoices(state.players.length);
    const t = this.ctx.currentTime, E = SOUND.engine;
    for (let i = 0; i < state.players.length; i++) {
      const eng = this.engines[i];
      const player = state.players[i];
      const speedNorm = clamp((BASE_TICK - player.tickMs) / (BASE_TICK - MIN_TICK), 0, 1);  // por moto
      const on = this.enginesActive && !paused && player.alive;
      eng.gain.gain.setTargetAtTime(on ? E.level : 0, t, 0.05);
      const freq = eng.baseFreq * (1 + speedNorm * E.pitchRise);
      eng.saw.frequency.setTargetAtTime(freq, t, ENGINE_SMOOTH);
      eng.sub.frequency.setTargetAtTime(freq * E.subRatio, t, ENGINE_SMOOTH);
      eng.filter.frequency.setTargetAtTime(E.filterHz + speedNorm * E.filterRise, t, 0.1);
      if (pans) eng.panner.pan.setTargetAtTime(pans[i], t, 0.1);
    }
    // motos a menos que numa partida anterior: silencia as vozes sobrando
    for (let i = state.players.length; i < this.engines.length; i++) {
      this.engines[i].gain.gain.setTargetAtTime(0, t, 0.05);
    }
  }

  // ---- Explosão ----
  explosion(pan = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, X = SOUND.explosion;
    const panner = ctx.createStereoPanner(); panner.pan.value = clamp(pan, -1, 1);
    panner.connect(this.master);

    // rajada de ruído com passa-baixa varrendo pra baixo
    const noise = ctx.createBufferSource(); noise.buffer = this.noiseBuffer;
    const nFilter = ctx.createBiquadFilter(); nFilter.type = "lowpass";
    nFilter.frequency.setValueAtTime(X.noiseFrom, t);
    nFilter.frequency.exponentialRampToValueAtTime(X.noiseTo, t + X.noiseDur);
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.0001, t);
    nGain.gain.exponentialRampToValueAtTime(X.noiseLevel, t + 0.01);
    nGain.gain.exponentialRampToValueAtTime(0.0001, t + X.noiseDur + 0.05);
    noise.connect(nFilter); nFilter.connect(nGain); nGain.connect(panner);
    noise.start(t); noise.stop(t + X.noiseDur + 0.1);

    // "boom" grave despencando de tom, com vibrato lento (o "ouououm")
    const boom = ctx.createOscillator(); boom.type = "square";
    boom.frequency.setValueAtTime(X.boomFrom, t);
    boom.frequency.exponentialRampToValueAtTime(X.boomTo, t + X.boomDur * 0.9);
    // LFO de vibrato no detune do boom = wobble grave de onda longa
    const vib = ctx.createOscillator(); vib.type = "sine"; vib.frequency.value = X.boomVibHz;
    const vibGain = ctx.createGain(); vibGain.gain.value = X.boomVibCents;
    vib.connect(vibGain); vibGain.connect(boom.detune);
    const bGain = ctx.createGain();
    bGain.gain.setValueAtTime(0.0001, t);
    bGain.gain.exponentialRampToValueAtTime(X.boomLevel, t + 0.01);
    bGain.gain.exponentialRampToValueAtTime(0.0001, t + X.boomDur);
    boom.connect(bGain); bGain.connect(panner);
    boom.start(t); boom.stop(t + X.boomDur + 0.05);
    vib.start(t); vib.stop(t + X.boomDur + 0.05);
  }

  // ---- De-rez da trilha (sumiço) — distinto da explosão: shimmer agudo + faísca ----
  trailDerez(pan = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, D = SOUND.derez;
    const panner = ctx.createStereoPanner(); panner.pan.value = clamp(pan, -1, 1);
    panner.connect(this.master);

    // vibrato compartilhado (igual ao boom da explosão): LFO senoidal somado ao detune das vozes
    const vib = ctx.createOscillator(); vib.type = "sine"; vib.frequency.value = D.vibHz;
    const vibGain = ctx.createGain(); vibGain.gain.value = D.vibCents;
    vib.connect(vibGain);
    vib.start(t); vib.stop(t + D.dur + 0.05);

    // shimmer descendente (2 vozes triangulares destoadas) — som cristalino/digital
    for (const det of [0, D.detune]) {
      const osc = ctx.createOscillator(); osc.type = "sawtooth"; osc.detune.value += det;   // += preserva a variância do root; sawtooth corta melhor
      vibGain.connect(osc.detune);   // soma o vibrato ao detune estático desta voz
      osc.frequency.setValueAtTime(D.from, t);
      osc.frequency.exponentialRampToValueAtTime(D.to, t + D.dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(D.level, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + D.dur + 0.02);
      osc.connect(g); g.connect(panner);
      osc.start(t); osc.stop(t + D.dur + 0.05);
    }

    // faísca: ruído com passa-ALTA abrindo pra cima (dissipa em agudos) — oposto da explosão
    const noise = ctx.createBufferSource(); noise.buffer = this.noiseBuffer;
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.Q.value = 0.7;
    hp.frequency.setValueAtTime(D.sparkFrom, t);
    hp.frequency.exponentialRampToValueAtTime(D.sparkTo, t + D.sparkDur);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(D.sparkLevel, t + 0.02);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + D.sparkDur + 0.02);
    noise.connect(hp); hp.connect(ng); ng.connect(panner);
    noise.start(t); noise.stop(t + D.sparkDur + 0.05);
  }

  // ---- Windup do de-rez ---- toca na MORTE: tom serra SUBINDO por `durSec` (começa
  // levemente grave, building até o corte). O pop (trailDerez) vem no fim, no corte.
  derezWindup(pan = 0, durSec = 2) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, D = SOUND.derez, end = t + durSec;
    const panner = ctx.createStereoPanner(); panner.pan.value = clamp(pan, -1, 1);
    panner.connect(this.master);

    // vibrato compartilhado com o de-rez (mesmo caráter)
    const vib = ctx.createOscillator(); vib.type = "sine"; vib.frequency.value = D.vibHz;
    const vibGain = ctx.createGain(); vibGain.gain.value = D.vibCents;
    vib.connect(vibGain);
    vib.start(t); vib.stop(end + 0.05);

    // 2 vozes serra destoadas SUBINDO de tom, com crescendo (building)
    for (const det of [0, D.detune]) {
      const osc = ctx.createOscillator(); osc.type = "sawtooth"; osc.detune.value += det;
      vibGain.connect(osc.detune);
      osc.frequency.setValueAtTime(D.windupFrom, t);
      osc.frequency.exponentialRampToValueAtTime(D.windupTo, end);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(D.windupLevel * 0.4, t + 0.2);   // entra
      g.gain.exponentialRampToValueAtTime(D.windupLevel, end - 0.05);      // cresce até o corte
      g.gain.exponentialRampToValueAtTime(0.0001, end);                    // corta sem clique (o pop assume)
      osc.connect(g); g.connect(panner);
      osc.start(t); osc.stop(end + 0.02);
    }
  }

  // ---- Bips / jingles (16-bit) ----
  _tone(type, freq, when, dur, level, pan = 0) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(); osc.type = type; osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(level, when + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    const panner = ctx.createStereoPanner(); panner.pan.value = pan;
    osc.connect(gain); gain.connect(panner); panner.connect(this.master);
    osc.start(when); osc.stop(when + dur + 0.02);
  }

  blip() {  // início de partida
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone("square", 523.25, t, 0.07, 0.2);
    this._tone("square", 783.99, t + 0.07, 0.1, 0.2);
  }

  victory() {  // arpejo C-E-G-C
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => this._tone("square", f, t + k * 0.1, 0.16, 0.22));
  }

  draw() {  // empate: dois tons descendo
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone("square", 311.13, t, 0.18, 0.2);
    this._tone("square", 233.08, t + 0.16, 0.28, 0.2);
  }

  uiMove() {   // navegação/hover no menu — tique curto e discreto
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone("square", 330, t, 0.045, 0.10);
  }

  uiSelect() {  // confirmar/selecionar no menu — dois tons subindo
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone("square", 523.25, t, 0.05, 0.14);
    this._tone("square", 784, t + 0.045, 0.08, 0.14);
  }

  uiBack() {  // voltar/cancelar (Esc e botões "Voltar") — dois tons descendo p/ o grave
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone("square", 330, t, 0.05, 0.12);
    this._tone("square", 165, t + 0.045, 0.11, 0.14);
  }

  moveTick(pan = 0, tickMs = BASE_TICK) {   // tique curtíssimo ao assentar o rastro — sobe de tom com a velocidade
    if (!this.ctx) return;
    const sn = clamp((BASE_TICK - tickMs) / (BASE_TICK - MIN_TICK), 0, 1);
    const t = this.ctx.currentTime;
    this._tone("square", 420 + sn * 520, t, 0.018, 0.035, pan);
  }

  nearMiss(pan = 0) {   // quase-acidente: "zip" curto e tenso ao raspar numa parede/rastro
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone("sawtooth", 1300, t, 0.05, 0.06, pan);
    this._tone("sawtooth", 600, t + 0.02, 0.06, 0.05, pan);
  }

  error() {   // "negado/erro" — buzz grave descendente (ex.: tentar sair do ARES cedo demais)
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone("sawtooth", 150, t, 0.10, 0.16);
    this._tone("sawtooth", 100, t + 0.08, 0.14, 0.16);
  }

  tick(go) {  // bip da contagem regressiva (go = "vai!", mais agudo e longo)
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone("square", go ? 880 : 440, t, go ? 0.18 : 0.07, 0.22);
  }

  aresStinger() {  // baque grave e ameaçador na entrada do modo ARES
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone("sawtooth", 110, t, 0.7, 0.26);
    this._tone("sawtooth", 55, t, 1.0, 0.22);
  }
}
