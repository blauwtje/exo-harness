import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { childEnv } from './child-env.mjs';
import { checkInit } from './invariants.mjs';
import { decide } from './permissions.mjs';
import { isBuildDispatch } from './shape-guard.mjs';
import { buildArgs, loadStages, userMessage } from './stages.mjs';
import { parseLine } from './stream.mjs';
import { classifyTurn } from './turns.mjs';

const run = promisify(execFile);

const userLine = (text) => `${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`;
const replyLine = (requestId, response) =>
  `${JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } })}\n`;

export const killGroup = (pgid, signal, report = console.error) => {
  try {
    process.kill(-pgid, signal);
  } catch (err) {
    // ESRCH: the group is already gone, which is what a kill wants. Anything else (EPERM) means it may still run.
    if (err.code !== 'ESRCH') report(`exo-harness: kill -${pgid} ${signal} failed: ${err.code ?? err.message}`);
  }
};

const textOf = (event) =>
  (event.message?.content ?? []).filter((b) => b?.type === 'text').map((b) => b.text).join('');

export async function startSession({
  store, state, job, card, worktree, pluginRoot, mode = 'start', claudePath = 'claude',
  parentEnv = process.env, onTurn = () => {}, onAsk = () => {},
}) {
  const stage = loadStages().stages[job.stage];
  job.sessionId ??= randomUUID();
  job.pluginRoot = pluginRoot;
  job.status = 'starting';
  store.save(state);

  const child = spawn(claudePath, buildArgs(job.stage, job, mode), {
    cwd: worktree, env: childEnv('exo-run', parentEnv), detached: true, stdio: ['pipe', 'pipe', 'ignore'],
  });
  const pgid = child.pid;
  let reason = null;
  let timer = null;
  const done = new Promise((resolve) => {
    child.on('error', (err) => { reason ??= 'spawn-error'; resolve({ code: null, signal: null, reason, error: err.message }); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (pgid && reason) killGroup(pgid, 'SIGKILL');
      resolve({ code, signal, reason });
    });
  });
  child.stdin.on('error', () => {});
  const write = (line) => child.stdin.writable && child.stdin.write(line);

  const kill = (why, signal, graceMs) => {
    reason ??= why;
    if (!pgid) return;
    killGroup(pgid, signal);
    if (graceMs) timer = setTimeout(() => killGroup(pgid, 'SIGKILL'), graceMs);
  };

  const open = new Set();
  let lastText = '';
  const handle = (raw) => {
    const rec = parseLine(raw);
    store.appendEvent(job.id, rec.event ?? { kind: 'malformed', raw });
    const { event } = rec;
    if (!event) return;
    if (rec.type === 'system' && rec.subtype === 'init') {
      const { mismatches, stamps } = checkInit(event, {
        permissionMode: stage.permissionMode, cwd: worktree, effort: stage.effort,
      });
      Object.assign(job, stamps);
      if (mismatches.length) { job.initMismatches = mismatches; kill('init-mismatch', 'SIGKILL'); }
      store.save(state);
    } else if (rec.type === 'system' && rec.subtype === 'task_started') open.add(event.task_id);
    else if (rec.type === 'system' && rec.subtype === 'task_notification') open.delete(event.task_id);
    else if (rec.type === 'assistant') {
      if (isBuildDispatch(event, job.stage)) return kill('refused', 'SIGKILL');
      lastText = textOf(event) || lastText;
    } else if (rec.type === 'result') {
      const text = lastText;
      lastText = '';
      if (open.size === 0) onTurn({ ...classifyTurn(text), text, event });
    } else if (rec.type === 'control_request' && event.request?.subtype === 'can_use_tool') {
      const d = decide(event, job.stage, worktree);
      if (d.behavior === 'ask') return onAsk(event.request_id, event.request, d);
      write(replyLine(event.request_id, d.behavior === 'allow'
        ? { behavior: 'allow', updatedInput: event.request.input } : d));
    }
  };
  createInterface({ input: child.stdout }).on('line', handle);

  write(userLine(mode === 'resume' ? stage.resumeMessage : userMessage(job.stage, card)));
  if (pgid) {
    const lstart = await run('ps', ['-o', 'lstart=', '-p', String(pgid)]).then((r) => r.stdout.trim(), () => null);
    Object.assign(job, { pid: pgid, pgid, startedAtLstart: lstart, status: 'running' });
    store.save(state);
  }

  return {
    pid: pgid, pgid, done,
    send: (text) => write(userLine(text)),
    answer: (requestId, response) => write(replyLine(requestId, response)),
    end: () => child.stdin.end(),
    stop: () => kill('stopped', 'SIGTERM', loadStages().killGraceMs),
  };
}
