// Processo principal do Electron — embrulha o jogo (game.html) numa janela
// fullscreen. Os arquivos são servidos via protocolo custom "app://" porque
// <script type="module"> não carrega por file:// (Chromium bloqueia módulos
// cross-origin no file://). Áudio MP3 toca nativo (Chromium do Electron traz o codec).
const { app, BrowserWindow, protocol, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");          // raiz: game.html, src/, music/, fonts/
const SELFTEST = process.env.LC_SELFTEST === "1"; // modo de verificação headless

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".ico": "image/x-icon",
  ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".m4a": "audio/mp4",
};

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function serveApp() {
  protocol.handle("app", async (request) => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname);
    if (!rel || rel === "/") rel = "/game.html";
    const fp = path.normalize(path.join(ROOT, rel));
    if (!fp.startsWith(ROOT)) return new Response("forbidden", { status: 403 });
    try {
      const data = await fs.promises.readFile(fp);
      const ext = path.extname(fp).toLowerCase();
      return new Response(data, { headers: { "content-type": MIME[ext] || "application/octet-stream" } });
    } catch {
      return new Response("not found", { status: 404 });
    }
  });
}

let win = null;
function createWindow() {
  win = new BrowserWindow({
    fullscreen: !SELFTEST,     // abre em tela cheia (nativa → ESC não sai)
    show: !SELFTEST,           // no self-test a janela fica oculta (só carrega e checa)
    backgroundColor: "#03060c",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL("app://localhost/game.html");
  if (SELFTEST) runSelfTest();
}

// Toggle de tela cheia vindo do menu de gráficos (via preload → IPC).
ipcMain.handle("fs-toggle", () => { const f = !win.isFullScreen(); win.setFullScreen(f); return f; });
ipcMain.handle("fs-is", () => (win ? win.isFullScreen() : false));
ipcMain.handle("app-quit", () => app.quit());

app.whenReady().then(() => { serveApp(); createWindow(); });
app.on("window-all-closed", () => app.quit());

// ---- Self-test (LC_SELFTEST=1): carrega a página oculta, checa boot + erros, sai. ----
function runSelfTest() {
  const consoleMsgs = [];
  const failures = [];
  const wc = win.webContents;
  wc.on("console-message", (...args) => {
    const msg = typeof args[2] === "string" ? args[2] : (args[0] && args[0].message) || "";
    if (msg) consoleMsgs.push(msg);
  });
  wc.on("did-fail-load", (...a) => failures.push("did-fail-load " + JSON.stringify(a.slice(1, 4))));
  wc.on("render-process-gone", (_e, d) => failures.push("render-process-gone " + JSON.stringify(d)));
  wc.on("did-finish-load", async () => {
    await new Promise((r) => setTimeout(r, 1800));   // deixa o main.js (módulo) rodar + intro iniciar
    let probe = {};
    try {
      probe = await wc.executeJavaScript(`(() => {
        const q = document.getElementById('btn-quit');
        const conf = document.getElementById('quit-confirm');
        const hasQuitBtn = !!q && getComputedStyle(q).display !== 'none';
        const hasElectronApp = !!(window.electronApp && window.electronApp.quit);
        if (q) q.click();   // abre a confirmação (NÃO confirma o quit)
        const confirmOpens = !!conf && !conf.classList.contains('hidden');
        return {
          title: document.title,
          hasCanvas: !!document.getElementById('game'),
          introStarted: !!document.getElementById('intro') && !document.getElementById('intro').classList.contains('hidden'),
          hasQuitBtn, hasElectronApp, confirmOpens
        };
      })()`);
    } catch (e) { failures.push("probe: " + e.message); }
    const ok = !!(probe.hasCanvas && probe.introStarted && probe.hasQuitBtn && probe.hasElectronApp && probe.confirmOpens && failures.length === 0);
    console.log("SELFTEST_RESULT " + JSON.stringify({ ok, probe, failures, consoleMsgs }));
    app.exit(ok ? 0 : 1);
  });
  setTimeout(() => {
    console.log("SELFTEST_RESULT " + JSON.stringify({ ok: false, timeout: true, failures, consoleMsgs }));
    app.exit(2);
  }, 20000);
}
