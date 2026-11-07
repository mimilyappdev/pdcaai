import { NOTE_TAGS, TAGS, buildTree, layoutGrowthTree, layoutTree } from '/tree.js';

const app = document.getElementById('app');
const treeBox = document.getElementById('tree');
const SVG_NS = 'http://www.w3.org/2000/svg';
const tree = { chain: [], selected: null, known: new Set() };

// 公開版（hosted）では、観点帳を各自のブラウザに置き、呼び出しのたびに送って更新後を受け取る。最初はカフェの見本から始まる。
let hosted = false;
const BOOK_KEY = 'pdcai-book';
const PASS_KEY = 'pdcai-pass';
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* 保存できない環境では、このタブの間だけ使う */ } },
};
let memoryBook = null;
async function myBook() {
  if (memoryBook) return memoryBook;
  const saved = store.get(BOOK_KEY);
  memoryBook = saved ? JSON.parse(saved) : await fetch('/sample-book.json').then((r) => r.json());
  return memoryBook;
}
function passcode() {
  let pass = store.get(PASS_KEY);
  if (!pass) { pass = (prompt('審査用の合言葉を入れてください') ?? '').trim(); store.set(PASS_KEY, pass); }
  return pass;
}

async function api(path, body) {
  if (hosted && path !== 'meta') body = { ...(body ?? {}), book: await myBook() };
  const res = await fetch(`/api/${path}`, body === undefined ? {} : {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(hosted ? { 'x-pdcai-pass': encodeURIComponent(passcode()) } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) store.set(PASS_KEY, '');
  if (!res.ok) throw new Error(data.error || '通信に失敗しました');
  if (data.book) { memoryBook = data.book; store.set(BOOK_KEY, JSON.stringify(data.book)); }
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
    h('p', {}, h('a', { class: 'button', href: '#/stretch' }, 'ストレッチャーを呼ぶ'), ' ', h('a', { class: 'button ghost', href: '#/new' }, '話しはじめる'), ' ', h('a', { class: 'button ghost', href: '#/notebook' }, '観点帳を見る')),
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
      h('a', { class: 'button ghost', href: '#/' }, '考えるへ')),
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
  const pick = (leaf) => detail.replaceChildren(...[h('b', {}, `${leaf.lens}・${NOTE_TAGS[leaf.tag]}`), leaf.recalled ? h('p', { class: 'recall-note' }, '前に見落とした型を、ヒントなしで自分で出せました') : null, h('p', {}, leaf.text)].filter(Boolean));
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
    const name = `${l.lens}・${NOTE_TAGS[l.tag]}${l.recalled ? '・前に見落とした型を自分で出せた' : ''}: ${l.text}`;
    const g = svg('g', { class: `leaf tag-${l.tag}${l.recalled ? ' recalled' : ''}`, transform: `translate(${l.x.toFixed(1)} ${l.y.toFixed(1)}) rotate(${l.angle})`, tabindex: 0, role: 'button', 'aria-label': name, style: `--delay:${(l.order / 100) * 0.5 + 0.55}s` }, svg('title', {}, name), leafShape(l.shape));
    g.addEventListener('click', () => pick(l));
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(l); } });
    return g;
  });
  const legend = h('div', { class: 'legend' },
    h('span', { class: 'chip tag-self' }, '自分で見つけた'), h('span', { class: 'chip tag-hint' }, 'AIの指摘に答えた'), h('span', { class: 'chip tag-ai' }, 'AIだけ'),
    h('span', { class: 'muted shape-note' }, '葉=自分の考え / つぼみ=AIの気づき / 花=ヒントで広がった / 金の縁=前に見落とした型を自分で出せた'));
  const scroller = h('div', { class: 'tree-scroll' });
  scroller.append(svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': '観点帳の木', class: 'growth-tree', style: `max-width:${width}px` }, ...crown, ground, ...trunkEls, ...branchEls, ...leafEls));
  treeBox.replaceChildren(h('h2', {}, '観点帳の木'), legend, scroller, detail);
  scroller.scrollTop = scroller.scrollHeight;
}

const LEVEL_LABEL = { 2: '補助輪 強（見落とした例を出す）', 1: '補助輪 弱（観点名だけ）' };
const WHEEL_LABEL = { 2: '強', 1: '弱', 0: '外れた' };
const day = (iso) => new Date(iso).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });

