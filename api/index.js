// Vercel 上の公開版の入口。観点帳は各自のブラウザに置き、AIは ANTHROPIC_API_KEY で呼ぶ。合言葉は PDCAI_PASSCODE。
import { Engine } from '../src/engine.js';
import { apiProvider } from '../src/providers.js';
import { JsonStore } from '../src/store.js';
import { handler } from '../src/server.js';

const provider = apiProvider();
const engine = new Engine({ store: new JsonStore('/tmp/pdcai-ledger.json'), provider });
const passcode = process.env.PDCAI_PASSCODE;
if (!passcode) throw new Error('PDCAI_PASSCODE が設定されていません');

export default handler(engine, provider.name, 0, { passcode });
