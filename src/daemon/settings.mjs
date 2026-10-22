import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { isAbsolute, join, normalize } from 'node:path';
import { ACCOUNT_ID, DEFAULT_ID } from './accounts.mjs';
import { loadStages } from './stages.mjs';

const LAND = ['local', 'pr'];
const WHERE = ['system', 'app', 'none'];
const KINDS = ['permission', 'question', 'invariant', 'turn-cap', 'failure', 'health', 'brief', 'gate', 'conflict', 'run-failed', 'setup', 'refusal', 'land', 'limit', 'budget', 'overage'];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const fraction = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1;

export const DEFAULTS = Object.freeze({
  ceilings: { fiveHour: 0.8, sevenDay: 0.7 },
  hardStopFiveHour: 0.92,
  maxConcurrent: 2,
  landDefault: 'local',
  landByProject: {},
  scouts: { enabled: false },
  overageAllowed: false,
  needsYou: ['question', 'permission', 'brief', 'gate', 'conflict', 'run-failed', 'setup', 'refusal', 'land', 'turn-cap'],
  alerts: {},
  accounts: [],
  accountByStage: {},
});

const defaults = () => structuredClone(DEFAULTS);

const CONTROL = /[\u0000-\u001f\u007f]/;
const cleanText = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !CONTROL.test(v);
const accountError = (a) => {
  if (!isObj(a)) return 'each account must be an object';
  if (typeof a.id !== 'string' || !ACCOUNT_ID.test(a.id) || a.id === DEFAULT_ID) return `account id ${JSON.stringify(a.id)} must match ${ACCOUNT_ID} and not be "${DEFAULT_ID}"`;
  if (!cleanText(a.name, 64)) return `account ${a.id} name must be 1 to 64 characters with no control characters`;
  if (!cleanText(a.configDir, 4096) || !isAbsolute(a.configDir) || normalize(a.configDir).replace(/(.)\/$/, '$1') !== a.configDir) return `account ${a.id} configDir must be a normalized absolute path`;
  return null;
};
const stageNames = () => Object.keys(loadStages().stages);
const pickError = (stage, id, ids) => {
  if (!stageNames().includes(stage)) return `accountByStage: unknown stage ${JSON.stringify(stage)}`;
  if (id !== DEFAULT_ID && !ids.includes(id)) return `accountByStage.${stage}: unknown account ${JSON.stringify(id)}`;
  return null;
};
const accountIds = (all) => (Array.isArray(all?.accounts) ? all.accounts.map((a) => a?.id) : []);

const RULES = {
  ceilings: (v) => (isObj(v) && fraction(v.fiveHour) && fraction(v.sevenDay) ? null : 'ceilings.fiveHour and ceilings.sevenDay must be above 0 and at most 1'),
  hardStopFiveHour: (v) => (fraction(v) ? null : 'hardStopFiveHour must be above 0 and at most 1'),
  maxConcurrent: (v) => (Number.isInteger(v) && v >= 1 && v <= 16 ? null : 'maxConcurrent must be a whole number from 1 to 16'),
  landDefault: (v) => (LAND.includes(v) ? null : `landDefault must be one of ${LAND.join(', ')}`),
  landByProject: (v) => (isObj(v) && Object.values(v).every((x) => LAND.includes(x)) ? null : `landByProject values must be one of ${LAND.join(', ')}`),
  scouts: (v) => (isObj(v) && typeof v.enabled === 'boolean' ? null : 'scouts.enabled must be true or false'),
  overageAllowed: (v) => (typeof v === 'boolean' ? null : 'overageAllowed must be true or false'),
  needsYou: (v) => (Array.isArray(v) && v.every((k) => KINDS.includes(k)) ? null : `needsYou must be a list of these kinds: ${KINDS.join(', ')}`),
  alerts: (v) => (isObj(v) && Object.values(v).every((a) => isObj(a) && WHERE.includes(a.where) && typeof a.sound === 'boolean') ? null : `alerts must map a kind to { where: ${WHERE.join(' | ')}, sound: true or false }`),
  accounts: (v) => {
    if (!Array.isArray(v)) return 'accounts must be a list';
    const bad = v.map(accountError).find(Boolean);
    if (bad) return bad;
    return new Set(v.map((a) => a.id)).size === v.length ? null : 'account ids must be unique';
  },
  accountByStage: (v, all) => {
    if (!isObj(v)) return 'accountByStage must map a stage to an account id';
    return Object.entries(v).map(([stage, id]) => pickError(stage, id, accountIds(all))).find(Boolean) ?? null;
  },
};
const LINKED = { accountByStage: ['accounts'] };

function sanitize(raw) {
  const out = defaults();
  if (!isObj(raw)) return out;
  for (const [key, rule] of Object.entries(RULES)) {
    if (key in raw && rule(raw[key], raw) === null) out[key] = raw[key];
  }
  out.ceilings = { fiveHour: out.ceilings.fiveHour, sevenDay: out.ceilings.sevenDay };
  out.scouts = { enabled: out.scouts.enabled };
  out.needsYou = [...new Set(out.needsYou)];
  out.alerts = Object.fromEntries(Object.entries(out.alerts).map(([k, a]) => [k, { where: a.where, sound: a.sound }]));
  const seen = new Set();
  out.accounts = (Array.isArray(raw.accounts) ? raw.accounts : []).filter((a) => !accountError(a) && !seen.has(a.id) && seen.add(a.id))
    .map((a) => ({ id: a.id, name: a.name, configDir: a.configDir }));
  const ids = out.accounts.map((a) => a.id);
  out.accountByStage = Object.fromEntries(Object.entries(isObj(raw.accountByStage) ? raw.accountByStage : {}).filter(([stage, id]) => !pickError(stage, id, ids)));
  return out;
}

export function loadSettings(dataDir) {
  try {
    return sanitize(JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8')));
  } catch (e) {
    if (e.code === 'ENOENT' || e instanceof SyntaxError) return defaults();
    throw e;
  }
}

function merge(current, patch) {
  const next = { ...current };
  for (const key of Object.keys(RULES)) {
    if (!(key in patch)) continue;
    const v = patch[key];
    next[key] = ['ceilings', 'scouts', 'accountByStage'].includes(key) && isObj(v) ? { ...current[key], ...v } : v;
  }
  return next;
}

export function saveSettings(dataDir, patch) {
  if (!isObj(patch)) return { error: 'settings must be an object' };
  const next = merge(loadSettings(dataDir), patch);
  for (const [key, rule] of Object.entries(RULES)) {
    const touched = key in patch || (LINKED[key] ?? []).some((k) => k in patch);
    const error = touched ? rule(next[key], next) : null;
    if (error) return { error };
  }
  const settings = sanitize(next);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, 'settings.json');
  const tmp = `${path}.${process.pid}.tmp`;
  const fd = openSync(tmp, 'w', 0o600);
  try {
    writeSync(fd, JSON.stringify(settings, null, 2));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
  return { settings };
}
