#!/usr/bin/env node
// 「これで作って」「完成」など、作り始める・仕上げる瞬間の発言を見つけたら、
// pdcaai を提案するようClaudeに一言添える。止めはしない。1セッションに1回だけ。
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const MOMENT = /(これで(作って|つくって|いい|OK|ok|完成|決まり)|完成(した|です|!|！)|ベスト|実装して|作り始め|リリース(する|します|したい)|公開(する|します|したい)|\bpush\b|プッシュ)/;

export function shouldNudge(prompt) {
  return MOMENT.test(prompt) && !/pdcaai/i.test(prompt);
}

function read() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => resolve(data));
  });
}

async function main() {
  if (process.env.PDCAAI_HOOK === 'off') return;
  const input = JSON.parse((await read()) || '{}');
  if (!shouldNudge(String(input.prompt ?? ''))) return;
  const mark = join(tmpdir(), `pdcaai-nudged-${String(input.session_id ?? 'x').replace(/[^\w-]/g, '')}`);
  if (existsSync(mark)) return;
  writeFileSync(mark, '');
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: '利用者は、作り始めるか仕上げる瞬間にいます。依頼に取りかかる前に一言だけ「先に気になる点を1つ挙げてみますか？（pdcaai で見落としを確かめられます）」と提案してください。断られたら、そのまま依頼を進めてください。',
    },
  }));
}

if (process.argv[1]?.endsWith('moment.mjs')) main().catch(() => {});