// 周回を横に並べ、人の考える力が伸びたかを数字で見せる。最初と最後を比べて「ここが伸びてますよ」を出す。
function growthTable(stats, lenses, reunions) {
  const rows = [
    ['AIと同じ点を、自分で先に出せた', (s) => s.self],
    ['AIの誰も出さなかった、自分だけの考え', (s) => s.ownOnly],
    ['ヒントのあとに広がった、自分だけの考え', (s) => s.spread],
    ['前に見落とした型を、ヒントなしで出せた', (s) => (s.recallBase ? `${s.recalled} / ${s.recallBase}` : '-')],
    ['AIだけが出した（見落とし）', (s) => s.ai],
    ...Object.entries(lenses).map(([lens, name]) => [`補助輪: ${name}`, (s) => WHEEL_LABEL[s.wheels[lens]] ?? '-']),
    ['後任AIテストで止まった数', (s) => (s.stuck.length ? s.stuck.join('→') : '-')],
    ['考える力の手応え', (s) => (s.feel == null ? '-' : FEEL.find(([v]) => v === s.feel)[1])],
  ];
  const first = stats[0];
  const last = stats.at(-1);
  const grew = [];
  if (stats.length > 1) {
    if (last.self > first.self) grew.push(`自分で先に出せた点 ${first.self} → ${last.self}`);
    if (last.ownOnly > first.ownOnly) grew.push(`自分だけの考え ${first.ownOnly} → ${last.ownOnly}`);
    if (last.recalled > 0) grew.push(`前に見落とした型を ${last.recallBase}個中 ${last.recalled}個、自分で出せた`);
    if (last.ai < first.ai) grew.push(`見落とし ${first.ai} → ${last.ai}`);
    const off = Object.entries(lenses).filter(([lens]) => first.wheels[lens] != null && last.wheels[lens] < first.wheels[lens]).map(([, name]) => name);
    if (off.length) grew.push(`補助輪が軽くなった: ${off.join('・')}`);
  }
  return h('section', { class: 'card' },
    h('h2', {}, `${stats.length}周の伸び`),
    h('div', { class: 'growth-scroll' }, h('table', { class: 'growth-table' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), stats.map((s, i) => h('th', {}, `${i + 1}周目`, h('div', { class: 'muted' }, day(s.createdAt)))))),
      h('tbody', {}, rows.map(([label, get]) => h('tr', {}, h('th', {}, label), stats.map((s) => h('td', {}, String(get(s))))))))),
    stats.length > 1
      ? h('p', { class: 'grew' }, grew.length ? `ここが伸びてますよ: ${grew.join('／')}` : 'まだ数字には出ていません。周回を重ねると見えてきます。')
      : h('p', { class: 'muted' }, '2周目から、ここに伸びが並びます。'),
    reunions.length ? h('div', {},
      h('h3', {}, '再会カード'),
      h('ul', { class: 'list' }, reunions.map((r) => h('li', { class: 'recall-note' },
        `${r.fromAt ? day(r.fromAt) : '前'}に見落とした「${r.pattern}」を、${day(r.at)}に自分で出せました（${lenses[r.lens] ?? ''}）`,
        h('div', { class: 'muted' }, `あなたの言葉:「${r.text}」`))))) : null);
}

// 周回ごとの棒グラフ。緑=自分で見つけた、オレンジ=AIの指摘に答えた、薄いオレンジ=AIだけ。
function cycleBars(stats) {
  const parts = (s) => [['c-self', s.self + s.ownOnly], ['c-answered', s.hint + s.spread], ['c-ai', s.ai]];
  const max = Math.max(...stats.map((s) => parts(s).reduce((n, [, v]) => n + v, 0)), 1);
  return h('section', { class: 'card' },
    h('h2', {}, '周回ごとの伸び'),
    h('div', { class: 'cycle-bars', role: 'img', 'aria-label': stats.map((s, i) => `${i + 1}周目 自分で${s.self + s.ownOnly} 答えた${s.hint + s.spread} AIだけ${s.ai}`).join('、') },
      stats.map((s, i) => h('div', { class: 'col' }, parts(s).map(([c, v]) => h('i', { class: c, style: `height:${(v / max) * 160}px;animation-delay:${i * 0.15}s` }))))),
    h('div', { class: 'cycle-caps' }, stats.map((s, i) => h('span', {}, `${i + 1}周目`))),
    h('p', { class: 'bar-key' }, h('i', { class: 'c-self' }), '自分で見つけた', h('i', { class: 'c-answered' }), 'AIの指摘に答えた', h('i', { class: 'c-ai' }), 'AIだけ'));
}

