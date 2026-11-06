#!/usr/bin/env node
// 観点帳。自分で出せた検討事項と、AIの観点役だけが出したものを周回ごとに記録し、
// 自分で出せる割合が上がった観点からヒントを減らしていく。依存なしで動かす。
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LENSES = {
  'first-timer': '新入社員',
  breaker: '法務・リスク管理',
  'money-ops': '財務',
  misreading: 'ユーザー',
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

export async function save(book, file = notebookPath()) {
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
    // 前に見落とした型をヒントなしで自分で出せた回も、自分で出せたものとして数える。
    const recalled = book.cycles.slice(-WINDOW).flatMap((c) => c.own.filter((o) => o.recalls?.lens === lens)).length;
    const rate = (items.filter((i) => i.status === 'self').length + recalled) / (items.length + recalled);
    const level = rate < 1 / 3 ? 2 : rate < 2 / 3 ? 1 : 0;
    if (!level) continue;
    // 型だけだと抽象的で伝わりにくく、項目だけだと前の題材に引きずられる。型を主にして、前回の項目を例として添える。
    const last = missed.at(-1);
    const example = last.pattern && last.pattern !== last.item ? `「${last.pattern}」（前回の例: ${last.item}）` : `「${last.item}」`;
    out.push({
      lens,
      name,
      level,
      selfRate: Math.round(rate * 100),
      text: level === 2 ? `${name}から: 前は${example}を見落としていました。今回の題材だと、どこが当てはまりそうですか？` : `${name}から: ほかに気になることはありますか？`,
    });
  }
  return out;
}

// 直近の周回で出た項目と本人の答え。観点役に同じ論点を繰り返させず、本人にも書き直させないために使う。
export function known(book) {
  const recent = book.cycles.slice(-WINDOW);
  return {
    items: [...new Set(recent.flatMap((c) => c.items.map((i) => i.item)))],
    said: recent.flatMap((c) => c.own.map((o) => o.text)),
    missedPatterns: missedPatterns(book).map((m) => m.pattern),
  };
}

// これまでに見落とした型（AIだけ、またはヒントで追いついた項目の型）。重複は除く。
export function missedPatterns(book) {
  const seen = new Map();
  for (const c of book.cycles) {
    for (const i of c.items) {
      const pattern = i.pattern || i.item;
      if (i.status !== 'self' && !seen.has(pattern)) seen.set(pattern, { pattern, lens: i.lens, cycleId: c.id });
    }
  }
  return [...seen.values()];
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
    // 前に見落とした型を、ヒントなしで自分で出せた数。人間の伸びに一番近い数字。
    recalled: cycle.own.filter((o) => o.phase === 'free' && o.recalls).length,
    selfRate: total ? Math.round((self / total) * 100) : null,
    confidenceBefore: cycle.confidenceBefore,
    confidenceAfter: cycle.confidenceAfter ?? null,
    mode: cycle.mode ?? 'skill',
    feel: cycle.feel ?? null,
    // 後任AIテストで止まった仕事の数の推移。
    stuck: cycle.handover?.tests.map((t) => t.stuck) ?? [],
  };
}

export function stats(book) {
  return book.cycles.map((c) => ({ id: c.id, project: c.project, createdAt: c.createdAt, ...summarize(c) }));
}

export function buildCycle(input, book, now = new Date()) {
  // recalls は、前の周回で実際に見落とした型と一字一句同じときだけ認める。
  const before = new Map(missedPatterns(book).map((m) => [m.pattern, m]));
  const own = (input.own ?? []).slice(0, LIMIT.items).map((o, i) => {
    const hit = o.recalls ? before.get(String(o.recalls)) : null;
    return {
      id: `o${i + 1}`,
      text: str(o.text, '自分の検討事項'),
      phase: o.phase === 'hint' ? 'hint' : 'free',
      ...(hit ? { recalls: { pattern: hit.pattern, lens: hit.lens, from: hit.cycleId } } : {}),
    };
  });
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
      pattern: String(it.pattern ?? '').slice(0, 60),
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
    // スキル（文字）で回したか、カード画面で回したか。考える力の手応えを比べるために残す。
    mode: input.mode === 'card' ? 'card' : 'skill',
    feel: null,
    hintsShown: (input.hintsShown ?? []).map((h) => String(h).slice(0, LIMIT.text)),
    own,
    items,
  };
}

export function applyUpdate(book, input) {
  const cycle = book.cycles.find((c) => c.id === input.id) ?? book.cycles.at(-1);
  if (!cycle) throw new Error('まだ周回がありません');
  if (input.confidenceAfter != null) cycle.confidenceAfter = pct(input.confidenceAfter, '見直した自信');
  // 考える力が上がった手応え。-2（下がった）〜 2（上がった）の本人の主観。
  if (input.feel != null) {
    const f = Number(input.feel);
    if (!Number.isInteger(f) || f < -2 || f > 2) throw new Error('手応えは-2〜2の整数で指定してください');
    cycle.feel = f;
  }
  for (const [id, d] of Object.entries(input.decisions ?? {})) {
    const item = cycle.items.find((i) => i.id === id);
    if (item && ['do', 'done', 'skip', 'later'].includes(d)) item.decision = d;
  }
  return cycle;
}

// 観点帳から引継ぎ書の下書きを作る。本人の言葉はそのまま載せ、AI社員が補った行には印を付ける。
// 「ツールの説明書」と、人から人へ伝える「業務の引継ぎ」の2部に分ける。
const MANUAL = [
  { title: 'ツールの説明書', parts: [
    { lens: 'first-timer', heading: '初めて触る人が迷うところ' },
    { lens: 'breaker', heading: '壊れる・混ざる・消えるのを防ぐ' },
  ] },
  { title: '業務の引継ぎ', parts: [
    { lens: 'misreading', heading: '言葉と範囲の取り決め' },
    { lens: 'money-ops', heading: 'お金と続けるための運用' },
  ] },
];

