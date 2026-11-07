// 後任AIテスト。引継ぎカード1枚だけを読んだ後任役のAIが、よくある仕事をやってみて、止まった場所を返す。
// 仕事は1回目に決めて固定し、カードを書き足すたびに同じ仕事で試す（止まった数を比べるため）。
import { handoverText, humanOnly } from '../plugin/skills/pdcaai/scripts/notebook.mjs';

const JOBS_SCHEMA = {
  type: 'object',
  properties: { jobs: { type: 'array', items: { type: 'string' } } },
  required: ['jobs'],
  additionalProperties: false,
};
const TEST_SCHEMA = {
  type: 'object',
  properties: { results: { type: 'array', items: { type: 'object', properties: {
    job: { type: 'string' }, result: { type: 'string', enum: ['できた', '止まった'] }, line: { type: 'string' }, why: { type: 'string' }, missing: { type: 'string' },
  }, required: ['job', 'result', 'line', 'why', 'missing'], additionalProperties: false } } },
  required: ['results'],
  additionalProperties: false,
};

export async function makeJobs(provider, cycle, book) {
  // 人間だけ帳は、同じ題材のものだけを使う（別の題材の観点が混ざらないように）。
  const human = humanOnly(book).filter((h) => h.cycleId === cycle.id).map((h) => h.text).slice(-10);
  const res = await provider.generate({
    system: 'あなたは引継ぎのテスト係です。この仕事を引き継いだ後任が、最初の1か月で出会いそうな具体的な仕事を3つ作ります。「人間だけ帳」（AIが出さず本人だけが出した観点）があれば、1つはそこから作ってください。1つの仕事は、誰から何を言われたかが分かる1文にします。仕事の文には、出典や【】などの印を付けません。',
    user: `仕事: ${cycle.project}。${cycle.summary ?? ''}\n\nAI社員が出した検討事項:\n${cycle.items.map((i) => `- ${i.item}`).join('\n') || '- なし'}\n\n人間だけ帳:\n${human.map((t) => `- ${t}`).join('\n') || '- なし'}`,
    schema: JOBS_SCHEMA,
    effort: 'low',
  });
  return res.jobs.slice(0, 3);
}

const MANUAL_SCHEMA = {
  type: 'object',
  properties: { manual: { type: 'string' } },
  required: ['manual'],
  additionalProperties: false,
};

// 引継ぎマニュアルの清書。AIは並べ替えと整えだけをして、カードにないことは足さない。
// 足していないことは、清書後にもう一度後任AIテストを回して、止まった数が変わらないことで確かめる。
export async function makeManual(provider, cycle) {
  const res = await provider.generate({
    system: 'あなたは清書係です。渡された引継ぎカード（資料と追記）を、新しく来た人が読む引継ぎマニュアルに整えます。してよいのは、並べ替え、見出しを付ける、同じことをまとめる、誤字と言い回しを直すことだけです。カードに書いていないことは1つも足しません（推測・一般論・注意書き・挨拶も足さない）。書き手の言葉はできるだけそのまま使います。資料と追記のどの行も落としません（同じことの重なりはまとめてよい）。追記の内容は、関係する見出しの中に入れます。問いの形の行や「決まっていない」「確認する」とある行は、決まりのように書き換えず、最後の「■ 決まっていないこと（確認する）」にまとめます。1行目は「引継ぎマニュアル：仕事の名前」。見出しは「■ 出勤したら」のように■で始まる短い1行、項目は「・」で始まる1行にします。#、-、*、**などの記号は使いません。見出しは、書き手の言葉から取った、現場で使う言い方にします。',
    user: handoverText(cycle),
    schema: MANUAL_SCHEMA,
    effort: 'medium',
  });
  return res.manual;
}

export async function successorTest(provider, cycle, jobs, text = handoverText(cycle)) {
  const res = await provider.generate({
    system: 'あなたは今日この仕事を引き継いだ後任です。渡された引継ぎカードに書いてあることだけで判断し、推測で補いません。各仕事について、カードだけで対応できたら「できた」、判断できなければ「止まった」とし、根拠または止まった行をカードからそのまま引用します。止まったときは missing に、前任者（カードを書く人）が決めて書くべきことを、問いの形で1文書きます（例:「濡れた本は、乾かす？司書に回す？」）。答えの例文や「〇〇」の穴埋め、選択肢を並べた下書きは書きません。できたときの missing は空にします。',
    user: `${text}\n\n仕事:\n${jobs.map((j, i) => `${i + 1}. ${j}`).join('\n')}`,
    schema: TEST_SCHEMA,
    effort: 'medium',
  });
  return jobs.map((job, i) => ({ ...res.results[i], job }));
}
