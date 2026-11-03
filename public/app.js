import { NOTE_TAGS, TAGS, buildTree, layoutGrowthTree, layoutTree } from '/tree.js';

const app = document.getElementById('app');
const treeBox = document.getElementById('tree');
const SVG_NS = 'http://www.w3.org/2000/svg';
const tree = { chain: [], selected: null, known: new Set() };

async function api(path, body) {
  const res = await fetch(`/api/${path}`, body === undefined ? {} : {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '通信に失敗しました');
  return data;
}

// 利用者の入力やAIの出力は textContent でのみ描画する。
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

function show(...nodes) {
  app.replaceChildren(...nodes.flat().filter(Boolean));
  app.focus({ preventScroll: true });
}

function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
}

function shortLabel(text) {
  return text.length > 7 ? `${text.slice(0, 6)}…` : text;
}

function renderTree() {
  if (!tree.chain.length) return drawTree(null);
  drawTree({
    nodes: buildTree(tree.chain),
    tags: TAGS,
    title: '思考ツリー',
    redraw: renderTree,
    detail: (selected) => (selected ? h('div', { class: 'detail' },
      h('b', {}, selected.label), h('p', {}, selected.text),
      selected.kind.startsWith('locked') ? null : h('label', {}, '自分の分類',
        h('select', {
          onchange: async (e) => {
            const updated = await api(`sessions/${selected.sessionId}/tags`, { node: selected.local, tag: e.target.value });
            tree.chain = tree.chain.map((s) => (s.id === updated.id ? updated : s));
            renderTree();
          },
        }, Object.entries(TAGS).map(([k, v]) => h('option', { value: k, selected: k === selected.tag }, v)))),
    ) : h('p', { class: 'muted' }, '丸を選ぶと内容を確認し、分類を直せます。')),
  });
}

// ツリー欄の描画。会話の思考ツリーと観点帳のツリーで共通に使う。
function drawTree(spec) {
  const shell = document.getElementById('shell');
  if (!spec) {
    treeBox.hidden = true;
    shell.classList.remove('with-tree');
    return;
  }
  treeBox.hidden = false;
  shell.classList.add('with-tree');
  const { nodes, width, depth } = layoutTree(spec.nodes);
  const cellX = 78;
  const cellY = 76;
  const w = Math.max(width * cellX, 320);
  const height = (depth + 1) * cellY + 24;
  const offset = (w - width * cellX) / 2;
  const pos = (n) => ({ x: offset + n.x * cellX + cellX / 2, y: height - 36 - n.depth * cellY });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const lines = nodes.filter((n) => byId.has(n.parent)).map((n) => {
    const a = pos(byId.get(n.parent));
    const b = pos(n);
    const my = (a.y + b.y) / 2;
    return svg('path', { d: `M${a.x} ${a.y} C${a.x} ${my} ${b.x} ${my} ${b.x} ${b.y}`, class: `edge edge-${n.tag}` });
  });
  const dots = nodes.map((n) => {
    const p = pos(n);
    const fresh = !tree.known.has(n.id);
    const name = `${n.label}: ${n.text}（${spec.tags[n.tag]}）`;
    const g = svg('g', {
      class: `node tag-${n.tag} kind-${n.kind}${fresh ? ' fresh' : ''}${tree.selected === n.id ? ' selected' : ''}`,
      transform: `translate(${p.x} ${p.y})`, tabindex: 0, role: 'button', 'aria-label': name,
    }, svg('title', {}, name), svg('circle', { r: n.kind === 'root' ? 13 : 10 }), svg('text', { y: 25, 'text-anchor': 'middle' }, shortLabel(n.label)));
    const pick = () => { tree.selected = n.id; spec.redraw(); };
    g.addEventListener('click', pick);
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    return g;
  });
  nodes.forEach((n) => tree.known.add(n.id));
  const legend = h('div', { class: 'legend' }, Object.entries(spec.tags).map(([k, v]) => h('span', { class: `chip tag-${k}` }, v)));
  const scroller = h('div', { class: 'tree-scroll' });
  scroller.append(svg('svg', { viewBox: `0 0 ${w} ${height}`, width: w, height, role: 'img', 'aria-label': spec.title }, ...lines, ...dots));
  const detail = spec.detail(byId.get(tree.selected));
  // 描き直しても位置を保ち、新しい枝が出たときだけそこへ移動する。
  const previous = treeBox.querySelector('.tree-scroll');
  const keep = previous ? [previous.scrollLeft, previous.scrollTop] : null;
  treeBox.replaceChildren(h('h2', {}, spec.title), legend, scroller, detail);
  const newest = [...scroller.querySelectorAll('.node.fresh')].at(-1);
  if (newest) newest.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  else if (keep) [scroller.scrollLeft, scroller.scrollTop] = keep;
}

