import test from 'node:test';
import assert from 'node:assert/strict';
import { loadStages, buildArgs, userMessage, runArgs } from '../src/daemon/stages.mjs';

const spec = loadStages().stages.spec;

const DENY = [
  'Bash(git push *)', 'Bash(gh *)', 'Bash(git reset *)', 'Bash(git rebase *)',
  'Bash(git cherry-pick *)', 'Bash(git merge *)', 'Bash(git tag *)', 'Bash(git switch *)',
  'Bash(git checkout *)', 'Bash(git branch -D *)', 'Bash(git commit *)', 'Bash(git stash *)',
  'Bash(git clean *)', 'Bash(git restore *)', 'Bash(node *settings.mjs*)',
  'Bash(node *memory.mjs*)', 'Bash(npm publish*)', 'Bash(npm *publish*)', 'Bash(vercel*)',
  'Bash(npx vercel*)', 'Bash(netlify deploy*)', 'Bash(fly deploy*)', 'Bash(flyctl deploy*)',
  'mcp__*',
];

test('every Decision 11 deny entry is in disallowedTools', () => {
  assert.deepEqual(spec.disallowedTools, DENY);
});

test('allowedTools has no bare git or node prefix and no Write or Edit', () => {
  for (const t of spec.allowedTools) {
    assert.doesNotMatch(t, /^Bash\((git|node):\*\)$/);
    assert.doesNotMatch(t, /^Bash\((git|node)\s*\*?\)$/);
    assert.doesNotMatch(t, /^(Write|Edit)/);
  }
  assert.equal(spec.allowedTools.length, 17);
});

test('the three texts are exact', () => {
  assert.equal(spec.systemPrompt, "This session is driven by a workflow (exo-harness): spec is invoked by a workflow, so at hand-off ask nothing and return to the caller; the harness queues the build itself so it stays inside the user's limits.");
  assert.equal(spec.userMessage, '/exo:spec {card}');
  assert.equal(spec.resumeMessage, 'This session was interrupted and has been resumed. The last tool call may not have finished: check its effect before you repeat any command that writes, then continue.');
  assert.equal(userMessage('spec', { title: 'T', body: 'B' }), '/exo:spec T\n\nB');
});

test('spec values', () => {
  assert.equal(spec.model, 'opus');
  assert.equal(spec.effort, 'medium');
  assert.equal(spec.maxTotalTurns, 200);
  assert.equal(spec.maxBudgetUsd, 10);
});

test('buildArgs carries the flags and fills plugin-root', () => {
  const a = buildArgs('spec', { sessionId: 'sid', pluginRoot: '/p' }, 'new');
  for (const f of ['--session-id', '--model', '--effort', '--max-turns', '--max-budget-usd',
    '--permission-mode', '--input-format', '--output-format', '--permission-prompt-tool',
    '--exclude-dynamic-system-prompt-sections', '--allowedTools', '--disallowedTools',
    '--append-system-prompt']) assert.ok(a.includes(f), f);
  assert.equal(a[a.indexOf('--permission-mode') + 1], 'default');
  assert.ok(a.includes('Bash(node /p/skills/spec/scripts/*)'));
  assert.ok(!a.some((x) => x.includes('<plugin-root>')));
  assert.equal(a[a.indexOf('--append-system-prompt') + 1], spec.systemPrompt);
  assert.ok(buildArgs('spec', { sessionId: 'sid', pluginRoot: '/p' }, 'resume').includes('--resume'));
});

test('F-3-02 runArgs gives the Decision 7 argv from the run caps', () => {
  const run = loadStages().stages.run;
  assert.deepEqual(run, { maxRunUsd: 30, maxBudgetUsd: 10, pollMs: 1000 });
  assert.deepEqual(runArgs({ pluginRoot: '/p', brief: '/b/plan.md' }, run), [
    '/p/skills/build/scripts/exo-cli.mjs', 'run', '/b/plan.md', '--detach',
    '--max-run-usd', '30', '--max-budget-usd', '10']);
});

test('F-3-10 stages.find-cause is read-only, sonnet, with the spec deny list', () => {
  const fc = loadStages().stages['find-cause'];
  assert.equal(fc.model, 'sonnet');
  assert.deepEqual(fc.disallowedTools, spec.disallowedTools);
  assert.deepEqual(fc.helperAllowlist, spec.helperAllowlist);
  assert.equal(fc.allowedTools.length, spec.allowedTools.length);
  assert.ok(fc.allowedTools.some((t) => t.includes('<plugin-root>/skills/find-cause/scripts/*')));
  assert.ok(!fc.allowedTools.some((t) => t.includes('skills/spec/scripts')));
  for (const t of fc.allowedTools) {
    assert.doesNotMatch(t, /^(Write|Edit)/);
    assert.doesNotMatch(t, /^Bash\((git|node)\s*\*?\)$/);
  }
  for (const d of ['Bash(git push *)', 'Bash(git commit *)', 'Bash(gh *)']) assert.ok(fc.disallowedTools.includes(d));
  const a = buildArgs('find-cause', { sessionId: 's', pluginRoot: '/p' }, 'new');
  assert.equal(a[a.indexOf('--model') + 1], 'sonnet');
  assert.ok(a.includes('Bash(node /p/skills/find-cause/scripts/*)'));
});
