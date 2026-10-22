import { useSyncExternalStore } from 'react';

export const fast = 0.14;
export const base = 0.22;
export const slow = 0.32;
export const ease = [0.22, 1, 0.36, 1];
export const easeInOut = [0.65, 0, 0.35, 1];
export const spring = { type: 'spring', stiffness: 380, damping: 34 };
export const exit = (seconds) => seconds * 0.7;

export const squish = {
  whileTap: { scale: 0.94 },
  transition: { type: 'spring', stiffness: 600, damping: 18, mass: 0.6 },
};

export const carMove = { type: 'spring', stiffness: 170, damping: 19, mass: 0.9 };

export const fadeRise = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: base, ease } },
  exit: { opacity: 0, transition: { duration: exit(base), ease } },
};

export const panel = {
  initial: { opacity: 0, x: 12 },
  animate: { opacity: 1, x: 0, transition: { duration: slow, ease } },
  exit: { opacity: 0, x: 12, transition: { duration: exit(slow), ease } },
};

export const listStagger = {
  container: { animate: { transition: { staggerChildren: 0.03 } } },
  item: (index = 0) => ({
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0, transition: { duration: base, ease, delay: Math.min(index, 6) * 0.03 } },
  }),
};

export const PAUSE_KEY = 'exo.pauseMotion';
const listeners = new Set();

function readSaved() {
  try { return globalThis.localStorage?.getItem(PAUSE_KEY) === '1'; } catch { return false; }
}

function mirror(paused) {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  if (paused) root.dataset.motion = 'paused';
  else delete root.dataset.motion;
}

let paused = readSaved();
mirror(paused);

export function motionPaused() {
  return paused;
}

function save(value) {
  try {
    globalThis.localStorage?.setItem(PAUSE_KEY, value ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

export function setMotionPaused(next) {
  paused = !!next;
  save(paused);
  mirror(paused);
  for (const fn of listeners) fn();
}

function subscribe(fn) {
  listeners.add(fn);
  const onStorage = (e) => {
    if (e.key !== PAUSE_KEY) return;
    paused = e.newValue === '1';
    mirror(paused);
    fn();
  };
  globalThis.addEventListener?.('storage', onStorage);
  return () => { listeners.delete(fn); globalThis.removeEventListener?.('storage', onStorage); };
}

export function useMotionPaused() {
  const value = useSyncExternalStore(subscribe, motionPaused, () => false);
  return [value, setMotionPaused];
}

export function loop({ keyframes, rest, isPaused = paused, seconds = 2.4 }) {
  if (isPaused) return { animate: rest, transition: { duration: 0 } };
  return { animate: keyframes, transition: { duration: seconds, ease: easeInOut, repeat: Infinity } };
}

export default { fast, base, slow, ease, easeInOut, spring, exit, squish, carMove, fadeRise, panel, listStagger, loop };
