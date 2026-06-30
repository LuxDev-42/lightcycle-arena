// Flags de orquestração (mutáveis), compartilhadas entre o game loop (main) e o
// input. Ficam num objeto pra que qualquer módulo veja sempre o valor atual.
export const app = {
  running: false,   // o rAF loop está ativo?
  paused: false,    // jogo pausado (tecla P)?
  debug: false,     // overlay de debug (Ctrl+D+B)?
  lastTime: 0,      // timestamp do frame anterior (ms)
};