// 伸びを見る: 周回ごとのタイルの木を横に並べる。タイルは本人の言葉、葉の色は 緑=自分で見つけた／オレンジ=AIの指摘に答えた。
// 下の根元（題材）から上へ、1枚ずつ葉が開く。答えたタイルには、問いを出しためんだこの吹き出しを付ける。
// AIだけの項目はタイルにせず、木のてっぺんに薄い「芽」として出す（次に考える所）。
function tileTrees(cycles, lenses = {}) {
  const icon = (lens) => h('img', { src: `/img/mendako-${lens}.png`, alt: '' });
  const pairs = (list) => list.reduce((rows, x, i) => (i % 2 ? rows.at(-1).push(x) : rows.push([x]), rows), []);
  // 蔓は、その上の段の葉が開く少し前に、下から伸びる。
  const fork = (at) => svg('svg', { class: 'tt-fork', viewBox: '0 0 100 24', preserveAspectRatio: 'none', 'aria-hidden': 'true', style: `animation-delay:${Math.max(at, 0)}s` },
    svg('path', { d: 'M50 24 C50 10 25 14 25 0' }), svg('path', { d: 'M50 24 C50 10 75 14 75 0' }));
  const STEP = 0.3;
  return h('section', { class: 'card' },
    h('h2', {}, '思考の木（周回ごと）'),
    h('p', { class: 'tt-lead' }, 'この木は、①洗い出すで、AIの答えを見る前にあなたが書いたことの記録です。マニュアルではありません。'),
    h('p', { class: 'bar-key' }, h('i', { class: 'c-self' }), '自分で見つけた', h('i', { class: 'c-answered' }), 'AIの指摘に答えた', ' 💡=前に見落とした型を自分で出せた'),
    h('div', { class: 'tt-row' }, cycles.map((c, ci) => {
      let n = 0;
      const start = ci * 1.2;
      const delay = () => `animation-delay:${start + (n++) * STEP}s`;
      const vine = (row) => fork(start + row * 2 * STEP - 0.35);
      const top = start + c.own.length * STEP;
      const tile = (o) => {
        const asked = c.items.find((i) => i.ownId === o.id);
        const answered = o.phase === 'hint';
        return h('div', { class: `tt-tile ${answered ? 'answered' : 'self'}`, title: o.text, style: delay() },
          asked && answered ? h('div', { class: 'tt-ask', title: asked.item }, icon(asked.lens), h('span', {}, h('b', {}, lenses[asked.lens] ?? ''), asked.item)) : null,
          h('span', { class: 'tt-leaf' }), h('div', { class: 'tt-sq' }, o.recalls ? '💡 ' : '', o.text),
          asked && !answered ? h('div', { class: 'tt-same', title: asked.item }, icon(asked.lens), `${lenses[asked.lens] ?? 'めんだこ'}も同じ所を見ていた`) : null);
      };
      const buds = c.items.filter((i) => i.status === 'ai');
      const rows = pairs(c.own).map((row) => h('div', { class: 'tt-pair' }, row.map(tile)));
      return h('div', { class: 'tt-tree' },
        h('div', { class: 'tt-head' }, `${ci + 1}周目`, h('span', { class: 'muted' }, ` ${day(c.createdAt)}`)),
        h('div', { class: 'tt-apple', style: `animation-delay:${top + 0.2}s` }, '🍏', h('small', {}, `自分で見つけた ${c.own.filter((o) => o.phase !== 'hint').length}／AIの指摘に答えた ${c.own.filter((o) => o.phase === 'hint').length}`)),
        buds.length ? h('div', { class: 'tt-buds', style: `animation-delay:${top + 0.5}s` },
          h('small', {}, h('b', {}, `🌱 芽＝めんだこだけが見た所 ${buds.length}`), '（あなたはまだ出せていない。次に考える所）'),
          buds.map((i, k) => h('div', { class: 'tt-bud', title: i.item, style: `animation-delay:${top + 0.7 + k * 0.12}s` }, icon(i.lens), h('span', {}, i.item)))) : null,
        h('p', { class: 'tt-zone' }, h('b', {}, '🍃 葉＝あなたが先に考えたこと'), `（1枚＝1行、${c.own.length}枚）`),
        h('div', { class: 'tt-stack' }, rows.flatMap((r, i) => (i ? [vine(i), r] : [r])).reverse(), vine(0)),
        h('div', { class: 'tt-root' }, h('small', {}, '根＝題材'), c.project));
    })));
}

