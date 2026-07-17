// Ícones de tipo de input (SVG inline, no mesmo estilo de traço dos botões do jogo).
// Usados nos balões "quem é quem" e no preview do roster local. `currentColor` no
// traço → herda a cor de onde forem colocados.
const SVG = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';

// Teclado: moldura + 4 teclas (pontos) + barra de espaço.
export const KB_ICON = `<svg class="input-ico" ${SVG}><rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10.5h0M10 10.5h0M14 10.5h0M18 10.5h0M8 14.5h8"/></svg>`;

// Controle: corpo arredondado + d-pad (cruz) à esquerda + 2 botões à direita.
export const PAD_ICON = `<svg class="input-ico" ${SVG}><path d="M8 8.5h8a5 5 0 0 1 4.9 6l-.5 2.6a2.1 2.1 0 0 1-3.9.7L15 16H9l-1.5 1.8a2.1 2.1 0 0 1-3.9-.7l-.5-2.6A5 5 0 0 1 8 8.5Z"/><path d="M6.6 11.7v2.2M5.5 12.8h2.2"/><path d="M15.6 12h0M17.6 14h0"/></svg>`;

export function inputIcon(kind) { return kind === "gamepad" ? PAD_ICON : KB_ICON; }
