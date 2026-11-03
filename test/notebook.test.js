import test from 'node:test';
import assert from 'node:assert/strict';
import { applyUpdate, buildCycle, hints, quoteIn, stats, summarize } from '../plugin/skills/pdcaai/scripts/notebook.mjs';
import { shouldNudge } from '../plugin/hooks/moment.mjs';

const input = (own, items, extra = {}) => ({ project: '引継ぎツール', confidenceBefore: 100, own, items, ...extra });
const item = (lens, quote = '') => ({ lens, item: `${lens}の項目`, why: '理由', check: '確かめ方', quote });

function addCycle(book, own, items) {
  const c = buildCycle(input(own, items), book);
  book.cycles.push(c);
  return c;
}

test('引用が本人の答えにあれば自分で、ヒント後の答えならヒントで、なければAIだけになる', () => {
  const book = { cycles: [] };
  const c = addCycle(book,
    [{ text: '前任者が辞めたあとに聞けない', phase: 'free' }, { text: '長い文章だと読まれない', phase: 'hint' }, { text: 'デザインが地味', phase: 'free' }],
    [item('misreading', '辞めたあとに聞けない'), item('breaker', '長い文章'), item('money-ops', '本人が言っていない文'), item('first-timer')]);
  assert.deepEqual(c.items.map((i) => i.status), ['self', 'hint', 'ai', 'ai']);
  const s = summarize(c);
  assert.deepEqual([s.total, s.self, s.hint, s.ai, s.ownOnly, s.selfRate], [4, 1, 1, 2, 1, 25]);
});

test('1つの答えはAIの1項目にしか一致せず、ヒント後の重ならない答えはヒントで広がったに数える', () => {
  const book = { cycles: [] };
  const c = addCycle(book,
    [{ text: '季節で仕込み量が変わる', phase: 'free' }, { text: '土日で締め日がずれる', phase: 'hint' }],
    [item('breaker', '季節で仕込み量'), item('misreading', '季節で仕込み量')]);
  assert.deepEqual(c.items.map((i) => i.status), ['self', 'ai']);
  const s = summarize(c);
  assert.deepEqual([s.ownOnly, s.spread], [0, 1]);
});

test('引用の確認は空白と全角半角の違いを無視し、1文字だけの引用は認めない', () => {
  assert.equal(quoteIn('Ｐ Ｄ Ｆ', 'PDFで渡す'), true);
  assert.equal(quoteIn('人', '前任の人'), false);
});

test('初回はヒントを出さず、見落とした観点は例つき、自分で出せるようになると消える', () => {
  const book = { cycles: [] };
  assert.deepEqual(hints(book), []);
  addCycle(book, [{ text: 'ない', phase: 'free' }], [item('breaker'), item('misreading')]);
  const first = hints(book);
  assert.deepEqual(first.map((h) => [h.lens, h.level]), [['breaker', 2], ['misreading', 2]]);
  assert.ok(first[0].text.includes('breakerの項目'));
  addCycle(book, [{ text: '極端に長い入力で崩れる', phase: 'free' }], [item('breaker', '極端に長い入力')]);
  assert.equal(hints(book).find((h) => h.lens === 'breaker').level, 1);
  addCycle(book, [{ text: '空の入力で落ちる', phase: 'free' }], [item('breaker', '空の入力')]);
  assert.equal(hints(book).some((h) => h.lens === 'breaker'), false);
});

test('ヒントで出せたものは、自分で出せた割合に入れない', () => {
  const book = { cycles: [] };
  addCycle(book, [{ text: '長い入力で崩れる', phase: 'hint' }], [item('breaker', '長い入力')]);
  assert.equal(hints(book)[0].level, 2);
  assert.equal(stats(book)[0].selfRate, 0);
});

test('見直した自信と、やるかどうかを記録し、不正な値は拒否する', () => {
  const book = { cycles: [] };
  addCycle(book, [], [item('breaker')]);
  applyUpdate(book, { id: 'c1', confidenceAfter: 70, decisions: { a1: 'do', a9: 'do' } });
  assert.deepEqual([book.cycles[0].confidenceAfter, book.cycles[0].items[0].decision], [70, 'do']);
  assert.throws(() => applyUpdate(book, { confidenceAfter: 120 }));
  assert.throws(() => buildCycle(input([], [item('unknown')]), book));
  assert.throws(() => buildCycle(input([], [], { confidenceBefore: -1 }), book));
});

test('作り始める・仕上げる瞬間の発言にだけフックが反応する', () => {
  assert.equal(shouldNudge('これで作って'), true);
  assert.equal(shouldNudge('完成した！pushお願い'), true);
  assert.equal(shouldNudge('この関数の意味を教えて'), false);
  assert.equal(shouldNudge('pdcaaiで完成を確かめたい'), false);
});
