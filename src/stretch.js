// カード版の「ストレッチャー」。AI社員4人の洗い出しと、本人の答えとの突き合わせ。
// 本人が書き終えるまで、AI社員の結果はブラウザへ送らない。
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LENSES, buildCycle, known, missedPatterns } from '../plugin/skills/pdcaai/scripts/notebook.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const LENS_MODEL = 'claude-sonnet-5-5';

// カードの表に出す、各AI社員の問いかけ。答えは見せずに、考える入口だけを渡す。
export const CARDS = {
  'first-timer': '初めて引き継ぐ人は、どこで止まりそう？',
  breaker: '法的に問題ない？リスクがない？',
  'money-ops': 'お金関連で問題が発生しない？',
  misreading: '利用者はどこで困りそう？',
};

export const ITEMS_SCHEMA = {
  type: 'object',
  properties: { items: { type: 'array', items: { type: 'object', properties: { item: { type: 'string' }, why: { type: 'string' }, check: { type: 'string' } }, required: ['item', 'why', 'check'], additionalProperties: false } } },
  required: ['items'],
  additionalProperties: false,
};
export const JUDGE_SCHEMA = {
  type: 'object',
  properties: { quotes: { type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, quote: { type: 'string' }, pattern: { type: 'string' } }, required: ['index', 'quote', 'pattern'], additionalProperties: false } } },
  required: ['quotes'],
  additionalProperties: false,
};
const RECALL_SCHEMA = {
  type: 'object',
  properties: { recalls: { type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, pattern: { type: 'string' } }, required: ['index', 'pattern'], additionalProperties: false } } },
  required: ['recalls'],
  additionalProperties: false,
};

export async function lensPrompt(lens) {
  const text = await readFile(join(ROOT, 'plugin', 'agents', `${lens}.md`), 'utf8');
  return `${text.replace(/^---[\s\S]*?---\s*/, '')}\n\n出力は items 配列に入れてください。`;
}

export async function runLenses(provider, description, seen = []) {
  const already = seen.length ? `\n\n前回までに出た項目（同じ論点は出さないでください）:\n${seen.map((s) => `- ${s}`).join('\n')}` : '';
  const out = await Promise.all(Object.keys(LENSES).map(async (lens) => {
    // 4人は並列で見るので、ほかの立場と重なる論点を避け、当てはまらなければ無理に出さないよう伝える。
    const others = Object.entries(LENSES).filter(([k]) => k !== lens).map(([, name]) => name).join('・');
    const note = `\n\nほかに${others}も同時に見ています。その人たちの担当と重なる論点は出さず、あなたの立場でしか気づけない所を優先してください。あなたの立場に当てはまる問題がなければ、無理に出さず少なくてかまいません（0件でもよい）。`;
    const res = await provider.generate({ system: await lensPrompt(lens), user: `作るものの説明:\n「${description}」${already}${note}`, schema: ITEMS_SCHEMA, effort: 'low', model: LENS_MODEL });
    return res.items.slice(0, 3).map((it) => ({ lens, ...it }));
  }));
  return out.flat();
}

export async function judge(provider, own, items) {
  if (!own.length) return { quotes: [] };
  return provider.generate({
    system: 'あなたは突き合わせの判定役です。AIが出した各検討事項について、本人の答えに同じ論点があるかを判定します。同じ論点なら本人の答えから一字一句そのままの引用を quote に入れます。同じ単語に触れただけなら同じ論点としません。迷ったら空文字にします。pattern には、その検討事項を題材に依存しない言い方の型で全角20字以内で書きます。',
    user: `本人の答え:\n${own.map((o, i) => `${i}: ${o.text}`).join('\n')}\n\nAIの検討事項:\n${items.map((it, i) => `${i}: ${it.item}（${it.why}）`).join('\n')}\n\nAIの検討事項すべてについて index と quote を返してください。`,
    schema: JUDGE_SCHEMA,
    effort: 'medium',
  });
}

// 本人の答えのうち、前に見落とした型と同じ論点に当たるもの。型は一覧から一字一句そのまま選ばせ、buildCycle で実在を確かめる。
export async function findRecalls(provider, own, patterns) {
  if (!own.length || !patterns.length) return { recalls: [] };
  return provider.generate({
    system: '本人の答えのうち、一覧にある「前に見落とした型」と同じ論点に当たるものを選びます。型は一覧から一字一句そのまま写します。同じ単語に触れただけなら選びません。迷ったら選びません。',
    user: `本人の答え:\n${own.map((o, i) => `${i}: ${o.text}`).join('\n')}\n\n前に見落とした型:\n${patterns.map((p) => `- ${p}`).join('\n')}`,
    schema: RECALL_SCHEMA,
    effort: 'medium',
  });
}

// AI社員の洗い出しは、本人が書いている間に裏で進める。
export function startStretch(provider, book, { project, summary }) {
  const description = `${project}。${summary ?? ''}`.trim();
  const pending = runLenses(provider, description, known(book).items);
  pending.catch(() => {});
  return pending;
}

export async function finishStretch(provider, book, { project, summary, confidenceBefore, own, pending }) {
  const items = await pending;
  const ownList = own.map((text) => ({ text, phase: 'free' }));
  const [judged, recalled] = await Promise.all([
    judge(provider, ownList, items),
    findRecalls(provider, ownList, missedPatterns(book).map((m) => m.pattern)),
  ]);
  const quoteOf = new Map(judged.quotes.map((q) => [q.index, q]));
  const recallOf = new Map(recalled.recalls.map((r) => [r.index, r.pattern]));
  return buildCycle({
    project,
    summary,
    confidenceBefore,
    mode: 'card',
    own: ownList.map((o, i) => (recallOf.has(i) ? { ...o, recalls: recallOf.get(i) } : o)),
    items: items.map((it, i) => ({ ...it, quote: quoteOf.get(i)?.quote ?? '', pattern: quoteOf.get(i)?.pattern ?? '' })),
  }, book);
}
