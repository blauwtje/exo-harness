import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, root), 'utf8'));
const problems = [];

const tests = read('tests.json');
const list = Array.isArray(tests) ? tests : tests.tests;
if (!Array.isArray(list)) problems.push('tests.json: no test list');
const ids = (list ?? []).map((t) => t.id);
if (ids.some((id) => !id)) problems.push('tests.json: entry without id');
for (const id of ids.filter((id, i) => ids.indexOf(id) !== i)) problems.push(`tests.json: duplicate id ${id}`);

const scripts = read('package.json').scripts ?? {};
for (const name of ['start', 'test', 'check', 'accept', 'build:ui', 'e2e']) {
  if (!scripts[name]) problems.push(`package.json: missing script ${name}`);
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('validate: ok');
