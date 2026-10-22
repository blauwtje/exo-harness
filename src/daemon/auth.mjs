import { execFile } from 'node:child_process';
import { childEnv } from './child-env.mjs';

export const LOGIN = 'claude auth login --claudeai';
const INSTALL = 'npm install -g @anthropic-ai/claude-code';

const block = (reason, fix, extra = {}) => ({ ok: false, reason, fix, ...extra });
const str = (v) => (typeof v === 'string' && v ? v : null);
const nonSecretFields = (s) => ({ signedIn: s?.loggedIn === true, email: str(s?.email), subscriptionType: str(s?.subscriptionType), authMethod: str(s?.authMethod) });

function judge(stdout, fix) {
  let status;
  try {
    status = JSON.parse(stdout);
  } catch {
    return block('claude auth status did not return JSON', fix);
  }
  if (!status || status.loggedIn !== true) return block('claude is not logged in', fix, nonSecretFields(status));
  if (status.authMethod !== 'claude.ai') {
    return block(`claude authMethod is ${JSON.stringify(status.authMethod)}, not "claude.ai"`, fix, nonSecretFields(status));
  }
  return { ok: true, reason: 'logged in with claude.ai', fix: '', ...nonSecretFields(status) };
}

export function checkAuth({ claudePath = 'claude', timeout = 15000, parentEnv = process.env, login = LOGIN } = {}) {
  return new Promise((resolve) => {
    const env = childEnv('auth', parentEnv);
    execFile(claudePath, ['auth', 'status', '--json'], { timeout, env }, (err, stdout) => {
      if (err?.code === 'ENOENT') return resolve(block(`claude binary not found: ${claudePath}`, INSTALL));
      if (err?.killed) return resolve(block(`claude auth status timed out after ${timeout} ms`, `${claudePath} auth status --json`));
      if (err && !stdout) return resolve(block(`claude auth status failed: ${err.message}`, login));
      resolve(judge(stdout, login));
    });
  });
}
