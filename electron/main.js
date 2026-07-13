// Processo principal do Electron — embrulha o jogo (game.html) numa janela
// fullscreen. Os arquivos são servidos via protocolo custom "app://" porque
// <script type="module"> não carrega por file:// (Chromium bloqueia módulos
// cross-origin no file://). Áudio MP3 toca nativo (Chromium do Electron traz o codec).
const { app, BrowserWindow, protocol, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const lan = require("./lan");

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
  win.webContents.on("before-input-event", (_e, input) => {   // F12 → DevTools (inspetor + console de logs)
    if (input.type === "keyDown" && input.key === "F12") win.webContents.toggleDevTools();
  });
  if (SELFTEST) runSelfTest();
}

// Toggle de tela cheia vindo do menu de gráficos (via preload → IPC).
ipcMain.handle("fs-toggle", () => { const f = !win.isFullScreen(); win.setFullScreen(f); return f; });
ipcMain.handle("fs-is", () => (win ? win.isFullScreen() : false));
ipcMain.handle("app-quit", () => app.quit());

// ---- Multiplayer LAN (ponte pro módulo lan.js) ----
let lanSession = null;   // Host ou Client ativo
let lanFinder = null;
const lanEmit = (type, data) => { try { win && win.webContents.send("lan:event", { type, data }); } catch {} };
function lanWire(s, isHost) {
  s.on("log", (m) => lanEmit("log", m));            // logs de rede → console do DevTools (F12)
  s.on("lobby", (l) => lanEmit("lobby", l));
  s.on("start", (p) => lanEmit("start", p));
  s.on("return", () => lanEmit("return", null));    // rematch: voltou pro lobby
  if (isHost) {
    s.on("input", (d) => lanEmit("input", d));        // input dos clientes → host aplica
  } else {
    s.on("welcome", (m) => lanEmit("welcome", m));
    s.on("disconnect", () => lanEmit("disconnect", null));
    s.on("error", () => lanEmit("error", null));
    s.on("state", (snap) => lanEmit("state", snap));  // snapshots do host → cliente renderiza
  }
}
function lanCloseFinder() { try { lanFinder && lanFinder.close(); } catch {} lanFinder = null; }
function lanCloseAll() { try { lanSession && lanSession.close(); } catch {} lanSession = null; lanCloseFinder(); }

ipcMain.handle("lan:create", (_e, opts) => {
  lanCloseAll();
  lanSession = lan.createHost(opts); lanWire(lanSession, true);
  return { isHost: true, youId: lanSession.players[0].id, name: lanSession.name, players: lanSession.players };
});
ipcMain.handle("lan:find", () => {
  lanCloseFinder();
  lanFinder = lan.createFinder();
  lanFinder.on("update", (list) => lanEmit("sessions", list));
  lanFinder.on("log", (m) => lanEmit("log", m));
  lanFinder.on("error", (e) => lanEmit("log", "erro descoberta: " + (e && e.message)));
  return lanFinder.list();
});
ipcMain.handle("lan:stopFind", () => lanCloseFinder());
ipcMain.handle("lan:join", (_e, session, opts) => {
  lanCloseAll();
  lanSession = lan.joinSession(session, opts); lanWire(lanSession, false);
  return { isHost: false };
});
ipcMain.handle("lan:setColor", (_e, color) => { if (lanSession) lanSession.setColor(color); });
ipcMain.handle("lan:setName", (_e, name) => { if (lanSession && lanSession.setName) lanSession.setName(name); });
ipcMain.handle("lan:returnLobby", () => { if (!lanSession) return; if (lanSession.returnToLobby) lanSession.returnToLobby(); else if (lanSession.requestReturn) lanSession.requestReturn(); });
ipcMain.handle("lan:setReady", (_e, ready) => { if (lanSession) lanSession.setReady(ready); });
ipcMain.handle("lan:sendInput", (_e, dir) => { if (lanSession && lanSession.sendInput) lanSession.sendInput(dir); });
ipcMain.handle("lan:sendState", (_e, snap) => { if (lanSession && lanSession.sendState) lanSession.sendState(snap); });
ipcMain.handle("lan:leave", () => lanCloseAll());
app.on("before-quit", lanCloseAll);

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
      probe = await wc.executeJavaScript(`(async () => {
        const vis = (id) => { const e = document.getElementById(id); return !!e && !e.classList.contains('hidden'); };
        const click = (id) => { const e = document.getElementById(id); if (e) e.click(); };
        const kids = (id) => (document.getElementById(id) || { children: [] }).children.length;
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        const r = {
          title: document.title,
          hasCanvas: !!document.getElementById('game'),
          introStarted: !!document.getElementById('intro') && !document.getElementById('intro').classList.contains('hidden'),
          hasElectronApp: !!(window.electronApp && window.electronApp.quit),
          hasLan: !!window.lan,
          hasQuitBtn: (() => { const q = document.getElementById('btn-quit'); return !!q && getComputedStyle(q).display !== 'none'; })()
        };
        click('btn-multiplayer');   r.mpOpens = vis('multiplayer-menu');   // menu → Multiplayer
        click('btn-mp-lan');        r.lanOpens = vis('lan-menu');          // → LAN
        click('btn-lan-find');      r.findOpens = vis('lan-find');         // → Encontrar sessão
        click('btn-lan-find-back');
        click('btn-lan-create');    await sleep(800);                      // Criar sessão (host) → lobby
        r.lobbyOpens = vis('lobby');
        r.lobbyHasPlayer = kids('lobby-players') >= 1;
        r.hasHueSlider = !!document.getElementById('lobby-hue');
        return r;
      })()`);
    } catch (e) { failures.push("probe: " + e.message); }
    const ok = !!(probe.hasCanvas && probe.introStarted && probe.hasElectronApp && probe.hasLan && probe.hasQuitBtn
      && probe.mpOpens && probe.lanOpens && probe.findOpens && probe.lobbyOpens && probe.lobbyHasPlayer && probe.hasHueSlider
      && failures.length === 0);
    console.log("SELFTEST_RESULT " + JSON.stringify({ ok, probe, failures, consoleMsgs }));
    app.exit(ok ? 0 : 1);
  });
  setTimeout(() => {
    console.log("SELFTEST_RESULT " + JSON.stringify({ ok: false, timeout: true, failures, consoleMsgs }));
    app.exit(2);
  }, 20000);
}
