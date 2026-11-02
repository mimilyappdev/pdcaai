import { randomUUID } from 'node:crypto';
import { ROLES, assumptionsPrompt, checkPrompt, reviewerPrompt } from './prompts.js';

export class InputError extends Error {}

const LIMITS = { name: 100, audience: 200, belief: 2000, evidence: 2000, material: 20000, answer: 4000 };

function percent(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 100) throw new InputError(`${label}は0〜100で入力してください`);
  return n;
}

function text(value, label, max, { required = true } = {}) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (required && !v) throw new InputError(`${label}を入力してください`);
  if (v.length > max) throw new InputError(`${label}は${max}文字以内にしてください`);
  return v;
}

// 引用が本人の文章に実在するときだけ認める。空白の差は無視する。
export function quoteExists(quote, source) {
  const normalize = (s) => s.replace(/\s+/g, '').replace(/＜/g, '<').replace(/＞/g, '>');
  const q = normalize(quote ?? '');
  return q.length >= 4 && normalize(source).includes(q);
}

// 表示用の前提を除いた、利用者に見せてよい状態だけを返す。封印はここで守る。
export function publicView(s) {
  const opened = Boolean(s.check);
  const reviewers = {};
  for (const [key, r] of Object.entries(s.reviewers)) {
    reviewers[key] = {
      label: ROLES[key].label,
      question: r.question,
      target: r.target,
      ...(opened ? { sealed_view: r.sealed_view, sealed_probe: r.sealed_probe } : {}),
    };
  }
  return { ...s, reviewers, stretch: stretchScore(s) };
}

