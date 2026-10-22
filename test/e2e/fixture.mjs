import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/daemon/app.mjs';
import { saveSettings } from '../../src/daemon/settings.mjs';

const PLUGIN_ROOT = fileURLToPath(new URL('../fake-claude/plugin-root', import.meta.url));
const tmp = (p) => realpathSync(mkdtempSync(join(tmpdir(), p)));
export const DIST = process.env.EXO_E2E_DIST || fileURLToPath(new URL('../../dist', import.meta.url));

export const USAGE = {
  total_cost_usd: 0.0421,
  usage: {
    input_tokens: 4, output_tokens: 90, cache_read_input_tokens: 7000,
    cache_creation_input_tokens: 3000, cache_creation: { ephemeral_1h_input_tokens: 2500, ephemeral_5m_input_tokens: 500 },
  },
  modelUsage: { 'claude-opus-4-8': { inputTokens: 4, outputTokens: 90, cacheReadInputTokens: 7000, cacheCreationInputTokens: 3000, costUSD: 0.0421 } },
};

export function fakeClaude(dir, steps, { init = {}, initFor = {} } = {}) {
  const bin = join(dir, 'claude');
  writeFileSync(bin, `#!/usr/bin/env node
const fs = require('node:fs');
const rl = require('node:readline').createInterface({ input: process.stdin })[Symbol.asyncIterator]();
const out = (o) => console.log(JSON.stringify(o));
if (process.argv[2] === 'auth') {
  const own = process.env.CLAUDE_CONFIG_DIR && require('node:path').join(process.env.CLAUDE_CONFIG_DIR, 'fake-auth.json');
  const reply = own && fs.existsSync(own) ? fs.readFileSync(own, 'utf8').trim() : process.env.FAKE_CLAUDE_AUTH || JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' });
  console.log(reply); process.exit(0);
}
const next = async (type) => { for (;;) { const { value, done } = await rl.next(); if (done) process.exit(0); if (JSON.parse(value).type === type) return JSON.parse(value); } };
const say = (t) => out({ type: 'assistant', message: { id: 'm' + Math.random(), model: 'claude-opus-4-8', content: [{ type: 'text', text: t }], usage: { input_tokens: 4, output_tokens: 90, cache_read_input_tokens: 7000, cache_creation_input_tokens: 3000, cache_creation: { ephemeral_1h_input_tokens: 2500, ephemeral_5m_input_tokens: 500 } } } });
const USAGE = ${JSON.stringify(USAGE)};
(async () => {
  const session = (fs.existsSync(${JSON.stringify(join(dir, 'spawns.txt'))}) ? fs.readFileSync(${JSON.stringify(join(dir, 'spawns.txt'))}, 'utf8').length : 0) + 1;
  out(Object.assign({ type: 'system', subtype: 'init', cwd: process.cwd(), apiKeySource: 'none', permissionMode: 'default', model: 'claude-opus-4-8', claude_code_version: '2.1.305', plugins: [{ name: 'exo', version: '0.136.0' }] }, ${JSON.stringify(init)}, ${JSON.stringify(initFor)}[session] || {}));
  await next('user');
  fs.appendFileSync(${JSON.stringify(join(dir, 'spawns.txt'))}, 'x');
  const n = fs.readFileSync(${JSON.stringify(join(dir, 'spawns.txt'))}, 'utf8').length;
  for (let step of ${JSON.stringify(steps)}) {
    const only = /^@([0-9,]+):(.*)$/.exec(step);
    if (only) { if (!only[1].split(',').map(Number).includes(n)) continue; step = only[2]; }
    if (step === 'rate') out({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour', unifiedWindows: { five_hour: { utilization: 0.42, resetsAt: Math.floor(Date.now() / 1000) + 7200 }, seven_day: { utilization: 0.18, resetsAt: Math.floor(Date.now() / 1000) + 300000 } } } });
    else if (step === 'tool') {
      out({ type: 'assistant', message: { id: 'tool1', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'src/greet.mjs' } }] } });
      out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'export const greet = () => "hi";' }] } });
    } else if (step.startsWith('say:')) say(step.slice(4));
    else if (step === 'ask') {
      out({ type: 'control_request', request_id: 'r-ask' + n, request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input: { questions: [{ question: 'Which greeting style?', options: [{ label: 'Formal' }, { label: 'Casual' }] }] } } });
      fs.writeFileSync('answer.json', JSON.stringify(await next('control_response')));
    } else if (step === 'perm') {
      out({ type: 'control_request', request_id: 'r-perm' + n, request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls docs' } } });
      fs.writeFileSync('perm.json', JSON.stringify(await next('control_response')));
    } else if (step === 'text-question') {
      say('**1/1 Greeting style**\\n- **(A) Formal**: Good day\\n- **(B) Casual**: Hey\\nRecommended: (B)');
      out(Object.assign({ type: 'result', subtype: 'success', num_turns: 1 }, USAGE));
      fs.writeFileSync('reply.txt', (await next('user')).message.content);
    } else if (step === 'brief') {
      fs.mkdirSync('docs/specs', { recursive: true });
      fs.writeFileSync('docs/specs/greet.md', '# Greet\\n\\n## Plan basis\\nBranch: greet\\nLand: local\\n');
      say('Brief written: docs/specs/greet.md');
      out(Object.assign({ type: 'result', subtype: 'success', num_turns: 1 }, USAGE));
    }
  }
  await next('never');
})();
`);
  chmodSync(bin, 0o755);
  return bin;
}

