import { useEffect, useState } from 'react';
import { DragDropProvider, useDraggable, useDroppable } from '@dnd-kit/react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { motion } from 'motion/react';
import { carMove } from './motion.js';
import QueuePause, { QueueOrder, queuedJobs } from './Queue.jsx';
import Overview from './Overview.jsx';
import { Mark, Status, useCalm } from './parts.jsx';
import { LANES, LINE, homeCounts, laneShownCards, laneWord, latestJob, liveJob, shortId, workingCount } from './derive.js';

const SHOWN = 3;
const PHONE = '(max-width: 640px)';
const STILL = { duration: 0 };

const RULE = {
  Inbox: 'New tasks, ready to plan',
  Shaped: 'Has a plan that waits for your OK',
  Approved: 'Approved, waits to start',
  Queued: 'Starts when a slot is free',
  Running: 'An agent is working on it',
  Review: 'Checked, then merged',
  Done: 'Merged and finished',
};

function usePhone() {
  const [phone, setPhone] = useState(() => typeof matchMedia === 'function' && matchMedia(PHONE).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined;
    const m = matchMedia(PHONE);
    const on = () => setPhone(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return phone;
}

function CardMenu({ card, job, act }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="icon-btn car-menu" aria-label={`Actions for ${card.title}`}>
        <span aria-hidden="true" className="dots" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu" align="end" sideOffset={4}>
          {card.body ? (
            <>
              <DropdownMenu.Label className="menu-notes">{card.body}</DropdownMenu.Label>
              <DropdownMenu.Separator className="menu-sep" />
            </>
          ) : null}
          <DropdownMenu.Item className="menu-item" disabled={!act.canShape} onSelect={act.shape}>Plan this task</DropdownMenu.Item>
          {act.inbox ? <DropdownMenu.Item className="menu-item" disabled={!act.canFind} onSelect={act.find}>Find cause</DropdownMenu.Item> : null}
          <DropdownMenu.Item className="menu-item" disabled={!job} onSelect={act.open}>Open session</DropdownMenu.Item>
          <DropdownMenu.Item className="menu-item" onSelect={() => navigator.clipboard?.writeText(card.id)}>Copy task id</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function carState({ turn, job, lane }) {
  if (turn) return <span className="status car-wait"><Mark status="waiting" label="Needs you" /><span>Needs you</span></span>;
  if (!job || (job.outcome !== 'invariant' && job.status === lane.toLowerCase())) return null;
  return <Status job={job} scope="card" />;
}

function usePulse(on) {
  const [pulse, setPulse] = useState(0);
  useEffect(() => { if (on) setPulse((n) => n + 1); }, [on]);
  return pulse;
}

function carMeaning({ turn, job, lane }) {
  if (turn) return 'waiting';
  if (job?.status === 'failed') return 'failed';
  if (lane === 'Done') return 'done';
  if (job?.status === 'running') return 'working';
  return undefined;
}

function Car({ card, lane, compact, ctx }) {
  const { state, deck, phone, dragging, motionOn } = ctx;
  const { ref, isDragging } = useDraggable({ id: card.id, disabled: phone });
  const pulse = usePulse(ctx.arrived.has(`${card.id}:${lane}`));
  const job = latestJob(state, card.id);
  const live = liveJob(state, card.id);
  const inbox = lane === 'Inbox';
  const turn = ctx.turnIds.has(card.id);
  const fresh = Boolean(deck.sinceLook?.has(card.id));
  const act = {
    inbox,
    canShape: inbox && !live,
    canFind: inbox && !(live && live.stage !== 'run') && state.jobs.some((j) => j.cardId === card.id && j.worktree && !j.worktreeRemoved),
    shape: () => ctx.shape(card),
    find: () => ctx.findCause(card),
    open: () => job && ctx.openJob(job.id),
  };
  const notes = card.body ? `notes-${card.id}` : undefined;
  const look = () => { if (fresh) deck.seen(card.id); };
  return (
    <motion.li ref={ref} className="car-slot" data-card={card.id} data-dragging={isDragging} data-turn={turn} data-new={fresh}
      layoutId={dragging ? undefined : card.id} layout={dragging ? false : 'position'} transition={{ layout: motionOn ? carMove : STILL }}
      onClickCapture={look}>
      <article className={turn ? 'car wait-glow' : 'car'} aria-describedby={notes} data-state={carMeaning({ turn, job: live ?? job, lane })} data-compact={compact}>
        <div className="car-top">
          <h3 className="car-title" title={card.title}>
            {job ? <button type="button" className="car-open" onClick={act.open}>{card.title}</button> : <span className="car-name">{card.title}</span>}
          </h3>
          {compact ? carState({ turn, job: live ?? job, lane }) : null}
          <CardMenu card={card} job={job} act={act} />
        </div>
        {card.collision?.text ? <p className="car-note" role="note">Cannot approve: {card.collision.text}</p> : null}
        {compact ? null : <div className="car-foot">
          <span className="car-id num" aria-hidden="true">{shortId(card.id)}</span>
          {fresh ? <span className="car-new">New here</span> : null}
          {carState({ turn, job: live ?? job, lane })}
          {act.canShape ? <button type="button" className="btn btn-secondary btn-sm car-plan" onClick={act.shape}>Plan</button> : null}
        </div>}
        {notes ? <span id={notes} className="sr">Notes: {card.body}</span> : null}
        {pulse && motionOn ? (
          <motion.span key={pulse} className="car-pulse" aria-hidden="true"
            initial={{ opacity: 0.8, scale: 1 }} animate={{ opacity: 0, scale: 1.08 }} transition={{ duration: 0.9, ease: 'easeOut' }} />
        ) : null}
      </article>
    </motion.li>
  );
}

function Stop({ name, n, live, ctx }) {
  const { ref, isDropTarget } = useDroppable({ id: name, disabled: ctx.phone });
  return (
    <li ref={ref} className="stop" data-lane={name} data-line={LINE[name]} data-load={n > 0} data-over={isDropTarget} title={RULE[name]}>
      <span className="stop-dot" aria-hidden="true">{live ? <span className="stop-live" /> : null}</span>
      <span className="stop-name">{laneWord(name)}</span>
      <span className="stop-count num">{n}<span className="sr">{n === 1 ? ' task' : ' tasks'}</span></span>
    </li>
  );
}

function Lane({ name, cards, queueOrder, ctx }) {
  const { ref, isDropTarget } = useDroppable({ id: `lane:${name}`, disabled: ctx.phone });
  const [all, setAll] = useState(false);
  const n = cards.length;
  const word = laneWord(name);
  const keep = name === 'Running';
  const shown = all || keep || ctx.dragging ? cards : cards.slice(0, SHOWN);
  const compact = keep && n > SHOWN;
  const listId = `lane-${name}`;
  return (
    <section ref={ref} className="lane" data-lane={name} data-line={LINE[name]} data-over={isDropTarget} data-load={n > 0}
      style={{ '--col': LANES.indexOf(name) + 1 }} aria-label={`${word}, ${n} task${n === 1 ? '' : 's'}`}>
      <p className="lane-cap" aria-hidden="true">
        <span className="lane-dot" />
        <span>{word}</span>
        <span className="lane-count num">{n}</span>
      </p>
      <ul className="lane-cars" id={listId}>
        {shown.map((c) => <Car key={c.id} card={c} lane={name} compact={compact} ctx={ctx} />)}
      </ul>
      {n > SHOWN && !keep && !ctx.dragging ? (
        <button type="button" className="fold lane-more" aria-expanded={all} aria-controls={listId} onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `+${n - SHOWN} more`}
        </button>
      ) : null}
      {queueOrder}
    </section>
  );
}

const track = (name, n) => {
  if (!n) return 'max-content';
  return name === 'Running' ? 'minmax(0, 1.25fr)' : 'minmax(0, 1fr)';
};

export default function Board({ state, project, items, deck, openJob, addCard }) {
  const [dragging, setDragging] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const phone = usePhone();
  const calm = useCalm();
  const { lanes: groups, waitIds: turnIds, working } = homeCounts(state, project.key, items);
  const shape = (card) => deck.act((api) => api.shape(card.id));
  const findCause = (card) => deck.act((api) => api.findCause(card.id));
  const none = LANES.every((l) => groups[l].length === 0);
  const arrived = new Set((deck.moves ?? []).map((m) => `${m.id}:${m.to}`));
  const ctx = { state, deck, turnIds, shape, findCause, openJob, phone, dragging, arrived, motionOn: !calm.reduced && !calm.paused };
  const cardsOf = (name) => laneShownCards(groups, name, turnIds);
  const countOf = (name) => (name === 'Running' ? workingCount(state, items, project.key) : groups[name].length);
  const order = <QueueOrder state={state} deck={deck} project={project} />;
  const loose = groups.Queued.length === 0 && queuedJobs(state).length > 0;
  const cols = [...LANES.map((name) => track(name, countOf(name) || (name === 'Queued' && loose))), 'max-content'].join(' ');

  const onDragEnd = ({ operation, canceled }) => {
    setDragging(false);
    const card = state.cards.find((c) => c.id === operation.source?.id);
    const to = String(operation.target?.id ?? '').replace(/^lane:/, '');
    if (canceled || !card || !to || !LANES.includes(to)) return;
    const from = LANES.find((l) => groups[l].some((c) => c.id === card.id));
    if (to === from) return;
    if (from === 'Inbox' && to === 'Shaped') { setRefusal(null); shape(card); return; }
    setRefusal(`${card.title} stays in ${laneWord(from)}. The daemon has no route that moves a task from ${laneWord(from)} to ${laneWord(to)}; only Inbox to Planned is wired (it runs Plan).`);
  };

  return (
    <DragDropProvider onDragStart={() => { setDragging(true); setRefusal(null); }} onDragEnd={onDragEnd}>
      <div className="board-col" data-empty={none}>
        <QueuePause state={state} deck={deck} />
        <div className="board" role="group" aria-label={`Board for ${project.key}`} data-dragging={dragging} style={{ '--cols': cols }}>
          <div className="line-row" data-block="line">
            <ol className="line" aria-label="Stations">
              {LANES.map((name) => <Stop key={name} name={name} n={countOf(name)} live={name === 'Running' && working} ctx={ctx} />)}
            </ol>
            <div className="line-end">
              <Overview state={state} project={project} deck={deck} />
              <button className={none ? 'btn btn-primary line-new' : 'btn btn-secondary line-new'} onClick={addCard}>New task</button>
            </div>
          </div>
          {refusal ? <p className="refusal" role="status"><span>{refusal}</span><button className="link" onClick={() => setRefusal(null)}>Dismiss</button></p> : null}
          <div className="lanes" data-block="cards">
            {none ? <p className="board-none">No tasks yet. Add a task to start.</p> : null}
            {LANES.filter((name) => cardsOf(name).length).map((name) => (
              <Lane key={name} name={name} cards={cardsOf(name)} queueOrder={name === 'Queued' ? order : null} ctx={ctx} />
            ))}
            {loose ? <div className="lane lane-loose" data-line="queued" style={{ '--col': LANES.indexOf('Queued') + 1 }}>{order}</div> : null}
          </div>
        </div>
      </div>
    </DragDropProvider>
  );
}
