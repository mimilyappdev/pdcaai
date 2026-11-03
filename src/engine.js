import { randomUUID } from 'node:crypto';
import { openPrompt, proposePrompt, turnPrompt } from './prompts.js';
import { TAGS } from '../public/tree.js';

export class InputError extends Error {}

const LIMITS = { message: 4000, field: 2000 };
const MIN_USER_MESSAGES_TO_OPEN = 2;
const MAX_NODES_PER_TURN = 2;
const MODE_TEXT = { unknown: 'わからない', hint: 'ヒントちょうだい' };

function percent(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 100) throw new InputError(`${label}は0〜100で入力してください`);
  return n;
}

function text(value, label, max) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) throw new InputError(`${label}を入力してください`);
  if (v.length > max) throw new InputError(`${label}は${max}文字以内にしてください`);
  return v;
}

// 引用が本人の文章に実在するときだけ認める。空白の差は無視する。
export function quoteExists(quote, source) {
  const normalize = (s) => s.replace(/\s+/g, '').replace(/＜/g, '<').replace(/＞/g, '>');
  const q = normalize(quote ?? '');
  return q.length >= 2 && normalize(source).includes(q);
}

// 開封前の見立ては中身を外し、枝の位置だけを返す。
export function publicView(s) {
  const opened = Boolean(s.check);
  return {
    ...s,
    sealed: s.sealed.map((v) => (opened ? v : { id: v.id, parent: v.parent })),
    stretch: stretchScore(s),
  };
}

// 能力の点数ではなく、この回の踏み込みの記録。AIの判定は引用が確認できた項目だけ数える。
export function stretchScore(s) {
  const items = [
    { key: 'doubted', label: '前提を自分で疑った' },
    { key: 'evidence', label: '事実に触れた' },
    { key: 'self_found', label: '自分の見方を出した' },
    { key: 'testable', label: '試せる行動に落とした' },
  ].map((item) => {
    if (item.key === 'testable') return { ...item, met: Boolean(s.act), quote: s.act?.action ?? '' };
    const c = s.check?.[item.key];
    return { ...item, met: Boolean(c?.met), quote: c?.evidence_quote ?? '', note: c?.note ?? '' };
  });
  return { base: 100, total: 100 + items.filter((i) => i.met).length * 2.5, items };
}

function userSource(s) {
  return s.messages.filter((m) => m.role === 'user' && !m.mode).map((m) => m.text).join('\n');
}

export class Engine {
  constructor({ store, provider, now = () => new Date() }) {
    this.store = store;
    this.provider = provider;
    this.now = now;
    this.running = new Map();
  }

  // 同じ生成の二重実行を防ぎ、再読み込みや二度押しでは進行中の結果を共有する。
  once(key, work) {
    if (!this.running.has(key)) {
      this.running.set(key, work().finally(() => this.running.delete(key)));
    }
    return this.running.get(key);
  }

  async create(input) {
    const previous = input.previousId ? await this.require(input.previousId) : null;
    const s = {
      id: randomUUID(),
      createdAt: this.now().toISOString(),
      previousId: previous?.id ?? null,
      previousResult: previous?.act?.result ? `${previous.act.belief} → ${previous.act.result.note}` : '',
      title: previous?.title ?? '',
      confidenceBefore: percent(input.confidenceBefore, '今の点数'),
      messages: [],
      nodes: [],
      sealed: [],
      readyToOpen: false,
      check: null,
      proposal: null,
      act: null,
      tags: {},
    };
    await this.store.put(s);
    return publicView(s);
  }

  async require(id) {
    const s = await this.store.get(id);
    if (!s) throw new InputError('記録が見つかりません');
    return s;
  }

  async say(id, input) {
    const mode = Object.hasOwn(MODE_TEXT, input.mode ?? '') ? input.mode : 'normal';
    const message = mode === 'normal' ? text(input.text, '発言', LIMITS.message) : MODE_TEXT[mode];
    if (this.running.has(`${id}:turn`)) throw new InputError('返答を待っています');
    return this.once(`${id}:turn`, () => this.turn(id, message, mode));
  }

  async turn(id, message, mode) {
    const s = await this.require(id);
    if (s.check) throw new InputError('この周回は開封済みです');
    const lastQuestion = s.messages.filter((m) => m.role === 'assistant').at(-1)?.text ?? '';
    s.messages.push({ role: 'user', text: message, ...(mode === 'normal' ? {} : { mode }) });
    const out = await this.provider.generate({ ...turnPrompt(s, mode, s.nodes), effort: 'low' });
    s.messages.push({ role: 'assistant', text: out.reply, ...(mode === 'hint' ? { hint: true } : {}) });
    if (!s.title && out.work_title) s.title = out.work_title;

    const known = new Set(s.nodes.map((n) => n.id));
    const add = (node) => {
      const nodeId = `n${s.nodes.length + 1}`;
      s.nodes.push({ id: nodeId, ...node, parent: known.has(node.parent) ? node.parent : 'root' });
      known.add(nodeId);
    };
    if (mode === 'unknown' && lastQuestion) {
      add({ kind: 'pending', label: '保留', text: lastQuestion, quote: '', parent: 'root' });
    }
    if (mode === 'normal') {
      // 本人の発言に実在する引用がある枝だけをツリーへ入れる。
      for (const b of (out.branches ?? []).slice(0, MAX_NODES_PER_TURN)) {
        if (quoteExists(b.quote, message)) add(b);
      }
    }
    for (const v of out.new_sealed ?? []) {
      if (!s.sealed.some((x) => x.lens === v.lens)) {
        s.sealed.push({ id: `seal${s.sealed.length + 1}`, parent: s.nodes.at(-1)?.id ?? 'root', ...v });
      }
    }
    s.readyToOpen = Boolean(out.ready_to_open);
    await this.store.put(s);
    return publicView(s);
  }

