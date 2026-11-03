// 試験走行の結果を集計する。記憶あり（remember）と記憶なし（control）で、周回ごとの伸びと、伸びた観点を比べる。
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LENSES, stats } from '../plugin/skills/pdcaai/scripts/notebook.mjs';

const DIR = join(fileURLToPath(new URL('..', import.meta.url)), 'data', 'sim');

const files = (await readdir(DIR)).filter((f) => /-(remember|control)\.json$/.test(f));
const runs = await Promise.all(files.map(async (f) => {
  const [key, cond] = f.replace('.json', '').split('-');
  return { key, cond, book: JSON.parse(await readFile(join(DIR, f), 'utf8')) };
}));

const out = {};
for (const cond of ['remember', 'control']) {
  const group = runs.filter((r) => r.cond === cond);
  const n = Math.max(...group.map((r) => r.book.cycles.length));
  const perCycle = Array.from({ length: n }, (_, i) => {
    const s = group.map((r) => stats(r.book)[i]).filter(Boolean);
    const sum = (k) => s.reduce((t, x) => t + (x[k] ?? 0), 0);
    return { cycle: i + 1, personas: s.length, self: sum('self'), hint: sum('hint'), ai: sum('ai'), total: sum('total'), spread: sum('spread'), ownOnly: sum('ownOnly'), selfRate: Math.round((sum('self') / sum('total')) * 100) };
  });
  // 観点ごとの、前半（1〜2周）と後半（3〜4周）の自分で出せた割合。
  const byLens = Object.fromEntries(Object.entries(LENSES).map(([lens, name]) => {
    const rate = (from, to) => {
      const items = group.flatMap((r) => r.book.cycles.slice(from, to).flatMap((c) => c.items.filter((i) => i.lens === lens)));
      return items.length ? Math.round((items.filter((i) => i.status === 'self').length / items.length) * 100) : null;
    };
    return [name, { early: rate(0, 2), late: rate(2, 4) }];
  }));
  const lateSelf = group.flatMap((r) => r.book.cycles.slice(2).flatMap((c) => c.items.filter((i) => i.status === 'self').map((i) => ({ who: r.key, lens: LENSES[i.lens], item: i.item, pattern: i.pattern, quote: i.quote }))));
  const spread = group.flatMap((r) => r.book.cycles.flatMap((c) => c.own.filter((o) => o.phase === 'hint' && !c.items.some((i) => i.ownId === o.id)).map((o) => ({ who: r.key, text: o.text }))));
  out[cond] = { perCycle, byLens, lateSelf, spreadCount: spread.length, spreadSample: spread.slice(0, 8) };
}
console.log(JSON.stringify(out, null, 2));
