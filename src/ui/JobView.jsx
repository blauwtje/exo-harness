import { useEffect, useId, useMemo, useRef, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import * as RadioGroup from '@radix-ui/react-radio-group';
import * as ScrollArea from '@radix-ui/react-scroll-area';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { base, ease, fadeRise } from './motion.js';
import { Status, Mark } from './parts.jsx';
import { fmt, isLive, laneOf, laneWord, LINE, ledgerOf, needsYou, shortId, timelineRows, usd } from './derive.js';

const NONE = fmt(null);
const DOT = ` ${String.fromCharCode(183)} `;
const LATEST = 5;
const FADE_IN = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: base, ease } };
// why: code, paths, tool output and limit readings sit behind each event's own disclosure; only prose shows inline.
const SYSTEM_KINDS = new Set(['tool', 'output', 'raw', 'limit', 'start', 'turn', 'think']);
const FOLD_KINDS = new Set(['tool', 'output', 'raw', 'limit', 'ask', 'start', 'turn', 'think']);
const KIND_WORD = { question: 'Question', permission: 'Permission', brief: 'Brief', gate: 'Gate', limit: 'Limit', conflict: 'Conflict', 'turn-cap': 'Turn cap', 'run-failed': 'Run failed', setup: 'Setup', refusal: 'Refused', land: 'Land' };
const plain = (s) => String(s ?? '').split(DOT).join(', ');
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function Row({ label, value, unit, wrong, sub, mono }) {
  return (
    <div className={`ledger-row${sub ? ' ledger-sub' : ''}`} data-wrong={wrong || undefined}>
      <dt>{label}</dt>
      <dd className={mono && value !== NONE ? 'mono' : 'num'} title={typeof value === 'string' && value !== NONE ? value : undefined}>
        {value}{unit && value !== NONE ? <small>{unit}</small> : null}
      </dd>
    </div>
  );
}

