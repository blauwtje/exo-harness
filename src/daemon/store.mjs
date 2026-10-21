import { appendFileSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { join } from 'node:path';

const EMPTY = () => ({ projects: [], cards: [], jobs: [] });
const SAFE_ID = /^[A-Za-z0-9_.-]+$/;

function jobDir(dir, jobId) {
  if (!SAFE_ID.test(jobId) || jobId === '.' || jobId === '..') throw new Error(`bad job id: ${jobId}`);
  return join(dir, 'jobs', jobId);
}

export function createStore(dir) {
  const statePath = join(dir, 'state.json');
  return {
    load() {
      try {
        return JSON.parse(readFileSync(statePath, 'utf8'));
      } catch (e) {
        if (e.code === 'ENOENT') return EMPTY();
        throw e;
      }
    },
    save(state) {
      const tmp = `${statePath}.${process.pid}.tmp`;
      const fd = openSync(tmp, 'w', 0o600);
      try {
        writeSync(fd, JSON.stringify(state, null, 2));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(tmp, statePath);
    },
    appendEvent(jobId, event) {
      const d = jobDir(dir, jobId);
      mkdirSync(d, { recursive: true, mode: 0o700 });
      appendFileSync(join(d, 'events.jsonl'), `${JSON.stringify(event)}\n`, { mode: 0o600 });
    },
    readEvents(jobId) {
      let text;
      try {
        text = readFileSync(join(jobDir(dir, jobId), 'events.jsonl'), 'utf8');
      } catch (e) {
        if (e.code === 'ENOENT') return [];
        throw e;
      }
      const lines = text.split('\n').filter(Boolean);
      return lines.flatMap((line, i) => {
        try {
          return [JSON.parse(line)];
        } catch (e) {
          if (i === lines.length - 1 && !text.endsWith('\n')) return [];
          throw e;
        }
      });
    },
  };
}