// 引継ぎの木（B案）: 後任AIテストの記録から「止まった → 店長に聞いた → 書き足した → 次はできた」を場面ごとにたどる。
// 下の1回目から上へ、書き足した回ごとに枝が伸びる。新しい記録は足さず、テスト結果（止まった理由・足りない1行・できた根拠）だけで組み立てる。
function handoverTree(cycle) {
  const tests = (cycle.handover?.tests ?? []).filter((t) => t.scenes !== 'unseen');
  if (tests.length < 2) return null;
  const n = tests[0].results.length;
  // できた根拠の行のうち、いちばん新しい追記を「書き足した行」とみなす。
  const added = (line) => {
    const parts = line.split('／').map((x) => x.trim()).filter(Boolean);
    const num = (x) => Number((x.match(/追記(\d+)/) ?? [])[1] ?? 0);
    return parts.reduce((a, b) => (num(b) > num(a) ? b : a), parts[0] ?? line);
  };
  const short = (job) => job.replace(/。.*$/, '');
  const fixes = [];
  const fine = [];
  const left = [];
  for (let j = 0; j < n; j++) {
    const rs = tests.map((t) => t.results[j]);
    if (rs.every((r) => r.result === 'できた')) { fine.push({ j, job: rs[0].job }); continue; }
    for (let k = 1; k < rs.length; k++) {
      if (rs[k - 1].result !== 'できた' && rs[k].result === 'できた') {
        let from = k - 1;
        while (from > 0 && rs[from - 1].result !== 'できた') from--;
        fixes.push({ j, job: rs[0].job, from: from + 1, round: k + 1, why: rs[k - 1].why, missing: rs[k - 1].missing, line: added(rs[k].line) });
      }
    }
    if (rs.at(-1).result !== 'できた') left.push({ j, job: rs[0].job, why: rs.at(-1).why });
  }
  // 下の回から順に枝が伸びるよう、回の早い順に出る順番を決める。
  const STEP = 0.35;
  fixes.sort((a, b) => a.round - b.round || a.j - b.j).forEach((f, i) => { f.order = i; });
  const branch = (f) => {
    const at = 0.4 + f.order * 4 * STEP;
    const box = (cls, label, text, i) => h('div', { class: `ht-box ${cls}`, title: text, style: `animation-delay:${at + i * STEP}s` }, h('b', {}, label), h('span', {}, text));
    return h('div', { class: 'ht-branch' },
      box('scene', `場面${f.j + 1}`, short(f.job), 0),
      box('stuck', f.from === f.round - 1 ? `${f.from}回目 止まった` : `${f.from}〜${f.round - 1}回目 止まった`, f.why, 1),
      box('ask', '足りなかったこと（店長に聞く）', f.missing, 2),
      box('leaf', `書き足した → ${f.round}回目はできた`, f.line, 3));
  };
  const rounds = tests.map((t, i) => ({ round: i + 1, stuck: t.stuck, fixes: fixes.filter((f) => f.round === i + 1) }));
  const last = tests.at(-1);
  // 初めての場面: 前のカードで人間もAIも止まった場面を、あなたの言葉（店長への問い）と最終稿の結果でたどる。
  const fresh = (cycle.handover.tests ?? []).find((t) => t.scenes === 'unseen' && t.before?.scenes);
  const freshAt = 0.4 + fixes.length * 4 * STEP + 0.8;
  const freshBranch = (b, i) => {
    const r = fresh.results[b.index];
    const at = freshAt + i * 4 * STEP;
    const box = (cls, label, text, k) => h('div', { class: `ht-box ${cls}`, title: text, style: `animation-delay:${at + k * STEP}s` }, h('b', {}, label), h('span', {}, text));
    const ok = r.result === 'できた';
    return h('div', { class: 'ht-branch' },
      box('scene', `場面${b.index + 1}`, short(r.job), 0),
      box('stuck', '止まった（後任AI）', b.ai.replace(/^止まった。/, ''), 1),
      box('ask you', 'あなたも止まって、店長に聞いた', `「${b.human}」`, 2),
      ok ? box('leaf', '店長が決めて書き足した → 最終稿はできた', added(r.line), 3)
        : box('right', '最終稿でも止まる＝店長に聞くのが正解', r.line || r.why, 3));
  };
  return h('section', { class: 'card ht' },
    h('h2', {}, '引継ぎの木（止まった → 店長に聞いた → 書き足した）'),
    h('p', { class: 'tt-lead' }, '後任役のAIが、カードだけを読んで同じ8場面を試した記録です。止まった場面を店長に聞き、答えをカードに書き足すと、次の回で止まらなくなりました。下の1回目から上へ育ちます。'),
    h('p', { class: 'muted' }, `題材: ${cycle.project}`),
    fresh ? h('div', { class: 'ht-fresh' },
      h('div', { class: 'ht-round' },
        h('div', { class: 'ht-ring fresh' }, h('b', {}, '初めての8場面'), h('span', {}, `あなた ${fresh.before.human}・AI ${fresh.before.ai} → 最終稿 AI ${fresh.stuck}`)),
        h('div', { class: 'ht-branches' }, fresh.before.scenes.map(freshBranch)))) : null,
    last.stuck === 0 ? h('div', { class: 'ht-top', style: `animation-delay:${0.4 + fixes.length * 4 * STEP}s` }, '🍏', h('small', {}, `${tests.length}回目: 同じ8場面はすべてできた`)) : null,
    h('div', { class: 'ht-trunk' }, rounds.slice().reverse().map((r) => h('div', { class: 'ht-round' },
      h('div', { class: 'ht-ring' }, h('b', {}, `${r.round}回目`), h('span', {}, `止まった ${r.stuck}`)),
      h('div', { class: 'ht-branches' }, r.fixes.length ? r.fixes.map(branch) : h('p', { class: 'muted ht-none' }, r.round === 1 ? '最初のカード' : '（止まらなくなった場面なし）'))))),
    h('div', { class: 'ht-root' },
      h('small', {}, '根＝最初から止まらなかった場面'),
      h('ul', {}, fine.map((f) => h('li', {}, `場面${f.j + 1} ${short(f.job)}`)))),
    left.length ? h('p', { class: 'muted' }, `まだ止まる場面: ${left.map((f) => `場面${f.j + 1}`).join('、')}`) : null);
}

