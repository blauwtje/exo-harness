import { useEffect, useState } from 'react';

const ARC = 'M 10 62 A 50 50 0 0 1 110 62';
const WINDOWS = [['five_hour', '5 hour', 'fiveHour'], ['seven_day', '7 day', 'sevenDay']];
const pointOnArc = (fraction, radius) => {
  const angle = Math.PI * fraction;
  return `${(60 - radius * Math.cos(angle)).toFixed(2)} ${(62 - radius * Math.sin(angle)).toFixed(2)}`;
};

function remaining(min) {
  if (min < 60) return `${min}m`;
  if (min < 2880) return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
  return `${Math.round(min / 1440)}d`;
}

function reset(at) {
  if (!at) return 'reset unknown';
  const min = Math.max(0, Math.round((at * 1000 - Date.now()) / 60000));
  return <>resets in <span className="num">{remaining(min)}</span></>;
}

function level(u) {
  if (u >= 0.9) return 'hot';
  if (u >= 0.75) return 'warm';
  return 'ok';
}

function resumeLine(resetsAt) {
  const min = Math.max(0, Math.round((resetsAt * 1000 - Date.now()) / 60000));
  return <>paused, resumes in <span className="num">{remaining(min)}</span></>;
}

function holdOf(id, state) {
  const pause = state?.queue?.pauses?.find((p) => p.reason === 'limit' && p.rateLimitType === id && p.resetsAt);
  if (pause) return pause;
  return state?.jobs?.map((j) => j.queued).find((q) => q?.rateLimitType === id && q.resetsAt);
}

function Gauge({ id, label, window, offline, ceiling, hold }) {
  const missingReading = offline ? 'not connected' : 'no reading yet';
  const u = offline ? null : window?.utilization;
  const has = typeof u === 'number';
  const used = has ? Math.min(1, Math.max(0, u)) : 0;
  const pct = has ? Math.round(u * 100) : null;
  return (
    <figure className="gauge" data-gauge={id} data-level={has ? level(u) : 'none'} data-ceiling={ceiling ?? undefined} data-held={hold ? 'true' : undefined}>
      {has ? (
        <svg viewBox="0 0 120 70" role="img" aria-label={`${label} limit window ${pct} percent used`}>
          <path d={ARC} className="arc-track" pathLength="100" />
          <path d={ARC} className="arc-fill" pathLength="100" strokeDasharray={`${(used * 100).toFixed(2)} 100`} />
          {ceiling == null ? null : <path d={`M ${pointOnArc(ceiling, 43)} L ${pointOnArc(ceiling, 57)}`} className="arc-ceiling" />}
        </svg>
      ) : <span className="sr">{label} limit window, {missingReading}</span>}
      <figcaption>
        <span className="g-value num">{has ? `${pct}%` : '—'}</span>
        <span className="g-label">{label}{ceiling == null ? '' : ` · ceiling ${Math.round(ceiling * 100)}%`}</span>
        <span className="g-sub">{hold ? resumeLine(hold.resetsAt) : has ? reset(window.resetsAt) : missingReading}</span>
      </figcaption>
    </figure>
  );
}

export default function Gauges({ rate, offline, state, api }) {
  const [settings, setSettings] = useState(null);
  useEffect(() => { api?.getSettings().then(setSettings, () => setSettings(null)); }, [api, state]);
  const overage = state?.needs?.find((n) => n.kind === 'overage');
  const extra = [...new Set((state?.queue?.pauses ?? []).filter((p) => p.reason === 'limit' && p.rateLimitType && !WINDOWS.some(([id]) => id === p.rateLimitType)).map((p) => p.rateLimitType))]
    .map((id) => [id, id.replaceAll('_', ' '), null]);
  return (
    <div className="gauges" role="group" aria-label="Usage limits">
      {[...WINDOWS, ...extra].map(([id, label, ceilingKey]) => (
        <Gauge key={id} id={id} label={label} window={rate?.windows?.[id] ?? state?.usage?.[id]} offline={offline}
          ceiling={settings?.ceilings?.[ceilingKey]} hold={offline ? null : holdOf(id, state)} />
      ))}
      {overage && !offline ? <p className="g-overage" role="status">Overage active{overage.resetsAt ? <>, {reset(overage.resetsAt)}</> : null}</p> : null}
    </div>
  );
}
