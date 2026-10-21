import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { loadStages } from './stages.mjs';

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

const deny = (message) => ({ behavior: 'deny', message });

const segments = (command) =>
  command.split(/&&|\|\||[;&|\n`()]|\$\(/).map((s) => s.trim().replace(/^(\w+=\S*\s+)+/, '')).filter(Boolean);

function bashRegex(rule) {
  const m = /^Bash\((.*)\)$/s.exec(rule);
  if (!m) return null;
  const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
  const body = m[1].endsWith(' *') ? `${esc(m[1].slice(0, -2))}(\\s.*)?` : esc(m[1]);
  return new RegExp(`^${body}$`, 's');
}

function denyListHit(command, rules) {
  const regexes = rules.map(bashRegex).filter(Boolean);
  const hit = [command, ...segments(command)].find((c) => regexes.some((r) => r.test(c)));
  return hit;
}

function realResolve(path) {
  try {
    return realpathSync(path);
  } catch {
    const up = dirname(path);
    return up === path ? path : join(realResolve(up), relative(up, path));
  }
}

function insideDocs(filePath, worktree) {
  if (typeof filePath !== 'string' || !filePath) return false;
  const root = realResolve(resolve(worktree));
  const target = realResolve(isAbsolute(filePath) ? resolve(filePath) : resolve(root, filePath));
  const docs = join(root, 'docs');
  return target.startsWith(docs + sep);
}

export function decide(request, stage, worktree) {
  const r = request.request ?? request;
  const cfg = loadStages().stages[stage];
  if (!cfg) return deny(`unknown stage: ${stage}`);
  const tool = r.tool_name;
  const input = r.input ?? {};
  if (tool === 'AskUserQuestion') return { behavior: 'ask', card: 'question' };
  if (tool === 'Bash') {
    const hit = denyListHit(String(input.command ?? ''), cfg.disallowedTools);
    if (hit) return deny(`Blocked by the harness: "${hit}" is not allowed in the ${stage} stage.`);
  }
  if (WRITE_TOOLS.has(tool) && !insideDocs(input.file_path ?? input.notebook_path, worktree)) {
    return deny(`Blocked by the harness: ${tool} may only write under docs/ in the worktree.`);
  }
  if (r.blocked_path) return { behavior: 'allow' };
  if (WRITE_TOOLS.has(tool)) return { behavior: 'allow' };
  return { behavior: 'ask', card: 'needs-you' };
}
