// 架空の引継ぎ案件で、ペルソナと観点役を自動で回す試験走行。
// 人間の伸びの証拠ではない。観点役の出し方、突き合わせの判定、ヒントを減らす仕組みの動作確認に使う。
// 結果は data/sim/ に保存し、本物の観点帳（~/.pdcaai/notebook.json）には混ぜない。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chooseProvider } from '../src/providers.js';
import { LENSES, buildCycle, hints, known, stats } from '../plugin/skills/pdcaai/scripts/notebook.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'data', 'sim');
const LENS_MODEL = 'claude-sonnet-5-5';
const PARALLEL = 6;

// 得意と苦手を持つペルソナ。苦手は観点役には伝えない。
export const PERSONAS = [
  {
    key: 'production',
    who: '食品工場の生産管理担当。現場歴20年。Excelで生産計画を回してきた',
    habit: '現場の段取りや機械の癖には詳しい。トラブル時の連絡先、費用、言葉の定義はあまり考えない',
    cases: ['定年前に、生産計画Excelの作り方を新人に引き継ぐ', '異動前に、原材料の発注ルールを別の工場の担当に引き継ぐ', '新ライン立ち上げ前に、品質検査の手順を派遣スタッフに引き継ぐ', '繁忙期前に、出荷調整のやり方をパートリーダーに引き継ぐ'],
  },
  {
    key: 'project',
    who: 'Web制作会社のプロジェクトマネージャー。受託案件を常に5件抱えている',
    habit: '進行管理と顧客とのやり取りには詳しい。システムが壊れる場面や、初めて関わる人の迷いはあまり考えない',
    cases: ['産休前に、進行中のECサイト改修案件を後輩PMに引き継ぐ', '退職前に、保守契約中の社内システム案件を外部の協力会社に引き継ぐ', '休職前に、Webサイトの月次更新作業をデザイナーに引き継ぐ', '部署異動前に、新規案件の見積もり作成を新人PMに引き継ぐ'],
  },
  {
    key: 'game',
    who: 'インディーゲームスタジオのディレクター。スマホゲームを2本運営している',
    habit: 'ゲームの面白さや演出には詳しい。お金の流れや運用の手間、言葉の解釈の違いはあまり考えない',
    cases: ['新作に専念するため、運営中ゲームの期間イベント運用を新人に引き継ぐ', '海外展開のため、ゲームのローカライズ作業を外部の翻訳者に引き継ぐ', '開発に専念するため、公式SNSの運用をコミュニティマネージャーに引き継ぐ', '契約終了前に、バグ報告の受付と整理を外部のQA会社に引き継ぐ'],
  },
  {
    key: 'indie',
    who: '個人開発者。小説や同人誌向けの小さなWebツールを複数運営している',
    habit: '画面の使いやすさや似たサービスとの比較には詳しい。極端な入力、決済や費用、作業範囲の決めごとはあまり考えない',
    cases: ['開発に集中するため、ツールの宣伝と更新告知を、Claudeを使えるマーケ担当に委託する', '問い合わせが増えたため、ツールのサポート対応を在宅のアシスタントに委託する', '体調を崩したため、ツールの不具合の一次切り分けを知人のエンジニアに引き継ぐ', '新作に集中するため、料金プラン変更の告知と問い合わせ対応を委託する'],
  },
  {
    key: 'accounting',
    who: '従業員15人の会社の経理担当。一人で経理を回してきた',
    habit: '数字の正確さと締め日には詳しい。初めての人がどこで迷うか、データが消えたときの戻し方はあまり考えない',
    cases: ['退職前に、月次決算の締め作業を後任に引き継ぐ', '育休前に、請求書の発行と入金確認を派遣スタッフに引き継ぐ', '産休前に、経費精算のチェックを総務の担当に引き継ぐ', '退職前に、年末調整の準備を税理士事務所と後任に引き継ぐ'],
  },
];

const ITEMS_SCHEMA = {
  type: 'object',
  properties: { items: { type: 'array', items: { type: 'object', properties: { item: { type: 'string' }, why: { type: 'string' }, check: { type: 'string' } }, required: ['item', 'why', 'check'], additionalProperties: false } } },
  required: ['items'],
  additionalProperties: false,
};
const OWN_SCHEMA = {
  type: 'object',
  properties: { answers: { type: 'array', items: { type: 'string' } } },
  required: ['answers'],
  additionalProperties: false,
};
const JUDGE_SCHEMA = {
  type: 'object',
  properties: { quotes: { type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, quote: { type: 'string' }, pattern: { type: 'string' } }, required: ['index', 'quote', 'pattern'], additionalProperties: false } } },
  required: ['quotes'],
  additionalProperties: false,
};

function limiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || !queue.length) return;
    active += 1;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => { active -= 1; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

async function lensPrompt(lens) {
  const text = await readFile(join(ROOT, 'plugin', 'agents', `${lens}.md`), 'utf8');
  return `${text.replace(/^---[\s\S]*?---\s*/, '')}\n\n出力は items 配列に入れてください。`;
}

// 人間が前回の振り返りを覚えている状態をまねる。直近の周回で見落とした型と、自分の強みだけを渡す。
export function memo(book) {
  const recent = book.cycles.slice(-3);
  const missed = [...new Set(recent.flatMap((c) => c.items.filter((i) => i.status !== 'self').map((i) => i.pattern || i.item)))].slice(-6);
  const strong = recent.flatMap((c) => c.own.filter((o) => !c.items.some((i) => i.ownId === o.id)).map((o) => o.text)).slice(-3);
  if (!missed.length && !strong.length) return '';
  return `\n前回までの振り返りで覚えていること（覚えている範囲で自然に使ってください）:\n見落としやすかった型: ${missed.join(' / ') || '(なし)'}\n自分だけが気づけたこと: ${strong.join(' / ') || '(なし)'}`;
}

function personaSystem(p, note = '') {
  return `あなたは次の人物として、短く自然に答えます。
人物: ${p.who}
考え方の癖: ${p.habit}
忙しい人なので、思いついたことだけを一言ずつ書きます。癖の範囲で思いつかないことは書きません。完璧な答えを作ろうとしないでください。${note}`;
}

export async function runCycle({ provider, p, task, book, run = (fn) => fn(), remember = false }) {
  const summary = `${p.who}が、${task}。`;
  const shown = hints(book);
  const note = remember ? memo(book) : '';
  const seen = known(book).items;
  const free = await run(() => provider.generate({
    system: personaSystem(p, note),
    user: `これから「${task}」ための引継ぎ資料を作ります。作る前に、気になっている点を思いつくだけ書いてください。0〜4個。1つ40字以内。`,
    schema: OWN_SCHEMA,
    effort: 'low',
  }));
  const lensOut = await Promise.all(Object.keys(LENSES).map((lens) => run(async () => {
    const already = seen.length ? `\n\n前回までに出た項目（同じ論点は出さないでください）:\n${seen.map((s) => `- ${s}`).join('\n')}` : '';
    const out = await provider.generate({ system: await lensPrompt(lens), user: `作るものの説明:\n「${summary}引継ぎ資料（マニュアル）を作る。」${already}`, schema: ITEMS_SCHEMA, effort: 'low', model: LENS_MODEL });
    return out.items.slice(0, 3).map((it) => ({ lens, ...it }));
  })));
  let later = { answers: [] };
  if (shown.length) {
    later = await run(() => provider.generate({
      system: personaSystem(p, note),
      user: `さっき挙げた点: ${free.answers.join(' / ') || '(なし)'}\n\n次のヒントを見て、ほかに思いついたら書いてください。なければ空の配列。0〜2個。1つ40字以内。\n${shown.map((h) => h.text).join('\n')}`,
      schema: OWN_SCHEMA,
      effort: 'low',
    }));
  }
  const own = [...free.answers.map((text) => ({ text, phase: 'free' })), ...later.answers.map((text) => ({ text, phase: 'hint' }))].filter((o) => o.text.trim());
  const items = lensOut.flat();
  const judged = own.length ? await run(() => provider.generate({
    system: 'あなたは突き合わせの判定役です。AIが出した各検討事項について、本人の答えに同じ論点があるかを判定します。同じ論点なら本人の答えから一字一句そのままの引用を quote に入れます。同じ単語に触れただけなら同じ論点としません。迷ったら空文字にします。pattern には、その検討事項を題材に依存しない言い方の型で全角20字以内で書きます。',
    user: `本人の答え:\n${own.map((o, i) => `${i}: ${o.text}`).join('\n')}\n\nAIの検討事項:\n${items.map((it, i) => `${i}: ${it.item}（${it.why}）`).join('\n')}\n\nAIの検討事項すべてについて index と quote を返してください。`,
    schema: JUDGE_SCHEMA,
    effort: 'medium',
  })) : { quotes: [] };
  const quoteOf = new Map(judged.quotes.map((q) => [q.index, q.quote]));
  const patternOf = new Map(judged.quotes.map((q) => [q.index, q.pattern]));
  const cycle = buildCycle({
    project: task,
    summary,
    confidenceBefore: 90,
    hintsShown: shown.map((h) => h.text),
    own,
    items: items.map((it, i) => ({ ...it, quote: quoteOf.get(i) ?? '', pattern: patternOf.get(i) ?? '' })),
  }, book);
  book.cycles.push(cycle);
  return { cycle, hints: shown };
}

// 振り返りを覚えている条件（remember）と、ヒントだけの条件（control）を同じ案件で比べる。
export function aggregate(runs) {
  const out = {};
  for (const cond of ['remember', 'control']) {
    const books = runs.filter((r) => r.cond === cond).map((r) => r.book);
    const n = Math.max(...books.map((b) => b.cycles.length));
    out[cond] = Array.from({ length: n }, (_, i) => {
      const s = books.map((b) => stats(b)[i]).filter(Boolean);
      const avg = (k) => Math.round((s.reduce((t, x) => t + (x[k] ?? 0), 0) / s.length) * 10) / 10;
      return { cycle: i + 1, selfRate: avg('selfRate'), self: avg('self'), hint: avg('hint'), spread: avg('spread'), ownOnly: avg('ownOnly'), total: avg('total') };
    });
  }
  return out;
}

async function main() {
  const provider = chooseProvider(process.argv.find((a) => a.startsWith('--provider='))?.split('=')[1]);
  const run = limiter(PARALLEL);
  await mkdir(OUT, { recursive: true });
  const started = Date.now();
  const jobs = PERSONAS.flatMap((p) => ['remember', 'control'].map((cond) => ({ p, cond })));
  const runs = await Promise.all(jobs.map(async ({ p, cond }) => {
    const book = { cycles: [] };
    for (const task of p.cases) {
      await runCycle({ provider, p, task, book, run, remember: cond === 'remember' });
      console.log(`[${p.key}/${cond}] ${task} 完了`);
    }
    await writeFile(join(OUT, `${p.key}-${cond}.json`), JSON.stringify(book, null, 2));
    return { key: p.key, cond, book };
  }));
  const summary = { seconds: Math.round((Date.now() - started) / 1000), provider: provider.name, average: aggregate(runs), personas: runs.map((r) => ({ key: r.key, cond: r.cond, stats: stats(r.book) })) };
  await writeFile(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary.average, null, 1));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((e) => { console.error(e); process.exitCode = 1; });
}
