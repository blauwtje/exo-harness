import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tooltip from '@radix-ui/react-tooltip';
import { readToken } from './api.js';
import { useDeck } from './deck.js';
import { useAlerts } from './alerts.js';
import { liveJobCount, needsYou, splitNeeds, workingCount } from './derive.js';
import Board from './Board.jsx';
import Agents from './Agents.jsx';
import Gauges from './Gauges.jsx';
import JobView from './JobView.jsx';
import NeedsYou from './NeedsYou.jsx';
import Settings from './Settings.jsx';
import Usage from './Usage.jsx';
import { fadeRise } from './motion.js';

const TOKEN = readToken();
const ADDRESS = `${location.origin}/#token=<token the daemon printed>`;
const jobFromHash = () => /^#\/jobs\/(.+)$/.exec(location.hash)?.[1] ?? null;
const PAGE_BY_HASH = { '#/settings': 'settings', '#/agents': 'agents', '#/usage': 'usage' };
const pageFromHash = () => PAGE_BY_HASH[location.hash] ?? null;
const agentsWord = (n) => (n === 1 ? '1 agent working' : `${n} agents working`);
const clock = (t) => (t ? new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : null);
const initials = (key) => {
  const last = key.split('/').pop();
  const words = last.split(/[^A-Za-z0-9]+|(?<=[a-z])(?=[A-Z])/).filter(Boolean);
  const two = words.length > 1 ? words[0][0] + words[1][0] : last.replace(/[^A-Za-z0-9]/g, '').slice(0, 2);
  return (two || '?').toUpperCase();
};

const repoName = (key) => key.split('/').pop();
const chipMarksDistinctOnClash = (keys) => {
  const base = new Map(keys.map((k) => [k, initials(k)]));
  const clash = (k) => keys.some((o) => o !== k && base.get(o) === base.get(k));
  return new Map(keys.map((k) => {
    if (!clash(k)) return [k, base.get(k)];
    const tail = repoName(k).split(/[^A-Za-z0-9]+/).filter(Boolean).pop() ?? '';
    return [k, (tail.slice(0, 2) || '?').toUpperCase()];
  }));
};
function SideNameKeepingTail({ name }) {
  if (name.length <= 14) return <span className="side-name" aria-hidden="true">{name}</span>;
  return <span className="side-name side-name-split" aria-hidden="true"><span className="side-name-head">{name.slice(0, -6)}</span><span className="side-name-tail">{name.slice(-6)}</span></span>;
}
const hueOf = (key) => (([...key].reduce((n, c) => n + c.charCodeAt(0), 0)) % 6) + 1;

function useMedia(query) {
  const [on, setOn] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const change = () => setOn(m.matches);
    change();
    m.addEventListener('change', change);
    return () => m.removeEventListener('change', change);
  }, [query]);
  return on;
}

function accessPlate(link) {
  if (!TOKEN) {
    return (
      <Plate title="No access token">
        <p>Open the address the daemon printed when it started.</p>
        <details className="plate-more">
          <summary className="fold">Closed that terminal?</summary>
          <p>Run <code>exo-harness</code> again. It prints a new address, shaped like this:</p>
          <pre className="cmd">{ADDRESS}</pre>
        </details>
      </Plate>
    );
  }
  if (link === 'bad-token') {
    return (
      <Plate title="Token not accepted">
        <p>The token changes each time the daemon starts, so open the newest address it printed.</p>
        <details className="plate-more"><summary className="fold">What the address looks like</summary><pre className="cmd">{ADDRESS}</pre></details>
      </Plate>
    );
  }
  return null;
}

function LinkState({ plate, link, lastGood }) {
  const word = (text, tone, extra) => <span className="linkstate" data-link={tone} role="status"><i aria-hidden="true" /><span className="linkstate-word">{text}{extra}</span></span>;
  if (plate) return word('Not connected', 'down');
  if (link === 'live') return null;
  if (link === 'connecting') return word('Connecting', 'connecting');
  return word('Offline', 'down', lastGood ? <span className="linkstate-since"> since <span className="num">{clock(lastGood)}</span></span> : null);
}

