const ALWAYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'FORCE_PROMPT_CACHING_5M',
];

const isRunVar = (name) => name === 'CLAUDECODE' || name.startsWith('CLAUDE_CODE_');

export function childEnv(kind, parent = process.env) {
  const drop = (name) => ALWAYS.includes(name) || (kind === 'exo-run' && isRunVar(name));
  return Object.fromEntries(Object.entries(parent).filter(([name]) => !drop(name)));
}