// 同じ題材の周回だけをまとめる。「（深掘り）」のような末尾の括弧書きは同じ題材として扱う。
const subject = (p) => norm(p).replace(/[（(][^（(]*[)）]$/, '');

export function manual(book, cycles = book.cycles.filter((c) => subject(c.project) === subject(book.cycles.at(-1)?.project))) {
  const seen = new Set();
  const items = cycles.flatMap((c) => c.items).filter((i) => i.decision !== 'skip' && !seen.has(i.item) && seen.add(i.item));
  const line = (i) => [
    `- ${i.item}${i.status === 'ai' ? '（AI社員が補足）' : ''}`,
    ...(i.why ? [`  - なぜ: ${i.why}`] : []),
    ...(i.check ? [`  - 確かめ方: ${i.check}`] : []),
  ];
  const out = [`# 引継ぎ書（下書き）: ${cycles.at(-1)?.project ?? ''}`, '', 'pdcaai の観点帳から作りました。本人の言葉はそのまま載せています。「AI社員が補足」の行は、本人が書くか消すかを決めてください。', ''];
  for (const section of MANUAL) {
    out.push(`## ${section.title}`, '');
    for (const part of section.parts) {
      const rows = items.filter((i) => i.lens === part.lens);
      if (rows.length) out.push(`### ${part.heading}`, '', ...rows.flatMap(line), '');
    }
    if (section.title === '業務の引継ぎ') {
      const said = [...new Set(cycles.flatMap((c) => c.own.map((o) => o.text)))];
      if (said.length) out.push('### 人から人へ伝えること（本人の言葉）', '', ...said.map((t) => `- ${t}`), '');
    }
  }
  return out.join('\n');
}

// 1枚の引継ぎカード。見出しは固定し、空いた欄はその担当のAI社員が指摘する。中身は本人の言葉だけ。
export const HANDOVER = [
  { key: 'purpose', heading: 'この仕事は何のため', lens: 'misreading', ask: '受け取った人は、何のための仕事だと思うかな？' },
  { key: 'flow', heading: 'いつもの流れ', lens: 'first-timer', ask: '最初から最後まで、どの順番でやる？' },
  { key: 'decide', heading: '自分で決めていいこと／必ず聞くこと', lens: 'misreading', ask: 'どこまで任せて、どこから相談してほしい？' },
  { key: 'trouble', heading: '困ったら（問い合わせ・お金）', lens: 'money-ops', ask: '問い合わせや返金が来たら、誰がどうする？' },
  { key: 'keep', heading: '触ってはいけないもの・見せないもの', lens: 'breaker', ask: '消えたり漏れたりしたら困るものは？' },
  { key: 'tips', heading: '前任者のコツ', lens: 'first-timer', ask: 'やってみて分かった、書いておきたいことは？' },
];

export function applyHandover(book, input) {
  const cycle = book.cycles.find((c) => c.id === input.id);
  if (!cycle) throw new Error('この周回は見つかりません');
  const handover = cycle.handover ?? { card: {}, jobs: [], tests: [] };
  if (input.card) handover.card = Object.fromEntries(HANDOVER.map(({ key }) => [key, String(input.card[key] ?? '').trim().slice(0, 2000)]));
  if (input.jobs) handover.jobs = input.jobs.slice(0, 5).map((j) => String(j).slice(0, 200));
  if (input.test) handover.tests.push({
    at: new Date().toISOString(),
    stuck: input.test.filter((r) => r.result !== 'できた').length,
    results: input.test.map((r) => ({ job: String(r.job ?? ''), result: r.result === 'できた' ? 'できた' : '止まった', line: String(r.line ?? ''), why: String(r.why ?? ''), missing: String(r.missing ?? '') })),
  });
  cycle.handover = handover;
  return cycle;
}

export function handoverText(cycle) {
  const card = cycle.handover?.card ?? {};
  return [`# 引継ぎカード: ${cycle.project}`, '', ...HANDOVER.flatMap(({ key, heading }) => [`## ${heading}`, card[key] || '（空いています）', ''])].join('\n');
}

// 人間だけ帳。AI社員の誰も出さなかった本人の考え。AIでは補えない観点として、後任AIテストの仕事づくりに使う。
export function humanOnly(book) {
  return book.cycles.flatMap((c) => c.own
    .filter((o) => !c.items.some((i) => i.ownId === o.id))
    .map((o) => ({ text: o.text, project: c.project, cycleId: c.id })));
}

async function readInput(path) {
  if (!path) throw new Error('入力のJSONファイルを指定してください');
  return JSON.parse((await readFile(path, 'utf8')).replace(/^﻿/, ''));
}

async function main([command, arg]) {
  const file = notebookPath();
  const book = await load(file);
  if (command === 'hints') return { notebook: file, cycles: book.cycles.length, hints: hints(book), known: known(book) };
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
  if (command === 'manual') {
    const out = arg ?? join(dirname(file), 'manual.md');
    await writeFile(out, manual(book));
    return { manual: out };
  }
  if (command === 'handover') {
    const cycle = applyHandover(book, await readInput(arg));
    await save(book, file);
    return { id: cycle.id, stuck: summarize(cycle).stuck, card: handoverText(cycle) };
  }
  if (command === 'human') return { humanOnly: humanOnly(book) };
  throw new Error('使い方: notebook.mjs hints | stats | record <file.json> | update <file.json> | manual [out.md] | handover <file.json> | human');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2))
    .then((out) => console.log(JSON.stringify(out, null, 2)))
    .catch((e) => { console.error(e.message); process.exitCode = 1; });
}
