import { readFileSync } from 'node:fs';

const configUrl = new URL('../../config/stages.json', import.meta.url);

export function loadStages(url = configUrl) {
  const config = JSON.parse(readFileSync(url, 'utf8'));
  for (const [name, s] of Object.entries(config.stages)) {
    if (!Array.isArray(s.windows) || s.windows.length === 0) throw new Error(`stage ${name} has no windows`);
  }
  return config;
}

const stageOf = (stage) => {
  const s = loadStages().stages[stage];
  if (!s) throw new Error(`unknown stage: ${stage}`);
  return s;
};

export const stageWindows = (stage) => stageOf(stage).windows;
export const seedP75 = (stage) => stageOf(stage).seedP75;

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
