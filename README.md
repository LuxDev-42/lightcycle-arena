# Lightcycle Arena — Build do app (Electron)

Esta branch (`electron`) empacota o jogo num executável desktop **autocontido** via
[Electron](https://www.electronjs.org/) + [electron-builder](https://www.electron.build/).
O Chromium vem embutido, então o AppImage roda em qualquer distro Linux **sem depender**
de WebKit/GStreamer do sistema, e o MP3 toca com o codec nativo do Chromium.

O jogo em si é 100% frontend (`game.html` + `src/` + `music/` + `fonts/`); o Electron só
o embrulha numa janela em tela cheia.

## Pré-requisitos

- **Node.js** e **npm** (testado com Node 24 / npm 11).
- Alvos configurados: **Linux** (AppImage), **Windows** (nsis + portável — cross-build via
  Wine ou no próprio Windows) e **macOS** (dmg — só rodando num Mac).

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

## Build para Windows

Dá pra gerar o `.exe` **a partir do Linux** usando o [Wine](https://www.winehq.org/)
(`sudo apt install wine`), ou rodando direto no Windows:

```bash
npm run electron:build:win
```

Gera em `dist-electron/`:

```
Lightcycle Arena 1.0.0.exe          ← portável (arquivo único, roda sem instalar)
Lightcycle Arena Setup 1.0.0.exe    ← instalador NSIS
```

Ambos são **autocontidos** — o colega roda com só o `.exe`, sem precisar do fonte.

> O app **não é assinado**, então o SmartScreen do Windows avisa na primeira vez:
> **Mais informações → Executar assim mesmo**.

## Build para macOS

O `.AppImage` (Linux) e o `.exe` (Windows) **não rodam no Mac**. E o electron-builder
**só gera o app de macOS rodando num Mac** (precisa das ferramentas da Apple) — não dá
pra cross-buildar a partir do Linux/Windows. Então, para o Mac, use **um dos dois
caminhos abaixo, ambos precisando dos arquivos-fonte** (não basta um artefato pronto):

### Opção A — rodar do fonte (mais rápido p/ playtest)

No Mac, com [Node.js](https://nodejs.org/) instalado e a pasta do projeto em mãos:

```bash
npm install
npm run electron:start
```

Abre o jogo direto (Electron é multiplataforma). Não gera arquivo — é só pra rodar/testar.

### Opção B — gerar um `.dmg` (num Mac)

```bash
npm install
npm run electron:build:mac
```

Gera `dist-electron/Lightcycle Arena-1.0.0.dmg`. Como o app não é assinado, o Gatekeeper
bloqueia na primeira abertura — abra com **botão direito → Abrir**, ou remova a quarentena:

```bash
xattr -dr com.apple.quarantine "/Applications/Lightcycle Arena.app"
```

### O que enviar para o colega do Mac

A pasta do projeto **sem** `node_modules/`, `dist/` e `dist-electron/` (o `npm install`
recria as dependências). Ex.: um zip do repositório limpo, ou o próprio `git clone`.

## Como funciona (resumo técnico)

- **`electron/main.js`** — processo principal. Cria a `BrowserWindow` em tela cheia
  (fullscreen nativo → o **ESC não sai** da tela cheia). Serve os arquivos por um
  protocolo custom **`app://`**, porque `file://` bloqueia ES modules
  (`<script type="module">`) por CORS no Chromium.
- **`electron/preload.js`** — expõe com segurança (`contextIsolation`) as pontes
  `window.electronFS` (toggle de tela cheia) e `window.electronApp` (sair do app).
- **`package.json`** — scripts (`electron:start`, `electron:selftest`, `electron:build`,
  `electron:build:win`, `electron:build:mac`) e a config do electron-builder (chave
  `build`: targets Linux/Windows/macOS, saída em `dist-electron/`, arquivos, ícones).

## Notas

- As fontes (Orbitron) vêm do Google Fonts por rede; offline, o jogo cai numa fonte de
  fallback (não quebra nada).
- `node_modules/`, `dist/` e `dist-electron/` estão no `.gitignore`.