  open(id) {
    return this.once(`${id}:open`, () => this.openSeal(id));
  }

  async openSeal(id) {
    const s = await this.require(id);
    if (s.check) return publicView(s);
    if (this.running.has(`${id}:turn`)) throw new InputError('返答を待っています');
    const spoken = s.messages.filter((m) => m.role === 'user').length;
    if (spoken < MIN_USER_MESSAGES_TO_OPEN) throw new InputError('もう少し話してから開けます');
    const raw = await this.provider.generate({ ...openPrompt(s), effort: 'medium' });
    for (const v of raw.new_view ?? []) {
      if (!s.sealed.some((x) => x.lens === v.lens)) {
        s.sealed.push({ id: `seal${s.sealed.length + 1}`, parent: s.nodes.at(-1)?.id ?? 'root', ...v });
      }
    }
    s.check = verifyCheck(raw, userSource(s));
    for (const r of s.check.reached) {
      if (s.sealed[r.index]) s.sealed[r.index].reachedQuote = r.evidence_quote;
    }
    await this.store.put(s);
    return publicView(s);
  }

  async propose(id) {
    return this.once(`${id}:propose`, async () => {
      const s = await this.require(id);
      if (!s.check) throw new InputError('先に見立てを開いてください');
      if (s.proposal) return s.proposal;
      s.proposal = await this.provider.generate({ ...proposePrompt(s), effort: 'low' });
      await this.store.put(s);
      return s.proposal;
    });
  }

  async submitAct(id, input) {
    const s = await this.require(id);
    if (!s.check) throw new InputError('先に見立てを開いてください');
    const confidence = Number(input.confidence);
    if (!Number.isInteger(confidence) || confidence < 50 || confidence > 100) {
      throw new InputError('確信度は50〜100で入力してください');
    }
    const checkDate = text(input.checkDate, '確認日', 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(checkDate) || Number.isNaN(Date.parse(checkDate))) {
      throw new InputError('確認日の形式が正しくありません');
    }
    s.act = {
      belief: text(input.belief, '確かめる前提', LIMITS.field),
      action: text(input.action, '試すこと', LIMITS.field),
      signal: text(input.signal, '外れたと判断する基準', LIMITS.field),
      confidence,
      confidenceAfter: percent(input.confidenceAfter, '開封後の点数'),
      checkDate,
      result: s.act?.result ?? null,
    };
    await this.store.put(s);
    return publicView(s);
  }

  async submitResult(id, input) {
    const s = await this.require(id);
    if (!s.act) throw new InputError('先に試すことを決めてください');
    if (!['held', 'broken', 'unclear'].includes(input.outcome)) throw new InputError('結果を選んでください');
    s.act.result = {
      outcome: input.outcome,
      note: text(input.note, '分かったこと', LIMITS.field),
      recordedAt: this.now().toISOString(),
    };
    await this.store.put(s);
    return publicView(s);
  }

  // 色分けは本人が直せる。ここを変えても踏み込みの記録（引用の確認）は変わらない。
  async setTag(id, input) {
    const s = await this.require(id);
    if (!/^[\w-]{1,30}$/.test(input.node ?? '')) throw new InputError('不明な項目です');
    if (!Object.hasOwn(TAGS, input.tag ?? '')) throw new InputError('不明な分類です');
    s.tags = { ...s.tags, [input.node]: input.tag };
    await this.store.put(s);
    return publicView(s);
  }

  async chain(id) {
    const list = [];
    const seen = new Set();
    let current = await this.require(id);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      list.unshift(publicView(current));
      current = current.previousId ? await this.store.get(current.previousId) : null;
    }
    return list;
  }

  async ledger() {
    const sessions = (await this.store.all())
      .filter((s) => s.messages.length)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const now = this.now();
    const pad = (n) => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    return {
      calibration: calibration(sessions),
      due: sessions
        .filter((s) => s.act && !s.act.result && s.act.checkDate <= today)
        .map((s) => ({ id: s.id, name: s.title, belief: s.act.belief, checkDate: s.act.checkDate })),
      sessions: sessions.map((s) => ({
        id: s.id,
        name: s.title || '無題',
        createdAt: s.createdAt,
        previousId: s.previousId,
        total: stretchScore(s).total,
        act: s.act,
      })),
    };
  }
}

function verifyCheck(raw, source) {
  const verified = {};
  for (const key of ['doubted', 'evidence', 'self_found']) {
    const c = raw[key] ?? {};
    const ok = Boolean(c.met) && quoteExists(c.evidence_quote, source);
    verified[key] = { met: ok, evidence_quote: ok ? c.evidence_quote : '', note: c.note ?? '' };
  }
  verified.reached = (raw.reached ?? []).filter((r) => quoteExists(r.evidence_quote, source));
  verified.next_gap = raw.next_gap ?? '';
  return verified;
}

// 「この前提は正しい」という確信の高さと、実際に残った割合を比べる。計算にAIは使わない。
export function calibration(sessions) {
  const resolved = sessions.filter((s) => s.act?.result && s.act.result.outcome !== 'unclear');
  const held = resolved.filter((s) => s.act.result.outcome === 'held').length;
  const avg = resolved.reduce((sum, s) => sum + s.act.confidence, 0);
  return {
    resolved: resolved.length,
    held,
    broken: resolved.length - held,
    avgConfidence: resolved.length ? Math.round(avg / resolved.length) : null,
    heldRate: resolved.length ? Math.round((held / resolved.length) * 100) : null,
  };
}