function setChain(chain) {
  tree.chain = chain;
  renderTree();
}

function updateCurrent(view) {
  tree.chain = [...tree.chain.slice(0, -1), view];
  renderTree();
}

function percentField(label, name, value, min) {
  const out = h('output', {}, String(value));
  return h('label', {}, `${label} `, out,
    h('input', { type: 'range', name, min, max: 100, step: 5, value, oninput: (e) => { out.textContent = e.target.value; } }));
}

function field(label, name, { value = '', type = 'text', hint } = {}) {
  return h('label', {}, label, hint ? h('small', {}, hint) : null, h('input', { type, name, value, required: true, maxlength: 2000 }));
}

function form(onsubmit, ...children) {
  const err = h('p', { class: 'error', role: 'alert', hidden: true });
  const el = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const submit = el.querySelector('button[type=submit]');
      submit.disabled = true;
      err.hidden = true;
      try {
        await onsubmit(Object.fromEntries(new FormData(el)));
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
      } finally {
        submit.disabled = false;
      }
    },
  }, ...children, err);
  return el;
}

async function home() {
  setChain([]);
  const ledger = await api('ledger');
  const c = ledger.calibration;
  show(
    h('h1', {}, '「これで100点」を、\n話しながら110点へ。'),
    h('p', { class: 'lead' }, '一言ずつ話すだけで大丈夫です。話した内容は思考ツリーに育ち、Claudeの見立ては少し話してから開きます。'),
    h('p', {}, h('a', { class: 'button', href: '#/new' }, '話しはじめる'), ' ', h('a', { class: 'button ghost', href: '#/notebook' }, '観点帳を見る')),
    ledger.due.length ? h('section', { class: 'card due' },
      h('h2', {}, '結果を確かめる日です'),
      h('ul', { class: 'list' }, ledger.due.map((d) => h('li', {},
        h('a', { href: `#/s/${d.id}` }, d.name), h('div', { class: 'muted' }, `${d.belief}（確認日 ${d.checkDate}）`))))) : null,
    h('h2', {}, '思い込み台帳'),
    h('div', { class: 'stats' },
      stat(c.resolved, '確かめた前提'),
      stat(c.avgConfidence == null ? '-' : `${c.avgConfidence}%`, '当時の確信度'),
      stat(c.heldRate == null ? '-' : `${c.heldRate}%`, '実際に残った割合')),
    ledger.sessions.length
      ? h('ul', { class: 'list' }, ledger.sessions.map((s) => h('li', {},
        h('a', { href: `#/s/${s.id}` }, s.name), ` ${s.total}`,
        h('div', { class: 'muted' }, new Date(s.createdAt).toLocaleDateString('ja-JP'), s.act?.result ? ` / ${outcomeLabel(s.act.result.outcome)}` : ''))))
      : h('p', { class: 'muted' }, 'まだ記録はありません。記録はこのPCの中だけに保存します。'),
  );
}

function stat(value, label) {
  return h('div', { class: 'stat' }, h('b', {}, String(value)), h('span', {}, label));
}

function outcomeLabel(o) {
  return { held: '前提は残った', broken: '前提は外れた', unclear: 'まだ分からない' }[o];
}

