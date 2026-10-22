import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { LOGIN, checkAuth } from './auth.mjs';

export const DEFAULT_ID = 'default';
export const DEFAULT_ACCOUNT = Object.freeze({ id: DEFAULT_ID, name: 'Main', configDir: null });
export const ACCOUNT_ID = /^[a-z0-9-]{1,32}$/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' && v ? v : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const words = (s) => s.split(/[_\s-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export const isDefault = (account) => !account || account.id === DEFAULT_ID;
export const accountList = (settings) => [DEFAULT_ACCOUNT, ...(settings?.accounts ?? [])];

export function slugId(name, taken = []) {
  const used = new Set([DEFAULT_ID, ...taken]);
  const base = slug(String(name ?? '')).slice(0, 27).replace(/-+$/, '') || 'account';
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

export function accountEnv(parentEnv, account) {
  if (isDefault(account)) return parentEnv;
  return { ...parentEnv, CLAUDE_CONFIG_DIR: account.configDir };
}

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
export const loginCommand = (account) => (isDefault(account) ? LOGIN : `CLAUDE_CONFIG_DIR=${shq(account.configDir)} ${LOGIN}`);

export const defaultClaudeJsonPath = (env = process.env, home = homedir()) =>
  (env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, '.claude.json') : join(home, '.claude.json'));
export const claudeJsonPath = (account, defaultPath = null) => (isDefault(account) ? defaultPath : join(account.configDir, '.claude.json'));

const epochSecondsOf = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v > 1e12 ? Math.floor(v / 1000) : v;
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
};
const pct = (v) => (num(v) === null ? null : Math.min(100, Math.max(0, v)));

const LIMIT_ORDER = ['session', 'weekly_all'];
const KIND_LABEL = { session: 'Current session', weekly_all: 'This week' };
const groupOf = (kind) => (kind === 'session' ? 'session' : kind.startsWith('weekly') ? 'weekly' : 'other');
const LIMIT_BY_WINDOW_TYPE = {
  five_hour: ['session', 'session', 'Current session'],
  seven_day: ['weekly_all', 'weekly', 'This week'],
  seven_day_opus: ['weekly_scoped:opus', 'weekly', 'Opus'],
  seven_day_sonnet: ['weekly_scoped:sonnet', 'weekly', 'Sonnet'],
};

function jsonLimit(l, observedAt) {
  if (!isObj(l) || !str(l.kind)) return null;
  let id = l.kind;
  let label = KIND_LABEL[l.kind] ?? words(l.kind);
  if (l.kind === 'weekly_scoped') {
    const model = str(l.scope?.model?.display_name);
    if (!model || !slug(model)) return null;
    id = `weekly_scoped:${slug(model)}`;
    label = model;
  }
  return { id, label, group: str(l.group) ?? groupOf(l.kind), percent: pct(l.percent), resetsAt: epochSecondsOf(l.resets_at), observedAt };
}

function usageLimits(u) {
  const observedAt = num(u.fetchedAtMs);
  if (Array.isArray(u.limits)) return u.limits.map((l) => jsonLimit(l, observedAt)).filter(Boolean);
  const util = isObj(u.utilization) ? u.utilization : {};
  return Object.entries(LIMIT_BY_WINDOW_TYPE).filter(([type]) => isObj(util[type])).map(([type, [id, group, label]]) =>
    ({ id, label, group, percent: pct(util[type].utilization), resetsAt: epochSecondsOf(util[type].resets_at), observedAt }));
}

export function pickClaudeJson(raw) {
  const o = isObj(raw?.oauthAccount) ? raw.oauthAccount : {};
  const u = isObj(raw?.cachedUsageUtilization) ? raw.cachedUsageUtilization : null;
  return {
    oauth: {
      organizationType: str(o.organizationType),
      organizationRateLimitTier: str(o.organizationRateLimitTier),
      billingType: str(o.billingType),
      subscriptionCreatedAt: str(o.subscriptionCreatedAt),
      email: str(o.emailAddress),
    },
    limits: u ? usageLimits(u) : [],
  };
}

const jsonCache = new Map();
export function readClaudeJson(path) {
  if (!path) return null;
  let st;
  try { st = statSync(path); } catch { jsonCache.delete(path); return null; }
  const hit = jsonCache.get(path);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.value;
  let value;
  try { value = pickClaudeJson(JSON.parse(readFileSync(path, 'utf8'))); } catch { return hit?.value ?? null; }
  jsonCache.set(path, { mtimeMs: st.mtimeMs, size: st.size, value });
  return value;
}

