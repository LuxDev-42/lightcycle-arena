// Multiplayer LAN — descoberta (UDP broadcast) + lobby/partida (TCP).
// Módulo Node PURO (dgram + net), sem dependência de Electron → testável isolado
// com `node`. O processo main do Electron importa isto e faz a ponte pro renderer
// via IPC. Modelo host-autoritativo: o host mantém o estado do lobby e o difunde.
const dgram = require("dgram");
const net = require("net");
const os = require("os");
const { EventEmitter } = require("events");

const DISCOVERY_PORT = 41234;   // porta fixa de descoberta na LAN
const ANNOUNCE_MS = 1000;       // host reanuncia a sessão a cada 1s
const SESSION_TTL_MS = 3500;    // sessão some da lista se não anunciar nesse tempo
const MAX_PLAYERS = 4;

// Alvos de broadcast: o dirigido à sub-rede (ex.: 192.168.0.255) é bem mais confiável
// na LAN que o 255.255.255.255 (vários roteadores/OS não entregam o "limitado").
function broadcastTargets() {
  const out = new Set(["255.255.255.255", "127.0.0.1"]);
  const ifaces = os.networkInterfaces();
  for (const name in ifaces) {
    for (const ni of ifaces[name] || []) {
      if (ni.family !== "IPv4" || ni.internal || !ni.netmask) continue;
      const ip = ni.address.split(".").map(Number);
      const mask = ni.netmask.split(".").map(Number);
      if (ip.length === 4 && mask.length === 4) out.add(ip.map((o, i) => (o | (255 - mask[i])) & 255).join("."));
    }
  }
  return [...out];
}

const genId = () => Math.random().toString(36).slice(2, 10);

// Divide um stream TCP em mensagens JSON separadas por \n.
function lineReader(sock, onMsg) {
  let buf = "";
  sock.on("data", (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (line.trim()) { try { onMsg(JSON.parse(line)); } catch {} }
    }
  });
}
const send = (sock, obj) => { try { sock.write(JSON.stringify(obj) + "\n"); } catch {} };

// ---- Host: servidor TCP + anúncio UDP + estado do lobby ----
class Host extends EventEmitter {
  constructor({ name, playerName, color, maxPlayers = MAX_PLAYERS, match = null } = {}) {
    super();
    this.id = genId();
    this.name = name || "Sessão LAN";
    this.maxPlayers = maxPlayers;
    this.match = match;          // config da partida (mapa/tamanho) — vai no payload de start
    this.started = false;
    this.clients = new Map();   // socket -> playerId
    this.players = [{ id: genId(), name: playerName || "Host", color, ready: false, isHost: true }];
    this.server = net.createServer((sock) => this._onClient(sock));
    this.server.listen(0, () => { this.tcpPort = this.server.address().port; this._startAnnounce(); });
  }
  _startAnnounce() {
    this.udp = dgram.createSocket({ type: "udp4", reuseAddr: true });
    this.udp.bind(() => {
      try { this.udp.setBroadcast(true); } catch {}
      this.targets = broadcastTargets();
      this.emit("log", `host anunciando "${this.name}" (tcp ${this.tcpPort}) → [${this.targets.join(", ")}]:${DISCOVERY_PORT}`);
      this._announce();
    });
    this._timer = setInterval(() => this._announce(), ANNOUNCE_MS);
  }
  _announce() {
    if (this.started || !this.tcpPort) return;
    const msg = Buffer.from(JSON.stringify({
      t: "lc-session", id: this.id, name: this.name,
      players: this.players.length, max: this.maxPlayers, tcpPort: this.tcpPort,
    }));
    for (const addr of this.targets || ["255.255.255.255", "127.0.0.1"]) {
      try { this.udp.send(msg, DISCOVERY_PORT, addr); } catch {}
    }
  }
  _onClient(sock) {
    if (this.started || this.players.length >= this.maxPlayers) { sock.destroy(); return; }
    lineReader(sock, (m) => this._onMsg(sock, m));
    sock.on("close", () => this._drop(sock));
    sock.on("error", () => this._drop(sock));
  }
  _onMsg(sock, m) {
    if (m.t === "join") {
      const p = { id: genId(), name: m.name || "Jogador", color: m.color, ready: false, isHost: false };
      this.clients.set(sock, p.id);
      this.players.push(p);
      send(sock, { t: "welcome", youId: p.id });
      this._broadcastLobby();
    } else if (m.t === "setColor") {
      const p = this._bySock(sock); if (p) { p.color = m.color; this._broadcastLobby(); }
    } else if (m.t === "setReady") {
      const p = this._bySock(sock); if (p) { p.ready = !!m.ready; this._broadcastLobby(); this._maybeStart(); }
    } else if (m.t === "input") {
      const p = this._bySock(sock); if (p) this.emit("input", { id: p.id, dir: m.dir });   // input do cliente → host aplica
    }
  }
  // Host → clientes: snapshot de estado da partida (chamado a cada frame do host).
  sendState(snap) { for (const s of this.clients.keys()) send(s, { t: "state", s: snap }); }
  // API local (o host é um jogador também)
  setColor(color) { this.players[0].color = color; this._broadcastLobby(); }
  setReady(ready) { this.players[0].ready = !!ready; this._broadcastLobby(); this._maybeStart(); }
  _maybeStart() {
    if (!this.started && this.players.length >= 2 && this.players.every((p) => p.ready)) this.start();
  }
  start() {
    if (this.started) return;
    this.started = true;
    clearInterval(this._timer);
    const payload = { t: "start", match: this.match, players: this.players.map((p, i) => ({ ...p, slot: i })) };
    for (const s of this.clients.keys()) send(s, payload);
    this.emit("start", payload);
  }
  _lobby() {
    return { t: "lobby", players: this.players, canStart: this.players.length >= 2 && this.players.every((p) => p.ready) };
  }
  _broadcastLobby() {
    const lobby = this._lobby();
    for (const s of this.clients.keys()) send(s, lobby);
    this.emit("lobby", lobby);
  }
  _bySock(sock) { const id = this.clients.get(sock); return this.players.find((p) => p.id === id); }
  _drop(sock) {
    const id = this.clients.get(sock);
    if (!id) return;
    this.clients.delete(sock);
    this.players = this.players.filter((p) => p.id !== id);
    this._broadcastLobby();
  }
  close() {
    clearInterval(this._timer);
    try { this.udp && this.udp.close(); } catch {}
    try { this.server.close(); } catch {}
    for (const s of this.clients.keys()) { try { s.destroy(); } catch {} }
  }
}

