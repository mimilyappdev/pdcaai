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

export function mockResponse({ schema, user }) {
  const keys = Object.keys(schema.properties);
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
