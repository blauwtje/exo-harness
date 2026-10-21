import { execFile } from 'node:child_process';
import { childEnv } from './child-env.mjs';
import { cliOf, loadStages, runArgs } from './stages.mjs';

export const FINAL_PHASES = ['passed', 'landed', 'parked', 'stopped', 'refused', 'crashed'];

// why: argv array and the exo-run env scrub, so the user's CLAUDECODE never reaches exo.
const exo = (args, cwd, parentEnv) =>
  new Promise((resolve) => {
    execFile(process.execPath, args, { cwd, env: childEnv('exo-run', parentEnv), timeout: 60000 }, (err, stdout, stderr) =>
      resolve({ err, stdout: String(stdout), stderr: String(stderr) }));
  });

const text = (r) => (r.stderr.trim() || r.stdout.trim() || String(r.err?.message ?? ''));

export const classify = (out) => (/\block\b|already running|held by/i.test(out) ? 'lock' : /dirty|uncommitted|not clean|working tree/i.test(out) ? 'dirty' : 'other');

export async function startRun({ pluginRoot, cwd, brief, parentEnv = process.env }) {
  const args = runArgs({ pluginRoot, brief }, loadStages().stages.run);
  const r = await exo(args, cwd, parentEnv);
  if (r.err) {
    const out = text(r);
    return { refusal: classify(out), text: out };
  }
  const runId = r.stdout.match(/exo: run (\S+) started in the background/)?.[1];
  return runId ? { runId } : { refusal: 'other', text: text(r) };
}

async function again(args, cwd, parentEnv) {
  const r = await exo(args, cwd, parentEnv);
  return r.err ? { ok: false, text: text(r) } : { ok: true, text: r.stdout.trim() };
}

export const approveRun = ({ pluginRoot, cwd, runId, parentEnv = process.env }) =>
  again([cliOf(pluginRoot), 'approve', runId], cwd, parentEnv);

export const resumeRun = ({ pluginRoot, cwd, runId, parentEnv = process.env }) =>
  again([cliOf(pluginRoot), 'run', '--resume', runId], cwd, parentEnv);

export function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// why: a queued job retries once its holder is final or its process is gone (S-07).
export const holderDone = (holder) => FINAL_PHASES.includes(holder?.phase) || !(holder?.pid && alive(holder.pid));