async function notebookView() {
  setChain([]);
  const { cycles, stats, hints, lenses, humanOnly, reunions } = await api('notebook');
  drawGrowthTree([], lenses);
  document.getElementById('shell').classList.toggle('wide', cycles.length > 0);
  const pctText = (v) => (v == null ? '-' : `${v}%`);
  show(
    h('h1', {}, '伸びを見る'),
    h('p', { class: 'lead' }, '自分で先に出した検討事項と、AI社員だけが出したものの記録です。自分で出せるようになった観点から、ヒント（補助輪）が外れていきます。'),
    cycles.length ? null : h('p', { class: 'muted' }, 'まだ記録はありません。Claude Code で pdcaai スキルを使うと、ここに積まれます。'),
    cycles.length ? tileTrees(cycles, lenses) : null,
    ...cycles.map(handoverTree),
    stats.length ? cycleBars(stats) : null,
    stats.length ? growthTable(stats, lenses, reunions) : null,
    stats.length ? h('section', { class: 'card' },
      h('h2', {}, '周回ごとの伸び'),
      h('ul', { class: 'growth' }, stats.map((s) => h('li', {},
        h('div', { class: 'growth-head' }, h('b', {}, s.project), h('span', { class: 'muted' }, new Date(s.createdAt).toLocaleDateString('ja-JP'))),
        h('div', { class: 'bar', role: 'img', 'aria-label': `自分で出せた割合 ${pctText(s.selfRate)}` },
          h('span', { style: `width:${s.selfRate ?? 0}%` })),
        h('p', {}, `自分で ${s.self} / ヒントで ${s.hint} / AIだけ ${s.ai}（全${s.total}件、自分で出せた割合 ${pctText(s.selfRate)}）`, s.ownOnly ? ` / 自分だけ ${s.ownOnly}` : '', s.spread ? ` / ヒントで広がった ${s.spread}` : ''),
        s.recalled ? h('p', { class: 'recall-note' }, `前に見落とした型を、ヒントなしで自分で出せた ${s.recalled}`) : null,
        h('p', { class: 'muted' }, `${s.mode === 'card' ? 'カード' : 'スキル'}で回した`, s.feel == null ? '' : `　考える力の手応え: ${FEEL.find(([v]) => v === s.feel)[1]}`),
        h('p', { class: 'muted' }, `最初の自信 ${s.confidenceBefore}% → 見直し ${pctText(s.confidenceAfter)}　思い込みのズレ ${s.selfRate == null ? '-' : `${s.confidenceBefore - s.selfRate}pt`}`),
        h('p', {}, s.stuck.length ? h('span', { class: 'stuck-trend' }, `後任AIテストで止まった数 ${s.stuck.join(' → ')} `) : null,
          h('a', { href: `#/handover/${s.id}` }, s.stuck.length ? '引継ぎカードを開く' : '引継ぎカードを書く')))))) : null,
    humanOnly.length ? h('section', { class: 'card' },
      h('h2', {}, '人間だけ帳'),
      h('p', { class: 'muted' }, 'AI社員4人の誰も出さなかった、あなたの考えです。後任AIテストの仕事づくりに使います。'),
      h('ul', { class: 'list note-own' }, humanOnly.map((x) => h('li', {}, x.text, h('div', { class: 'muted' }, x.project))))) : null,
    h('section', { class: 'card' },
      h('h2', {}, '補助輪の状態'),
      hints.length
        ? h('ul', { class: 'list' }, hints.map((x) => h('li', {}, h('b', {}, x.name), ` ${LEVEL_LABEL[x.level]}`, h('div', { class: 'muted' }, `この観点で自分で出せた割合 ${x.selfRate}%`))))
        : h('p', { class: 'muted' }, cycles.length ? '補助輪が必要な観点はありません。' : '初回はヒントなしで始めます。')),
    h('p', {}, h('a', { class: 'button ghost', href: '#/' }, '考えるへ')),
  );
}

// カード版のストレッチャー。「これで完璧」と思った瞬間に4人のAI社員が現れ、
// 先に自分で「足りないもの」を考えてから、カードをめくって答え合わせをする。
const FEEL = [[-2, '下がった'], [-1, '少し下がった'], [0, '変わらない'], [1, '少し上がった'], [2, '上がった']];
const ITEM_LABEL = { self: '自分でも出せた', hint: 'ヒントで出せた', ai: 'AI社員だけ' };

// AI社員4人は、作者が描いためんだこ。全員オレンジで、持ち物で見分ける。
function mendako(lens, size = 100) {
  return h('img', { class: 'mendako', src: `/img/mendako-${lens}.png`, alt: '', width: size, height: Math.round(size * 0.77) });
}

// AIの返事待ち。考え中のめんだこを出す。
function thinking(text) {
  return h('div', { class: 'thinking', role: 'status' }, h('img', { src: '/img/mendako-thinking.png', alt: '' }), h('span', { class: 'waiting' }, text));
}

function stretchCard(card, back) {
  return h('div', { class: `stretch-card lens-${card.lens}` },
    h('div', { class: 'stretch-inner' },
      h('div', { class: 'stretch-face front', 'aria-hidden': back ? 'true' : null },
        mendako(card.lens),
        h('b', { class: 'stretch-name' }, card.name),
        h('p', {}, card.question)),
      h('div', { class: 'stretch-face back', 'aria-hidden': back ? null : 'true' },
        h('b', { class: 'stretch-name' }, card.name),
        back ?? null)));
}

