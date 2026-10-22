import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, createApi } from './api.js';
import { latestRate } from './derive.js';
import { diffMoves, loadSnapshot, movedSince, saveSnapshot, stageMap } from './moves.js';

const EMPTY = { projects: [], cards: [], jobs: [], pending: [] };

export function useDeck(token) {
  const api = useMemo(() => (token ? createApi(token) : null), [token]);
  const [state, setState] = useState(null);
  const [health, setHealth] = useState(null);
  const [events, setEvents] = useState({});
  const [rate, setRate] = useState(null);
  const [settings, setSettings] = useState(null);
  const [link, setLink] = useState(token ? 'connecting' : 'no-token');
  const [error, setError] = useState(null);
  const [moves, setMoves] = useState([]);
  const [sinceLook, setSinceLook] = useState(() => new Set());
  const stages = useRef({});
  const snapshots = useRef({});
  const loaded = useRef(new Map());
  const retry = useRef({ timer: null, delay: 0 });

  const loadTranscript = useCallback(async (id) => {
    if (!api || loaded.current.has(id)) return;
    loaded.current.set(id, []);
    try {
      const list = await api.transcript(id);
      const buffered = loaded.current.get(id);
      const tail = list.slice(-50).map((e) => JSON.stringify(e));
      const extra = buffered.filter((e) => !tail.includes(JSON.stringify(e)));
      loaded.current.set(id, null);
      setEvents((m) => ({ ...m, [id]: [...list, ...extra] }));
      const r = latestRate(list);
      if (r) setRate((cur) => cur ?? r);
    } catch (e) {
      loaded.current.delete(id);
      setError(`Transcript failed to load: ${e.message}`);
    }
  }, [api]);

  const trackMoves = useCallback((next) => {
    const found = [];
    const since = [];
    for (const { key } of next.projects) {
      const map = stageMap(next, key);
      if (!(key in snapshots.current)) snapshots.current[key] = loadSnapshot({ storage: localStorage, projectKey: key });
      found.push(...diffMoves({ prev: stages.current[key], next: map }));
      since.push(...movedSince({ snapshot: snapshots.current[key], next: map }));
      stages.current[key] = map;
    }
    setMoves(found);
    setSinceLook(new Set(since));
  }, []);

  const saveLook = useCallback(() => {
    for (const [key, map] of Object.entries(stages.current)) saveSnapshot({ storage: localStorage, projectKey: key, map });
    snapshots.current = { ...stages.current };
    setSinceLook(new Set());
  }, []);

  const seen = useCallback((id) => setSinceLook((cur) => {
    if (!cur.has(id)) return cur;
    const rest = new Set(cur);
    rest.delete(id);
    return rest;
  }), []);

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const next = await api.state();
      clearTimeout(retry.current.timer);
      retry.current.delay = 0;
      trackMoves({ ...EMPTY, ...next });
      setState({ ...EMPTY, ...next });
      setLink((l) => (l === 'live' ? l : 'live'));
      for (const j of next.jobs ?? []) loadTranscript(j.id);
    } catch (e) {
      const badToken = e instanceof ApiError && e.status === 401;
      setLink(badToken ? 'bad-token' : 'down');
      if (badToken) return;
      clearTimeout(retry.current.timer);
      retry.current.delay = Math.min(retry.current.delay ? retry.current.delay * 2 : 500, 8000);
      retry.current.timer = setTimeout(refresh, retry.current.delay);
    }
  }, [api, loadTranscript, trackMoves]);

  const refreshHealth = useCallback(() => api?.health().then(setHealth, (e) => setError(`Health check failed: ${e.message}`)), [api]);
  const refreshSettings = useCallback(() => api?.getSettings().then(setSettings, (e) => setError(`Settings failed to load: ${e.message}`)), [api]);

  useEffect(() => {
    if (!api) return undefined;
    let timer;
    const soon = () => { clearTimeout(timer); timer = setTimeout(refresh, 60); };
    refresh();
    refreshHealth();
    refreshSettings();
    const es = api.events();
    es.addEventListener('state', soon);
    es.addEventListener('ask', soon);
    es.addEventListener('needs-you', soon);
    es.addEventListener('event', (m) => {
      const { jobId, event } = JSON.parse(m.data);
      const buffer = loaded.current.get(jobId);
      if (buffer) buffer.push(event);
      else if (buffer === null) setEvents((cur) => ({ ...cur, [jobId]: [...(cur[jobId] ?? []), event] }));
      else { loadTranscript(jobId); loaded.current.get(jobId)?.push(event); }
      const r = latestRate([event]);
      if (r) setRate(r);
    });
    es.onopen = () => { setLink('live'); refresh(); };
    es.onerror = () => setLink((l) => (l === 'bad-token' ? l : 'down'));
    return () => { clearTimeout(timer); clearTimeout(retry.current.timer); es.close(); };
  }, [api, refresh, refreshHealth, refreshSettings, loadTranscript]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') saveLook(); };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [saveLook]);

  const act = useCallback(async (fn) => {
    try { setError(null); return await fn(api); } catch (e) { setError(e.message); return null; } finally { refresh(); }
  }, [api, refresh]);

  return { state, health, events, rate, settings, link, error, moves, sinceLook, seen, setError, act, refresh, refreshHealth, refreshSettings, api };
}
