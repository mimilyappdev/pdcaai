import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { mockResponse } from './mock.js';

const MODEL = 'claude-opus-5-5';

// ANTHROPIC_API_KEY がある場合に使う本番経路。
export function apiProvider(client = new Anthropic()) {
  return {
    name: 'api',
    async generate({ system, user, schema, effort = 'high' }) {
      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort, format: { type: 'json_schema', schema } },
        system,
        messages: [{ role: 'user', content: user }],
      });
      const message = await stream.finalMessage();
      if (message.stop_reason === 'refusal') throw new Error('Claudeがこの内容への回答を見送りました');
      if (message.stop_reason === 'max_tokens') throw new Error('回答が長すぎて途中で切れました');
      const text = message.content.find((b) => b.type === 'text')?.text;
      if (!text) throw new Error('Claudeから回答がありませんでした');
      return JSON.parse(text);
    },
  };
}

// APIキーなしでも、ログイン済みのClaude Codeで動かす経路。入力は標準入力で渡す。
export function cliProvider(run = runClaude) {
  return {
    name: 'claude-code',
    async generate({ system, user, schema, effort = 'high' }) {
      const out = await run(
        ['-p', '--model', MODEL, '--effort', effort, '--output-format', 'json',
          '--json-schema', JSON.stringify(schema), '--system-prompt', system,
          '--tools', '', '--no-session-persistence', '--setting-sources', ''],
        user,
      );
      const result = JSON.parse(out);
      if (result.is_error) throw new Error(`Claude Code: ${result.result}`);
      return result.structured_output ?? JSON.parse(result.result);
    },
  };
}

function defaultClaudeBin() {
  if (process.platform !== 'win32') return 'claude';
  const exe = join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  return existsSync(exe) ? exe : 'claude.exe';
}

function runClaude(args, input) {
  return new Promise((resolve, reject) => {
    // Windowsの .cmd はJSONの引用符を壊すため、実行ファイルを直接起動する。
    const command = process.env.PDCAAI_CLAUDE_BIN || defaultClaudeBin();
    const child = spawn(command, args, { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Claude Codeの応答が3分を超えました'));
    }, 180_000);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`Claude Codeを起動できません: ${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (stdout.trim()) resolve(stdout);
      else reject(new Error(`Claude Codeが終了しました (code ${code}): ${stderr.slice(0, 300)}`));
    });
    child.stdin.end(input);
  });
}

export function mockProvider() {
  return {
    name: 'mock',
    async generate(request) {
      return mockResponse(request);
    },
  };
}

export function chooseProvider(name = process.env.PDCAAI_PROVIDER) {
  if (name === 'mock') return mockProvider();
  if (name === 'cli') return cliProvider();
  if (name === 'api') return apiProvider();
  return process.env.ANTHROPIC_API_KEY ? apiProvider() : cliProvider();
}
