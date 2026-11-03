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

export const NOTE_TAGS = { self: '自分で出せた', own: '自分だけ', spread: 'ヒントで広がった', hint: 'ヒントで', ai: 'AIで気づいた', skip: 'やらない', none: '作品・観点' };

// 観点帳の周回を古い順に受け取り、作品→観点→検討事項のツリーにする。次の周回の根は前の根の上に伸びる。
export function buildNotebookTree(cycles, lensNames) {
  const nodes = [];
  let previous = null;
  for (const c of cycles) {
    const add = (local, parent, kind, label, text, tag) => {
      nodes.push({ id: `${c.id}/${local}`, cycleId: c.id, local, parent: parent && (parent.includes('/') ? parent : `${c.id}/${parent}`), kind, label, text, tag });
    };
    const rate = c.items.length ? Math.round((c.items.filter((i) => i.status === 'self').length / c.items.length) * 100) : 0;
    add('root', previous, 'root', c.project, `最初の自信 ${c.confidenceBefore}% / 自分で出せた割合 ${rate}%`, 'none');
    for (const lens of Object.keys(lensNames)) {
      const items = c.items.filter((i) => i.lens === lens);
      if (!items.length) continue;
      add(lens, 'root', 'lens', lensNames[lens], `${items.length}件`, 'none');
      for (const i of items) {
        const own = c.own.find((o) => o.id === i.ownId);
        add(i.id, lens, 'item', i.item, [i.why, own ? `自分の言葉: ${own.text}` : '', i.check ? `確かめ方: ${i.check}` : ''].filter(Boolean).join('\n'), i.decision === 'skip' ? 'skip' : i.status);
      }
    }
    const ownOnly = c.own.filter((o) => !c.items.some((i) => i.ownId === o.id));
    if (ownOnly.length) {
      add('own', 'root', 'lens', '自分だけ', 'AIの観点役が出さなかったもの', 'none');
      ownOnly.forEach((o) => add(o.id, 'own', 'item', o.text, o.phase === 'hint' ? `${o.text}
（ヒントで広がった）` : o.text, o.phase === 'hint' ? 'spread' : 'own'));
    }
    previous = `${c.id}/root`;
  }
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
