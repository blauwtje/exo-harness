import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args[0] === 'set' && args[1] === 'budget') {
  const i = args.indexOf('--scope');
  const scope = i < 0 ? null : args[i + 1];
  if (process.env.FAKE_SETTINGS_LOG) appendFileSync(process.env.FAKE_SETTINGS_LOG, `${JSON.stringify({ key: 'budget', value: args[2], scope })}\n`);
  if (scope !== 'local') { console.error('budget dial writes the local scope only'); process.exit(1); }
  console.log(`budget=${args[2]} (local)`);
} else {
  console.log('docs');
}
