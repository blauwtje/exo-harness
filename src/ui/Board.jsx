import { useRef, useState } from 'react';
import { DragDropProvider, useDraggable, useDroppable } from '@dnd-kit/react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as ScrollArea from '@radix-ui/react-scroll-area';
import { AnimatePresence, motion } from 'motion/react';
import { Count, Status, spring, useBelow } from './parts.jsx';
import { LANES, groupCards, latestJob, liveJob, shortId } from './derive.js';

const HINT = {
  Inbox: 'Manual cards wait here until you shape them.',
  Shaped: 'A brief exists. Review it, then approve.',
  Approved: 'Approved briefs, ready to queue.',
  Queued: 'Waiting for a free agent.',
  Running: 'Agents are working on these.',
  Review: 'Built work waiting for your eyes.',
  Done: 'Finished and merged.',
};

function CardMenu({ card, job, onShape, onOpen, canShape, inbox, canFind, onFind }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="icon-btn" aria-label={`Actions for ${card.title}`}>
        <span aria-hidden="true" className="dots" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu" align="end" sideOffset={4}>
          <DropdownMenu.Item className="menu-item" disabled={!canShape} onSelect={onShape}>Shape this card</DropdownMenu.Item>
          {inbox ? <DropdownMenu.Item className="menu-item" disabled={!canFind} onSelect={onFind}>Find cause</DropdownMenu.Item> : null}
          <DropdownMenu.Item className="menu-item" disabled={!job} onSelect={onOpen}>Open job</DropdownMenu.Item>
          <DropdownMenu.Item className="menu-item" onSelect={() => navigator.clipboard?.writeText(card.id)}>Copy card id</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function Card({ card, state, shape, findCause, openJob, setFocusCard }) {
  const { ref, isDragging } = useDraggable({ id: card.id });
  const job = latestJob(state, card.id);
  const live = liveJob(state, card.id);
  const inbox = card.lane === 'Inbox';
  const canShape = inbox && !live;
  // why: Decision 15; find-cause inspects the card's latest worktree, so it needs one still on disk and no other live session.
  const canFind = inbox && !(live && live.stage !== 'run') && state.jobs.some((j) => j.cardId === card.id && j.worktree && !j.worktreeRemoved);
  return (
    <div ref={ref} className="card-slot" data-dragging={isDragging} data-card={card.id} onPointerEnter={() => setFocusCard?.(card.id)} onPointerLeave={() => setFocusCard?.(null)} onFocus={() => setFocusCard?.(card.id)} onBlur={() => setFocusCard?.(null)}>
      <motion.article layout="position" className="card" transition={spring}
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }}>
        <span className="plate-id num">{shortId(card.id)}</span>
        <div className="card-top">
          <h3>{card.title}</h3>
          <CardMenu card={card} job={job} canShape={canShape} onShape={() => shape(card)} onOpen={() => openJob(job.id)}
            inbox={inbox} canFind={canFind} onFind={() => findCause(card)} />
        </div>
        {card.body ? <p className="card-body">{card.body}</p> : null}
        {card.collision?.text ? <p className="card-note" role="note">Cannot approve: {card.collision.text}</p> : null}
        <div className="card-meta">
          {job ? <button className="link" onClick={() => openJob(job.id)}><Status job={job} scope="card" /></button> : <span className="dim">No job yet</span>}
        </div>
        {canShape ? <button className="btn btn-edge" onClick={() => shape(card)}>Shape</button> : null}
      </motion.article>
    </div>
  );
}