function plugin() {
  const root = tmp('deck-plugin-');
  cpSync(PLUGIN_ROOT, root, { recursive: true });
  return root;
}

export function repo(name = 'deck-repo-') {
  const dir = tmp(name);
  const g = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
  g('init', '-q', '-b', 'main');
  g('commit', '-q', '--allow-empty', '-m', 'init');
  return dir;
}

export function accountsFixture(dir, dataDir, now = Date.now()) {
  const s = (ms) => new Date(now + ms).toISOString();
  const H = 3600_000;
  const limit = (kind, group, percent, resetsIn, model) => ({ kind, group, percent, resets_at: s(resetsIn), scope: model ? { model: { id: null, display_name: model } } : null });
  const claudeJson = (oauth, limits) => ({ oauthAccount: { billingType: 'stripe_subscription', ...oauth }, cachedUsageUtilization: { fetchedAtMs: now - 60_000, limits } });
  const claudeJsonPath = join(dir, 'default-claude.json');
  writeFileSync(claudeJsonPath, JSON.stringify(claudeJson(
    { emailAddress: 'thomas@example.com', organizationType: 'claude_max', organizationRateLimitTier: 'default_claude_max_5x', subscriptionCreatedAt: '2025-03-09T10:00:00.000Z' },
    [limit('session', 'session', 34, 2.25 * H), limit('weekly_all', 'weekly', 61, 76 * H), limit('weekly_scoped', 'weekly', 18, 76 * H, 'Fable')],
  )));
  const workDir = join(dir, 'accounts', 'work');
  mkdirSync(workDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(workDir, '.claude.json'), JSON.stringify(claudeJson(
    { emailAddress: 'thomas@work.example', organizationType: 'claude_pro', organizationRateLimitTier: 'default_claude_pro', subscriptionCreatedAt: '2026-01-27T08:30:00.000Z' },
    [limit('session', 'session', 7, 4 * H), limit('weekly_all', 'weekly', 22, 120 * H)],
  )));
  writeFileSync(join(workDir, 'fake-auth.json'), JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'thomas@work.example', subscriptionType: 'pro' }));
  const saved = saveSettings(dataDir, { accounts: [{ id: 'work', name: 'Work', configDir: workDir }] });
  if (saved.error) throw new Error(saved.error);
  return { claudeJsonPath, env: { FAKE_CLAUDE_AUTH: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'thomas@example.com', subscriptionType: 'max' }) } };
}

export async function boot({ steps = [], init, initFor, seed, scenario = {}, claudeMissing = false, accounts = false } = {}) {
  const dir = tmp('deck-dir-');
  const dataDir = join(dir, 'data');
  mkdirSync(dataDir, { recursive: true });
  if (seed) writeFileSync(join(dataDir, 'state.json'), JSON.stringify(seed));
  const acc = accounts ? accountsFixture(dir, dataDir) : { claudeJsonPath: null, env: {} };
  const scenarioFile = join(dir, 'scenario.json');
  writeFileSync(scenarioFile, JSON.stringify(scenario));
  const claudePath = claudeMissing ? join(dir, 'no-such-claude') : fakeClaude(dir, steps, { init, initFor });
  const app = createApp({ dataDir, claudePath, pluginRoot: plugin(), distDir: DIST, claudeJsonPath: acc.claudeJsonPath, parentEnv: { ...process.env, FAKE_EXO_SCENARIO: scenarioFile, ...acc.env } });
  const { port, url } = await app.start();
  const token = new URL(url).hash.replace(/^#token=/, '');
  const api = async (method, path, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  return {
    app, api, token, dir, port, scenarioFile,
    deckUrl: `http://127.0.0.1:${port}/#token=${token}`,
    queryUrl: `http://127.0.0.1:${port}/?token=${token}`,
    close: () => app.close(),
  };
}

export const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  for (let v; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if ((v = await fn())) return v;
  throw new Error('timed out');
};

export async function withCards(t, titles = []) {
  const project = (await t.api('POST', '/api/projects', { path: repo() })).body;
  const cards = [];
  for (const title of titles) cards.push((await t.api('POST', '/api/cards', { projectKey: project.key, title })).body);
  return { project, cards };
}

export const stateOf = async (t) => (await t.api('GET', '/api/state')).body;