function newSession(previousId, previousName) {
  if (!previousId) setChain([]);
  show(
    h('h2', {}, previousName ? `「${previousName}」の続きを話しましょう` : '最近「これで完成」と思ったものは？'),
    form(async (data) => {
      const s = await api('sessions', { confidenceBefore: Number(data.confidenceBefore), previousId });
      await api(`sessions/${s.id}/messages`, { text: data.text });
      location.hash = `#/s/${s.id}`;
    },
    h('label', {}, '一言で大丈夫です',
      h('small', {}, '入力はClaudeに送られます。個人情報と秘密情報は入れないでください'),
      h('textarea', { name: 'text', required: true, maxlength: 4000, placeholder: '例: 小説の入稿PDFを作るツール。機能は揃った気がする' })),
    percentField('今の自分の点数', 'confidenceBefore', 100, 0),
    h('button', { type: 'submit' }, '話しはじめる')),
  );
}

async function session(id) {
  const chain = await api(`sessions/${id}/chain`);
  setChain(chain);
  const s = chain.at(-1);
  if (s.act) return actDone(s);
  if (s.check) return openedView(s);
  return chatView(s);
}

function bubbles(messages) {
  return h('div', { class: 'chat', 'aria-live': 'polite' }, messages.flatMap((m) => [
    h('div', { class: `bubble ${m.role}` }, m.text),
    m.mirror ? h('div', { class: 'mirror' },
      h('span', { class: 'mirror-head' }, 'あなたの発言を並べると'),
      h('blockquote', {}, m.mirror.a),
      h('blockquote', {}, m.mirror.b),
      m.mirror.note ? h('p', {}, m.mirror.note) : null) : null,
  ]));
}

function chatView(start) {
  let s = start;
  const log = h('div');
  const err = h('p', { class: 'error', role: 'alert', hidden: true });
  const input = h('textarea', { rows: 2, maxlength: 4000, 'aria-label': 'Claudeへの返事', placeholder: '一言で大丈夫です（Ctrl+Enterで送信）' });
  const send = h('button', { type: 'button' }, '送る');
  const unknown = h('button', { type: 'button', class: 'ghost' }, 'わからない');
  const hint = h('button', { type: 'button', class: 'ghost' }, 'ヒント');
  const open = h('button', { type: 'button', class: 'ghost' }, '見立てを開く');
  const controls = [send, unknown, hint, open, input];

  const paint = (pending) => {
    const messages = pending ? [...s.messages, { role: 'user', text: pending }] : s.messages;
    log.replaceChildren(bubbles(messages), pending ? h('p', { class: 'waiting' }, 'Claudeが考えています') : '');
    const spoken = s.messages.filter((m) => m.role === 'user').length;
    open.hidden = spoken < 2;
    open.className = s.readyToOpen ? '' : 'ghost';
    window.scrollTo(0, document.body.scrollHeight);
  };
  const busy = (on) => controls.forEach((c) => { c.disabled = on; });
  const run = async (body, shown) => {
    busy(true);
    err.hidden = true;
    paint(shown);
    try {
      s = await api(`sessions/${s.id}/messages`, body);
      updateCurrent(s);
      if (body.text) input.value = '';
      paint();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      paint();
    } finally {
      busy(false);
      input.focus();
    }
  };
  const submit = () => { if (input.value.trim()) run({ text: input.value }, input.value.trim()); };
  send.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } });
  unknown.addEventListener('click', () => run({ mode: 'unknown' }, 'わからない'));
  hint.addEventListener('click', () => run({ mode: 'hint' }, 'ヒントちょうだい'));
  open.addEventListener('click', async () => {
    busy(true);
    err.hidden = true;
    log.append(h('p', { class: 'waiting' }, '見立てを開いています'));
    try {
      await api(`sessions/${s.id}/open`, {});
      await session(s.id);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      busy(false);
      paint();
    }
  });
  show(log, err, h('div', { class: 'composer' }, input, h('div', { class: 'row' }, send, unknown, hint, open)));
  paint();
}

function gauge(st) {
  return h('section', { class: 'gauge', 'aria-label': `今回の踏み込み ${st.total}` },
    h('div', { class: 'gauge-num' }, String(st.total), h('small', {}, ' / 110')),
    h('div', { class: 'gauge-bar' }, st.items.map((i) => h('i', { class: i.met ? 'on' : '' }))),
    h('p', { class: 'muted' }, '能力の点数ではありません。今回の発言と行動で踏み込めた項目の記録です。'),
  );
}