// .docx は zip なので、本文（word/document.xml）だけをブラウザの中で取り出して段落ごとの文にする。
async function docxText(buf) {
  const v = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let end = buf.byteLength - 22;
  while (end >= 0 && v.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('Wordのファイルを読めませんでした');
  let p = v.getUint32(end + 16, true);
  for (let i = v.getUint16(end + 10, true); i > 0; i--) {
    const nameLen = v.getUint16(p + 28, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
    if (name === 'word/document.xml') {
      const local = v.getUint32(p + 42, true);
      const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      const raw = u8.subarray(start, start + v.getUint32(p + 20, true));
      const data = v.getUint16(p + 10, true) === 0 ? raw
        : await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
      const xml = new DOMParser().parseFromString(new TextDecoder().decode(data), 'application/xml');
      return [...xml.getElementsByTagNameNS('*', 'p')].map((para) => [...para.getElementsByTagNameNS('*', 't')].map((t) => t.textContent).join('')).join('\n').trim();
    }
    p += 46 + nameLen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
  }
  throw new Error('Wordのファイルに本文が見つかりませんでした');
}

// 資料の文を貼る欄と、ファイルから読み込むボタン。読み込んだ文は欄に入るので、送る前に見て直せる。
function docField(label, name, max) {
  const area = h('textarea', { name, rows: 8, maxlength: max });
  const status = h('small', { class: 'muted', 'aria-live': 'polite' });
  const pick = h('input', { type: 'file', accept: '.txt,.md,.docx', hidden: true, onchange: async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = file.name.toLowerCase().endsWith('.docx') ? await docxText(await file.arrayBuffer()) : await file.text();
      area.value = text.slice(0, max);
      status.textContent = `${file.name} を読み込みました${text.length > max ? `（${max}字までにしました）` : ''}`;
    } catch (ex) {
      status.textContent = ex.message;
    }
    e.target.value = '';
  } });
  return h('label', {}, label, h('small', {}, '文章を貼り付けるか、ファイルを読み込みます（.txt .md .docx）'), area,
    h('span', { class: 'doc-pick' }, h('button', { type: 'button', class: 'ghost', onclick: () => pick.click() }, '資料をアップロード'), pick, status));
}

function stretchView() {
  setChain([]);
  show(
    h('h1', {}, 'ストレッチャーを呼ぶ'),
    h('p', { class: 'lead' }, 'PDCAIで引き継ぎの抜け漏れを防いで、思考力を上げよう！'),
    h('p', {}, '「資料できた！」と思ったら、めんだこAI達を呼びます。自分でも足りないものを考えて、仕事を引き継いだめんだこ達がこの資料で動けたか見てみましょう。'),
    form(async (v) => {
      app.append(thinking('めんだこたちが集まっています'));
      const input = { project: v.project, summary: v.summary, confidenceBefore: Number(v.confidence) };
      const st = { ...await api('stretch', input), input };
      stretchThink(st);
    },
    field('作るもの', 'project', { hint: '例：カフェの予約の方法' }),
    docField('いつもの流れ', 'summary', 8000),
    percentField('今の自信（%）', 'confidence', 80, 0),
    h('button', { type: 'submit' }, 'ストレッチャー登場')),
  );
}

function stretchThink(st) {
  show(
    h('h1', {}, '本当にこれで引き継げるのかな？'),
    h('p', { class: 'lead' }, '4人のカードを見て、思いついたことを書いてください。1行に1つ。なければ空のままで大丈夫です。'),
    thinking('めんだこたちも、裏で考え中'),
    h('div', { class: 'stretch-grid' }, st.cards.map((c) => stretchCard(c))),
    form(async (v) => {
      const own = v.own.split('\n').map((s) => s.trim()).filter(Boolean);
      app.append(thinking('めんだこたちが、あなたの答えと突き合わせています'));
      const out = await api(`stretch/${st.id}/answer`, { own, stretch: st.input });
      st.input.cycleId = out.cycle.id;
      stretchReveal(st, out);
    },
    h('label', {}, '足りないと思うこと', h('textarea', { name: 'own', rows: 6, maxlength: 3000 })),
    h('button', { type: 'submit' }, 'カードをめくる')),
  );
}

