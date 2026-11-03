import test from 'node:test';
import assert from 'node:assert/strict';
import { PERSONAS, runCycle } from '../sim/run.mjs';

// 決まった答えを返す偽のClaude。どの段階で呼ばれたかを記録する。
function fakeProvider() {
  const calls = [];
  return {
    calls,
    async generate({ schema, user, model }) {
      const keys = Object.keys(schema.properties);
      if (keys.includes('answers')) {
        calls.push(user.includes('ヒント') ? 'hint' : 'free');
        return { answers: user.includes('ヒント') ? ['長い入力で崩れるかも'] : ['手順が多い'] };
      }
      if (keys.includes('items')) {
        calls.push(`lens:${model}`);
        return { items: [{ item: '長い入力で崩れる', why: 'x', check: 'y' }] };
      }
      calls.push('judge');
      return { quotes: [{ index: 1, quote: '長い入力で崩れる' }] };
    },
  };
}

test('試験走行は初回はヒントなしで回り、2回目はヒント後の答えをヒントでとして数える', async () => {
  const provider = fakeProvider();
  const book = { cycles: [] };
  const p = PERSONAS[0];
  const first = await runCycle({ provider, p, task: p.cases[0], book });
  assert.equal(first.hints.length, 0);
  assert.equal(provider.calls.filter((c) => c === 'hint').length, 0);
  assert.equal(provider.calls.filter((c) => c.startsWith('lens:claude-sonnet')).length, 4);
  assert.deepEqual(first.cycle.items.map((i) => i.status), ['ai', 'ai', 'ai', 'ai']);

  const second = await runCycle({ provider, p, task: p.cases[1], book });
  assert.ok(second.hints.length > 0);
  assert.deepEqual(second.cycle.items.map((i) => i.status), ['ai', 'hint', 'ai', 'ai']);
});