function Lane({ name, cards, bridge, dragging, state, shape, findCause, openJob, addCard, setFocusCard }) {
  const { ref, isDropTarget } = useDroppable({ id: name });
  const view = useRef(null);
  const below = useBelow(view, '.card-slot', cards.length);
  const collapsed = cards.length === 0 && name !== 'Inbox' && !dragging;
  const waiting = name === 'Running' ? cards.filter((c) => liveJob(state, c.id)?.status === 'waiting') : [];
  const working = name === 'Running' ? cards.filter((c) => !waiting.includes(c)) : cards;
  const card = (c) => <Card key={c.id} card={c} state={state} shape={shape} findCause={findCause} openJob={openJob} setFocusCard={setFocusCard} />;
  return (
    <motion.section ref={ref} layout className={`lane${collapsed ? ' lane-collapsed' : ''}`} data-lane={name} data-over={isDropTarget} data-active={name === 'Running' && working.length > 0} data-load={cards.length > 0} data-bridge={bridge}
      aria-label={`${name}, ${cards.length} card${cards.length === 1 ? '' : 's'}`} transition={spring}>
      <header className="lane-head">
        <span className="joint" aria-hidden="true" />
        <h2>{name}</h2>
        <Count n={working.length} />
        {name === 'Inbox' ? <button className="icon-btn plus" onClick={addCard} aria-label="New card"><span aria-hidden="true" /></button> : null}
      </header>
      {collapsed ? null : (
        <ScrollArea.Root className="scroll">
          <ScrollArea.Viewport className="scroll-view" ref={view}>
            <div className="stack">
              <AnimatePresence initial={false} mode="popLayout">
                {working.map(card)}
              </AnimatePresence>
              {waiting.length ? (
                <div className="sub-divider" role="group" aria-label={`Waiting on you, ${waiting.length}`}>
                  <span className="section-h">Waiting on you <span className="count num">{waiting.length}</span></span>
                </div>
              ) : null}
              <AnimatePresence initial={false} mode="popLayout">
                {waiting.map(card)}
              </AnimatePresence>
              {cards.length === 0 ? (
                <div className="lane-empty">
                  <p>{HINT[name]}</p>
                  {name === 'Inbox' ? <button className="btn btn-edge" onClick={addCard}>Add card</button> : null}
                </div>
              ) : null}
            </div>
          </ScrollArea.Viewport>
          <ScrollArea.Scrollbar orientation="vertical" className="sb"><ScrollArea.Thumb className="sb-thumb" /></ScrollArea.Scrollbar>
        </ScrollArea.Root>
      )}
      {below > 0 ? <p className="more" role="status"><span className="num">+{below}</span> more below</p> : null}
    </motion.section>
  );
}

export default function Board({ state, project, deck, openJob, addCard, setFocusCard }) {
  const [dragging, setDragging] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const groups = groupCards(state, project.key);
  const shape = (card) => deck.act((api) => api.shape(card.id));
  const findCause = (card) => deck.act((api) => api.findCause(card.id));

  const onDragEnd = ({ operation, canceled }) => {
    setDragging(false);
    const card = state.cards.find((c) => c.id === operation.source?.id);
    const to = operation.target?.id;
    if (canceled || !card || !to || !LANES.includes(to)) return;
    const from = groups && LANES.find((l) => groups[l].some((c) => c.id === card.id));
    if (to === from) return;
    if (from === 'Inbox' && to === 'Shaped') { setRefusal(null); shape(card); return; }
    setRefusal(`${card.title} stays in ${from}. The daemon has no route that moves a card from ${from} to ${to}; only Inbox to Shaped is wired (it runs Shape).`);
  };

  return (
    <DragDropProvider onDragStart={() => { setDragging(true); setRefusal(null); }} onDragEnd={onDragEnd}>
      <div className="board-col" data-empty={LANES.every((l) => groups[l].length === 0)}>
      <div className="board" role="group" aria-label={`Board for ${project.key}`}>
        {LANES.map((name, i) => (
          <Lane key={name} name={name} cards={groups[name]} bridge={groups[name].length > 0 && groups[LANES[i + 1]]?.length > 0} dragging={dragging} state={state} shape={shape} findCause={findCause} openJob={openJob} addCard={addCard} setFocusCard={setFocusCard} />
        ))}
      </div>
      {refusal ? <p className="refusal" role="status">{refusal}<button className="link" onClick={() => setRefusal(null)}>Dismiss</button></p> : null}
      </div>
    </DragDropProvider>
  );
}