export function planOf(oauth, auth) {
  const type = oauth?.organizationType ?? null;
  const tier = oauth?.organizationRateLimitTier ?? null;
  const fromTier = tier?.replace(/^default_/, '').replace(/^claude_/, '').replace(/_?\d+x$/, '') || null;
  const name = type?.replace(/^claude_/, '') || fromTier || auth?.subscriptionType || null;
  if (!name) return null;
  const x = tier?.match(/(\d+)x$/)?.[1];
  return { label: x ? `${words(name)} (${x}x)` : words(name), type: type ?? auth?.subscriptionType ?? null, tier };
}

export function renewal(createdIso, now = Date.now()) {
  const t = typeof createdIso === 'string' ? Date.parse(createdIso) : NaN;
  if (!Number.isFinite(t)) return { renewsAt: null, renewsEstimated: false };
  const c = new Date(t);
  const y = c.getUTCFullYear();
  const m = c.getUTCMonth();
  const at = (k) => {
    const last = new Date(Date.UTC(y, m + k + 1, 0)).getUTCDate();
    return Date.UTC(y, m + k, Math.min(c.getUTCDate(), last), c.getUTCHours(), c.getUTCMinutes(), c.getUTCSeconds(), c.getUTCMilliseconds());
  };
  const n = new Date(now);
  let k = Math.max(1, (n.getUTCFullYear() - y) * 12 + n.getUTCMonth() - m - 1);
  while (at(k) <= now) k++;
  return { renewsAt: new Date(at(k)).toISOString(), renewsEstimated: true };
}

export function limitsFromWindows(windows = {}) {
  return Object.entries(windows ?? {}).filter(([type, w]) => LIMIT_BY_WINDOW_TYPE[type] && num(w?.utilization) !== null).map(([type, w]) => {
    const [id, group, label] = LIMIT_BY_WINDOW_TYPE[type];
    return { id, label, group, percent: pct(Math.round(w.utilization * 1000) / 10), resetsAt: epochSecondsOf(w.resetsAt), observedAt: num(w.observedAt) };
  });
}

export function mergeLimits(...lists) {
  const out = new Map();
  for (const l of lists.flat()) {
    const had = out.get(l.id);
    if (!had || (l.observedAt ?? -Infinity) >= (had.observedAt ?? -Infinity)) out.set(l.id, l);
  }
  const rank = (id) => (LIMIT_ORDER.includes(id) ? LIMIT_ORDER.indexOf(id) : LIMIT_ORDER.length);
  return [...out.values()].sort((a, b) => rank(a.id) - rank(b.id));
}

export function limitsOf({ windows = {}, claudeJson = null, now = Date.now() } = {}) {
  return mergeLimits(limitsFromWindows(windows), claudeJson?.limits ?? []).map((l) =>
    (l.resetsAt !== null && l.resetsAt * 1000 < now ? { ...l, percent: null, stale: true } : { ...l, stale: false }));
}

export function windowsFromClaudeJson(claudeJson) {
  const back = Object.fromEntries(Object.entries(LIMIT_BY_WINDOW_TYPE).map(([type, [id]]) => [id, type]));
  return Object.fromEntries((claudeJson?.limits ?? []).filter((l) => back[l.id] && l.percent !== null)
    .map((l) => [back[l.id], { utilization: l.percent / 100, resetsAt: l.resetsAt, status: null, observedAt: l.observedAt }]));
}

export function createAccountAuth({ claudePath = 'claude', parentEnv = process.env, check = checkAuth } = {}) {
  const cache = new Map();
  const remember = (id, r) => {
    const v = { signedIn: r?.ok === true, email: r?.email ?? null, subscriptionType: r?.subscriptionType ?? null, reason: r?.reason ?? null, checkedAt: Date.now() };
    cache.set(id, v);
    return v;
  };
  return {
    get: (id) => cache.get(id) ?? null,
    remember,
    forget: (id) => cache.delete(id),
    async refresh(account) {
      return remember(account.id, await check({ claudePath, parentEnv: accountEnv(parentEnv, account), login: loginCommand(account) }));
    },
  };
}

export function accountView({ account, auth = null, claudeJson = null, windows = {}, now = Date.now() }) {
  const oauth = claudeJson?.oauth ?? null;
  const { renewsAt, renewsEstimated } = renewal(oauth?.subscriptionCreatedAt, now);
  return {
    id: account.id,
    name: account.name,
    configDir: account.configDir ?? null,
    isDefault: isDefault(account),
    signedIn: auth ? auth.signedIn : null,
    email: auth?.email ?? oauth?.email ?? null,
    plan: planOf(oauth, auth),
    renewsAt,
    renewsEstimated,
    loginCommand: loginCommand(account),
    limits: limitsOf({ windows, claudeJson, now }),
  };
}