// 能力の点数ではなく、この回の踏み込みの記録。AIの判定は引用が確認できた項目だけ数える。
export function stretchScore(s) {
  const items = [
    { key: 'doubted', label: '前提を自分で疑った' },
    { key: 'evidence', label: '観測事実で確かめた' },
    { key: 'self_found', label: '自分の案を出した' },
    { key: 'testable', label: '試せる行動に落とした' },
  ].map((item) => {
    if (item.key === 'testable') return { ...item, met: Boolean(s.act), quote: s.act?.action ?? '' };
    const c = s.check?.[item.key];
    return { ...item, met: Boolean(c?.met), quote: c?.evidence_quote ?? '', note: c?.note ?? '' };
  });
  return { base: 100, total: 100 + items.filter((i) => i.met).length * 2.5, items };
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
      work: {
        name: text(input.name, '作ったもの', LIMITS.name),
        audience: text(input.audience, '届けたい相手', LIMITS.audience),
        belief: text(input.belief, '100点だと思う理由', LIMITS.belief),
        evidence: text(input.evidence, 'そう思う根拠', LIMITS.evidence),
        material: text(input.material, '補足資料', LIMITS.material, { required: false }),
      },
      // AIの問いを見る前の自信。開封後の自信と比べる。
      confidenceBefore: percent(input.confidenceBefore, '今の自信'),
      assumptions: [],
      reviewers: {},
      answers: null,
      check: null,
      act: null,
    };
    await this.store.put(s);
    return publicView(s);
  }

  async require(id) {
    const s = await this.store.get(id);
    if (!s) throw new InputError('記録が見つかりません');
    return s;
  }

  async assumptions(id) {
    return this.once(`${id}:assumptions`, async () => {
      const s = await this.require(id);
      if (s.assumptions.length) return publicView(s);
      const out = await this.provider.generate({ ...assumptionsPrompt(s), effort: 'medium' });
      if (!Array.isArray(out.assumptions) || !out.assumptions.length) throw new Error('前提を取り出せませんでした');
      s.assumptions = out.assumptions.slice(0, 4).map((a, i) => ({ id: `a${i + 1}`, ...a }));
      await this.store.put(s);
      return publicView(s);
    });
  }

  async reviewer(id, role) {
    if (!Object.hasOwn(ROLES, role)) throw new InputError('不明な役割です');
    return this.once(`${id}:${role}`, () => this.generateReviewer(id, role));
  }

  async generateReviewer(id, role) {
    const s = await this.require(id);
    if (!s.assumptions.length) throw new InputError('先に前提を取り出してください');
    if (!s.reviewers[role]) {
      const request = { ...reviewerPrompt(s, role), effort: 'medium' };
      let out = await this.provider.generate(request);
      // 長い問いは一度だけ作り直す。
      if ((out.question ?? '').length > 60) out = await this.provider.generate(request);
      // 並列実行中の他の役割を消さないよう、保存直前に読み直す。
      const latest = await this.require(id);
      latest.reviewers[role] = out;
      await this.store.put(latest);
      return publicView(latest).reviewers[role];
    }
    return publicView(s).reviewers[role];
  }

  submitAnswers(id, input) {
    return this.once(`${id}:answers`, () => this.checkAnswers(id, input));
  }

  async checkAnswers(id, input) {
    const s = await this.require(id);
    if (s.check) return publicView(s);
    for (const role of Object.keys(ROLES)) {
      if (!s.reviewers[role]) throw new InputError('まだ問いが揃っていません');
    }
    const answers = { own_idea: text(input.own_idea, '自分で見つけた+10案', LIMITS.answer) };
    for (const [role, def] of Object.entries(ROLES)) {
      answers[role] = text(input[role], `${def.label}への回答`, LIMITS.answer);
    }
    s.answers = answers;
    const raw = await this.provider.generate({ ...checkPrompt(s), effort: 'high' });
    s.check = verifyCheck(raw, answers);
    await this.store.put(s);
    return publicView(s);
  }

  async submitAct(id, input) {
    const s = await this.require(id);
    if (!s.check) throw new InputError('先に振り返りを終えてください');
    const confidence = Number(input.confidence);
    if (!Number.isInteger(confidence) || confidence < 50 || confidence > 100) {
      throw new InputError('確信度は50〜100で入力してください');
    }
    const checkDate = text(input.checkDate, '確認日', 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(checkDate) || Number.isNaN(Date.parse(checkDate))) {
      throw new InputError('確認日の形式が正しくありません');
    }
    s.act = {
      belief: text(input.belief, '確かめる前提', LIMITS.belief),
      action: text(input.action, '試すこと', LIMITS.belief),
      signal: text(input.signal, '外れたと判断する基準', LIMITS.belief),
      confidence,
      confidenceAfter: percent(input.confidenceAfter, '開封後の自信'),
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
      note: text(input.note, '分かったこと', LIMITS.belief),
      recordedAt: this.now().toISOString(),
    };
    await this.store.put(s);
    return publicView(s);
  }

  async ledger() {
    const sessions = (await this.store.all()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const now = this.now();
    const pad = (n) => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    return {
      calibration: calibration(sessions),
      due: sessions
        .filter((s) => s.act && !s.act.result && s.act.checkDate <= today)
        .map((s) => ({ id: s.id, name: s.work.name, belief: s.act.belief, checkDate: s.act.checkDate })),
      sessions: sessions.map((s) => ({
        id: s.id,
        name: s.work.name,
        createdAt: s.createdAt,
        previousId: s.previousId,
        total: stretchScore(s).total,
        act: s.act,
      })),
    };
  }
}

function verifyCheck(raw, answers) {
  const source = Object.values(answers).join('\n');
  const verified = {};
  for (const key of ['doubted', 'evidence', 'self_found']) {
    const c = raw[key] ?? {};
    const ok = Boolean(c.met) && quoteExists(c.evidence_quote, source);
    verified[key] = { met: ok, evidence_quote: ok ? c.evidence_quote : '', note: c.note ?? '' };
  }
  verified.sealed_review = {};
  for (const role of Object.keys(ROLES)) {
    const c = raw.sealed_review?.[role] ?? {};
    const ok = Boolean(c.self_reached) && quoteExists(c.evidence_quote, source);
    verified.sealed_review[role] = { self_reached: ok, evidence_quote: ok ? c.evidence_quote : '' };
  }
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
