import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { loadStages } from './stages.mjs';

const blocks = (event) =>
  event?.type === 'assistant' && Array.isArray(event.message?.content) ? event.message.content : [];

export function isBuildDispatch(event, stage) {
  const s = loadStages().stages[stage];
  if (!s) throw new Error(`unknown stage: ${stage}`);
  return blocks(event).some((b) => {
    if (b?.type !== 'tool_use') return false;
    if (b.name === 'Agent') return !s.helperAllowlist.includes(b.input?.subagent_type);
    if (b.name === 'Skill') return /^(exo:)?build$/.test(String(b.input?.skill ?? '').trim());
    return false;
  });
}

async function newBriefs(worktree, startedAt) {
  const dir = join(worktree, 'docs', 'specs');
  let names;
  try { names = await readdir(dir); } catch { return []; }
  const found = [];
  for (const n of names) {
    if (!n.endsWith('.md')) continue;
    const p = join(dir, n);
    const st = await stat(p);
    if (st.isFile() && st.mtimeMs >= startedAt) found.push(p);
  }
  return found;
}

const planCheck = (script, brief, worktree) =>
  new Promise((resolve) => {
    execFile(process.execPath, [script, '--plan', brief, '--root', worktree, '--loop', '--run'],
      { cwd: worktree, timeout: 120000 }, (err) => resolve(!err));
  });

export async function isDone(worktree, startedAt, { pluginRoot }) {
  const script = join(pluginRoot, 'skills', 'spec', 'scripts', 'plan-check.mjs');
  for (const brief of await newBriefs(worktree, startedAt)) {
    if (await planCheck(script, brief, worktree)) return brief;
  }
  return null;
}
