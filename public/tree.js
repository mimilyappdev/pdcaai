// 思考ツリーの組み立てと配置。画面とテストの両方から使う、副作用のない処理だけを置く。

export const TAGS = { discovery: '発見', thought: '思考', pending: '保留', conclusion: '結論', none: '未分類' };

const ROLE_ORDER = ['newcomer', 'numbers', 'opponent'];

function quotedIn(check, text) {
  if (!check || !text) return false;
  const quotes = [
    check.doubted?.evidence_quote,
    check.evidence?.evidence_quote,
    check.self_found?.evidence_quote,
    ...ROLE_ORDER.map((r) => check.sealed_review?.[r]?.evidence_quote),
  ];
  const compact = (s) => s.replace(/\s+/g, '').replace(/＜/g, '<').replace(/＞/g, '>');
  return quotes.some((q) => q && compact(text).includes(compact(q)));
}

// sessions は古い周回から順に並んだ公開ビュー。drafts は入力中の回答で、最後の周回に重ねる。
export function buildTree(sessions, drafts = {}) {
  const nodes = [];
  let attach = null;
  sessions.forEach((s, index) => {
    const isLast = index === sessions.length - 1;
    const add = (local, parent, kind, label, text, autoTag) => {
      const id = `${s.id}/${local}`;
      nodes.push({
        id, sessionId: s.id, local, parent: parent && (parent.includes('/') ? parent : `${s.id}/${parent}`),
        kind, label, text, autoTag, tag: s.tags?.[local] ?? autoTag, edited: Boolean(s.tags?.[local]),
      });
      return id;
    };

    add('root', attach, 'root', s.work.name, `${s.work.belief}（自分の点数 ${s.confidenceBefore}）`, 'none');
    (s.assumptions ?? []).forEach((a, i) => add(`a${i + 1}`, 'root', 'assumption', `前提${i + 1}`, a.text, 'pending'));

    for (const role of ROLE_ORDER) {
      const r = s.reviewers?.[role];
      if (!r) continue;
      add(`q-${role}`, 'root', 'question', r.label, r.question, 'none');
      const answer = s.answers?.[role] ?? (isLast ? drafts[role] : '') ?? '';
      if (answer.trim()) {
        add(`ans-${role}`, `q-${role}`, 'answer', '自分の回答', answer, quotedIn(s.check, answer) ? 'discovery' : 'thought');
      }
      if (s.check) {
        add(`seal-${role}`, `ans-${role}`, 'sealed', '開封', r.sealed_view, 'none');
      } else {
        const hasAnswer = answer.trim();
        add(`seal-${role}`, hasAnswer ? `ans-${role}` : `q-${role}`, 'locked', '封印中', '回答が揃うと開きます。', 'none');
      }
    }

    const own = s.answers?.own_idea ?? (isLast ? drafts.own_idea : '') ?? '';
    if (own.trim()) add('own', 'root', 'own', '+10案', own, s.check?.self_found?.met ? 'discovery' : 'thought');

    if (s.act) {
      add('act', own.trim() ? 'own' : 'root', 'act', '実験', `${s.act.belief}: ${s.act.action}（外れの基準: ${s.act.signal}）`, 'thought');
      if (s.act.result) {
        const labels = { held: '前提は残った', broken: '前提は外れた', unclear: 'まだ不明' };
        attach = add('result', 'act', 'result', labels[s.act.result.outcome], s.act.result.note, s.act.result.outcome === 'unclear' ? 'pending' : 'conclusion');
      } else {
        attach = nodes.at(-1).id;
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
