import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
import * as Tooltip from '@radix-ui/react-tooltip';
import { readToken } from './api.js';
import { useDeck } from './deck.js';
import { isLive, needsYou } from './derive.js';
import Board from './Board.jsx';
import CrewPanel from './CrewPanel.jsx';
import Gauges from './Gauges.jsx';
import JobView from './JobView.jsx';
import NeedsYou from './NeedsYou.jsx';

const TOKEN = readToken();
const jobFromHash = () => /^#\/jobs\/(.+)$/.exec(location.hash)?.[1] ?? null;
const clock = (t) => (t ? new Date(t).toLocaleTimeString('en-GB') : null);

function accessPlate(link) {
  if (!TOKEN) return <Plate title="No access token"><p>Open the address the daemon printed when it started. It ends in <code>#token=…</code>.</p><p className="dim">Run <code>exo-harness</code> again if you closed that terminal.</p></Plate>;
  if (link === 'bad-token') return <Plate title="Token not accepted"><p>The daemon refused this token. It changes each time the daemon starts.</p><p className="dim">Open the newest address the daemon printed.</p></Plate>;
  return null;
}

function linkLabel(plate, link, lastGood) {
  if (plate) return 'Disconnected';
  if (link === 'live') return 'Connected';
  if (link === 'connecting') return 'Connecting';
  return `Disconnected${lastGood ? `, last event ${clock(lastGood)}` : ''}`;
}

function Tip({ label, children }) {
  return (
    <Tooltip.Root delayDuration={300}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal><Tooltip.Content className="tip" side="right" sideOffset={8}>{label}</Tooltip.Content></Tooltip.Portal>
    </Tooltip.Root>
  );
}

function Mark() {
  return (
    <svg className="logo" viewBox="0 0 28 28" role="img" aria-label="exo deck">
      <path d="M5 4h8v4H9v4h4v4H9v4h4v4H5z" /><path d="M15 4h8v20h-8v-4h4V8h-4z" />
      <circle cx="14" cy="14" r="2" className="logo-pin" />
    </svg>
  );
}

function Plate({ title, children }) {
  return (
    <section className="plate"><h2>{title}</h2>{children}
      <pre className="cmd">{`${location.origin}/#token=<token the daemon printed>`}</pre>
      <div className="actions"><button className="btn btn-edge" onClick={() => location.reload()}>Retry</button></div>
    </section>
  );
}

