const app = document.getElementById('app');
const ROLE_ORDER = ['newcomer', 'numbers', 'opponent'];
const STEP_NAMES = ['Plan 思い込み', 'Do 自分で考える', 'Check 開封', 'Act 試す'];
const DRAFT_PREFIX = 'pdcaai-draft-';

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
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

function show(...nodes) {
  app.replaceChildren(...nodes.flat().filter(Boolean));
  window.scrollTo(0, 0);
  app.focus({ preventScroll: true });
}

function steps(active) {
  return h('ol', { class: 'steps' }, STEP_NAMES.map((n, i) => h('li', { class: i <= active ? 'on' : '' }, n)));
}

function field(label, name, { hint, type = 'textarea', value = '', required = true, ...rest } = {}) {
  const input = type === 'textarea'
    ? h('textarea', { name, required, ...rest }, value)
    : h('input', { type, name, value, required, ...rest });
  return h('label', {}, label, hint ? h('small', {}, hint) : null, input);
}

function errorLine() {
  return h('p', { class: 'error', role: 'alert', hidden: true });
}

function form(onsubmit, ...children) {
  const err = errorLine();
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
  const ledger = await api('ledger');
  const c = ledger.calibration;
  show(
    h('h1', {}, '「これで100点」を、\n自分の頭で110点へ。'),
    h('p', { class: 'lead' }, 'AIは答えを先に見せません。問いに自分で答えたあとで、封印した指摘を開きます。最後に小さく試して、思い込みの結果を記録します。'),
    h('p', {}, h('a', { class: 'button', href: '#/new' }, '成果物を疑いはじめる')),
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
  show(
    steps(0),
    h('h2', {}, '何を「もう完成」と思っていますか？'),
    previousName ? h('p', { class: 'muted' }, `前回の「${previousName}」の結果から続けます。`) : null,
    form(async (data) => {
      const s = await api('sessions', { ...data, confidenceBefore: Number(data.confidenceBefore), previousId });
      location.hash = `#/s/${s.id}`;
    },
    percentField('今、この成果物は何点ですか？', 'confidenceBefore', 100, 0),
    field('作ったもの', 'name', { type: 'text', maxlength: 100, value: previousName ?? '', hint: 'ツール、記事、商品、企画など' }),
    field('届けたい相手', 'audience', { type: 'text', maxlength: 200, hint: 'なるべく一人の顔が浮かぶように' }),
    field('100点だと思う理由', 'belief', { maxlength: 2000 }),
    field('そう思う根拠', 'evidence', { maxlength: 2000, hint: '実際に見た反応や数字。感覚でもそのまま書いてください' }),
    field('補足資料（任意）', 'material', { required: false, maxlength: 20000, hint: '説明文やREADMEなど。Claudeへ送るので、個人情報と秘密情報は入れないでください' }),
    h('button', { type: 'submit' }, '思い込みを取り出す')),
  );
}

async function session(id) {
  const s = await api(`sessions/${id}`);
  if (s.act) return actDone(s);
  if (s.check) return checkView(s);
  return doView(s);
}

// 生成の途中で失敗して再読み込みしても、書いた回答を失わない。
function keepDraft(el, id) {
  const read = () => {
    try { return JSON.parse(localStorage.getItem(DRAFT_PREFIX + id) || '{}'); } catch { return {}; }
  };
  const saved = read()[el.name];
  if (saved) el.value = saved;
  el.addEventListener('input', () => {
    try {
      localStorage.setItem(DRAFT_PREFIX + id, JSON.stringify({ ...read(), [el.name]: el.value }));
    } catch { /* 保存できなくても入力は続ける */ }
  });
  return el;
}

async function doView(s) {
  const slots = {};
  const assumptionsBox = h('section', { class: 'card' },
    h('h3', {}, 'あなたが置いている前提'), h('p', { class: 'waiting' }, '文章から取り出しています'));
  const questions = h('div', {}, ROLE_ORDER.map((r) => {
    slots[r] = h('section', { class: 'card' }, h('p', { class: 'waiting' }, '問いを用意しています'));
    return slots[r];
  }));
  const err = errorLine();
  show(steps(1), h('h2', {}, `「${s.work.name}」の前提を揺らします`), assumptionsBox, questions, err);

  const answerForm = h('div', { id: 'finish' });
  app.append(answerForm);
  try {
    const withAssumptions = await api(`sessions/${s.id}/assumptions`, {});
    assumptionsBox.replaceChildren(
      h('h3', {}, 'あなたが置いている前提'),
      h('ul', {}, withAssumptions.assumptions.map((a) => h('li', {}, a.text))),
    );
    const results = await Promise.all(ROLE_ORDER.map(async (role) => {
      const r = await api(`sessions/${s.id}/reviewers/${role}`, {});
      slots[role].replaceChildren(
        h('span', { class: 'who' }, r.label),
        h('p', { class: 'question' }, r.question),
        h('label', {}, '自分の言葉で答える', keepDraft(h('textarea', { name: role, required: true, maxlength: 4000, form: 'answers' }), s.id)),
        h('div', { class: 'seal locked' }, '封印中: 答えたあとで、この人の見立てが開きます'),
      );
      return r;
    }));
    if (results.length !== ROLE_ORDER.length) return;
    const f = form(async (data) => {
      const answers = {};
      for (const el of app.querySelectorAll('textarea[form=answers]')) answers[el.name] = el.value;
      await api(`sessions/${s.id}/answers`, { ...data, ...answers });
      try { localStorage.removeItem(DRAFT_PREFIX + s.id); } catch { /* 消せなくても進める */ }
      await session(s.id);
    },
    field('自分で見つけた+10案', 'own_idea', { maxlength: 4000, hint: 'まだAIの案は見えていません。粗くて大丈夫です' }),
    h('button', { type: 'submit' }, '答えて封印を開く'));
    f.id = 'answers';
    answerForm.append(f);
    keepDraft(f.querySelector('textarea[name=own_idea]'), s.id);
  } catch (ex) {
    err.textContent = `${ex.message} 再読み込みすると続きからやり直せます。`;
    err.hidden = false;
  }
}

function gauge(st) {
  const total = st.total;
  return h('section', { class: 'gauge', 'aria-label': `今回の踏み込み ${total}` },
    h('div', { class: 'gauge-num' }, String(total), h('small', {}, ' / 110')),
    h('div', { class: 'gauge-bar' }, st.items.map((i) => h('i', { class: i.met ? 'on' : '' }))),
    h('p', { class: 'muted' }, '能力の点数ではありません。今回の文章と行動で踏み込めた項目の記録です。'),
  );
}

function proofList(st) {
  return h('ul', { class: 'proof' }, st.items.map((i) => h('li', {},
    h('b', { class: i.met ? 'met' : 'miss' }, i.met ? i.label : `${i.label}（今回はなし）`),
    i.met && i.quote ? h('blockquote', {}, i.quote) : null,
  )));
}

function revealCards(s) {
  return ROLE_ORDER.map((role) => {
    const r = s.reviewers[role];
    const reached = s.check.sealed_review[role];
    return h('section', { class: 'card' },
      h('span', { class: 'who' }, r.label),
      h('p', {}, h('b', {}, r.question)),
      h('p', { class: 'muted' }, 'あなたの回答: ', s.answers[role]),
      h('div', { class: 'seal' },
        h('strong', {}, '開封した見立て'),
        reached.self_reached ? h('span', { class: 'reached' }, '自力で同じ点に届いています') : null,
        h('p', {}, r.sealed_view),
        h('p', {}, '確かめ方: ', r.sealed_probe)));
  });
}

function checkView(s) {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  const pad = (n) => String(n).padStart(2, '0');
  const week = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  show(
    steps(3),
    h('h2', {}, '封印を開きました'),
    gauge(s.stretch),
    h('section', { class: 'card' }, proofList(s.stretch)),
    revealCards(s),
    s.check.next_gap ? h('section', { class: 'card' }, h('h3', {}, 'まだ考えていないこと'), h('p', {}, s.check.next_gap)) : null,
    h('h2', {}, '小さく試す'),
    h('p', { class: 'lead' }, 'ここはあなたが書きます。AIは行動を決めません。'),
    form(async (data) => {
      await api(`sessions/${s.id}/act`, { ...data, confidence: Number(data.confidence), confidenceAfter: Number(data.confidenceAfter) });
      await session(s.id);
    },
    field('確かめる前提', 'belief', { hint: '1つに絞ってください', type: 'text', maxlength: 2000 }),
    field('30分以内に試すこと', 'action', { type: 'text', maxlength: 2000 }),
    field('外れたと判断する基準', 'signal', { type: 'text', maxlength: 2000, hint: '試す前に決めておきます' }),
    percentField('開封した今、この成果物は何点ですか？', 'confidenceAfter', s.confidenceBefore, 0),
    percentField('確かめる前提が正しい確信度', 'confidence', 80, 50),
    field('結果を確かめる日', 'checkDate', { type: 'date', value: week }),
    h('button', { type: 'submit' }, '台帳に載せて110へ')),
  );
}

function percentField(label, name, value, min) {
  const out = h('output', {}, String(value));
  return h('label', {}, `${label} `, out,
    h('input', { type: 'range', name, min, max: 100, step: 5, value, oninput: (e) => { out.textContent = e.target.value; } }));
}

function actDone(s) {
  const a = s.act;
  const resultBlock = a.result
    ? h('section', { class: 'card' },
      h('h3', {}, `結果: ${outcomeLabel(a.result.outcome)}`),
      h('p', {}, a.result.note),
      h('p', {}, h('button', { class: 'ghost', type: 'button', onclick: () => newSession(s.id, s.work.name) }, 'この結果から次の周回へ')))
    : h('section', { class: 'card' }, h('h3', {}, '結果を記録する'), form(async (data) => {
      await api(`sessions/${s.id}/result`, data);
      await session(s.id);
    },
    h('div', { class: 'choice', role: 'group', 'aria-label': '結果' },
      ...[['held', '前提は残った'], ['broken', '前提は外れた'], ['unclear', 'まだ分からない']].map(([value, label], i) =>
        h('label', {}, h('input', { type: 'radio', name: 'outcome', value, required: i === 0 }), ` ${label}`))),
    h('br', {}),
    field('分かったこと', 'note', { maxlength: 2000 }),
    h('button', { type: 'submit' }, '記録する')));
  show(
    steps(3),
    h('h2', {}, `「${s.work.name}」の周回`),
    gauge(s.stretch),
    h('section', { class: 'card shift' },
      h('h3', {}, '自分でつけた点数の変化'),
      h('p', { class: 'shift-num' }, `${s.confidenceBefore} → ${a.confidenceAfter}`)),
    h('section', { class: 'card' },
      h('h3', {}, '賭けた前提'), h('p', {}, `${a.belief}（確信度 ${a.confidence}%）`),
      h('h3', {}, '試すこと'), h('p', {}, a.action),
      h('h3', {}, '外れたと判断する基準'), h('p', {}, a.signal),
      h('p', { class: 'muted' }, `確認日 ${a.checkDate}`)),
    resultBlock,
    h('section', { class: 'card' }, proofList(s.stretch)),
    revealCards(s),
    h('p', {}, h('a', { class: 'button ghost', href: '#/' }, '台帳へ戻る')),
  );
}

async function router() {
  const hash = location.hash || '#/';
  try {
    const m = hash.match(/^#\/s\/([\w-]+)$/);
    if (hash === '#/new') newSession();
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
