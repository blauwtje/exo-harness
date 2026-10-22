import { useMemo } from 'react';
import { STATUS_WORD, Mark } from './parts.jsx';
import { isLive, laneOf } from './derive.js';
import AgentAccounts from './AgentAccounts.jsx';

const GROUPS = [['waiting', 'Waiting on you'], ['running', 'Working'], ['queued', 'Queued'], ['other', 'Other']];
const groupOf = (status) => (GROUPS.some(([g]) => g === status) ? status : 'other');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function AgentRow({ job, card, lane, project }) {
  const word = STATUS_WORD[job.status] ?? job.status;
  return (
    <li className="agent" data-status={job.status} data-lane={lane}>
      <a className="agent-link" href={`#/jobs/${job.id}`}>
        <span className="agent-title">{card.title}</span>
        <span className="agent-meta">
          <span className="agent-status"><span className="agent-mark" aria-hidden="true"><Mark status={job.status} label={word} /></span><span>{word}</span></span>
          {job.stage ? <span className="agent-stage">{cap(job.stage)} session</span> : null}
          {project ? <span className="agent-project">{project}</span> : null}
        </span>
      </a>
    </li>
  );
}

export default function Agents({ state, api }) {
  const many = state.projects.length > 1;
  const groups = useMemo(() => {
    const cards = new Map(state.cards.map((c) => [c.id, c]));
    const rows = state.jobs.filter((j) => isLive(j) && cards.has(j.cardId)).map((job) => ({ job, card: cards.get(job.cardId) }));
    return GROUPS.map(([id, title]) => ({ id, title, rows: rows.filter((r) => groupOf(r.job.status) === id) })).filter((g) => g.rows.length);
  }, [state]);

  return (
    <section className="agents-page" aria-labelledby="agents-title">
      <header className="page-head">
        <h1 id="agents-title" className="page-h">Agents</h1>
      </header>
      {groups.length === 0 ? <p className="agents-empty">No agents working. They show up here when a task starts.</p> : null}
      {groups.length ? (
        <div className="agents-groups" role="group" aria-label="Live sessions">
          {groups.map((g) => (
            <section key={g.id} className="agents-group" data-group={g.id} aria-labelledby={`agents-${g.id}`}>
              <h2 id={`agents-${g.id}`} className="section-h">{g.title} <span className="count num">{g.rows.length}</span></h2>
              <ul className="agents">
                {g.rows.map(({ job, card }) => <AgentRow key={job.id} job={job} card={card} lane={laneOf(state, card)} project={many ? card.projectKey.split('/').pop() : null} />)}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
      <div className="agents-accounts" data-slot="agent-accounts"><AgentAccounts state={state} api={api} /></div>
    </section>
  );
}