function proofList(st) {
  return h('ul', { class: 'proof' }, st.items.filter((i) => i.met).map((i) => h('li', {},
    h('b', { class: 'met' }, i.label), i.quote ? h('blockquote', {}, i.quote) : null)));
}

function viewCards(s) {
  return s.sealed.map((v) => h('div', { class: 'seal' },
    h('strong', {}, v.lens),
    v.reachedQuote ? h('span', { class: 'reached' }, '自分で話していました') : null,
    h('p', {}, v.view),
    h('p', {}, '確かめ方: ', v.probe)));
}

async function openedView(s) {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  const pad = (n) => String(n).padStart(2, '0');
  const week = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const actBox = h('div', {}, h('p', { class: 'waiting' }, '話した内容から実験の下書きを作っています'));
  show(
    bubbles(s.messages),
    h('h2', {}, '見立てを開きました'),
    viewCards(s),
    s.check.next_gap ? h('section', { class: 'card' }, h('h3', {}, 'まだ話していないこと'), h('p', {}, s.check.next_gap)) : null,
    gauge(s.stretch),
    h('section', { class: 'card' }, proofList(s.stretch)),
    h('h2', {}, '小さく試す'),
    actBox,
    h('p', {}, h('button', { class: 'ghost', type: 'button', onclick: () => continueFrom(s) }, '実験は決めずに続きを話す')),
  );
  const draftForm = (draft) => form(async (data) => {
    await api(`sessions/${s.id}/act`, { ...data, confidence: Number(data.confidence), confidenceAfter: Number(data.confidenceAfter) });
    await session(s.id);
  },
  h('p', { class: 'lead' }, 'Claudeの下書きです。自分の言葉に直して決めてください。'),
  field('確かめる前提', 'belief', { value: draft.belief }),
  field('30分以内に試すこと', 'action', { value: draft.action }),
  field('外れたと判断する基準', 'signal', { value: draft.signal }),
  percentField('今の自分の点数', 'confidenceAfter', s.confidenceBefore, 0),
  percentField('確かめる前提が正しい確信度', 'confidence', 80, 50),
  field('結果を確かめる日', 'checkDate', { type: 'date', value: week }),
  h('button', { type: 'submit' }, 'この実験を台帳に載せる'));
  try {
    actBox.replaceChildren(draftForm(await api(`sessions/${s.id}/propose`, {})));
  } catch {
    actBox.replaceChildren(h('p', { class: 'muted' }, '下書きを作れなかったので、直接書いてください。'), draftForm({ belief: '', action: '', signal: '' }));
  }
}

function continueFrom(s) {
  window.scrollTo(0, 0);
  newSession(s.id, s.title);
}

function actDone(s) {
  const a = s.act;
  const resultBlock = a.result
    ? h('section', { class: 'card' },
      h('h3', {}, `結果: ${outcomeLabel(a.result.outcome)}`),
      h('p', {}, a.result.note),
      h('p', {}, h('button', { class: 'ghost', type: 'button', onclick: () => continueFrom(s) }, 'この結果から次の周回へ')))
    : h('section', { class: 'card' }, h('h3', {}, '結果を記録する'), form(async (data) => {
      await api(`sessions/${s.id}/result`, data);
      await session(s.id);
    },
    h('div', { class: 'choice', role: 'group', 'aria-label': '結果' },
      ...[['held', '前提は残った'], ['broken', '前提は外れた'], ['unclear', 'まだ分からない']].map(([value, label], i) =>
        h('label', {}, h('input', { type: 'radio', name: 'outcome', value, required: i === 0 }), ` ${label}`))),
    h('br', {}),
    h('label', {}, '分かったこと', h('textarea', { name: 'note', required: true, maxlength: 2000 })),
    h('button', { type: 'submit' }, '記録する')));
  show(
    h('h2', {}, `「${s.title}」の周回`),
    gauge(s.stretch),
    h('section', { class: 'card shift' },
      h('h3', {}, '自分でつけた点数の変化'),
      h('p', { class: 'shift-num' }, `${s.confidenceBefore} → ${a.confidenceAfter}`)),
    h('section', { class: 'card' },
      h('h3', {}, '確かめる前提'), h('p', {}, `${a.belief}（確信度 ${a.confidence}%）`),
      h('h3', {}, '試すこと'), h('p', {}, a.action),
      h('h3', {}, '外れたと判断する基準'), h('p', {}, a.signal),
      h('p', { class: 'muted' }, `確認日 ${a.checkDate}`)),
    resultBlock,
    h('section', { class: 'card' }, proofList(s.stretch)),
    viewCards(s),
    h('p', {},
      a.result ? null : h('button', { class: 'ghost', type: 'button', onclick: () => continueFrom(s) }, 'この続きを話す'),
      ' ',
      h('a', { class: 'button ghost', href: '#/' }, '台帳へ戻る')),
  );
}