function Tip({ label, children, on = true }) {
  if (!on) return children;
  return (
    <Tooltip.Root delayDuration={300}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal><Tooltip.Content className="tip" side="right" sideOffset={10}>{label}</Tooltip.Content></Tooltip.Portal>
    </Tooltip.Root>
  );
}

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 28 28" aria-hidden="true">
      <path d="M5 4h8v4H9v4h4v4H9v4h4v4H5z" /><path d="M15 4h8v20h-8v-4h4V8h-4z" />
      <circle cx="14" cy="14" r="2" className="logo-pin" />
    </svg>
  );
}

function Plate({ title, children, action }) {
  return (
    <section className="plate" aria-labelledby="plate-h">
      <h2 id="plate-h">{title}</h2>
      {children}
      <div className="plate-actions">{action ?? <button className="btn btn-primary" onClick={() => location.reload()}>Retry</button>}</div>
    </section>
  );
}

function Form({ open, onOpenChange, title, description, submit, children, onSubmit, need }) {
  const [ok, setOk] = useState(false);
  useEffect(() => { if (open) setOk(false); }, [open]);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog">
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>{description}</Dialog.Description>
          <form noValidate onInput={(e) => setOk(Boolean(e.currentTarget.elements[need]?.value.trim()))}
            onSubmit={(e) => { e.preventDefault(); if (ok) onSubmit(new FormData(e.currentTarget)); }}>
            {children}
            <div className="dialog-actions">
              <button type="submit" className="btn btn-primary" disabled={!ok}>{submit}</button>
              <Dialog.Close className="btn btn-quiet" type="button">Cancel</Dialog.Close>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function StopAllDialog({ open, setOpen, live, deck }) {
  const jobs = `${live} session${live === 1 ? '' : 's'}`;
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog">
          <Dialog.Title>Stop all sessions</Dialog.Title>
          <Dialog.Description>This stops <b className="num">{live}</b> live session{live === 1 ? '' : 's'} and their agents now. Work in progress stays in each worktree.</Dialog.Description>
          <div className="dialog-actions">
            <button className="btn btn-primary" onClick={() => { setOpen(false); deck.act((api) => api.stopAll()); }}>Stop {jobs}</button>
            <Dialog.Close className="btn btn-quiet">Cancel</Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const ICON = {
  usage: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h16" /><path d="M7 16v-4M12 16V6M17 16v-7" strokeWidth="3" /></svg>,
  agents: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.6 2.7-6 6-6s6 2.4 6 6" /><circle cx="17.5" cy="9" r="2.4" /><path d="M16.5 14.2c2.9-.3 4.9 1.7 4.9 4.8" /></svg>,
  settings: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></svg>,
  plus: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>,
};

const TOOLS = [['agents', 'Agents'], ['usage', 'Usage'], ['settings', 'Settings']];

function ProjectRow({ p, mark, current, stats, onClick }) {
  const { live, waiting } = stats;
  const spoken = `${p.key}${live ? `, ${live} working` : ''}${waiting ? `, ${waiting} need you` : ''}`;
  return (
    <Tip label={<><span className="tip-key">{p.key}</span><span className="tip-path">{p.path}</span>{live ? <span className="tip-path">{live} working</span> : null}</>}>
      <button className="side-item" aria-label={spoken} aria-current={current ? 'page' : undefined} onClick={onClick}>
        <span className="chip" data-hue={hueOf(p.key)} aria-hidden="true">{mark}</span>
        <SideNameKeepingTail name={repoName(p.key)} />
        {waiting ? <span className="side-need num" aria-hidden="true">{waiting}</span> : null}
      </button>
    </Tip>
  );
}

function Sidebar({ projects, project, statsOf, setProject, addProject, canAdd, page, showTools, linkState }) {
  const compact = useMedia('(max-width: 1099px)');
  const marks = chipMarksDistinctOnClash(projects.map((p) => p.key));
  return (
    <aside className="sidebar">
      <a className="brand" href="#/" aria-label="exo, back to board"><Logo /><span className="brand-word">exo</span></a>
      <nav className="side-nav" aria-label="Projects">
        <ul className="side-list">
          {projects.map((p) => (
            <li key={p.key}><ProjectRow p={p} mark={marks.get(p.key)} current={p.key === project?.key} stats={statsOf(p.key)} onClick={() => setProject(p.key)} /></li>
          ))}
        </ul>
        {canAdd ? (
          <Tip on={compact} label="Add project">
            <button className="side-item side-add" aria-label="Add project" onClick={addProject}>{ICON.plus}<span className="side-name" aria-hidden="true">Add project</span></button>
          </Tip>
        ) : null}
      </nav>
      <div className="side-foot">
        {showTools ? TOOLS.map(([id, label]) => (
          <Tip key={id} on={compact} label={label}>
            <a className="side-item side-tool" href={`#/${id}`} aria-current={page === id ? 'page' : undefined}>{ICON[id]}<span className="side-name">{label}</span></a>
          </Tip>
        )) : null}
        {linkState}
      </div>
    </aside>
  );
}

function MenuSheet({ open, setOpen, projects, project, statsOf, setProject, addProject, ready, liveCount, working, gauges, page, stopAll, linkState }) {
  const go = (fn) => () => { setOpen(false); fn(); };
  const marks = chipMarksDistinctOnClash(projects.map((p) => p.key));
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="menu-sheet" aria-describedby={undefined}>
          <div className="menu-sheet-head">
            <Dialog.Title className="h2">Menu</Dialog.Title>
            <Dialog.Close className="btn btn-secondary btn-sm">Close</Dialog.Close>
          </div>
          <nav aria-label="Projects">
            <ul className="menu-sheet-list">
              {projects.map((p) => (
                <li key={p.key}>
                  <button className="menu-sheet-item" aria-current={p.key === project?.key ? 'page' : undefined} onClick={go(() => setProject(p.key))}>
                    <span className="chip" data-hue={hueOf(p.key)} aria-hidden="true">{marks.get(p.key)}</span>
                    <span className="menu-sheet-name">{p.key}</span>
                    {statsOf(p.key).waiting ? <span className="side-need num">{statsOf(p.key).waiting}<span className="sr"> need you</span></span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          {ready ? (
            <div className="menu-sheet-status">
              {working ? <p className="live">{agentsWord(working)}</p> : null}
              {gauges}
            </div>
          ) : null}
          <div className="menu-sheet-actions">
            <button className="btn btn-secondary" onClick={go(addProject)}>Add project</button>
            {ready ? TOOLS.map(([id, label]) => (
              <a key={id} className="btn btn-secondary" href={`#/${id}`} aria-current={page === id ? 'page' : undefined} onClick={() => setOpen(false)}>{label}</a>
            )) : null}
            {ready && liveCount > 0 ? <button className="btn btn-secondary" onClick={go(stopAll)}>Stop all</button> : null}
          </div>
          {linkState}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default function App() {
  const deck = useDeck(TOKEN);
  const { state, health, events, rate, link } = deck;
  const [projectKey, setProjectKey] = useState(null);
  const [jobId, setJobId] = useState(jobFromHash());
  const [page, setPage] = useState(pageFromHash());
  const settingsOpen = page === 'settings';
  const [dialog, setDialog] = useState(null);
  const [lastGood, setLastGood] = useState(null);

  useEffect(() => {
    const on = () => { setJobId(jobFromHash()); setPage(pageFromHash()); };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  useEffect(() => { if (link === 'live') setLastGood(Date.now()); }, [link, state]);
  const wasSettings = useRef(settingsOpen);
  useEffect(() => {
    if (wasSettings.current && !settingsOpen) deck.refreshSettings();
    wasSettings.current = settingsOpen;
  }, [settingsOpen]);

  const project = state?.projects.find((p) => p.key === projectKey) ?? state?.projects[0] ?? null;
  const split = useMemo(() => splitNeeds(state ? needsYou(state, health) : [], deck.settings?.needsYou), [state, health, deck.settings]);
  const { items, history } = split;
  const { toasts, dismiss } = useAlerts({ items, alerts: deck.settings?.alerts, ready: Boolean(state && deck.settings) });
  const liveCount = liveJobCount(state);
  const job = jobId && state ? state.jobs.find((j) => j.id === jobId) : null;
  const openJob = (id) => { location.hash = `#/jobs/${id}`; };
  const back = () => { location.hash = '#/'; };
  const working = workingCount(state, items);
  const chooseProject = (k) => { setProjectKey(k); back(); };

  const plate = accessPlate(link);
  const offline = Boolean(plate) || link === 'down';
    const name = project ? repoName(project.key) : 'exo';

  const view = () => {
    if (plate) return ['plate', plate];
    if (link === 'down' && !state) {
      return ['plate', <Plate key="off" title="Can't reach the daemon" action={<button className="btn btn-primary" onClick={deck.refresh}>Retry</button>}>
        <p>Check that <code>exo-harness</code> is still running.{lastGood ? <> Last update at <span className="num">{clock(lastGood)}</span>.</> : null}</p>
      </Plate>];
    }
    if (!state) return ['loading', <div key="load" className="loading" aria-busy="true"><p className="sr" role="status">Loading</p><div className="bars" aria-hidden="true"><i /><i /><i /></div></div>];
    if (page === 'settings') return ['settings', <Settings state={state} project={project} api={deck.api} back={back} />];
    if (page === 'agents') return ['agents', <Agents state={state} api={deck.api} />];
    if (page === 'usage') return ['usage', <Usage state={state} deck={deck} />];
    if (!project) {
      return ['plate', <Plate key="first" title="No project yet" action={<button className="btn btn-primary" onClick={() => setDialog('project')}>Add a project</button>}>
        <p>A project is a git repository the agents work in.</p>
      </Plate>];
    }
    if (job) return ['job', <JobView job={job} card={state.cards.find((c) => c.id === job.cardId)} events={events[job.id] ?? []} deck={deck} />];
    if (jobId) {
      return ['plate', <Plate key="gone" title="Session not found" action={<button className="btn btn-primary" onClick={back}>Back to board</button>}>
        <p>That session isn't in the daemon's state.</p>
      </Plate>];
    }
    return ['home', <>
      <NeedsYou items={items} history={history} deck={deck} openJob={openJob} />
      <Board state={state} project={project} items={items} deck={deck} openJob={openJob} addCard={() => setDialog('card')} />
    </>];
  };
  const [kind, content] = view();
  const ready = ['home', 'job', 'settings', 'agents', 'usage'].includes(kind);
  const stuck = Boolean(plate) || (link === 'down' && !state);
  const canStop = ready && !offline && liveCount > 0;
  const statsOf = (key) => ({
    live: workingCount(state, items, key),
    waiting: items.filter((i) => i.card?.projectKey === key).length,
  });
  const linkState = <LinkState plate={plate} link={link} lastGood={lastGood} />;
  const linkTone = plate ? 'down' : link === 'live' || link === 'connecting' ? link : 'down';
  const linkWord = plate ? 'Not connected' : link === 'connecting' ? 'Connecting' : 'Offline';
  const waitsElsewhere = items.some((i) => i.card?.projectKey && i.card.projectKey !== project?.key);
  const homeTitle = <h1 className="crumb-home" title={project?.key}>{name}</h1>;
  const crumbNow = { job: <span className="crumb-now" aria-current="page" title={project?.key}>{name}</span>, settings: <span className="crumb-now" aria-current="page">Settings</span>, agents: <span className="crumb-now" aria-current="page">Agents</span>, usage: <span className="crumb-now" aria-current="page">Usage</span> }[kind];
  const trail = crumbNow ? (
    <nav className="crumbs" aria-label="Breadcrumb">
      <ol>
        <li>
          <a href="#/" className="crumb-link">
            <i className="crumb-back" aria-hidden="true" /><span className="crumb-name">exo</span>
          </a>
        </li>
        <li>{crumbNow}</li>
      </ol>
    </nav>
  ) : homeTitle;

  return (
    <Tooltip.Provider>
      <div className="shell" data-view={kind}>
        <Sidebar projects={state?.projects ?? []} project={project} statsOf={statsOf} setProject={chooseProject} addProject={() => setDialog('project')} canAdd={!stuck}
          page={page} showTools={ready} linkState={linkState} />
        <div className="main">
          <header className="top">
            {stuck ? null : (
              <button className="icon-btn menu-btn" aria-label={waitsElsewhere ? 'Menu, another project needs you' : 'Menu'} aria-haspopup="dialog" onClick={() => setDialog('menu')}>
                <span className="burger" aria-hidden="true" />
                {waitsElsewhere ? <span className="dot dot-need menu-badge" aria-hidden="true" /> : null}
              </button>
            )}
            {trail}
            {plate || link !== 'live' ? <span className="linkdot" data-link={linkTone} role="img" aria-label={linkWord} title={linkWord} /> : null}
            {ready ? (
              <div className="tools">
                {working ? <span className="live">{agentsWord(working)}</span> : null}
                <Gauges rate={rate} offline={offline} state={state} api={deck.api} />
                {canStop ? <button className="btn btn-secondary btn-stop" onClick={() => setDialog('stop')}>Stop all</button> : null}
              </div>
            ) : null}
          </header>
          <main className="sheet">
            {deck.error && !plate ? <p className="sheet-error" role="alert"><span>{deck.error}</span><button className="link" onClick={() => deck.setError(null)}>Dismiss</button></p> : null}
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={`${kind}:${jobId ?? ''}`} className="page" data-view={kind} {...fadeRise}>{content}</motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
      <MenuSheet open={dialog === 'menu'} setOpen={(o) => setDialog(o ? 'menu' : null)} projects={state?.projects ?? []} project={project} setProject={chooseProject}
        addProject={() => setDialog('project')} page={page} stopAll={() => setDialog('stop')} statsOf={statsOf} linkState={linkState}
        ready={ready} liveCount={liveCount} working={working}
        gauges={<Gauges inline rate={rate} offline={offline} state={state} api={deck.api} onOpen={() => setDialog(null)} />} />
      <StopAllDialog open={dialog === 'stop'} setOpen={(o) => setDialog(o ? 'stop' : null)} live={liveCount} deck={deck} />
      <Form open={dialog === 'card'} onOpenChange={(o) => !o && setDialog(null)} title="New task" description={`Goes to Inbox in ${project?.key ?? 'the project'}.`} submit="Add task" need="title"
        onSubmit={(f) => { const t = f.get('title').trim(); if (t) { setDialog(null); deck.act((api) => api.addCard(project.key, t, f.get('body').trim() || undefined)); } }}>
        <label htmlFor="card-title">Title</label><input id="card-title" name="title" required autoFocus />
        <label htmlFor="card-body">Notes <span className="dim">(optional)</span></label><textarea id="card-body" name="body" rows={3} />
      </Form>
      <Form open={dialog === 'project'} onOpenChange={(o) => !o && setDialog(null)} title="Add project" description="Absolute path of a git repository on this machine." submit="Add project" need="path"
        onSubmit={(f) => { const p = f.get('path').trim(); if (p) { setDialog(null); deck.act((api) => api.addProject(p)); } }}>
        <label htmlFor="project-path">Repository path</label><input id="project-path" name="path" required autoFocus placeholder="/Users/you/code/app" />
      </Form>
      <div className="toasts" role="status" aria-label="Alerts">
        {toasts.map((t) => (
          <div key={t.key} className="toast">
            <span className="pill pill-need">{t.kind}</span>
            <span className="toast-text">{t.text}</span>
            <button type="button" className="btn btn-quiet" onClick={() => dismiss(t.key)}>Dismiss</button>
          </div>
        ))}
      </div>
    </Tooltip.Provider>
  );
}
