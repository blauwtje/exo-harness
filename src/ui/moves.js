import { laneOf } from './derive.js';

const PREFIX = 'exo.lastlook.';

export function stageMap(state, projectKey) {
  const map = {};
  for (const card of state.cards) if (card.projectKey === projectKey) map[card.id] = laneOf(state, card);
  return map;
}

export function diffMoves({ prev, next }) {
  if (!prev) return [];
  return Object.keys(next).filter((id) => id in prev && prev[id] !== next[id]).map((id) => ({ id, from: prev[id], to: next[id] }));
}

export function loadSnapshot({ storage, projectKey }) {
  try {
    const parsed = JSON.parse(storage.getItem(PREFIX + projectKey));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSnapshot({ storage, projectKey, map }) {
  try { storage.setItem(PREFIX + projectKey, JSON.stringify(map)); } catch (e) { console.warn(`Last-look snapshot could not be saved: ${e.message}`); }
}

export const movedSince = ({ snapshot, next }) => diffMoves({ prev: snapshot, next }).map((m) => m.id);
