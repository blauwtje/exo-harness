import { execFile } from 'node:child_process';
import { childEnv } from './child-env.mjs';

const LOGIN = 'claude auth login --claudeai';
const INSTALL = 'npm install -g @anthropic-ai/claude-code';

const block = (reason, fix) => ({ ok: false, reason, fix });

function judge(stdout) {
  let status;
  try {
    status = JSON.parse(stdout);
  } catch {
    return block('claude auth status did not return JSON', LOGIN);
  }
  if (!status || status.loggedIn !== true) return block('claude is not logged in', LOGIN);
  if (status.authMethod !== 'claude.ai') {
    return block(`claude authMethod is ${JSON.stringify(status.authMethod)}, not "claude.ai"`, LOGIN);
  }
  return { ok: true, reason: 'logged in with claude.ai', fix: '' };
}

export function checkAuth({ claudePath = 'claude', timeout = 15000, parentEnv = process.env } = {}) {
  return new Promise((resolve) => {
    const env = childEnv('auth', parentEnv);
    execFile(claudePath, ['auth', 'status', '--json'], { timeout, env }, (err, stdout) => {
      if (err?.code === 'ENOENT') return resolve(block(`claude binary not found: ${claudePath}`, INSTALL));
      if (err?.killed) return resolve(block(`claude auth status timed out after ${timeout} ms`, `${claudePath} auth status --json`));
      if (err && !stdout) return resolve(block(`claude auth status failed: ${err.message}`, LOGIN));
      resolve(judge(stdout));
    });
  });
}
