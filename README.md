# Lightcycle Arena — Build do app (Electron)

Esta branch (`electron`) empacota o jogo num executável desktop **autocontido** via
[Electron](https://www.electronjs.org/) + [electron-builder](https://www.electron.build/).
O Chromium vem embutido, então o AppImage roda em qualquer distro Linux **sem depender**
de WebKit/GStreamer do sistema, e o MP3 toca com o codec nativo do Chromium.

O jogo em si é 100% frontend (`game.html` + `src/` + `music/` + `fonts/`); o Electron só
o embrulha numa janela em tela cheia.

## Pré-requisitos

- **Node.js** e **npm** (testado com Node 24 / npm 11).
- Linux x64 (o target configurado é AppImage).

## Passo a passo

### 1. Instalar dependências

```bash
npm install
```

Baixa o binário do Electron (~100 MB) e o electron-builder. Só precisa rodar uma vez
(ou quando o `package.json` mudar).

### 2. Rodar em desenvolvimento (opcional)

```bash
npm run electron:start
```

Abre o jogo numa janela em tela cheia, servindo os arquivos ao vivo do disco. Bom pra
testar mudanças no jogo sem gerar build.

### 3. Verificar o boot sem abrir janela (opcional)

```bash
npm run electron:selftest
```

Carrega `game.html` numa janela **oculta**, confere se o jogo inicializou (canvas, intro,
botão Sair, bridge de fullscreen) e imprime `SELFTEST_RESULT {...}` com `"ok": true` se
tudo carregou. Útil em ambiente sem tela / CI.

### 4. Gerar o executável (AppImage)

```bash
npm run electron:build
```

O electron-builder empacota tudo e gera os artefatos em **`dist-electron/`**:

```
dist-electron/Lightcycle Arena-1.0.0.AppImage   ← o executável único (~140 MB)
```

## Rodar o AppImage

O arquivo já sai com permissão de execução:

```bash
"dist-electron/Lightcycle Arena-1.0.0.AppImage"
```

Ou dê **duplo-clique** no gerenciador de arquivos. Pra enviar a um amigo, basta mandar
esse único arquivo.

> Se o duplo-clique não abrir no Ubuntu, pode faltar o `libfuse2`
> (`sudo apt install libfuse2t64`) ou é preciso marcar "permitir execução" nas
> propriedades do arquivo.

## Como funciona (resumo técnico)

- **`electron/main.js`** — processo principal. Cria a `BrowserWindow` em tela cheia
  (fullscreen nativo → o **ESC não sai** da tela cheia). Serve os arquivos por um
  protocolo custom **`app://`**, porque `file://` bloqueia ES modules
  (`<script type="module">`) por CORS no Chromium.
- **`electron/preload.js`** — expõe com segurança (`contextIsolation`) as pontes
  `window.electronFS` (toggle de tela cheia) e `window.electronApp` (sair do app).
- **`package.json`** — scripts (`electron:start`, `electron:selftest`, `electron:build`)
  e a config do electron-builder (chave `build`: target AppImage, saída em
  `dist-electron/`, arquivos incluídos, ícone).

## Notas

- `main` continua sendo a versão **Tauri**; esta branch é a alternativa Electron.
- As fontes (Orbitron) vêm do Google Fonts por rede; offline, o jogo cai numa fonte de
  fallback (não quebra nada).
- `node_modules/`, `dist/` e `dist-electron/` estão no `.gitignore`.
