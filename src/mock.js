// APIキーもログインもない審査員がUIを試すための固定応答。AIの判断ではないことを画面に明示する。

const REPLIES = [
  'なるほど。初めて見た人は、最初の画面で何をすると思いますか？',
  'そこは大事そうですね。実際に使ってくれた人の反応は、何か見ましたか？',
  'ありがとうございます。これを使わない人は、今どうしているんでしょう？',
  '聞けてよかったです。そろそろ見立てを開いても大丈夫です。',
];
const VIEWS = [
  { lens: '初見の客', view: '作者は操作を知っているため、最初の迷いを確認できていません。', probe: '初見の人の最初の操作を1回観察します。' },
  { lens: '数字番', view: '声が届いた人だけを見ていて、離れた人の数が見えていません。', probe: '開始した人と完了した人の数を比べます。' },
  { lens: '反対者', view: '競合は他のツールではなく、紙やメモ帳かもしれません。', probe: '使わなかった人に今の手段を1つ聞きます。' },
];

function userLines(user) {
  return (user.match(/<conversation>([\s\S]*?)<\/conversation>/)?.[1] ?? '')
    .split('\n')
    .filter((l) => l.startsWith('作り手: '))
    .map((l) => l.slice('作り手: '.length));
}

// カード版のストレッチャー用。AI社員の項目と突き合わせを、固定の内容で返す。
const STRETCH = {
  '初めて引き継ぐ': { item: '最初の画面で何をすればいいか書かれていない', why: '初めての人は最初の一手で止まりやすい。', check: '初見の人に画面だけ見せて、最初の操作までの時間を測る。' },
  '壊れる': { item: '途中で閉じると入力が消える', why: '長い入力ほど、消えたときの損が大きい。', check: '入力の途中で閉じて開き直し、残っているか確かめる。' },
  '運営担当': { item: '使う人が増えたときの費用が見積もられていない', why: '無料のまま増えると、費用だけがかさむ。', check: '10人と100人のときの月額を書き出す。' },
  '受け取る側': { item: '「完成」と言われても、受け取った人には何が終わったか分からない', why: '受け取る側は、何をすればいいか判断できない。', check: '完成の条件を3行で書き、別の人に読んでもらう。' },
};

function mockStretch(keys, system, user) {
  if (keys.includes('items')) {
    const hit = Object.entries(STRETCH).find(([k]) => system.includes(k));
    return { items: hit ? [hit[1]] : [] };
  }
  if (keys.includes('quotes')) {
    const own = (user.match(/本人の答え:\n([\s\S]*?)\n\n/)?.[1] ?? '').split('\n').map((l) => l.replace(/^\d+: /, ''));
    const items = (user.match(/AIの検討事項:\n([\s\S]*?)\n\n/)?.[1] ?? '').split('\n');
    // 本人の答えとAIの項目に同じ言葉があれば、その言葉を引用として返す。
    const word = (line) => ['費用', '消え', '最初', '完成'].find((w) => line.includes(w) && own.some((o) => o.includes(w)));
    return { quotes: items.map((line, index) => ({ index, quote: word(line) ?? '', pattern: '' })) };
  }
  return { recalls: [] };
}

// 後任AIテスト用。仕事ごとに見るカードの見出しを決めておき、その欄が空なら「止まった」にする。
const JOBS = [
  ['お客さんから「いつまでですか？」と聞かれた', 'いつもの流れ'],
  ['届いた品物が壊れていたと連絡が来た', '困ったら（問い合わせ・お金）'],
  ['提出済みのデータを差し替えたいと言われた', '自分で決めていいこと／必ず聞くこと'],
];

function mockSuccessor(user) {
  const section = (heading) => user.match(new RegExp(`## ${heading.replace(/[()（）／]/g, '.')}\\n(.*)`))?.[1] ?? '';
  return {
    results: JOBS.map(([job, heading]) => {
      const line = section(heading);
      const ok = line && line !== '（空いています）';
      return { job, result: ok ? 'できた' : '止まった', line: ok ? line : `${heading}（空いています）`, why: ok ? 'カードの行で判断できた。' : 'この欄が空いていて判断できない。', missing: ok ? '' : `「${heading}」に1行` };
    }),
  };
}

export function mockResponse({ schema, system = '', user }) {
  const keys = Object.keys(schema.properties);
  if (keys.includes('jobs')) return { jobs: JOBS.map(([job]) => job) };
  if (keys.includes('results')) return mockSuccessor(user);
  if (['items', 'quotes', 'recalls'].some((k) => keys.includes(k))) return mockStretch(keys, system, user);
  const lines = userLines(user);
  if (keys.includes('reply')) {
    const turn = lines.length - 1;
    const latest = lines.at(-1) ?? '';
    const asked = latest === 'ヒントちょうだい' || latest === 'わからない';
    return {
      reply: REPLIES[Math.min(turn, REPLIES.length - 1)],
      work_title: lines[0]?.slice(0, 12) ?? '',
      branches: asked ? [] : [{
        label: turn === 0 ? '思い込み' : '自分の考え',
        text: latest,
        quote: latest,
        parent: 'root',
        kind: turn === 0 ? 'assumption' : 'thought',
      }],
      new_sealed: VIEWS[turn] ? [VIEWS[turn]] : [],
      ready_to_open: turn >= 2,
      mirror: !asked && lines.length >= 3 ? { a: lines[0], b: latest, note: '並べるとどう見えますか？' } : { a: '', b: '', note: '' },
    };
  }
  if (keys.includes('next_gap')) {
    const find = (re) => lines.find((l) => re.test(l)) ?? '';
    const doubted = find(/かも|外れ|怪しい|思い込み/);
    const evidence = find(/\d+\s*(人|件|回)|数えて|自分だけ|見ていない/);
    const own = lines.find((l) => l.length >= 10 && l !== doubted && l !== evidence) ?? '';
    return {
      doubted: { met: Boolean(doubted), evidence_quote: doubted, note: '' },
      evidence: { met: Boolean(evidence), evidence_quote: evidence, note: '' },
      self_found: { met: Boolean(own), evidence_quote: own, note: '' },
      reached: [],
      new_view: [],
      next_gap: 'その変更で、いちばん困る人は誰ですか？',
    };
  }
  return { belief: '説明なしで使える', action: '初見の1人の最初の操作を観察する', signal: '30秒以内に最初の操作で止まる' };
}
