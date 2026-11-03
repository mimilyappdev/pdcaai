#!/usr/bin/env node
// 観点帳。自分で出せた検討事項と、AIの観点役だけが出したものを周回ごとに記録し、
// 自分で出せる割合が上がった観点からヒントを減らしていく。依存なしで動かす。
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LENSES = {
  'first-timer': '初見の客',
  breaker: '壊し屋',
  'money-ops': 'お金と運用',
  misreading: '読み違い',
};

const WINDOW = 3;
const LIMIT = { text: 500, items: 30 };

export function notebookPath() {
  return process.env.PDCAAI_NOTEBOOK || join(homedir(), '.pdcaai', 'notebook.json');
}

export async function load(file = notebookPath()) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return { cycles: [] };
    throw e;
  }
}

async function save(book, file) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(book, null, 2));
  await rename(tmp, file);
}

const norm = (s) => String(s ?? '').normalize('NFKC').replace(/\s+/g, '');

// 引用が本人の書いた文に一字一句あるときだけ「自分で出せた」と認める。
export function quoteIn(quote, text) {
  const q = norm(quote);
  return q.length >= 2 && norm(text).includes(q);
}

function str(v, name, max = LIMIT.text) {
  const s = String(v ?? '').trim();
  if (!s) throw new Error(`${name}が空です`);
  return s.slice(0, max);
}

function pct(v, name) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 100) throw new Error(`${name}は0〜100の整数で指定してください`);
  return n;
}

// 観点ごとに直近の周回を見て、ヒントの強さを決める。2=見落とした例まで出す、1=観点名だけ、0=出さない。
export function hints(book) {
  const out = [];
  for (const [lens, name] of Object.entries(LENSES)) {
    const recent = book.cycles.filter((c) => c.items.some((i) => i.lens === lens)).slice(-WINDOW);
    const items = recent.flatMap((c) => c.items.filter((i) => i.lens === lens));
    const missed = items.filter((i) => i.status !== 'self');
    if (!missed.length) continue;
    const rate = items.filter((i) => i.status === 'self').length / items.length;
    const level = rate < 1 / 3 ? 2 : rate < 2 / 3 ? 1 : 0;
    if (!level) continue;
    const example = missed.at(-1).item;
    out.push({
      lens,
      name,
      level,
      selfRate: Math.round(rate * 100),
      text: level === 2 ? `「${name}」の観点: 前に「${example}」を見落としています。似たことはありますか？` : `「${name}」の観点で、ほかに気になることはありますか？`,
    });
  }
  return out;
}

export function summarize(cycle) {
  const count = (s) => cycle.items.filter((i) => i.status === s).length;
  const total = cycle.items.length;
  const self = count('self');
  return {
    total,
    self,
    hint: count('hint'),
    ai: count('ai'),
    ownOnly: cycle.own.filter((o) => o.phase === 'free' && !cycle.items.some((i) => i.ownId === o.id)).length,
    // ヒントのあとに出た、AIの項目とも重ならない自分の検討事項。ヒントで考えが広がった数。
    spread: cycle.own.filter((o) => o.phase === 'hint' && !cycle.items.some((i) => i.ownId === o.id)).length,
    selfRate: total ? Math.round((self / total) * 100) : null,
    confidenceBefore: cycle.confidenceBefore,
    confidenceAfter: cycle.confidenceAfter ?? null,
  };
}

export function stats(book) {
  return book.cycles.map((c) => ({ id: c.id, project: c.project, createdAt: c.createdAt, ...summarize(c) }));
}

export function buildCycle(input, book, now = new Date()) {
  const own = (input.own ?? []).slice(0, LIMIT.items).map((o, i) => ({
    id: `o${i + 1}`,
    text: str(o.text, '自分の検討事項'),
    phase: o.phase === 'hint' ? 'hint' : 'free',
  }));
  // 本人の1つの答えが一致するのは、AIの1項目までにする。
  const used = new Set();
  const items = (input.items ?? []).slice(0, LIMIT.items).map((it, i) => {
    if (!Object.hasOwn(LENSES, it.lens)) throw new Error(`観点 ${it.lens} は登録されていません`);
    const match = it.quote ? own.find((o) => !used.has(o.id) && quoteIn(it.quote, o.text)) : null;
    if (match) used.add(match.id);
    return {
      id: `a${i + 1}`,
      lens: it.lens,
      item: str(it.item, '検討事項', 200),
      why: String(it.why ?? '').slice(0, LIMIT.text),
      check: String(it.check ?? '').slice(0, LIMIT.text),
      status: match ? (match.phase === 'free' ? 'self' : 'hint') : 'ai',
      ownId: match?.id ?? null,
      quote: match ? it.quote : '',
      decision: null,
    };
  });
  return {
    id: `c${book.cycles.length + 1}`,
    createdAt: now.toISOString(),
    project: str(input.project, '作るもの', 200),
    summary: String(input.summary ?? '').slice(0, LIMIT.text),
    confidenceBefore: pct(input.confidenceBefore, '最初の自信'),
    confidenceAfter: null,
    hintsShown: (input.hintsShown ?? []).map((h) => String(h).slice(0, LIMIT.text)),
    own,
    items,
  };
}

export function applyUpdate(book, input) {
  const cycle = book.cycles.find((c) => c.id === input.id) ?? book.cycles.at(-1);
  if (!cycle) throw new Error('まだ周回がありません');
  if (input.confidenceAfter != null) cycle.confidenceAfter = pct(input.confidenceAfter, '見直した自信');
  for (const [id, d] of Object.entries(input.decisions ?? {})) {
    const item = cycle.items.find((i) => i.id === id);
    if (item && ['do', 'done', 'skip', 'later'].includes(d)) item.decision = d;
  }
  return cycle;
}

async function readInput(path) {
  if (!path) throw new Error('入力のJSONファイルを指定してください');
  return JSON.parse((await readFile(path, 'utf8')).replace(/^﻿/, ''));
}

async function main([command, arg]) {
  const file = notebookPath();
  const book = await load(file);
  if (command === 'hints') return { notebook: file, cycles: book.cycles.length, hints: hints(book) };
  if (command === 'stats') return { notebook: file, cycles: stats(book) };
  if (command === 'record') {
    const cycle = buildCycle(await readInput(arg), book);
    book.cycles.push(cycle);
    await save(book, file);
    return {
      id: cycle.id,
      summary: summarize(cycle),
      self: cycle.items.filter((i) => i.status === 'self').map((i) => i.item),
      hint: cycle.items.filter((i) => i.status === 'hint').map((i) => i.item),
      ai: cycle.items.filter((i) => i.status === 'ai').map((i) => ({ id: i.id, lens: LENSES[i.lens], item: i.item, why: i.why, check: i.check })),
      ownOnly: cycle.own.filter((o) => o.phase === 'free' && !cycle.items.some((i) => i.ownId === o.id)).map((o) => o.text),
      spread: cycle.own.filter((o) => o.phase === 'hint' && !cycle.items.some((i) => i.ownId === o.id)).map((o) => o.text),
    };
  }
  if (command === 'update') {
    const cycle = applyUpdate(book, await readInput(arg));
    await save(book, file);
    return { id: cycle.id, summary: summarize(cycle) };
  }
  throw new Error('使い方: notebook.mjs hints | stats | record <file.json> | update <file.json>');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2))
    .then((out) => console.log(JSON.stringify(out, null, 2)))
    .catch((e) => { console.error(e.message); process.exitCode = 1; });
}
