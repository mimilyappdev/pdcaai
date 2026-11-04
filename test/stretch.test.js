import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mockProvider } from '../src/providers.js';
import { finishStretch, startStretch } from '../src/stretch.js';
import { applyUpdate, summarize } from '../plugin/skills/pdcaai/scripts/notebook.mjs';
import { buildServer } from '../src/server.js';

test('カード版は4人の洗い出しを本人の答えと突き合わせ、カードで回した記録として残す', async () => {
  const provider = mockProvider();
  const book = { cycles: [] };
  const input = { project: 'オンラインのイベント', summary: '', confidenceBefore: 70 };
  const pending = startStretch(provider, book, input);
  const cycle = await finishStretch(provider, book, { ...input, own: ['サーバーの費用が気になる', '名前を決めたい'], pending });
  assert.equal(cycle.mode, 'card');
  assert.equal(cycle.items.length, 4);
  const money = cycle.items.find((i) => i.lens === 'money-ops');
  assert.equal(money.status, 'self');
  assert.equal(summarize(cycle).ownOnly, 1);
  book.cycles.push(cycle);
  applyUpdate(book, { feel: 1, confidenceAfter: 75 });
  assert.deepEqual([cycle.feel, cycle.confidenceAfter], [1, 75]);
  assert.throws(() => applyUpdate(book, { feel: 3 }));
});

test('カードをめくる前は、AI社員の結果をブラウザへ送らない', async () => {
  process.env.PDCAAI_NOTEBOOK = join(await mkdtemp(join(tmpdir(), 'pdcaai-')), 'notebook.json');
  const server = buildServer({ provider: mockProvider() }, 'mock', 0);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api/stretch`;
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  try {
    const st = await post('', { project: 'イベント', confidenceBefore: 60 });
    assert.equal(st.cards.length, 4);
    assert.equal(JSON.stringify(st).includes('item'), false);
    const out = await post(`/${st.id}/answer`, { own: ['最初の画面が分かりにくい'] });
    assert.equal(out.summary.self, 1);
    const done = await post(`/${st.id}/feel`, { feel: 2, confidenceAfter: 65 });
    assert.deepEqual([done.summary.feel, done.summary.mode], [2, 'card']);
  } finally {
    server.close();
    delete process.env.PDCAAI_NOTEBOOK;
  }
});