const LEAF_PATH = 'M-11 0 Q0 -8 11 0 Q0 8 -11 0Z';

function leafShape(shape) {
  if (shape === 'bud') return svg('circle', { r: 5.5 });
  if (shape === 'flower') {
    return svg('g', {}, ...[0, 72, 144, 216, 288].map((a) => svg('ellipse', { rx: 3.6, ry: 6, transform: `rotate(${a}) translate(0 -5)` })), svg('circle', { r: 2.6, class: 'pistil' }));
  }
  return svg('path', { d: LEAF_PATH });
}

// 観点帳を一本の木として描く。開くと幹→枝→葉の順に育つ。
function drawGrowthTree(cycles, lenses) {
  const shell = document.getElementById('shell');
  if (!cycles.length) {
    treeBox.hidden = true;
    shell.classList.remove('with-tree');
    return;
  }
  treeBox.hidden = false;
  shell.classList.add('with-tree');
  const { width, height, trunk, canopy, branches, leaves } = layoutGrowthTree(cycles, lenses);
  const crown = canopy.map((c) => svg('ellipse', { cx: c.cx, cy: c.cy, rx: c.rx, ry: c.ry, class: 'canopy' }));
  const detail = h('div', { class: 'detail' }, h('p', { class: 'muted' }, '葉・つぼみ・花を選ぶと内容を確認できます。下の根元から、周回ごとに上へ伸びます。'));
  const pick = (leaf) => detail.replaceChildren(h('b', {}, `${leaf.lens}・${NOTE_TAGS[leaf.tag]}`), h('p', {}, leaf.text));
  const ground = svg('path', { d: `M${width / 2 - 70} ${trunk[0].y1 + 2} Q${width / 2} ${trunk[0].y1 - 6} ${width / 2 + 70} ${trunk[0].y1 + 2}`, class: 'ground' });
  const trunkEls = trunk.flatMap((t, i) => [
    svg('line', { x1: t.x, y1: t.y1, x2: t.x, y2: t.y2, 'stroke-width': t.width, class: 'trunk', style: `animation-delay:${i * 0.5}s` }),
    svg('text', { x: 8, y: t.y1 - 8, class: 'ring' }, `${t.label}`),
  ]);
  const branchEls = branches.flatMap((b) => {
    const order = trunk.findIndex((t) => t.cycleId === b.cycleId);
    return [
      svg('path', { d: `M${b.x0} ${b.y0} Q${b.qx} ${b.qy} ${b.x1} ${b.y1}`, class: 'branch', pathLength: 1, style: `animation-delay:${order * 0.5 + 0.25}s` }),
      svg('text', { x: b.x1 + b.side * 6, y: b.y1 + 4, 'text-anchor': b.side > 0 ? 'start' : 'end', class: 'branch-label' }, b.label),
    ];
  });
  const leafEls = leaves.map((l) => {
    const name = `${l.lens}・${NOTE_TAGS[l.tag]}: ${l.text}`;
    const g = svg('g', { class: `leaf tag-${l.tag}`, transform: `translate(${l.x.toFixed(1)} ${l.y.toFixed(1)}) rotate(${l.angle})`, tabindex: 0, role: 'button', 'aria-label': name, style: `--delay:${(l.order / 100) * 0.5 + 0.55}s` }, svg('title', {}, name), leafShape(l.shape));
    g.addEventListener('click', () => pick(l));
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(l); } });
    return g;
  });
  const legend = h('div', { class: 'legend' },
    Object.entries(NOTE_TAGS).filter(([k]) => k !== 'none').map(([k, v]) => h('span', { class: `chip tag-${k}` }, v)),
    h('span', { class: 'muted shape-note' }, '葉=自分の考え / つぼみ=AIの気づき / 花=ヒントで広がった'));
  const scroller = h('div', { class: 'tree-scroll' });
  scroller.append(svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': '観点帳の木', class: 'growth-tree', style: `max-width:${width}px` }, ...crown, ground, ...trunkEls, ...branchEls, ...leafEls));
  treeBox.replaceChildren(h('h2', {}, '観点帳の木'), legend, scroller, detail);
  scroller.scrollTop = scroller.scrollHeight;
}

