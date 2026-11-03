// 思考ツリーの組み立てと配置。画面とテストの両方から使う、副作用のない処理だけを置く。

export const TAGS = { discovery: '発見', thought: '思考', pending: '保留', conclusion: '結論', none: '未分類' };

const AUTO_TAG = { assumption: 'pending', thought: 'thought', discovery: 'discovery', pending: 'pending' };

// sessions は古い周回から順に並んだ公開ビュー。
export function buildTree(sessions) {
  const nodes = [];
  let attach = null;
  sessions.forEach((s) => {
    const add = (local, parent, kind, label, text, autoTag) => {
      nodes.push({
        id: `${s.id}/${local}`,
        sessionId: s.id,
        local,
        parent: parent && (parent.includes('/') ? parent : `${s.id}/${parent}`),
        kind,
        label,
        text,
        autoTag,
        tag: s.tags?.[local] ?? autoTag,
        edited: Boolean(s.tags?.[local]),
      });
    };

    const first = s.messages.find((m) => m.role === 'user')?.text ?? '';
    add('root', attach, 'root', s.title || '話しはじめ', `${first}（自分の点数 ${s.confidenceBefore}）`, 'none');
    for (const n of s.nodes) add(n.id, n.parent, n.kind, n.label, n.text, AUTO_TAG[n.kind] ?? 'thought');
    for (const v of s.sealed) {
      if (s.check) add(v.id, v.parent, 'sealed', v.lens, v.view, v.reachedQuote ? 'discovery' : 'none');
      else add(v.id, v.parent, s.readyToOpen ? 'locked ready' : 'locked', '封印中', s.readyToOpen ? 'もう開けます。' : '話したあとで開きます。', 'none');
    }

    if (s.act) {
      add('act', s.nodes.at(-1)?.id ?? 'root', 'act', '実験', `${s.act.belief}: ${s.act.action}（外れの基準: ${s.act.signal}）`, 'thought');
      if (s.act.result) {
        const labels = { held: '前提は残った', broken: '前提は外れた', unclear: 'まだ不明' };
        add('result', 'act', 'result', labels[s.act.result.outcome], s.act.result.note, s.act.result.outcome === 'unclear' ? 'pending' : 'conclusion');
        attach = `${s.id}/result`;
      } else {
        attach = `${s.id}/act`;
      }
    } else {
      attach = `${s.id}/root`;
    }
  });
  return nodes;
}

// 根を下に置き、葉が上へ広がる配置。単位は枠。描画側でピクセルに変換する。
export function layoutTree(nodes) {
  const children = new Map();
  for (const n of nodes) {
    if (!children.has(n.parent)) children.set(n.parent, []);
    children.get(n.parent).push(n);
  }
  const placed = new Map();
  let leaf = 0;
  let maxDepth = 0;
  const visit = (node, depth) => {
    const kids = children.get(node.id) ?? [];
    maxDepth = Math.max(maxDepth, depth);
    let x;
    if (kids.length) {
      const xs = kids.map((k) => visit(k, depth + 1));
      x = (xs[0] + xs[xs.length - 1]) / 2;
    } else {
      x = leaf;
      leaf += 1;
    }
    placed.set(node.id, { ...node, x, depth });
    return x;
  };
  for (const root of children.get(null) ?? []) visit(root, 0);
  return { nodes: [...placed.values()], width: Math.max(leaf, 1), depth: maxDepth };
}
