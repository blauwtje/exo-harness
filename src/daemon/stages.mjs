import { readFileSync } from 'node:fs';

const configUrl = new URL('../../config/stages.json', import.meta.url);

export const loadStages = () => JSON.parse(readFileSync(configUrl, 'utf8'));

const fill = (tools, pluginRoot) => tools.map((t) => t.replaceAll('<plugin-root>', pluginRoot));

export function buildArgs(stage, job, mode) {
  const s = loadStages().stages[stage];
  if (!s) throw new Error(`unknown stage: ${stage}`);
  return [
    mode === 'resume' ? '--resume' : '--session-id', job.sessionId,
    '--model', s.model,
    '--effort', s.effort,
    '--max-turns', String(s.maxTurns),
    '--max-budget-usd', String(s.maxBudgetUsd),
    '--permission-mode', s.permissionMode,
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-prompt-tool', 'stdio',
    '--exclude-dynamic-system-prompt-sections',
    '--allowedTools', ...fill(s.allowedTools, job.pluginRoot),
    '--disallowedTools', ...s.disallowedTools,
    '--append-system-prompt', s.systemPrompt,
  ];
}

export const userMessage = (stage, card) =>
  loadStages().stages[stage].userMessage.replace('{card}', () => `${card.title}\n\n${card.body}`);

export const cliOf = (pluginRoot) => `${pluginRoot}/skills/build/scripts/exo-cli.mjs`;

export const runArgs = (job, stage) => [
  cliOf(job.pluginRoot), 'run', job.brief, '--detach',
  '--max-run-usd', String(stage.maxRunUsd),
  '--max-budget-usd', String(stage.maxBudgetUsd),
];
