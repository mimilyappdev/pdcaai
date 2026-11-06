import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine, InputError, publicView } from './engine.js';
import { chooseProvider } from './providers.js';
import { JsonStore } from './store.js';
import * as notebook from '../plugin/skills/pdcaai/scripts/notebook.mjs';
import { CARDS, finishStretch, startStretch } from './stretch.js';
import { makeJobs, successorTest } from './handover.js';
import { randomUUID } from 'node:crypto';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const MAX_BODY = 200_000;

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  if (!(req.headers['content-type'] ?? '').startsWith('application/json')) throw new InputError('JSONで送信してください');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new InputError('入力が長すぎます');
    chunks.push(chunk);
  }
  let body;
  try {
    body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  } catch {
    throw new InputError('JSONを読み取れません');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new InputError('JSONの形式が正しくありません');
  return body;
}

// カード版のストレッチャー。AI社員の結果は、本人が書き終えるまでサーバーの中に置いておく。
const stretches = new Map();

const text = (v, name, max) => {
  const s = String(v ?? '').trim();
  if (!s) throw new InputError(`${name}を入れてください`);
  return s.slice(0, max);
};

async function stretchRoute(provider, pathname, body) {
  const m = pathname.match(/^\/api\/stretch(?:\/([\w-]+)\/(answer|feel))?$/);
  if (!m) throw new InputError('見つかりません');
  const [, id, action] = m;
  if (!id) {
    const project = text(body.project, '作るもの', 200);
    const summary = String(body.summary ?? '').trim().slice(0, 500);
    const confidenceBefore = Number(body.confidenceBefore);
    if (!Number.isInteger(confidenceBefore) || confidenceBefore < 0 || confidenceBefore > 100) throw new InputError('自信は0〜100で入れてください');
    const book = await notebook.load();
    const sid = randomUUID();
    stretches.set(sid, { project, summary, confidenceBefore, pending: startStretch(provider, book, { project, summary }) });
    return { id: sid, cards: Object.entries(notebook.LENSES).map(([lens, name]) => ({ lens, name, question: CARDS[lens] })) };
  }
  const st = stretches.get(id);
  if (!st) throw new InputError('この回は見つかりません。最初からやり直してください');
  const book = await notebook.load();
  if (action === 'answer') {
    const own = (Array.isArray(body.own) ? body.own : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 30);
    const cycle = await finishStretch(provider, book, { ...st, own });
    book.cycles.push(cycle);
    await notebook.save(book);
    st.cycleId = cycle.id;
    return { cycle, summary: notebook.summarize(cycle) };
  }
  if (!st.cycleId) throw new InputError('先にカードをめくってください');
  const cycle = notebook.applyUpdate(book, { id: st.cycleId, feel: body.feel, confidenceAfter: body.confidenceAfter });
  await notebook.save(book);
  stretches.delete(id);
  return { summary: notebook.summarize(cycle) };
}

// 引継ぎカードを保存し、後任AIテストを回す。仕事は1回目に決めて、書き足したあとも同じ仕事で試す。
async function handoverRoute(provider, cycleId, body) {
  const book = await notebook.load();
  const cycle = book.cycles.find((c) => c.id === cycleId);
  if (!cycle) throw new InputError('この周回は見つかりません');
  notebook.applyHandover(book, { id: cycleId, card: body.card ?? {} });
  if (!Object.values(cycle.handover.card).some(Boolean)) throw new InputError('カードに1行以上書いてください');
  if (!cycle.handover.jobs.length) notebook.applyHandover(book, { id: cycleId, jobs: await makeJobs(provider, cycle, book) });
  notebook.applyHandover(book, { id: cycleId, test: await successorTest(provider, cycle, cycle.handover.jobs) });
  await notebook.save(book);
  return { handover: cycle.handover };
}

async function route(engine, req, res, providerName) {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && pathname === '/api/meta') return send(res, 200, { provider: providerName });
  if (req.method === 'GET' && pathname === '/api/ledger') return send(res, 200, await engine.ledger());
  if (req.method === 'GET' && pathname === '/api/notebook') {
    const book = await notebook.load();
    return send(res, 200, { cycles: book.cycles, stats: notebook.stats(book), hints: notebook.hints(book), lenses: notebook.LENSES, slots: notebook.HANDOVER, humanOnly: notebook.humanOnly(book), reunions: notebook.reunions(book) });
  }
  const hm = pathname.match(/^\/api\/handover\/(c\d+)$/);
  if (req.method === 'POST' && hm) return send(res, 200, await handoverRoute(engine.provider, hm[1], await readJson(req)));
  if (req.method === 'POST' && pathname.startsWith('/api/stretch')) return send(res, 200, await stretchRoute(engine.provider, pathname, await readJson(req)));
  const m = pathname.match(/^\/api\/sessions(?:\/([\w-]+)(?:\/([\w-]+)(?:\/(\w+))?)?)?$/);
  if (m) {
    const [, id, action, role] = m;
    if (req.method === 'GET' && id && !action) {
      return send(res, 200, publicView(await engine.require(id)));
    }
    if (req.method === 'GET' && id && action === 'chain') return send(res, 200, await engine.chain(id));
    if (req.method === 'POST') {
      const body = await readJson(req);
      if (!id) return send(res, 201, await engine.create(body));
      if (action === 'messages') return send(res, 200, await engine.say(id, body));
      if (action === 'open') return send(res, 200, await engine.open(id));
      if (action === 'propose') return send(res, 200, await engine.propose(id));
      if (action === 'act') return send(res, 200, await engine.submitAct(id, body));
      if (action === 'tags') return send(res, 200, await engine.setTag(id, body));
      if (action === 'result') return send(res, 200, await engine.submitResult(id, body));
    }
  }
  return send(res, 404, { error: '見つかりません' });
}

async function serveStatic(req, res) {
  const { pathname } = new URL(req.url, 'http://localhost');
  const file = normalize(join(PUBLIC, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC + sep)) { res.writeHead(403); return res.end(); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'x-content-type-options': 'nosniff' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

export function buildServer(engine, providerName, port) {
  const allowed = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
  return createServer(async (req, res) => {
    // 他サイトから手元のサーバーを操作されないように、Hostと送信元を確認する。
    if (port && !allowed.has(req.headers.host)) { res.writeHead(403); return res.end(); }
    const origin = req.headers.origin;
    if (origin && port && !allowed.has(origin.replace(/^https?:\/\//, ''))) { res.writeHead(403); return res.end(); }
    try {
      if (req.url.startsWith('/api/')) return await route(engine, req, res, providerName);
      if (req.method === 'GET') return await serveStatic(req, res);
      send(res, 405, { error: '許可されていません' });
    } catch (e) {
      if (e instanceof InputError) return send(res, 400, { error: e.message });
      console.error(e);
      send(res, 502, { error: e.message || '処理に失敗しました' });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const providerArg = process.argv.find((a) => a.startsWith('--provider='))?.split('=')[1];
  const provider = chooseProvider(providerArg);
  const port = Number(process.env.PORT) || 3210;
  const dataFile = process.env.PDCAAI_DATA || join(ROOT, 'data', provider.name === 'mock' ? 'demo-ledger.json' : 'ledger.json');
  const engine = new Engine({ store: new JsonStore(dataFile), provider });
  buildServer(engine, provider.name, port).listen(port, '127.0.0.1', () => {
    console.log(`pdcaai: http://localhost:${port} (AI: ${provider.name})`);
  });
}