const LEVEL_LABEL = { 2: '補助輪 強（見落とした例を出す）', 1: '補助輪 弱（観点名だけ）' };

async function notebookView() {
  setChain([]);
  const { cycles, stats, hints, lenses } = await api('notebook');
  drawGrowthTree(cycles, lenses);
  const pctText = (v) => (v == null ? '-' : `${v}%`);
  show(
    h('h1', {}, '観点帳'),
    h('p', { class: 'lead' }, '自分で先に出した検討事項と、AIの観点役だけが出したものの記録です。自分で出せるようになった観点から、ヒント（補助輪）が外れていきます。'),
    cycles.length ? null : h('p', { class: 'muted' }, 'まだ記録はありません。Claude Code で pdcaai スキルを使うと、ここに積まれます。'),
    stats.length ? h('section', { class: 'card' },
      h('h2', {}, '周回ごとの伸び'),
      h('ul', { class: 'growth' }, stats.map((s) => h('li', {},
        h('div', { class: 'growth-head' }, h('b', {}, s.project), h('span', { class: 'muted' }, new Date(s.createdAt).toLocaleDateString('ja-JP'))),
        h('div', { class: 'bar', role: 'img', 'aria-label': `自分で出せた割合 ${pctText(s.selfRate)}` },
          h('span', { style: `width:${s.selfRate ?? 0}%` })),
        h('p', {}, `自分で ${s.self} / ヒントで ${s.hint} / AIだけ ${s.ai}（全${s.total}件、自分で出せた割合 ${pctText(s.selfRate)}）`, s.ownOnly ? ` / 自分だけ ${s.ownOnly}` : '', s.spread ? ` / ヒントで広がった ${s.spread}` : ''),
        h('p', { class: 'muted' }, `最初の自信 ${s.confidenceBefore}% → 見直し ${pctText(s.confidenceAfter)}　思い込みのズレ ${s.selfRate == null ? '-' : `${s.confidenceBefore - s.selfRate}pt`}`))))) : null,
    h('section', { class: 'card' },
      h('h2', {}, '補助輪の状態'),
      hints.length
        ? h('ul', { class: 'list' }, hints.map((x) => h('li', {}, h('b', {}, x.name), ` ${LEVEL_LABEL[x.level]}`, h('div', { class: 'muted' }, `この観点で自分で出せた割合 ${x.selfRate}%`))))
        : h('p', { class: 'muted' }, cycles.length ? '補助輪が必要な観点はありません。' : '初回はヒントなしで始めます。')),
    h('p', {}, h('a', { class: 'button ghost', href: '#/' }, '台帳へ戻る')),
  );
}

async function router() {
  const hash = location.hash || '#/';
  try {
    const m = hash.match(/^#\/s\/([\w-]+)$/);
    if (hash === '#/new') newSession();
    else if (hash === '#/notebook') await notebookView();
    else if (m) await session(m[1]);
    else await home();
  } catch (ex) {
    show(h('p', { class: 'error', role: 'alert' }, ex.message), h('a', { class: 'button ghost', href: '#/' }, '戻る'));
  }
}

api('meta').then(({ provider }) => {
  if (provider === 'mock') {
    const mode = document.getElementById('mode');
    mode.textContent = 'デモ: AIを使わない固定応答';
    mode.hidden = false;
  }
}).catch(() => {});
window.addEventListener('hashchange', router);
router();
