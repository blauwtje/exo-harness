export const STAGE_NAMES = {
  spec: 'Plan', build: 'Build', verify: 'Check', ship: 'Ship', 'find-cause': 'Find cause', run: 'Run', 'scout-triage': 'Scout',
};
const WORK_ORDER = ['spec', 'build', 'verify', 'ship', 'run', 'find-cause', 'scout-triage'];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ');
export const stageName = (stage) => STAGE_NAMES[stage] ?? cap(stage);

export const stagesInWorkOrder = (accountByStage = {}) => [...WORK_ORDER, ...Object.keys(accountByStage).filter((s) => !WORK_ORDER.includes(s))];

const DAY = 86_400_000;
const clock = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function resetWords(resetsAtS, now = Date.now()) {
  const at = new Date(resetsAtS * 1000);
  const days = Math.round((startOfDay(at) - startOfDay(new Date(now))) / DAY);
  const day = days === 0 ? 'today' : days === 1 ? 'tomorrow' : days < 7 ? WEEKDAY[at.getDay()] : `${at.getDate()} ${MONTH[at.getMonth()]}`;
  return `Resets ${day} ${clock(at)}`;
}

export function untilWords(resetsAtS, now = Date.now()) {
  const min = Math.round((resetsAtS * 1000 - now) / 60_000);
  if (min < 1) return 'under a minute';
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
  return `${Math.floor(min / 1440)}d ${Math.floor((min % 1440) / 60)}h`;
}

export const leftWords = (resetsAtS, now = Date.now()) => `in ${untilWords(resetsAtS, now)}`;

export function meterLevel(used, ceiling) {
  if (ceiling != null && used >= ceiling) return 'over';
  if (used >= 0.75) return 'warm';
  return 'calm';
}

export function renewWords(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : `Renews ${d.getDate()} ${MONTH[d.getMonth()]}`;
}
