// Live Poll: server locale senza dipendenze.
// Tiene lo stato dei sondaggi, aggrega i voti e sincronizza pannello e overlay via SSE.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = process.env.LIVE_POLL_DATA || path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'polls.json');
const PORT = Number(process.env.PORT) || 4330;
const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f'];

// ---- dati persistenti: sondaggi + impostazioni ----
let store = { settings: { sessionId: '', password: '', position: 'bottom' }, polls: [] };
try {
  const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  store = { settings: { ...store.settings, ...saved.settings }, polls: saved.polls || [] };
} catch { /* primo avvio */ }

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

// ---- stato live (in memoria) ----
const live = {
  activeId: null,
  view: 'hidden',      // hidden | question | results
  open: false,         // votazione aperta
  reveal: false,       // evidenzia la risposta corretta
  votes: {},           // pollId -> { voterKey: letter }
  lastMessageAt: 0,    // ultimo messaggio di chat ricevuto (qualsiasi)
  lastVote: null,      // { name, letter, at }
};
let anonSeq = 0;

const activePoll = () => store.polls.find((p) => p.id === live.activeId) || null;

function tally(poll) {
  const counts = {};
  poll.options.forEach((_, i) => { counts[LETTERS[i]] = 0; });
  for (const letter of Object.values(live.votes[poll.id] || {})) {
    if (letter in counts) counts[letter] += 1;
  }
  return counts;
}

function snapshot() {
  const poll = activePoll();
  const counts = poll ? tally(poll) : {};
  return {
    settings: store.settings,
    polls: store.polls.map((p) => ({
      ...p,
      total: Object.keys(live.votes[p.id] || {}).length,
    })),
    live: {
      activeId: poll ? poll.id : null,
      view: poll ? live.view : 'hidden',
      open: live.open,
      reveal: live.reveal,
      counts,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      lastMessageAt: live.lastMessageAt,
      lastVote: live.lastVote,
    },
    overlays: [...clients].filter((c) => c.role === 'overlay').length,
  };
}

// ---- SSE ----
const clients = new Set();
function broadcast() {
  const payload = `data: ${JSON.stringify(snapshot())}\n\n`;
  for (const c of clients) c.res.write(payload);
}
setInterval(() => { for (const c of clients) c.res.write(': ping\n\n'); }, 25000).unref();

// ---- voti ----
// Un messaggio è un voto solo se contiene unicamente una lettera valida: "a", "B", "c)", "D."
function parseLetter(text, poll) {
  const plain = String(text || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim();
  const m = plain.match(/^([a-f])\s*[.)!:\-]*$/i);
  if (!m) return null;
  const letter = m[1].toLowerCase();
  return LETTERS.indexOf(letter) < poll.options.length ? letter : null;
}

function registerVote(name, text) {
  live.lastMessageAt = Date.now();
  const poll = activePoll();
  if (!poll || !live.open) return { counted: false, reason: 'votazione chiusa' };
  const letter = parseLetter(text, poll);
  if (!letter) return { counted: false, reason: 'non è un voto' };
  const cleanName = String(name || '').trim();
  // Un voto per persona: se riscrive, vale l'ultima lettera.
  const key = cleanName ? cleanName.toLowerCase() : `anon-${++anonSeq}`;
  (live.votes[poll.id] ||= {})[key] = letter;
  live.lastVote = { name: cleanName || 'Anonimo', letter, at: Date.now() };
  return { counted: true, letter };
}

// ---- comandi di regia (pannello, scorciatoie, Stream Deck) ----
function step(delta) {
  if (!store.polls.length) return;
  const i = store.polls.findIndex((p) => p.id === live.activeId);
  const next = store.polls[Math.min(Math.max(i + delta, 0), store.polls.length - 1)];
  activate(next.id);
}
function activate(id) {
  if (!store.polls.some((p) => p.id === id)) return false;
  if (live.activeId !== id) { live.activeId = id; live.reveal = false; live.open = false; live.view = 'hidden'; }
  return true;
}
const COMMANDS = {
  question() { if (!activePoll()) step(0); if (activePoll()) { live.view = 'question'; live.open = true; } },
  results()  { if (!activePoll()) step(0); if (activePoll()) live.view = 'results'; },
  toggle()   { live.view === 'question' ? COMMANDS.results() : COMMANDS.question(); },
  hide()     { live.view = 'hidden'; },
  open()     { if (activePoll()) live.open = true; },
  close()    { live.open = false; },
  reveal()   { live.reveal = !live.reveal; },
  reset()    { if (live.activeId) delete live.votes[live.activeId]; live.lastVote = null; live.reveal = false; },
  next()     { step(1); },
  prev()     { step(-1); },
};

