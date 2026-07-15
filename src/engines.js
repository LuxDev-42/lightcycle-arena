// Singletons de motor: renderer (canvas), áudio (SFX) e música. Criados uma vez
// e importados por quem precisar — evita passá-los de mão em mão entre módulos.
import { Renderer } from "./render/graphics.js";
import { AudioEngine } from "./audio/sound.js";
import { MusicPlayer } from "./audio/music.js";
import { el } from "./ui/dom.js";

export const renderer = new Renderer(el.canvas);
export const audio = new AudioEngine();
export const music = new MusicPlayer(el.bgm);
