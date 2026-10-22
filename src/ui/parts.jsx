import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useMotionPaused } from './motion.js';

const EASE = [0.22, 1, 0.36, 1];
export const dur = { quick: 0.12, base: 0.2, slow: 0.28 };
export const spring = { duration: dur.slow, ease: EASE };
export const fade = { duration: dur.quick, ease: EASE };

const instant = { duration: 0 };
const calmFull = { fade, spring, slide: { duration: dur.base, ease: EASE }, fold: { duration: dur.base, ease: EASE }, dialog: { duration: dur.slow, ease: EASE } };
const calmReduced = { fade, spring: fade, slide: fade, fold: instant, dialog: fade };

export function useCalm() {
  const reduced = !!useReducedMotion();
  const [paused] = useMotionPaused();
  return { reduced, paused, ...(reduced ? calmReduced : calmFull), offset: (px) => (reduced ? 0 : px) };
}

export function PauseMotion({ className = '' }) {
  const [paused, setPaused] = useMotionPaused();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={paused}
      className={`switch${className ? ` ${className}` : ''}`}
      onClick={() => setPaused(!paused)}
    >
      <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
      <span>Pause motion</span>
    </button>
  );
}

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
  if (scope === 'card' && s === 'done') return 'Session done';
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
    <motion.span key={n} className={`count${signal && n ? ' count-signal' : ''}`} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} transition={fade}>
      {n}
    </motion.span>
  );
}
