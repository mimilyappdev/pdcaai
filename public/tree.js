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

export const NOTE_TAGS = { self: '自分で見つけた', own: '自分で見つけた（AIも出さなかった）', spread: 'AIの指摘のあとで広がった', hint: 'AIの指摘に答えた', ai: 'AIだけ', skip: 'やらない', none: '作品・観点' };

// 観点帳を一本の木として配置する。周回ごとに幹が1段ずつ上へ伸び、各段からAI社員ごとの枝が左右に開く。
// 葉の形は区分ごとに変える（自分の考え=葉、AIの気づき=つぼみ、ヒントで広がった=花）。色が見分けにくい人にも区別できるように。
export const LEAF_SHAPE = { self: 'leaf', own: 'leaf', hint: 'leaf', spread: 'flower', ai: 'bud', skip: 'bud' };

// 前に見落とした型を、ヒントなしで自分で出せた答えかどうか。
function recalledBy(cycle, ownId) {
  const o = cycle.own.find((x) => x.id === ownId);
  return Boolean(o && o.phase === 'free' && o.recalls);
}

export function layoutGrowthTree(cycles, lensNames, { width = 380, segment = 170, margin = 40 } = {}) {
  const cx = width / 2;
  const height = margin * 2 + Math.max(cycles.length, 1) * segment + 30;
  const trunk = [];
  const canopy = [];
  const branches = [];
  const leaves = [];
  cycles.forEach((c, ci) => {
    const base = height - margin - ci * segment;
    const top = base - segment;
    // 幹は周回を重ねるほど下の段が太くなる（年輪のように）。
    canopy.push({ cycleId: c.id, cx, cy: base - segment * 0.55, rx: width / 2 - 14, ry: segment * 0.62 });
    trunk.push({ cycleId: c.id, label: `${ci + 1}周目`, project: c.project, x: cx, y1: base, y2: top, width: 4 + (cycles.length - ci) * 2.5 });
    const groups = Object.keys(lensNames)
      .map((lens) => ({ key: lens, label: lensNames[lens], items: c.items.filter((i) => i.lens === lens).map((i) => ({ ...i, tag: i.decision === 'skip' ? 'skip' : i.status, text: i.item, recalled: recalledBy(c, i.ownId) })) }))
      .filter((g) => g.items.length);
    const ownOnly = c.own.filter((o) => !c.items.some((i) => i.ownId === o.id));
    if (ownOnly.length) groups.push({ key: 'own', label: '自分だけ', items: ownOnly.map((o) => ({ id: o.id, tag: o.phase === 'hint' ? 'spread' : 'own', text: o.text, recalled: recalledBy(c, o.id) })) });
    groups.forEach((g, gi) => {
      // 左右交互に、下の枝ほど長く、上の枝ほど短く斜め上へ開く。
      const side = gi % 2 ? 1 : -1;
      const rank = Math.floor(gi / 2);
      const perSide = Math.ceil(groups.length / 2);
      const y0 = base - 18 - (rank / Math.max(perSide, 1)) * (segment - 40) - (side > 0 ? 14 : 0);
      const reach = (width / 2 - 62) * (1 - rank * 0.12);
      const x1 = cx + side * reach;
      const y1 = y0 - 42 - rank * 6;
      const qx = cx + side * reach * 0.42;
      const qy = y0 - 4;
      const branch = { id: `${c.id}/${g.key}`, cycleId: c.id, label: g.label, x0: cx, y0, qx, qy, x1, y1, side };
      branches.push(branch);
      g.items.forEach((it, k) => {
        // 葉は枝の先の半分に集め、枝の両側へ交互に付ける。
        const t = 0.45 + (0.55 * (k + 1)) / (g.items.length + 0.6);
        const px = (1 - t) ** 2 * cx + 2 * (1 - t) * t * qx + t ** 2 * x1;
        const py = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * qy + t ** 2 * y1;
        const lift = k % 2 ? 10 : -10;
        leaves.push({ id: `${c.id}/${it.id}`, cycleId: c.id, branchId: branch.id, lens: g.label, tag: it.tag, shape: LEAF_SHAPE[it.tag] ?? 'leaf', text: it.text, recalled: it.recalled, x: px, y: py + lift, angle: side * (-25 + (k % 2 ? 50 : 0)), order: ci * 100 + gi * 10 + k });
      });
    });
  });
  return { width, height, trunk, canopy, branches, leaves };
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