function Form({ open, onOpenChange, title, description, submit, children, onSubmit }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog">
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>{description}</Dialog.Description>
          <form onSubmit={(e) => { e.preventDefault(); onSubmit(new FormData(e.currentTarget)); }}>
            {children}
            <div className="actions">
              <button type="submit" className="btn btn-edge">{submit}</button>
              <Dialog.Close className="btn btn-quiet" type="button">Cancel</Dialog.Close>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function stopAllTitle(offline, live) {
  if (offline) return 'Not connected to the daemon.';
  if (live === 0) return 'No jobs are running.';
  return undefined;
}

function StopAll({ live, deck, offline }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="btn btn-edge" disabled={offline || live === 0} title={stopAllTitle(offline, live)}>Stop all</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog">
          <Dialog.Title>Stop all jobs</Dialog.Title>
          <Dialog.Description>This stops <b className="num">{live}</b> live job{live === 1 ? '' : 's'} and their agents now. Work in progress is kept in each worktree.</Dialog.Description>
          <div className="actions">
            <button className="btn btn-bad" onClick={() => { setOpen(false); deck.act((api) => api.stopAll()); }}>Stop {live} job{live === 1 ? '' : 's'}</button>
            <Dialog.Close className="btn btn-quiet">Cancel</Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Rail({ projects, project, setProject, count, addProject }) {
  return (
    <nav className="rail" aria-label="Projects">
      <Mark />
      <span className="rail-name" aria-hidden="true">exo</span>
      <Tabs.Root orientation="vertical" value={project?.key ?? ''} onValueChange={setProject} className="rail-tabs">
        <Tabs.List className="rail-list" aria-label="Projects">
          {projects.map((p) => (
            <Tip key={p.key} label={p.key}>
              <Tabs.Trigger value={p.key} className="rail-item" aria-label={p.key}>{p.key.split('/').pop().slice(0, 2)}</Tabs.Trigger>
            </Tip>
          ))}
        </Tabs.List>
      </Tabs.Root>
      <Tip label="Add project"><button className="rail-item rail-add" aria-label="Add project" onClick={addProject}><span aria-hidden="true" className="plus-glyph" /></button></Tip>
      <span className="rail-foot" aria-label={`${count} need you`}><b className="num">{count}</b><span aria-hidden="true">needs you</span></span>
    </nav>
  );
}

export default function App() {
  const deck = useDeck(TOKEN);
  const { state, health, events, rate, link } = deck;
  const [projectKey, setProjectKey] = useState(null);
  const [jobId, setJobId] = useState(jobFromHash());
  const [dialog, setDialog] = useState(null);
  const [lastGood, setLastGood] = useState(null);
  const [crewOpen, setCrewOpen] = useState(false);
  const [focusCard, setFocusCard] = useState(null);

  useEffect(() => {
    const on = () => setJobId(jobFromHash());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  useEffect(() => { if (link === 'live') setLastGood(Date.now()); }, [link, state]);

  const project = state?.projects.find((p) => p.key === projectKey) ?? state?.projects[0] ?? null;
  const items = useMemo(() => (state ? needsYou(state, health) : []), [state, health]);
  const liveCount = state ? state.jobs.filter(isLive).length : 0;
  const job = jobId && state ? state.jobs.find((j) => j.id === jobId) : null;
  const openJob = (id) => { location.hash = `#/jobs/${id}`; };
  const back = () => { location.hash = '#/'; };

  const plate = accessPlate(link);
  const crewShown = Boolean(!job && !plate && state && project);
  const shownLink = plate ? 'down' : link;
  const linkText = linkLabel(plate, link, lastGood);
  const jobTitle = job ? state.cards.find((c) => c.id === job.cardId)?.title ?? 'Job' : null;
  const pathText = () => {
    if (job) return `Board / ${jobTitle}`;
    if (project) return project.path;
    return plate ? 'Not connected' : 'No project yet';
  };
  const center = () => {
    if (plate) return <main className="center">{plate}</main>;
    if (link === 'down' && !state) return <main className="center"><section className="failed"><p>Couldn't reach the daemon{lastGood ? `. Last updated ${clock(lastGood)}.` : '.'}</p><button className="link" onClick={deck.refresh}>Retry</button></section></main>;
    if (!state) return <main className="center" aria-busy="true"><div className="bars"><i /><i /><i /></div></main>;
    if (!project) return <main className="center"><section className="first"><h2>No project yet</h2><p className="dim">A project is a git repository the agents work in.</p><button className="btn btn-edge" onClick={() => setDialog('project')}>Add a project</button></section></main>;
    if (job) return <main className="center"><JobView job={job} card={state.cards.find((c) => c.id === job.cardId)} events={events[job.id] ?? []} deck={deck} back={back} /></main>;
    if (jobId) return <main className="center"><section className="failed"><p>That job isn't in the daemon's state.</p><button className="link" onClick={back}>Back to board</button></section></main>;
    return (
      <main className="center">
        <NeedsYou items={items} deck={deck} openJob={openJob} />
        <Board state={state} project={project} deck={deck} openJob={openJob} addCard={() => setDialog('card')} setFocusCard={setFocusCard} />
      </main>
    );
  };

  return (
    <Tooltip.Provider>
      <div className="shell" data-job={Boolean(job)} data-crew={crewShown}>
        <Rail projects={state?.projects ?? []} project={project} setProject={(k) => { setProjectKey(k); back(); }} count={items.length} addProject={() => setDialog('project')} />
        <header className="top">
          <div className="top-id">
            {job ? <p className="h1">{project?.key ?? 'exo deck'}</p> : <h1>{project?.key ?? 'exo deck'}</h1>}
            <span className="dim path">{pathText()}</span>
          </div>
          <Gauges rate={rate} offline={shownLink === 'down'} />
          <div className="top-end">
            <span className="linkstate" data-link={shownLink} role="status"><i aria-hidden="true" />{linkText}</span>
            {job ? null : <button className="btn btn-edge crew-toggle" aria-expanded={crewOpen} aria-controls="crew-panel" onClick={() => setCrewOpen((o) => !o)}>Crew <span className="num">{liveCount}</span></button>}
            <StopAll live={liveCount} deck={deck} offline={shownLink === 'down'} />
          </div>
        </header>
        {deck.error ? <p className="refusal bar" role="alert">{deck.error}<button className="link" onClick={() => deck.setError(null)}>Dismiss</button></p> : null}
        {center()}
        {crewShown ? <CrewPanel state={state} project={project} focusCard={focusCard} open={crewOpen} /> : null}
      </div>
      <Form open={dialog === 'card'} onOpenChange={(o) => !o && setDialog(null)} title="New card" description={`Goes to Inbox in ${project?.key ?? 'the project'}.`} submit="Add card"
        onSubmit={(f) => { const t = f.get('title').trim(); if (t) { setDialog(null); deck.act((api) => api.addCard(project.key, t, f.get('body').trim() || undefined)); } }}>
        <label htmlFor="card-title">Title</label><input id="card-title" name="title" required autoFocus />
        <label htmlFor="card-body">Notes <span className="dim">optional</span></label><textarea id="card-body" name="body" rows={3} />
      </Form>
      <Form open={dialog === 'project'} onOpenChange={(o) => !o && setDialog(null)} title="Add project" description="Absolute path of a git repository on this machine." submit="Add project"
        onSubmit={(f) => { const p = f.get('path').trim(); if (p) { setDialog(null); deck.act((api) => api.addProject(p)); } }}>
        <label htmlFor="project-path">Repository path</label><input id="project-path" name="path" required autoFocus placeholder="/Users/you/code/app" />
      </Form>
    </Tooltip.Provider>
  );
}
