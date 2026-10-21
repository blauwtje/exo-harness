import { execFile } from 'node:child_process';

const ALLOWED = new Set(['repo list', 'repo clone', 'repo view', 'pr list', 'pr view', 'api', 'auth status']);
const API_WRITE_FLAGS = /^(-X|--method|-f|-F|--field|--raw-field|--input)(=|$)/;

function isWriteFlag(arg) {
  return API_WRITE_FLAGS.test(arg) || /^-[XfF]./.test(arg);
}

export function checkGhArgs(args) {
  if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) throw new Error('gh args must be a string array');
  const [a, b] = args;
  const key = a === 'api' ? 'api' : `${a} ${b}`;
  if (!ALLOWED.has(key)) throw new Error(`gh command not allowed: ${key}`);
  const badFlag = key === 'api' && args.slice(1).find(isWriteFlag);
  if (badFlag) throw new Error(`gh api flag not allowed: ${badFlag}`);
}

export function runGh(args, { timeout = 60000 } = {}) {
  checkGhArgs(args);
  return new Promise((resolve, reject) => {
    execFile('gh', args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stdout, stderr }));
      else resolve({ stdout, stderr });
    });
  });
}