// ---- HTTP ----
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg' };

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
  });
}
function cleanPoll(input, existing) {
  const options = (Array.isArray(input.options) ? input.options : [])
    .map((o) => String(o || '').trim()).filter(Boolean).slice(0, LETTERS.length);
  const title = String(input.title || '').trim();
  if (!title || options.length < 2) return null;
  const right = LETTERS.indexOf(input.right) > -1 && LETTERS.indexOf(input.right) < options.length ? input.right : '';
  return { id: existing?.id || randomUUID().slice(0, 8), title, options, right };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    const client = { res, role: url.searchParams.get('role') || 'control' };
    clients.add(client);
    req.on('close', () => { clients.delete(client); broadcast(); });
    broadcast();
    return;
  }
  if (p === '/api/state') return json(res, 200, snapshot());

  if (p === '/api/polls' && req.method === 'POST') {
    const body = await readBody(req);
    const existing = store.polls.find((x) => x.id === body.id);
    const poll = cleanPoll(body, existing);
    if (!poll) return json(res, 400, { ok: false, error: 'Servono un titolo e almeno due risposte.' });
    if (existing) {
      // Se cambiano le risposte i voti vecchi non hanno più senso.
      if (existing.options.length !== poll.options.length) delete live.votes[existing.id];
      Object.assign(existing, poll);
    } else store.polls.push(poll);
    persist(); broadcast();
    return json(res, 200, { ok: true, poll });
  }
  if (p === '/api/polls/order' && req.method === 'POST') {
    const { ids = [] } = await readBody(req);
    store.polls.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    persist(); broadcast();
    return json(res, 200, { ok: true });
  }
  if (p.startsWith('/api/polls/') && req.method === 'DELETE') {
    const id = p.split('/').pop();
    store.polls = store.polls.filter((x) => x.id !== id);
    delete live.votes[id];
    if (live.activeId === id) { live.activeId = null; live.view = 'hidden'; live.open = false; }
    persist(); broadcast();
    return json(res, 200, { ok: true });
  }
  if (p === '/api/settings' && req.method === 'POST') {
    const body = await readBody(req);
    for (const k of ['sessionId', 'password', 'position']) {
      if (typeof body[k] === 'string') store.settings[k] = body[k].trim();
    }
    persist(); broadcast();
    return json(res, 200, { ok: true });
  }
  if (p === '/api/vote' && req.method === 'POST') {
    const body = await readBody(req);
    const result = registerVote(body.name, body.text);
    broadcast();
    return json(res, 200, { ok: true, ...result });
  }
  if (p.startsWith('/control/')) {
    const cmd = p.slice('/control/'.length);
    if (cmd === 'activate') {
      if (!activate(url.searchParams.get('id'))) return json(res, 404, { ok: false, error: 'sondaggio non trovato' });
    } else if (COMMANDS[cmd]) COMMANDS[cmd]();
    else return json(res, 404, { ok: false, error: `comando sconosciuto: ${cmd}`, commands: [...Object.keys(COMMANDS), 'activate'] });
    broadcast();
    const s = snapshot();
    return json(res, 200, { ok: true, cmd, view: s.live.view, open: s.live.open, overlays: s.overlays });
  }

  // file statici
  let file = p === '/' ? '/control.html' : p;
  if (!path.extname(file)) file += '.html';
  const full = path.normalize(path.join(PUBLIC, file));
  if (!full.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Live Poll attivo`);
  console.log(`  Pannello di regia: http://127.0.0.1:${PORT}/`);
  console.log(`  Overlay per OBS:   http://127.0.0.1:${PORT}/overlay`);
});
