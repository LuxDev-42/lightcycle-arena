// Singletons de motor: renderer (canvas), áudio (SFX) e música. Criados uma vez
// e importados por quem precisar — evita passá-los de mão em mão entre módulos.
import { Renderer } from "./graphics.js";
import { AudioEngine } from "./sound.js";
import { MusicPlayer } from "./music.js";
import { el } from "./dom.js";

export const renderer = new Renderer(el.canvas);
export const audio = new AudioEngine();
export const music = new MusicPlayer(el.bgm);
