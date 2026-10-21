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

function queuedJobs(state) {
  const byId = new Map(state.jobs.map((j) => [j.id, j]));
  return state.queue.order.map((id) => byId.get(id)).filter((j) => j?.status === 'queued');
}

function reasonText(queued) {
  if (!queued) return 'waiting';
  if (queued.reason === 'lock') return 'waiting for the exo run lock';
  return `waiting: ${queued.reason}`;
}

export default function Queue({ state, deck }) {
  const queue = state.queue;
  if (!queue) return null;
  const pauses = queue.pauses ?? [];
  const jobs = queuedJobs(state);
  const move = (index, step) => {
    const ids = jobs.map((j) => j.id);
    [ids[index], ids[index + step]] = [ids[index + step], ids[index]];
    deck.act((api) => api.reorderQueue(ids));
  };
  if (!pauses.length && !jobs.length) return null;
  return (
    <section className="queue" aria-label="Queue">
      {pauses.map((p) => <p key={p.reason} className="refusal" role="status" data-pause={p.reason}>{pauseText(p)}</p>)}
      {pauses.some((p) => RESUMABLE.includes(p.reason))
        ? <div className="actions"><button className="btn btn-edge" onClick={() => deck.act((api) => api.resumeQueue())}>Resume queue</button></div> : null}
      {jobs.length ? (
        <ol className="queue-list" aria-label="Queued jobs">
          {jobs.map((j, i) => {
            const title = state.cards.find((c) => c.id === j.cardId)?.title ?? j.id;
            return (
              <li key={j.id} className="queue-item" data-job={j.id}>
                <span className="num dim">{i + 1}</span>
                <b>{title}</b>
                <span className="queue-why">{reasonText(j.queued)}</span>
                <button className="btn btn-quiet" disabled={i === 0} aria-label={`Move ${title} up`} onClick={() => move(i, -1)}>Up</button>
                <button className="btn btn-quiet" disabled={i === jobs.length - 1} aria-label={`Move ${title} down`} onClick={() => move(i, 1)}>Down</button>
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}
