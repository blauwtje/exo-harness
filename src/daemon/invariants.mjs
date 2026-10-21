import { realpathSync } from 'node:fs';

const real = (p) => {
  try { return realpathSync(p); } catch { return p; }
};

export function checkInit(init, expected) {
  const mismatches = [];
  const exo = (Array.isArray(init?.plugins) ? init.plugins : []).find((p) => p?.name === 'exo');
  if (init?.apiKeySource !== (expected.apiKeySource ?? 'none')) mismatches.push('apiKeySource');
  if (init?.permissionMode !== expected.permissionMode) mismatches.push('permissionMode');
  if (!exo) mismatches.push('plugins');
  if (typeof init?.cwd !== 'string' || real(init.cwd) !== real(expected.cwd)) mismatches.push('cwd');
  const stamps = {
    claudeCodeVersion: init?.claude_code_version ?? null,
    exoVersion: exo?.version ?? null,
    model: init?.model ?? null,
    effort: expected.effort ?? null,
  };
  return { mismatches, stamps };
}
