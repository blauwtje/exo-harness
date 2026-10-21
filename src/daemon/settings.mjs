import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { join } from 'node:path';

const LAND = ['local', 'pr'];
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
});

const defaults = () => structuredClone(DEFAULTS);

const RULES = {
  ceilings: (v) => (isObj(v) && fraction(v.fiveHour) && fraction(v.sevenDay) ? null : 'ceilings.fiveHour and ceilings.sevenDay must be above 0 and at most 1'),
  hardStopFiveHour: (v) => (fraction(v) ? null : 'hardStopFiveHour must be above 0 and at most 1'),
  maxConcurrent: (v) => (Number.isInteger(v) && v >= 1 && v <= 16 ? null : 'maxConcurrent must be a whole number from 1 to 16'),
  landDefault: (v) => (LAND.includes(v) ? null : `landDefault must be one of ${LAND.join(', ')}`),
  landByProject: (v) => (isObj(v) && Object.values(v).every((x) => LAND.includes(x)) ? null : `landByProject values must be one of ${LAND.join(', ')}`),
  scouts: (v) => (isObj(v) && typeof v.enabled === 'boolean' ? null : 'scouts.enabled must be true or false'),
  overageAllowed: (v) => (typeof v === 'boolean' ? null : 'overageAllowed must be true or false'),
};

function sanitize(raw) {
  const out = defaults();
  if (!isObj(raw)) return out;
  for (const [key, rule] of Object.entries(RULES)) {
    if (key in raw && rule(raw[key]) === null) out[key] = raw[key];
  }
  out.ceilings = { fiveHour: out.ceilings.fiveHour, sevenDay: out.ceilings.sevenDay };
  out.scouts = { enabled: out.scouts.enabled };
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
    next[key] = (key === 'ceilings' || key === 'scouts') && isObj(v) ? { ...current[key], ...v } : v;
  }
  return next;
}

export function saveSettings(dataDir, patch) {
  if (!isObj(patch)) return { error: 'settings must be an object' };
  const next = merge(loadSettings(dataDir), patch);
  for (const [key, rule] of Object.entries(RULES)) {
    const error = key in patch ? rule(next[key]) : null;
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
