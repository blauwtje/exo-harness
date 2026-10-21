const ARC = 'M 10 62 A 50 50 0 0 1 110 62';
const WINDOWS = [['five_hour', '5 hour'], ['seven_day', '7 day']];

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

function Gauge({ id, label, window, offline }) {
  const missingReading = offline ? 'not connected' : 'no reading yet';
  const u = offline ? null : window?.utilization;
  const has = typeof u === 'number';
  const used = has ? Math.min(1, Math.max(0, u)) : 0;
  const pct = has ? Math.round(u * 100) : null;
  return (
    <figure className="gauge" data-gauge={id} data-level={has ? level(u) : 'none'}>
      {has ? (
        <svg viewBox="0 0 120 70" role="img" aria-label={`${label} limit window ${pct} percent used`}>
          <path d={ARC} className="arc-track" pathLength="100" />
          <path d={ARC} className="arc-fill" pathLength="100" strokeDasharray={`${(used * 100).toFixed(2)} 100`} />
        </svg>
      ) : <span className="sr">{label} limit window, {missingReading}</span>}
      <figcaption>
        <span className="g-value num">{has ? `${pct}%` : '—'}</span>
        <span className="g-label">{label}</span>
        <span className="g-sub">{has ? reset(window.resetsAt) : missingReading}</span>
      </figcaption>
    </figure>
  );
}

export default function Gauges({ rate, offline }) {
  return (
    <div className="gauges" role="group" aria-label="Usage limits">
      {WINDOWS.map(([id, label]) => <Gauge key={id} id={id} label={label} window={rate?.windows?.[id]} offline={offline} />)}
    </div>
  );
}