// ---- Client: conecta no host e espelha o lobby ----
class Client extends EventEmitter {
  constructor(session, { playerName, color } = {}) {
    super();
    this.youId = null;
    this.sock = net.connect(session.tcpPort, session.host, () => send(this.sock, { t: "join", name: playerName, color }));
    lineReader(this.sock, (m) => {
      if (m.t === "welcome") { this.youId = m.youId; this.emit("welcome", m); }
      else if (m.t === "lobby") this.emit("lobby", m);
      else if (m.t === "start") this.emit("start", m);
      else if (m.t === "state") this.emit("state", m.s);   // snapshot do host
    });
    this.sock.on("close", () => this.emit("disconnect"));
    this.sock.on("error", (e) => this.emit("error", e));
  }
  setColor(color) { send(this.sock, { t: "setColor", color }); }
  setReady(ready) { send(this.sock, { t: "setReady", ready }); }
  sendInput(dir) { send(this.sock, { t: "input", dir }); }   // cliente → host
  close() { try { this.sock.destroy(); } catch {} }
}

// ---- Finder: escuta anúncios UDP e mantém a lista de sessões ----
class Finder extends EventEmitter {
  constructor() {
    super();
    this.sessions = new Map();   // id -> sessão
    this.udp = dgram.createSocket({ type: "udp4", reuseAddr: true });
    this._seen = new Set();
    this.udp.on("message", (msg, rinfo) => {
      let m; try { m = JSON.parse(msg.toString()); } catch { return; }
      if (m.t !== "lc-session") return;
      const key = rinfo.address + "|" + m.id;
      if (!this._seen.has(key)) { this._seen.add(key); this.emit("log", `anúncio recebido de ${rinfo.address} ("${m.name}", ${m.players}/${m.max})`); }
      this.sessions.set(m.id, { id: m.id, name: m.name, players: m.players, max: m.max, host: rinfo.address, tcpPort: m.tcpPort, lastSeen: Date.now() });
      this.emit("update", this.list());
    });
    this.udp.on("error", (e) => this.emit("error", e));
    this.udp.bind(DISCOVERY_PORT, () => this.emit("log", `descoberta escutando em 0.0.0.0:${DISCOVERY_PORT}`));
    this._expire = setInterval(() => {
      const now = Date.now(); let changed = false;
      for (const [id, s] of this.sessions) if (now - s.lastSeen > SESSION_TTL_MS) { this.sessions.delete(id); changed = true; }
      if (changed) this.emit("update", this.list());
    }, 1000);
  }
  list() { return [...this.sessions.values()]; }
  close() { clearInterval(this._expire); try { this.udp.close(); } catch {} }
}

module.exports = {
  DISCOVERY_PORT,
  createHost: (opts) => new Host(opts),
  createFinder: () => new Finder(),
  joinSession: (session, opts) => new Client(session, opts),
};
