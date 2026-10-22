import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { fadeRise, spring } from './motion.js';

const RESUMABLE = ['stopped', 'limit'];

function clock(resetsAt) {
  return new Date(resetsAt * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function pauseText(pause) {
  if (pause.reason === 'stopped') return 'Queue paused: Stop all was used. Nothing starts until you resume.';
  if (pause.reason === 'offline') return 'Queue paused: the daemon is offline. It resumes when the connection is back.';
  const window = pause.rateLimitType ? `${pause.rateLimitType.replace('_', '-')} limit` : 'limit';
  return `Queue paused: ${window} reached${pause.resetsAt ? `, resumes at ${clock(pause.resetsAt)}` : ''}.`;
}

export function queuedJobs(state) {
  const byId = new Map(state.jobs.map((j) => [j.id, j]));
  return (state.queue?.order ?? []).map((id) => byId.get(id)).filter((j) => j?.status === 'queued');
}

function reasonText(queued) {
  if (!queued) return 'Waiting';
  if (queued.reason === 'lock') return 'Waiting for the exo run lock';
  return `Waiting: ${queued.reason}`;
}

export default function QueuePause({ state, deck }) {
  const pauses = state.queue?.pauses ?? [];
  if (!pauses.length) return null;
  return (
    <section className="queue-pause" aria-label="Queue">
      <div className="queue-pause-text">
        {pauses.map((p) => <p key={p.reason} role="status" data-pause={p.reason}>{pauseText(p)}</p>)}
      </div>
      {pauses.some((p) => RESUMABLE.includes(p.reason))
        ? <button className="btn btn-secondary" onClick={() => deck.act((api) => api.resumeQueue())}>Resume queue</button> : null}
    </section>
  );
}

export function QueueOrder({ state, deck, project }) {
  const [open, setOpen] = useState(false);
  const jobs = queuedJobs(state);
  if (!jobs.length) return null;
  const move = (index, step) => {
    const ids = jobs.map((j) => j.id);
    [ids[index], ids[index + step]] = [ids[index + step], ids[index]];
    deck.act((api) => api.reorderQueue(ids));
  };
  return (
    <div className="queue-order">
      <button type="button" className="fold queue-toggle" aria-expanded={open} aria-controls="queue-order" onClick={() => setOpen((o) => !o)}>
        Queue order
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div key="order" id="queue-order" className="queue-fold" {...fadeRise}>
            <ol className="queue-list" aria-label="Queued sessions">
              {jobs.map((j, i) => {
                const card = state.cards.find((c) => c.id === j.cardId);
                const title = card?.title ?? j.id;
                const elsewhere = card && project && card.projectKey !== project.key ? `In ${card.projectKey}. ` : '';
                return (
                  <motion.li key={j.id} className="queue-item" data-job={j.id} layout="position" transition={{ layout: spring }}>
                    <span className="num dim">{i + 1}</span>
                    <b className="queue-title">{title}</b>
                    <span className="queue-why">{elsewhere}{reasonText(j.queued)}</span>
                    <button className="btn btn-quiet btn-sm" disabled={i === 0} aria-label={`Move ${title} up`} onClick={() => move(i, -1)}>Up</button>
                    <button className="btn btn-quiet btn-sm" disabled={i === jobs.length - 1} aria-label={`Move ${title} down`} onClick={() => move(i, 1)}>Down</button>
                  </motion.li>
                );
              })}
            </ol>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
