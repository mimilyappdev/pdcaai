// APIキーもログインもない審査員がUIを試すための固定応答。AIの判断ではないことを画面に明示する。

export function mockResponse({ schema, system, user }) {
  const keys = Object.keys(schema.properties);
  if (keys.includes('assumptions')) {
    return {
      assumptions: [
        { text: '使う人は説明を読まなくても最初の操作が分かる', why_it_matters: '外れると価値が届く前に離脱します' },
        { text: '今の利用者の満足は、新しい相手にも当てはまる', why_it_matters: '外れると広げても伸びません' },
        { text: '代わりの手段より、乗り換える手間のほうが小さい', why_it_matters: '外れると買う理由がなくなります' },
      ],
    };
  }
  if (keys.includes('sealed_view')) {
    if (system.includes('初見の客')) {
      return {
        question: '説明を一切見ない人は、最初の30秒でどこで止まりますか？',
        target: '説明なしで使える',
        sealed_view: '作者は操作を知っているため、最初の迷いを確認できていません。',
        sealed_probe: '初見の人の最初の操作を1回観察します。',
      };
    }
    if (system.includes('数字番')) {
      return {
        question: '「好評」と言える根拠は、何人のうち何人の、いつの反応ですか？',
        target: '反応がよい',
        sealed_view: '声が届いた人だけを見ていて、離れた人の数が見えていません。',
        sealed_probe: '開始した人と完了した人の数を比べます。',
      };
    }
    return {
      question: 'あなたの作品を使わない人は、今どうやって困りごとを解決していますか？',
      target: '代わりがない',
      sealed_view: '競合は他のツールではなく、紙やメモ帳かもしれません。',
      sealed_probe: '使わなかった人に今の手段を1つ聞きます。',
    };
  }
  const answers = user.match(/<answers>([\s\S]*?)<\/answers>/)?.[1] ?? '';
  const line = (needle) =>
    answers.split('\n').find((l) => l.trim() && !l.startsWith('[') && needle.test(l))?.trim() ?? '';
  const own = answers.split('[自分で見つけた+10案]')[1]?.trim().split('\n')[0] ?? '';
  const doubted = line(/かもしれない|外れ|怪しい|思い込み/);
  const evidence = line(/\d+\s*(人|件|回)|数えて|観察|測/);
  return {
    doubted: { met: Boolean(doubted), evidence_quote: doubted, note: '自分の前提が外れる可能性を書いています' },
    evidence: { met: Boolean(evidence), evidence_quote: evidence, note: '確かめる数字に触れています' },
    self_found: { met: own.length >= 10, evidence_quote: own.length >= 10 ? own : '', note: '自分の案を具体的に書いています' },
    sealed_review: {
      newcomer: { self_reached: false, evidence_quote: '' },
      numbers: { self_reached: Boolean(evidence), evidence_quote: evidence },
      opponent: { self_reached: false, evidence_quote: '' },
    },
    next_gap: 'その改善で、いちばん困る人は誰ですか？',
  };
}
