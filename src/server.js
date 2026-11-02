import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine, InputError, publicView } from './engine.js';
import { chooseProvider } from './providers.js';
import { JsonStore } from './store.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
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

async function route(engine, req, res, providerName) {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && pathname === '/api/meta') return send(res, 200, { provider: providerName });
  if (req.method === 'GET' && pathname === '/api/ledger') return send(res, 200, await engine.ledger());
  const m = pathname.match(/^\/api\/sessions(?:\/([\w-]+)(?:\/([\w-]+)(?:\/(\w+))?)?)?$/);
  if (m) {
    const [, id, action, role] = m;
    if (req.method === 'GET' && id && !action) {
      return send(res, 200, publicView(await engine.require(id)));
    }
    if (req.method === 'POST') {
      const body = await readJson(req);
      if (!id) return send(res, 201, await engine.create(body));
      if (action === 'assumptions') return send(res, 200, await engine.assumptions(id));
      if (action === 'reviewers' && role) return send(res, 200, await engine.reviewer(id, role));
      if (action === 'answers') return send(res, 200, await engine.submitAnswers(id, body));
      if (action === 'act') return send(res, 200, await engine.submitAct(id, body));
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
