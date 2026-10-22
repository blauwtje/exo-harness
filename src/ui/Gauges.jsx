import { useEffect, useState } from 'react';
import { meterLevel, untilWords } from './accounts.js';

const WINDOWS = [
  ['five_hour', 'Session', 'fiveHour', (ls) => ls.find((l) => l.group === 'session')],
  ['seven_day', 'Week', 'sevenDay', (ls) => ls.find((l) => l.id === 'weekly_all') ?? ls.find((l) => l.group === 'weekly')],
];
const EXTRA_LABEL = { seven_day_opus: 'Opus week', seven_day_sonnet: 'Sonnet week' };
const clamp = (u) => Math.min(1, Math.max(0, u));
const isRead = (u) => typeof u === 'number';
const nowS = () => Date.now() / 1000;


function holdOf(id, state) {
  const pause = state?.queue?.pauses?.find((p) => p.reason === 'limit' && p.rateLimitType === id && p.resetsAt);
  if (pause) return pause;
  return state?.jobs?.map((j) => j.queued).find((q) => q?.rateLimitType === id && q.resetsAt);
}

function accountLimitOrRateReading(state, rate, pick, id) {
  const limits = state?.accounts?.[0]?.limits;
  const limit = Array.isArray(limits) ? pick(limits) : null;
  if (limit && typeof limit.percent === 'number' && !limit.stale) return { u: limit.percent / 100, resetsAt: limit.resetsAt ?? null };
  const window = rate?.windows?.[id] ?? state?.usage?.[id];
  if (window && isRead(window.utilization)) return { u: window.utilization, resetsAt: window.resetsAt ?? null };
  return { u: null, resetsAt: null, stale: Boolean(limit?.stale) };
}

function subText({ row, offline }) {
  if (row.hold) return <>Paused, resumes in <span className="num">{untilWords(row.hold.resetsAt)}</span></>;
  if (offline) return 'Not connected';
  if (row.old) return 'No fresh reading';
  if (isRead(row.u)) return row.resetsAt ? <>resets in <span className="num">{untilWords(row.resetsAt)}</span></> : 'Reset time unknown';
  return 'No reading yet';
}

function Bar({ row, offline }) {
  const has = isRead(row.u);
  const pct = has ? Math.round(row.u * 100) : null;
  return (
    <span className="gbar" data-gauge={row.id} data-level={has ? meterLevel(row.u, row.ceiling) : 'none'} data-ceiling={row.ceiling ?? undefined} data-held={row.hold ? 'true' : undefined} data-over={has && row.ceiling != null && row.u >= row.ceiling ? 'true' : undefined}>
      <span className="gbar-head">
        <span className="gbar-label">{row.label}</span>
        <span className="gbar-pct num">{has ? `${pct}% used` : '–'}</span>
      </span>
      <span className="gbar-track" aria-hidden="true">
        {has ? <span className="gbar-fill" style={{ width: `${(clamp(row.u) * 100).toFixed(1)}%` }} /> : null}
        {row.ceiling == null ? null : <span className="gbar-tick" style={{ left: `${(clamp(row.ceiling) * 100).toFixed(1)}%` }} />}
      </span>
      <span className="gbar-sub">{subText({ row, offline })}</span>
      {row.ceiling == null ? null : <span className="sr">, ceiling {Math.round(row.ceiling * 100)}%</span>}
    </span>
  );
}

function spokenOf({ rows, offline, overage }) {
  if (offline) return 'Usage limits, not connected';
  const parts = rows.map((r) => (isRead(r.u) ? `${r.label} ${Math.round(r.u * 100)}% used` : `${r.label} no reading yet`));
  const held = rows.some((r) => r.hold) ? ', queue paused' : '';
  const extra = overage ? ', overage active' : '';
  return `Usage limits: ${parts.join(', ')}${held}${extra}`;
}

export default function Gauges({ rate, offline, state, api, inline = false, onOpen }) {
  const [settings, setSettings] = useState(null);
  useEffect(() => { api?.getSettings().then(setSettings, () => setSettings(null)); }, [api, state]);

  const overage = offline ? null : state?.needs?.find((n) => n.kind === 'overage');
  const main = WINDOWS.map(([id, label, ceilingKey, pick]) => {
    const read = offline ? { u: null, resetsAt: null } : accountLimitOrRateReading(state, rate, pick, id);
    const old = !offline && (read.stale || (isRead(read.u) && read.resetsAt != null && read.resetsAt < nowS()));
    return { id, label, u: old ? null : read.u, resetsAt: read.resetsAt, old, ceiling: settings?.ceilings?.[ceilingKey], hold: offline ? null : holdOf(id, state) };
  });
  const pausedOtherWindows = offline ? [] : [...new Set((state?.queue?.pauses ?? []).filter((p) => p.reason === 'limit' && p.rateLimitType && !WINDOWS.some(([id]) => id === p.rateLimitType)).map((p) => p.rateLimitType))]
    .map((id) => {
      const window = rate?.windows?.[id] ?? state?.usage?.[id];
      return { id, label: EXTRA_LABEL[id] ?? id.replaceAll('_', ' '), u: window?.utilization ?? null, resetsAt: window?.resetsAt ?? null, old: false, ceiling: null, hold: holdOf(id, state) };
    });
  const rows = [...main, ...pausedOtherWindows];
  const show = inline ? !offline : rows.some((r) => isRead(r.u) || r.hold || r.old) || Boolean(overage);
  if (!show) return null;

  const who = (state?.accounts?.length ?? 0) > 1 ? state.accounts[0].name : null;
  return (
    <a className={`usage${inline ? ' usage-inline' : ''}`} href="#/usage" aria-label={spokenOf({ rows, offline, overage })} title={who ? `Usage of ${who}` : undefined} onClick={onOpen}>
      {rows.map((r) => <Bar key={r.id} row={r} offline={offline} />)}
      {rows.some((r) => r.hold) || overage ? (
        <span className="usage-pills" aria-hidden="true">
          {rows.some((r) => r.hold) ? <span className="pill">Paused</span> : null}
          {overage ? <span className="pill pill-warning">Overage</span> : null}
        </span>
      ) : null}
    </a>
  );
}