function LedgerRows({ rows }) {
  return (
    <section className="ledger-rows" aria-labelledby="rows-h">
      <h3 id="rows-h">Cost rows</h3>
      <ol>
        {rows.map((r) => (
          <li key={r.at} className="ledger-row" data-idle={r.idleCacheWrite || undefined}>
            <span className="num">{new Date(r.at).toLocaleTimeString('en-GB')}</span>
            <span className="num">{fmt(r.input)} in, {fmt(r.output)} out, {fmt(r.cacheRead)} read, {fmt(r.cacheCreation1h)} + {fmt(r.cacheCreation5m)} write</span>
            <span className="num">{usd(r.costUsd)} <small>estimate</small></span>
            {r.idleCacheWrite ? <span className="idle-flag">idle cache write</span> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function CostPanel({ l, total, job }) {
  return (
    <section className="job-cost" aria-label="Cost">
      <dl className="cost-big">
        <div><dt>Tokens used</dt><dd className="num">{fmt(total)}</dd></div>
        <div><dt>Estimated cost</dt><dd className="num">{usd(l.cost)}</dd></div>
      </dl>
      <div className="cost-groups">
        <section aria-labelledby="cost-tokens-h">
          <h3 id="cost-tokens-h">Tokens</h3>
          <dl>
            <Row label="Input tokens" value={fmt(l.input)} />
            <Row label="Output tokens" value={fmt(l.output)} />
            <Row label="Cache read" value={fmt(l.cacheRead)} />
            <Row label="Cache write" value={fmt(l.cacheWrite)} />
            <Row label="of which 1 hour" value={fmt(l.cache1h)} sub />
            <Row label="of which 5 minute" value={fmt(l.cache5m)} sub />
            <Row label="All tokens" value={fmt(total)} />
            <Row label="Estimated cost" value={usd(l.cost)} unit=" est." />
          </dl>
        </section>
        <section aria-labelledby="cost-setup-h">
          <h3 id="cost-setup-h">Setup</h3>
          <dl className="ledger-meta">
            <Row label="Model" value={l.model ?? NONE} />
            <Row label="Effort" value={l.effort ?? NONE} />
            <Row label="Claude Code" value={l.claudeVersion ?? NONE} />
            <Row label="exo plugin" value={l.exoVersion ?? NONE} />
            <Row label="Session id" value={job.id ?? NONE} mono />
          </dl>
        </section>
      </div>
      {job.ledger?.length ? <LedgerRows rows={job.ledger} /> : null}
    </section>
  );
}

function RunFields({ run }) {
  const v = (x) => (x == null || x === '' ? NONE : String(x));
  return (
    <section className="job-run" aria-labelledby="run-h">
      <h3 id="run-h">Run</h3>
      <dl>
        <Row label="Run id" value={v(run.id)} mono />
        <Row label="Phase" value={v(run.phase)} wrong={['stopped', 'crashed', 'refused'].includes(run.phase)} />
        <Row label="Stage" value={v(run.stage)} />
        <Row label="Branch" value={v(run.branch)} mono />
        <Row label="Task" value={v(run.task)} />
        <Row label="Landed" value={v(run.landed)} />
        <Row label="Total tasks" value={v(run.total)} />
        <Row label="Reason" value={v(run.reason)} wrong={Boolean(run.reason)} />
        <Row label="Run root" value={v(run.runRoot)} mono />
      </dl>
    </section>
  );
}

function Glyph({ row }) {
  if (row.kind === 'error') return <Mark status="crashed" label="Failed" />;
  return <span className="tl-glyph" aria-hidden="true"><i /></span>;
}

// why: the newest rows show and older ones fold behind one button. Hold (the default) freezes where
// the list starts and never scrolls; Follow keeps the newest rows in view as they arrive.
// why: the default list is what the agent said and what was decided; system events (limits, reads, tool
// output, paths) fold behind one button and every one stays a click away.
function Timeline({ rows: every, follow }) {
  const wrap = useRef(null);
  const [all, setAll] = useState(false);
  const [sys, setSys] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const rows = useMemo(() => (sys ? every : every.filter((r) => !SYSTEM_KINDS.has(r.kind))), [every, sys]);
  const hidden = every.length - every.filter((r) => !SYSTEM_KINDS.has(r.kind)).length;
  const tail = Math.max(0, rows.length - LATEST);
  useEffect(() => {
    if (follow) setAnchor(null);
    else if (anchor == null && rows.length) setAnchor(tail);
  }, [follow, anchor, rows.length, tail]);
  useEffect(() => {
    const view = wrap.current?.closest('.scroll-view');
    if (follow && view) view.scrollTop = view.scrollHeight;
  }, [rows.length, follow]);
  if (!every.length) return <p className="job-empty">No events yet. They appear here as the agent works.</p>;
  const start = all ? 0 : follow ? tail : Math.min(anchor ?? tail, tail);
  return (
    <div className="tl-wrap" ref={wrap}>
      {start > 0 || (all && tail > 0) ? (
        <button type="button" className="fold tl-more" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? 'Hide earlier events' : `Show ${start} earlier event${start === 1 ? '' : 's'}`}
        </button>
      ) : null}
      {!rows.length ? <p className="job-empty">The agent has not said anything yet.</p> : null}
      <ol className="timeline">
        <AnimatePresence initial={false}>
          {rows.slice(start).map((r) => (
            <motion.li key={r.key} className={`tl tl-${r.kind}${SYSTEM_KINDS.has(r.kind) ? ' tl-sys' : ''}`} {...FADE_IN}>
              <Glyph row={r} />
              <div className="tl-body">
                {r.text && FOLD_KINDS.has(r.kind) ? (
                  <details className="tl-detail">
                    <summary className="fold">{r.kind === 'tool' ? <span className="tl-tag">Tool</span> : null}<b>{r.title}</b></summary>
                    <p className="mono">{plain(r.text)}</p>
                  </details>
                ) : (
                  <>
                    <b>{r.title}</b>
                    {r.text ? <p>{plain(r.text)}</p> : null}
                  </>
                )}
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
      {hidden > 0 ? (
        <button type="button" className="fold tl-more" aria-expanded={sys} onClick={() => { setSys(!sys); setAnchor(null); }}>
          {sys ? 'Hide system events' : `Show ${hidden} system event${hidden === 1 ? '' : 's'}`}
        </button>
      ) : null}
    </div>
  );
}

function Scroll({ children, label }) {
  return (
    <ScrollArea.Root className="job-scroll">
      <ScrollArea.Viewport className="scroll-view" aria-label={label} tabIndex={0}>{children}</ScrollArea.Viewport>
      <ScrollArea.Scrollbar orientation="vertical" className="sb"><ScrollArea.Thumb className="sb-thumb" /></ScrollArea.Scrollbar>
    </ScrollArea.Root>
  );
}

function Choices({ legend, hideLegend, value, onChange, options }) {
  return (
    <fieldset className="choice">
      <legend className={hideLegend ? 'sr' : undefined}>{legend}</legend>
      <RadioGroup.Root value={value ?? ''} onValueChange={onChange} className="choice-list">
        {options.map((o) => (
          <RadioGroup.Item key={o.value} value={o.value} className="choice-item">
            <span className="choice-key">{o.key}</span>
            <span className="choice-text"><b>{o.label}</b>{o.text ? <em>{o.text}</em> : null}</span>
            {o.recommended ? <small>recommended</small> : null}
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
    </fieldset>
  );
}

function ReplyBox({ onSend, primary }) {
  const [text, setText] = useState('');
  const id = useId();
  return (
    <form className="reply" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { onSend(text.trim()); setText(''); } }}>
      <label className="sr" htmlFor={id}>Reply to the agent</label>
      <textarea id={id} rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply in your own words" />
      <button type="submit" className={primary ? 'btn btn-primary' : 'btn btn-secondary'} disabled={!text.trim()}>Send reply</button>
    </form>
  );
}

function Reveal({ label, children }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="turn-fold">
      <button type="button" className="fold" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>{label}</button>
      {open ? <div id={id} className="turn-fold-inner">{children}</div> : null}
    </div>
  );
}

function Panel({ item, headline, children, actions, more, moreLabel }) {
  return (
    <motion.section className="job-turn ask-card" aria-labelledby="wait-h" {...fadeRise}>
      <p className="ask-context"><span className="pill pill-need">{KIND_WORD[item.kind] ?? item.kind}</span></p>
      <h2 id="wait-h" className="ask-headline" tabIndex={-1}>{headline}</h2>
      {children}
      {actions ? <div className="actions">{actions}</div> : null}
      {more ? <Reveal label={moreLabel}>{more}</Reveal> : null}
    </motion.section>
  );
}

const letter = (i) => String.fromCharCode(65 + i);

function QuestionPanel({ item, job, deck }) {
  const [picked, setPicked] = useState({});
  const reply = (t) => deck.act((api) => api.reply(job.id, t));
  const own = <ReplyBox onSend={reply} />;
  const asked = item.ask?.request.input?.questions;
  const specs = asked
    ? asked.map((q) => ({ id: q.question, title: q.question, options: (q.options ?? []).map((o, i) => ({ value: o.label, key: letter(i), label: o.label, text: o.description })) }))
    : (item.questions ?? []).map((q) => ({ id: q.n, title: q.title, legend: `${q.n}/${q.total} ${q.title}`, options: q.options.map((o) => ({ value: o.letter, key: o.letter, label: o.label, text: o.text, recommended: q.recommended === o.letter })) }));
  if (!specs.length) {
    return (
      <Panel item={item} headline="Reply to the agent">
        {item.text ? <p className="job-turn-ask">{item.text}</p> : null}
        <ReplyBox onSend={reply} primary />
      </Panel>
    );
  }
  const one = specs.length === 1;
  const wrap = useRef(null);
  const [hint, setHint] = useState('');
  const send = () => {
    const miss = specs.findIndex((q) => !picked[q.id]);
    if (miss >= 0) {
      setHint(one ? 'Pick an option' : 'Pick an option for each question');
      wrap.current?.querySelectorAll('[role="radiogroup"]')[miss]?.querySelector('[role="radio"]')?.focus();
      return;
    }
    if (asked) return deck.act((api) => api.permission({ id: job.id, requestId: item.ask.requestId, allow: true, answers: picked }));
    return reply(specs.map((q) => { const o = q.options.find((x) => x.value === picked[q.id]); return `${q.id}. (${o.key}) ${o.label}`; }).join('\n'));
  };
  return (
    <Panel item={item} headline={one ? specs[0].title : `Answer ${specs.length} questions`} more={own} moreLabel="Reply in your own words"
      actions={<>
        <button type="button" className="btn btn-primary" onClick={send}>{asked ? 'Answer' : 'Send answers'}</button>
        {asked ? <button type="button" className="btn btn-secondary" onClick={() => deck.act((api) => api.permission({ id: job.id, requestId: item.ask.requestId, allow: false, message: 'Skipped by the user.' }))}>Skip</button> : null}
        <span className="pick-hint" role="status">{hint}</span>
      </>}>
      <div className="choices" ref={wrap}>
        {specs.map((q) => (
          <Choices key={q.id} legend={q.legend ?? q.title} hideLegend={one} value={picked[q.id]} onChange={(v) => { setHint(''); setPicked((p) => ({ ...p, [q.id]: v })); }} options={q.options} />
        ))}
      </div>
    </Panel>
  );
}

const RUN_ACTION = {
  resume: { label: 'Resume', call: (api, id) => api.resumeRun(id) },
  retry: { label: 'Retry', call: (api, id) => api.retry(id) },
  discard: { label: 'Discard', call: (api, id) => api.discard(id), bad: true },
};
const GATE_HEAD = { limit: 'Continue after the usage limit?', conflict: 'Fix a rebase conflict' };
const STAGE_WORD = { spec: 'Plan', run: 'Run' };
const FAILED = new Set(['crashed', 'refused', 'invariant']);
const sessionName = (j) => (j.stage ? `${STAGE_WORD[j.stage] ?? cap(j.stage)} session` : 'Session');

function runOptions(job) {
  const options = (job.needsYou?.options ?? []).filter((o) => RUN_ACTION[o]);
  return { options, safe: options.find((o) => !RUN_ACTION[o].bad) };
}

function safeRunAction({ job }) {
  const { safe } = runOptions(job);
  if (!safe) return null;
  return { label: RUN_ACTION[safe].label, call: (api) => RUN_ACTION[safe].call(api, job.id) };
}

const ITEM_ACTION = {
  brief: ({ card, job }) => ({ label: 'Approve', call: (api) => api.approve(card?.id ?? job.cardId) }),
  gate: ({ job, lane }) => ({ label: lane === 'Review' ? 'Merge' : 'Approve', call: (api) => api.approveGate(job.id) }),
  limit: ({ job }) => ({ label: 'Continue', call: (api) => api.approveGate(job.id) }),
  conflict: ({ job, card }) => ({ label: 'Find cause', call: (api) => api.findCause(card?.id ?? job.cardId, job.id) }),
  'turn-cap': ({ job }) => ({ label: 'Continue', call: (api) => api.continueJob(job.id) }),
  'run-failed': safeRunAction,
  setup: ({ job }) => ({ label: 'Retry', call: (api) => api.retry(job.id) }),
  refusal: ({ job }) => ({ label: 'Retry', call: (api) => api.retry(job.id) }),
  land: ({ job }) => ({ label: 'Retry', call: (api) => api.finishLand(job.id) }),
};

function mainAction(ctx) {
  if (ctx.item) return ITEM_ACTION[ctx.item.kind]?.(ctx) ?? null;
  if (ctx.lane === 'Inbox' && ctx.card && !ctx.live) return { label: 'Plan', call: (api) => api.shape(ctx.card.id) };
  return null;
}

function DecisionPanel({ item, job, deck, verb }) {
  const act = (fn) => deck.act((api) => fn(api));
  const n = job.needsYou ?? {};
  if (item.kind === 'question') return <QuestionPanel item={item} job={job} deck={deck} />;
  if (item.kind === 'permission') {
    const { tool_name: tool, input = {} } = item.ask.request;
    return (
      <Panel item={item} headline={`Allow ${tool}?`}
        actions={<>
          <button type="button" className="btn btn-primary" onClick={() => act((api) => api.permission({ id: job.id, requestId: item.ask.requestId, allow: true }))}>Allow once</button>
          <button type="button" className="btn btn-secondary" onClick={() => act((api) => api.permission({ id: job.id, requestId: item.ask.requestId, allow: false }))}>Deny</button>
        </>}>
        <pre className="cmd" aria-label="What it wants to run">{input.command ?? input.file_path ?? JSON.stringify(input, null, 1)}</pre>
      </Panel>
    );
  }
  if (item.kind === 'brief') {
    return (
      <Panel item={item} headline="Approve the brief?"
        actions={<button type="button" className="btn btn-secondary" onClick={() => act((api) => api.reject(item.card?.id ?? job.cardId))}>Reject</button>}>
        <p className="job-turn-ask">Approving starts the run. Rejecting moves the task back to Inbox.</p>
      </Panel>
    );
  }
  if (item.kind === 'gate' || GATE_HEAD[item.kind]) {
    const conflict = item.kind === 'conflict';
    const more = (n.diffStat || n.files?.length) ? (
      <>
        {n.diffStat ? <pre className="cmd" aria-label="Diff stat">{n.diffStat.trimEnd()}</pre> : null}
        {n.files?.length ? <ul className="files" aria-label="Changed files">{n.files.map((f) => <li key={f} className="mono">{f}</li>)}</ul> : null}
      </>
    ) : null;
    return (
      <Panel item={item} headline={GATE_HEAD[item.kind] ?? `${verb} this change?`} more={more} moreLabel="Show the change"
        actions={<>
          {conflict ? <button type="button" className="btn btn-secondary" onClick={() => act((api) => api.approveGate(job.id))}>Approve</button> : null}
          <button type="button" className="btn btn-secondary" onClick={() => act((api) => api.rejectGate(job.id))}>Reject</button>
        </>}>
        {n.gates?.length ? <ul className="gates">{n.gates.map((g) => <li key={g}>{g.replace(/^-\s*/, '')}</li>)}</ul> : <p className="job-turn-ask">Check the change first. Rejecting moves the task back.</p>}
      </Panel>
    );
  }
  if (item.kind === 'turn-cap') {
    return (
      <Panel item={item} headline={`Keep going after ${n.turns ?? 'many'} turns?`}>
        <p className="job-turn-ask">The agent paused so you can check its work.</p>
      </Panel>
    );
  }
  if (item.kind === 'run-failed') {
    const { options, safe } = runOptions(job);
    const rest = options.filter((o) => o !== safe);
    return (
      <Panel item={item} headline="The run stopped"
        actions={rest.length ? rest.map((o) => (
          <button key={o} type="button" className="btn btn-secondary" onClick={() => act((api) => RUN_ACTION[o].call(api, job.id))}>{RUN_ACTION[o].label}</button>
        )) : null}>
        <p className="job-turn-ask">{plainPath(n.reason) || 'The run ended before it finished.'}</p>
      </Panel>
    );
  }
  if (item.kind === 'setup' || item.kind === 'refusal' || item.kind === 'land') {
    const head = { setup: 'Worktree setup failed', refusal: 'exo refused the run', land: 'Landing stopped' }[item.kind];
    return (
      <Panel item={item} headline={head}>
        <p className="job-turn-ask">{plainPath(n.text) || (item.kind === 'setup' ? 'The setup step failed, so the run did not start.' : 'Nothing was changed.')}</p>
      </Panel>
    );
  }
  return null;
}

function plainPath(text) {
  return String(text ?? '').replace(/\s+(?:at|in)\s+\/[^\s'"`,;)]+/g, '').replace(/:\s+\/[^\s'"`,;)]+/g, '').trim();
}

function FollowSwitch({ on, set }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="follow" onClick={() => set(!on)}>
      <span className="follow-track" aria-hidden="true"><i /></span>
      <span>Follow new events</span>
      <span className="follow-state">{on ? 'On' : 'Off'}</span>
    </button>
  );
}

const TAB_INK = { duration: base, ease };

function Tab({ value, current, children }) {
  return (
    <Tabs.Trigger value={value} className="tab">
      {children}
      {current === value ? <motion.span layoutId="job-tab-ink" className="tab-ink" transition={TAB_INK} aria-hidden="true" /> : null}
    </Tabs.Trigger>
  );
}

const TONE = { waiting: 'need', running: 'run', done: 'done', crashed: 'back', refused: 'back', invariant: 'back', stopped: 'quiet' };

function Sessions({ jobs, current }) {
  return (
    <ul className="job-sessions" aria-label="Sessions for this task">
      {jobs.map((j) => (
        <li key={j.id}>
          <a href={`#/jobs/${j.id}`} className="job-session" aria-current={j.id === current ? 'page' : undefined}>
            <span className="job-session-name">{sessionName(j)}</span>
            <Status job={j} />
            <span className="mono job-session-id">{shortId(j.id)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function StateWord({ s, shown, lane }) {
  if (FAILED.has(s)) return <span className="status">Moved back to {laneWord(lane)}</span>;
  return <Status job={shown} />;
}

function Footer({ shown, lane, action, deck, statusRef, live, onStop, hint }) {
  const s = shown.outcome === 'invariant' ? 'invariant' : shown.status;
  return (
    <footer className="job-foot" data-tone={TONE[s] ?? 'quiet'} data-line={LINE[lane] ?? 'inbox'}>
      <div className="job-foot-in">
        <div className="job-where">
          <span className="job-station" aria-hidden="true"><i /></span>
          <div className="job-where-text">
            <span className="job-sub job-state" ref={statusRef} tabIndex={-1} role="status">
              <span className="job-lane">{laneWord(lane)}</span>
              <StateWord s={s} shown={shown} lane={lane} />
            </span>
            {hint ? <span className="job-hint">{hint}</span> : null}
          </div>
        </div>
        {action ? <button type="button" className="btn btn-primary job-main" onClick={() => deck.act(action.call)}>{action.label}</button> : null}
        {live ? <button type="button" className="btn btn-secondary job-stop" onClick={onStop}>Stop session</button> : null}
      </div>
    </footer>
  );
}

function costLine({ total, cost }) {
  if (total == null) return 'No tokens used yet';
  if (cost == null) return `${fmt(total)} tokens`;
  return `${fmt(total)} tokens, ${usd(cost)} estimated`;
}

function hintOf({ item, action, live }) {
  if (item?.kind === 'question' || item?.kind === 'permission') return 'Answer above so the agent can go on';
  if (live && !item) return 'An agent is working on it';
  return null;
}

function whyOf({ job, s, lane, live }) {
  const reason = plainPath(job.run?.reason ?? job.reason ?? job.error);
  if (FAILED.has(s)) return { head: `Moved back to ${laneWord(lane)}.`, text: reason || 'The session ended before it finished.' };
  if (job.stage === 'spec' && lane === 'Inbox' && !live) return { head: 'Moved back to Inbox.', text: 'The plan was rejected. Plan it again when you are ready.' };
  if (reason) return { head: null, text: reason };
  return null;
}

export default function JobView({ job, card, events, deck }) {
  const [follow, setFollow] = useState(false);
  const [tab, setTab] = useState('output');
  const statusRef = useRef(null);
  const rows = useMemo(() => timelineRows(events), [events]);
  const ledger = useMemo(() => ledgerOf(events, job), [events, job]);
  const live = isLive(job);
  const item = useMemo(
    () => (deck.state ? needsYou(deck.state, {}) : []).find((x) => x.job?.id === job.id && x.kind !== 'failure' && x.kind !== 'invariant' && !(x.kind === 'question' && !x.ask && job.stage === 'run')),
    [deck.state, job.id, job.stage],
  );
  const jobs = useMemo(() => (deck.state?.jobs ?? [job]).filter((j) => j.cardId === job.cardId), [deck.state, job]);
  const shown = item ? { ...job, status: 'waiting', outcome: undefined } : job;
  const s = shown.outcome === 'invariant' ? 'invariant' : shown.status;
  const lane = card && deck.state ? laneOf(deck.state, card) : 'Inbox';
  const action = mainAction({ item, lane, job, card, live });
  const why = item ? null : whyOf({ job, s, lane, live });
  const parts = [ledger.input, ledger.output, ledger.cacheRead, ledger.cacheWrite];
  const total = parts.some((x) => x != null) ? parts.reduce((a, x) => a + (x ?? 0), 0) : null;
  const stop = async () => { await deck.act((api) => api.stop(job.id)); statusRef.current?.focus(); };
  return (
    <section className="jobview" aria-labelledby="job-h" data-ask={item ? '' : undefined}>
      <header className="job-head">
        <a href="#/" className="btn btn-quiet job-back"><i className="job-back-chev" aria-hidden="true" />Back to board</a>
        <h1 id="job-h" className="job-title">{card?.title ?? 'Session'}</h1>
        <p className="job-meta num">{costLine({ total, cost: ledger.cost })}</p>
        {why ? <p className="job-why">{why.head ? <b>{why.head}</b> : null} {why.text}</p> : null}
      </header>
      <AnimatePresence initial={false}>
        {item ? <DecisionPanel key={item.key} item={item} job={job} deck={deck} verb={action?.label ?? 'Approve'} /> : null}
      </AnimatePresence>
      <LayoutGroup id={`job-${job.id}`}>
        <Tabs.Root value={tab} onValueChange={setTab} className="tabs job-tabs">
          <div className="tabs-bar">
            <Tabs.List className="tabs-list" aria-label="Task details">
              <Tab value="output" current={tab}>Agent output<span className="count">{rows.length}</span></Tab>
              <Tab value="sessions" current={tab}>Sessions<span className="count">{jobs.length}</span></Tab>
              <Tab value="cost" current={tab}>Cost</Tab>
              <Tab value="history" current={tab}>History</Tab>
            </Tabs.List>
            {live && tab === 'output' ? <FollowSwitch on={follow} set={setFollow} /> : null}
          </div>
          <Tabs.Content value="output" className="tab-panel">
            <Scroll label="Agent output"><Timeline key={job.id} rows={rows} follow={live && follow} /></Scroll>
          </Tabs.Content>
          <Tabs.Content value="sessions" className="tab-panel tab-pad">
            <Sessions jobs={jobs} current={job.id} />
            {job.run ? <RunFields run={job.run} /> : null}
          </Tabs.Content>
          <Tabs.Content value="cost" className="tab-panel tab-pad">
            <CostPanel l={ledger} total={total} job={job} />
          </Tabs.Content>
          <Tabs.Content value="history" className="tab-panel">
            <Scroll label="Raw transcript">
              {events.length ? <pre className="raw">{events.map((e) => JSON.stringify(e)).join('\n')}</pre> : <p className="job-empty">Nothing recorded yet.</p>}
            </Scroll>
          </Tabs.Content>
        </Tabs.Root>
      </LayoutGroup>
      <Footer shown={shown} lane={lane} action={action} deck={deck} statusRef={statusRef} live={live} onStop={stop} hint={hintOf({ item, action, live })} />
    </section>
  );
}