function stretchReveal(st, { cycle, summary }) {
  const ownText = new Map(cycle.own.map((o) => [o.id, o.text]));
  const backOf = (lens) => {
    const items = cycle.items.filter((i) => i.lens === lens);
    return items.length
      ? h('ul', { class: 'stretch-items' }, items.map((i) => h('li', { class: `note-${i.status}` },
        h('small', {}, ITEM_LABEL[i.status]), h('div', {}, i.item),
        i.ownId ? h('div', { class: 'muted' }, `あなたの言葉:「${ownText.get(i.ownId)}」`) : h('div', { class: 'muted' }, `確かめ方: ${i.check}`))))
      : h('p', { class: 'muted' }, '指摘なし');
  };
  const mine = cycle.own.filter((o) => !cycle.items.some((i) => i.ownId === o.id));
  const recalled = cycle.own.filter((o) => o.recalls);
  let feel = null;
  const buttons = h('div', { class: 'feel', role: 'group', 'aria-label': '考える力の手応え' }, FEEL.map(([value, label]) => h('button', {
    type: 'button',
    'aria-pressed': 'false',
    onclick: (e) => {
      feel = value;
      for (const b of buttons.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
    },
  }, label)));
  const cards = st.cards.map((c) => stretchCard(c, backOf(c.lens)));
  // 表のまま描いてから1枚ずつめくる。
  cards.forEach((el, i) => setTimeout(() => el.classList.add('flipped'), 150 + i * 250));
  show(
    h('h1', {}, 'カードをめくりました'),
    h('p', { class: 'lead' }, `自分でも出せた ${summary.self} / AI社員だけ ${summary.ai} / 自分だけ ${summary.ownOnly}`),
    h('div', { class: 'stretch-grid' }, cards),
    mine.length ? h('section', { class: 'card' }, h('h2', {}, '自分だけが出したもの'), h('p', { class: 'muted' }, 'AI社員4人の誰も出さなかった、あなたの考えです。'),
      h('ul', { class: 'list note-own' }, mine.map((o) => h('li', {}, o.text)))) : null,
    recalled.length ? h('section', { class: 'card' }, h('h2', {}, '再会カード: 前に見落とした型を、自分で出せた'), h('p', { class: 'muted' }, 'ここが伸びてますよ。観点帳でいつ見落としたかを見返せます。'),
      h('ul', { class: 'list' }, recalled.map((o) => h('li', { class: 'recall-note' }, `「${o.text}」→ ${o.recalls.pattern}`)))) : null,
    h('section', { class: 'card' },
      h('h2', {}, '考える力は上がった感じがしますか？'),
      h('p', { class: 'muted' }, 'あなたの感じたままで大丈夫です。スキル（文字）で回したときと比べるために残します。'),
      form(async (v) => {
        if (feel == null) throw new Error('手応えを1つ選んでください');
        await api(`stretch/${st.id}/feel`, { feel, confidenceAfter: Number(v.confidence), stretch: st.input });
        show(h('h1', {}, '記録しました'),
          h('p', { class: 'lead' }, '次は、人に渡せる1枚の引継ぎカードにします。書くのはあなたの言葉だけです。'),
          h('p', {}, h('a', { class: 'button', href: `#/handover/${cycle.id}` }, '引継ぎカードを書く'), ' ', h('a', { class: 'button ghost', href: '#/notebook' }, '観点帳の木を見る')));
      },
      buttons,
      percentField('今の自信（%）', 'confidence', cycle.confidenceBefore, 0),
      h('button', { type: 'submit' }, '記録する'))),
  );
}

// 1枚の引継ぎカード。空いた欄はその担当のめんだこが指摘し、後任役のAIがカードだけで仕事を試す。
async function handoverView(cycleId) {
  setChain([]);
  const { cycles, slots, lenses } = await api('notebook');
  const cycle = cycles.find((c) => c.id === cycleId);
  if (!cycle) throw new Error('この周回は見つかりません');
  const card = cycle.handover?.card ?? {};
  // 資料は①の「いつもの流れ」から始める。前の6欄の形で書いた分は、見出し付きで追記に移して続きを書けるようにする。
  const legacy = slots.filter((s) => card[s.key]).map((s) => `【${s.heading}】\n${card[s.key]}`).join('\n\n');
  const rows = [
    h('label', {}, '資料（①のいつもの流れ）', h('small', {}, 'ここを直してもかまいません'), h('textarea', { name: 'doc', rows: 10, maxlength: 8000, value: card.doc ?? cycle.summary ?? '' })),
    h('label', {}, '追記', h('small', {}, '後任めんだこが止まった所への答えや、資料に書いていないこと'), h('textarea', { name: 'extra', rows: 6, maxlength: 8000, value: card.extra ?? legacy })),
  ];
  // 書く手が止まったときに、①でめんだこが出した指摘を見返すためのヒント。押すまでは隠しておく。
  const hints = h('section', { class: 'card hint-box', hidden: true },
    Object.entries(lenses).map(([lens, name]) => {
      const items = cycle.items.filter((i) => i.lens === lens);
      return items.length ? h('div', { class: `hint-lens lens-${lens}` }, mendako(lens, 48), h('div', {}, h('b', {}, name),
        h('ul', { class: 'list' }, items.map((i) => h('li', { class: `note-${i.status}` }, h('small', {}, ITEM_LABEL[i.status]), ' ', i.item))))) : null;
    }));
  const hintButton = h('button', { type: 'button', class: 'ghost', onclick: () => {
    hints.hidden = !hints.hidden;
    hintButton.textContent = hints.hidden ? 'ヒントを出す（①のめんだこの指摘）' : 'ヒントをしまう';
  } }, 'ヒントを出す（①のめんだこの指摘）');
  const results = h('section', { 'aria-live': 'polite' });
  const renderResults = (handover) => {
    const last = handover.tests.at(-1);
    if (!last) return;
    const c = handover.card;
    const text = c.doc != null || c.extra != null
      ? [`# 引継ぎカード: ${cycle.project}`, '', '## 資料', c.doc || '（空いています）', '', '## 追記', c.extra || '（なし）', ''].join('\n')
      : [`# 引継ぎカード: ${cycle.project}`, '', ...slots.flatMap((s) => [`## ${s.heading}`, c[s.key] || '（空いています）', ''])].join('\n');
    const download = h('a', { class: 'button ghost', download: `引継ぎカード_${cycle.project}.md`, href: URL.createObjectURL(new Blob([text], { type: 'text/markdown' })) }, 'カードを書き出す（.md）');
    // rightStop は、カードに「決まっていない（前任者に確認）」とあり、止まって前任者に聞くのが正しい場面。
    const kind = (r) => (r.result === 'できた' ? 'pass' : r.rightStop ? 'ask' : 'stuck');
    const right = (t) => t.results.filter((r) => kind(r) === 'ask').length;
    const grid = h('div', { class: 'stuck-grid', 'aria-hidden': 'true' }, last.results.map((_, i) => h('span', {}, String(i + 1))));
    // ○×を1つずつ点ける。
    last.results.forEach((r, i) => setTimeout(() => { grid.children[i].className = kind(r); }, 300 + i * 350));
    // 初めての場面（scenes: 'unseen'）で試した回は、同じ場面の推移と分けて並べる。before は同じ場面での人間とAIの前回の結果。
    const seen = handover.tests.filter((t) => t.scenes !== 'unseen');
    const unseen = handover.tests.filter((t) => t.scenes === 'unseen');
    const trend = (list) => list.map((t) => t.stuck).join(' → ');
    results.replaceChildren(h('div', { class: 'card' },
      h('h2', {}, `後任AIテスト ${handover.tests.length}回目`, last.scenes === 'unseen' ? '（初めての場面）' : ''),
      h('div', { class: 'stuck-big' }, h('b', {}, String(last.stuck)), h('span', {}, `/ ${last.results.length} で止まった`)),
      right(last) ? h('p', { class: 'right-stop' }, `うち ${right(last)} つは、止まって正しい場面（前任者に聞くのが正解）`) : null,
      seen.length > 1 ? h('p', { class: 'stuck-trend' }, `${unseen.length ? '同じ場面で ' : ''}止まった数 ${trend(seen)}`) : null,
      unseen.length ? h('div', { class: 'trend-break' }, h('small', {}, `ここから初めての${unseen[0].results.length}場面`),
        h('p', { class: 'stuck-trend' }, unseen.map((t) => (t.before ? `人間 ${t.before.human}・AI ${t.before.ai}（前のカード） → AI ${t.stuck}` : `AI ${t.stuck}`) + (right(t) ? `（正しく止まった ${right(t)}）` : '')).join(' → '))) : null,
      grid,
      h('ul', { class: 'list test-results' }, last.results.map((r) => h('li', { class: kind(r) },
        h('small', {}, kind(r) === 'ask' ? '止まった（正しい：前任者に聞く）' : r.result), h('div', {}, r.job),
        h('div', { class: 'muted' }, r.result === 'できた' ? `根拠: ${r.line}` : `止まった: ${r.why}`),
        r.missing ? h('div', {}, `足りない1行: ${r.missing}`) : null))),
      last.stuck && last.stuck === right(last) ? h('p', {}, '残りは、前任者に聞くのが正しい場面です。カードで決めることは、ここまでです。')
        : last.stuck ? h('p', { class: 'muted' }, 'カードに書き足して、もう一度試してください。書くのはあなたの言葉です。') : h('p', {}, '後任役のAIは、このカードだけで全部の仕事ができました。'),
      h('p', {}, download)));
  };
  show(
    h('h1', {}, `引継ぎカード: ${cycle.project}`),
    h('p', { class: 'lead' }, '①の資料を、後任めんだこがそのまま読んで、よくある仕事を試します。止まった所は「追記」に、あなたの言葉で書き足してください。'),
    form(async (v) => {
      results.replaceChildren(thinking('後任役のAIが、カードだけを読んで仕事を試しています（30秒ほど）'));
      const out = await api(`handover/${cycleId}`, { card: v });
      renderResults(out.handover);
    }, rows[0], cycle.items.length ? h('p', {}, hintButton) : null, hints, rows[1], h('button', { type: 'submit' }, '後任めんだこに試してもらう')),
    results,
  );
  if (cycle.handover) renderResults(cycle.handover);
}

function tabOf(hash) {
  if (hash !== '#/notebook') document.getElementById('shell').classList.remove('wide');
  if (hash.startsWith('#/handover')) return 'handover';
  if (hash === '#/notebook') return 'look';
  return 'think';
}

// 引き継ぐタブ: 引継ぎカードがあるいちばん新しい周回を開く。なければ最新の周回。
async function latestHandover() {
  const { cycles } = await api('notebook');
  if (!cycles.length) return show(h('h1', {}, '引き継ぐ'), h('p', { class: 'lead' }, 'まず「考える」で1周回すと、ここで引継ぎカードを書けます。'), h('p', {}, h('a', { class: 'button', href: '#/' }, '考えるへ')));
  await handoverView((cycles.filter((c) => c.handover).at(-1) ?? cycles.at(-1)).id);
}

async function router() {
  const hash = location.hash || '#/';
  try {
    const m = hash.match(/^#\/s\/([\w-]+)$/);
    const ho = hash.match(/^#\/handover\/(c\d+)$/);
    for (const a of document.querySelectorAll('.tabs a')) a.setAttribute('aria-current', a.dataset.tab === tabOf(hash) ? 'page' : 'false');
    if (ho) await handoverView(ho[1]);
    else if (hash === '#/handover') await latestHandover();
    else if (hash === '#/ledger') await home();
    else if (hash === '#/new') newSession();
    else if (hash === '#/notebook') await notebookView();
    else if (hash === '#/stretch') stretchView();
    else if (m) await session(m[1]);
    else stretchView();
  } catch (ex) {
    show(h('p', { class: 'error', role: 'alert' }, ex.message), h('a', { class: 'button ghost', href: '#/' }, '戻る'));
  }
}

api('meta').then((meta) => {
  hosted = !!meta.hosted;
  if (meta.provider === 'mock') {
    const mode = document.getElementById('mode');
    mode.textContent = 'デモ: AIを使わない固定応答';
    mode.hidden = false;
  }
}).catch(() => {}).finally(() => {
  window.addEventListener('hashchange', router);
  router();
});
