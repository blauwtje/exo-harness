import { randomUUID } from 'node:crypto';
import { basename, resolve } from 'node:path';

const GITHUB_ORIGIN = /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i;

export function projectKey(path, origin) {
  const m = origin ? GITHUB_ORIGIN.exec(origin.trim()) : null;
  return m ? `${m[1]}/${m[2]}` : `local/${basename(resolve(path))}`;
}

export function addProject(state, { path, origin = null }) {
  const abs = resolve(path);
  const key = projectKey(abs, origin);
  const dupe = state.projects.find((p) => p.key === key && p.path === abs);
  if (dupe) return dupe;
  if (state.projects.some((p) => p.key === key)) throw new Error(`project key already used by another path: ${key}`);
  const project = { key, path: abs, origin: origin ?? null };
  state.projects.push(project);
  return project;
}

export function addCard(state, { projectKey: key, title }) {
  if (!state.projects.some((p) => p.key === key)) throw new Error(`unknown project: ${key}`);
  const card = { id: randomUUID(), projectKey: key, title, lane: 'Inbox' };
  state.cards.push(card);
  return card;
}

export function addJob(state, { cardId, stage }) {
  if (!state.cards.some((c) => c.id === cardId)) throw new Error(`unknown card: ${cardId}`);
  const job = { id: randomUUID(), cardId, stage, status: 'queued' };
  state.jobs.push(job);
  return job;
}
