import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const arg = process.argv.indexOf('--phase');
const phase = Number(process.argv[arg + 1]);
if (arg < 0 || !Number.isInteger(phase)) {
  console.error('usage: phase-status.mjs --phase <n>');
  process.exit(2);
}
const read = (f) => readFileSync(root + f, 'utf8');
const idRe = /\b[FSC]-(?:\d+-)?\d+\b/g;
const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });

const passed = new Set();
const failed = new Set();
const note = (title, ok) => { for (const id of title.match(idRe) ?? []) (ok ? passed : failed).add(id); };

const unit = run(process.execPath, ['--test', '--test-reporter=spec', 'test/*.test.mjs']);
for (const line of unit.stdout.split('\n')) {
  const m = line.match(/^\s*([✔✖]) (.*?)(?: \([\d.]+ms\))?$/u);
  if (m) note(m[2], m[1] === '✔');
}

const pw = run('npx', ['playwright', 'test', '--reporter=json']);
const walk = (suite) => {
  for (const s of suite.specs ?? []) note(s.title, s.ok);
  (suite.suites ?? []).forEach(walk);
};
try { walk(...[JSON.parse(pw.stdout)].map((r) => ({ suites: r.suites }))); } catch { console.error('phase-status: no Playwright result'); }

const proved = (id) => {
  if (id === 'F-2-22') return existsSync(root + 'docs/design/contract-selected.json');
  if (id === 'F-3-01') return /^## Probe P3$/m.test(read('docs/facts.md'));
  if (id === 'C-07') return /^- Next: .*phase 3/im.test(read('docs/progress.md'));
  return passed.has(id) && !failed.has(id);
};

const tests = JSON.parse(read('tests.json'));
const open = [];
for (const t of tests.filter((t) => t.phase === phase)) {
  t.status = proved(t.id) ? 'pass' : 'fail';
  if (t.status === 'fail') open.push(t.id);
}
writeFileSync(root + 'tests.json', JSON.stringify(tests, null, 2) + '\n');
const mine = tests.filter((t) => t.phase === phase);
console.log(`phase ${phase}: ${mine.length - open.length}/${mine.length} pass`);
if (open.length) console.log(`no passing test names: ${open.join(' ')}`);
