import { useEffect, useState } from 'react';
import { motion } from 'motion/react';

export const spring = { type: 'spring', stiffness: 520, damping: 48, mass: 0.9 };
export const fade = { duration: 0.16, ease: [0.2, 0, 0, 1] };

export function Mark({ status, label }) {
  return (
    <span className={`mark mark-${status}`} role="img" aria-label={label ?? status}>
      <i aria-hidden="true" />
    </span>
  );
}

export const STATUS_WORD = {
  queued: 'Queued', running: 'Running', waiting: 'Waiting on you', done: 'Done', crashed: 'Crashed', stopped: 'Stopped', refused: 'Refused',
};

function statusWord(s, scope) {
  if (s === 'invariant') return 'Invariant broke';
  if (scope === 'card' && s === 'done') return 'Job done';
  return STATUS_WORD[s] ?? s;
}

export function Status({ job, scope }) {
  if (!job) return null;
  const s = job.outcome === 'invariant' ? 'invariant' : job.status;
  return (
    <span className="status">
      <Mark status={s} label={STATUS_WORD[s] ?? s} />
      <span>{statusWord(s, scope)}</span>
    </span>
  );
}

export function useBelow(ref, selector, dep) {
  const [below, setBelow] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const edge = el.getBoundingClientRect().bottom;
      setBelow([...el.querySelectorAll(selector)].filter((x) => x.getBoundingClientRect().bottom > edge + 1).length);
    };
    measure();
    el.addEventListener('scroll', measure);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', measure); ro.disconnect(); };
  }, [ref, selector, dep]);
  return below;
}

export function Count({ n, signal }) {
  return (
    <motion.span key={n} className={`count${signal && n ? ' count-signal' : ''}`} initial={{ y: -4, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={spring}>
      {n}
    </motion.span>
  );
}
