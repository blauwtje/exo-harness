import { useCallback, useEffect, useRef, useState } from 'react';
import { KIND_WORD, titleOf } from './NeedsYou.jsx';

const MAX_TOASTS = 4;

export function newItems({ prev, items }) {
  if (!prev) return [];
  return items.filter((i) => !prev.has(i.key));
}

function beep() {
  try {
    const ctx = new AudioContext();
    const tone = ctx.createOscillator();
    tone.connect(ctx.destination);
    tone.onended = () => ctx.close();
    tone.start();
    tone.stop(ctx.currentTime + 0.18);
  } catch (e) {
    console.warn(`Alert sound could not play: ${e.message}`);
  }
}

function desktop({ item, text }) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  new Notification(KIND_WORD[item.kind] ?? item.kind, { body: text, tag: item.key });
  return true;
}

function raise({ item, way }) {
  const text = titleOf(item);
  if (way.sound) beep();
  if (way.where === 'system' && desktop({ item, text })) return null;
  return { key: item.key, kind: KIND_WORD[item.kind] ?? item.kind, text };
}

export function useAlerts({ items, alerts, ready }) {
  const prev = useRef(null);
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    if (!ready) return;
    const found = newItems({ prev: prev.current, items });
    prev.current = new Set(items.map((i) => i.key));
    const loud = found.filter((item) => alerts?.[item.kind] && alerts[item.kind].where !== 'none');
    const shown = loud.map((item) => raise({ item, way: alerts[item.kind] })).filter(Boolean);
    if (shown.length) setToasts((cur) => [...cur.filter((t) => !shown.some((s) => s.key === t.key)), ...shown].slice(-MAX_TOASTS));
  }, [items, alerts, ready]);

  const dismiss = useCallback((key) => setToasts((cur) => cur.filter((t) => t.key !== key)), []);
  return { toasts, dismiss };
}
