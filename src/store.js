import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// 記録は手元のJSON1ファイルだけに保存する。書き込みは直列化し、一時ファイル経由で置き換える。
export class JsonStore {
  constructor(path) {
    this.path = path;
    this.queue = Promise.resolve();
  }

  async read() {
    try {
      return JSON.parse(await readFile(this.path, 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return {};
      throw e;
    }
  }

  async get(id) {
    await this.queue;
    return (await this.read())[id] ?? null;
  }

  async all() {
    await this.queue;
    return Object.values(await this.read());
  }

  put(session) {
    const write = this.queue.then(async () => {
      const data = await this.read();
      const incoming = structuredClone(session);
      // 並列の問い生成が互いの結果を消さないように統合する。
      if (data[session.id]) {
        incoming.reviewers = { ...data[session.id].reviewers, ...incoming.reviewers };
      }
      data[session.id] = incoming;
      await mkdir(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      await writeFile(tmp, JSON.stringify(data, null, 2));
      await rename(tmp, this.path);
    });
    this.queue = write.catch(() => {});
    return write;
  }
}

export class MemoryStore {
  constructor() { this.data = new Map(); }
  async get(id) { return structuredClone(this.data.get(id) ?? null); }
  async all() { return [...this.data.values()].map((s) => structuredClone(s)); }
  async put(s) {
    const prev = this.data.get(s.id);
    this.data.set(s.id, structuredClone({ ...s, reviewers: { ...prev?.reviewers, ...s.reviewers } }));
  }
}
