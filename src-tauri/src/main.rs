// Entrada do app desktop (Tauri). Só sobe a janela apontada em tauri.conf.json
// (game.html do frontendDist); toda a lógica do jogo é JS, como no navegador.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Lightcycle Arena");
}
