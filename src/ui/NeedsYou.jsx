import { useRef, useState } from 'react';
import * as RadioGroup from '@radix-ui/react-radio-group';
import * as ScrollArea from '@radix-ui/react-scroll-area';
import { AnimatePresence, motion } from 'motion/react';
import { Count, fade, spring, useBelow } from './parts.jsx';
import { shortId } from './derive.js';

const KIND_WORD = {
  permission: 'Permission', question: 'Question', invariant: 'Invariant', 'turn-cap': 'Turn cap', failure: 'Failure', health: 'Health',
  brief: 'Brief', gate: 'Gate', conflict: 'Conflict', 'run-failed': 'Run failed', setup: 'Setup', refusal: 'Refused', land: 'Land',
  limit: 'Limit', budget: 'Budget', overage: 'Overage',
};

const pathTail = (p) => String(p ?? '').split('/').slice(-3).join('/');

// why: Decision 18; the per-file diff loads on click, so a large change never ships in the state payload.
function GateBody({ item, deck, open }) {
  const n = item.job.needsYou;
  const [file, setFile] = useState(null);
  const [diff, setDiff] = useState('');
  const [manual, setManual] = useState(false);
  const show = async (f) => {
    if (f === file) { setFile(null); return; }
    setFile(f);
    setDiff('');
    const r = await deck.act((api) => api.diff(item.job.id, f));
    setDiff(r?.diff ?? '');
  };
  const conflict = item.kind === 'conflict';
  return (
    <>
      <p className="said">{conflict ? 'The run cannot rebase onto its base. Find the cause, or rebase by hand, then approve.' : item.kind === 'limit' ? 'The run parked on a usage limit. Approve to continue it, or reject.' : 'The run parked at a gate. Review the change, then approve or reject.'}</p>
      <dl className="kv">
        <dt>Branch</dt><dd>{item.job.run?.branch ?? '—'}</dd>
        <dt>Base</dt><dd>{n.base ?? '—'}</dd>
      </dl>
      {n.gates?.length ? <ul className="gates">{n.gates.map((g) => <li key={g}>{g.replace(/^-\s*/, '')}</li>)}</ul> : null}
      {conflict && n.conflicts?.length ? (
        <div className="fix"><span>Conflicting files</span>{n.conflicts.map((f) => <span key={f} className="fix-file">{f}</span>)}</div>
      ) : null}
      {n.diffStat ? <pre className="cmd" aria-label="Diff stat">{n.diffStat.trimEnd()}</pre> : null}
      {n.files?.length ? (
        <ul className="files" aria-label="Changed files">
          {n.files.map((f) => (
            <li key={f}><button className="link" aria-pressed={file === f} onClick={() => show(f)}>{f}</button></li>
          ))}
        </ul>
      ) : null}
      {file ? <pre className="cmd cmd-diff" aria-label={`Diff of ${file}`}>{diff || 'Loading the diff…'}</pre> : null}
      {n.reportHead ? <pre className="cmd" aria-label="Report head">{n.reportHead.trimEnd()}</pre> : null}
      {n.denied?.trim() ? <div className="fix"><span>Denied commands</span>{n.denied.trimEnd()}</div> : null}
      {manual ? <div className="fix"><span>Rebase by hand in</span>{n.worktree}</div> : null}
      <div className="actions">
        {conflict ? <button className="btn btn-signal" onClick={() => deck.act((api) => api.findCause(item.card.id, item.job.id))}>Find cause</button> : null}
        {conflict ? <button className="btn" aria-pressed={manual} onClick={() => setManual((m) => !m)}>Manual</button> : null}
        <button className={conflict ? 'btn' : 'btn btn-signal'} onClick={() => deck.act((api) => api.approveGate(item.job.id))}>Approve</button>
        <button className="btn btn-bad" onClick={() => deck.act((api) => api.rejectGate(item.job.id))}>Reject</button>
        <button className="btn btn-quiet" onClick={open}>Open job</button>
      </div>
    </>
  );
}

const RUN_ACTION = {
  resume: { label: 'Resume', call: (api, id) => api.resumeRun(id) },
  retry: { label: 'Retry', call: (api, id) => api.retry(id) },
  discard: { label: 'Discard', call: (api, id) => api.discard(id), bad: true },
};

function RunBody({ item, deck, open }) {
  const n = item.job.needsYou;
  const options = (n.options ?? []).filter((o) => RUN_ACTION[o]);
  const retry = <button className="btn btn-signal" onClick={() => deck.act((api) => (item.kind === 'land' ? api.finishLand(item.job.id) : api.retry(item.job.id)))}>Retry</button>;
  return (
    <>
      {item.kind === 'run-failed' ? <p className="said">The run stopped: <b>{n.reason}</b></p> : null}
      {item.kind === 'setup' ? <p className="said">The worktree setup step failed, so the run did not start.</p> : null}
      {item.kind === 'refusal' ? <p className="said">exo refused the run: <b>{n.text}</b></p> : null}
      {item.kind === 'land' ? <p className="said">The run passed, but landing on <b>{n.base}</b> stopped: {n.text}</p> : null}
      <dl className="kv">
        {item.kind === 'run-failed' ? <><dt>Phase</dt><dd>{n.phase ?? '—'}</dd></> : null}
        {item.kind === 'setup' ? <><dt>Command</dt><dd>{n.command}</dd></> : null}
        {item.kind === 'land' && n.action ? <><dt>Action</dt><dd>{n.action}</dd></> : null}
        {item.job.run?.branch ? <><dt>Branch</dt><dd>{item.job.run.branch}</dd></> : null}
      </dl>
      {item.kind === 'setup' && n.tail ? <pre className="cmd" aria-label="Setup output">{n.tail.trimEnd()}</pre> : null}
      {item.kind === 'refusal' && n.status ? <pre className="cmd" aria-label="Main checkout status">{n.status.trimEnd()}</pre> : null}
      <div className="actions">
        {item.kind === 'run-failed' ? options.map((o, i) => (
          <button key={o} className={`btn${RUN_ACTION[o].bad ? ' btn-bad' : i === 0 ? ' btn-signal' : ''}`} onClick={() => deck.act((api) => RUN_ACTION[o].call(api, item.job.id))}>{RUN_ACTION[o].label}</button>
        )) : retry}
        <button className="btn btn-quiet" onClick={open}>Open job</button>
      </div>
    </>
  );
}

function BriefBody({ item, deck, open }) {
  return (
    <>
      <p className="said">A brief is ready. Approve it to start the run, or reject it.</p>
      <dl className="kv"><dt>Brief</dt><dd title={item.job.brief}>{pathTail(item.job.brief)}</dd></dl>
      <div className="actions">
        <button className="btn btn-signal" onClick={() => deck.act((api) => api.approve(item.card.id))}>Approve</button>
        <button className="btn btn-bad" onClick={() => deck.act((api) => api.reject(item.card.id))}>Reject</button>
        <button className="btn btn-quiet" onClick={open}>Open job</button>
      </div>
    </>
  );
}

// why: Decisions 7 and 12; a budget raise waits for Approve or Reject, and overage is lifted only by its own Allow.
function NeedBody({ item, deck }) {
  const n = item.need;
  if (n.kind === 'overage') {
    return (
      <>
        <p className="said">Overage is active, so no new job starts and running jobs drain. Allow it for this session, or wait for the window to reset.</p>
        <div className="actions"><button className="btn btn-signal" onClick={() => deck.act((api) => api.allowOverage())}>Allow</button></div>
      </>
    );
  }
  return (
    <>
      <p className="said">{n.change?.ceilings ? `New ceilings: ${Object.entries(n.change.ceilings).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(', ')}` : `Budget for ${n.change?.projectKey}: ${n.change?.dial}`}</p>
      <div className="actions">
        <button className="btn btn-signal" onClick={() => deck.act((api) => api.approveNeed(n.id))}>Approve</button>
        <button className="btn btn-bad" onClick={() => deck.act((api) => api.rejectNeed(n.id))}>Reject</button>
      </div>
    </>
  );
}

function Choices({ legend, value, onChange, options }) {
  return (
    <fieldset className="choice">
      <legend>{legend}</legend>
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

function ReplyBox({ onSend, busy }) {
  const [text, setText] = useState('');
  return (
    <form className="reply" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { onSend(text.trim()); setText(''); } }}>
      <label className="sr" htmlFor="reply-text">Reply to the agent</label>
      <textarea id="reply-text" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply in your own words" />
      <button type="submit" className="btn" disabled={busy || !text.trim()}>Send reply</button>
    </form>
  );
}

function QuestionBody({ item, deck, open }) {
  const [picked, setPicked] = useState({});
  const ask = item.ask;
  if (ask) {
    const qs = ask.request.input?.questions ?? [];
    const ready = qs.every((q) => picked[q.question]);
    return (
      <>
        {qs.map((q) => (
          <Choices key={q.question} legend={q.question} value={picked[q.question]} onChange={(v) => setPicked((p) => ({ ...p, [q.question]: v }))}
            options={(q.options ?? []).map((o, i) => ({ value: o.label, key: String.fromCharCode(65 + i), label: o.label, text: o.description }))} />
        ))}
        <div className="actions">
          <button className="btn btn-signal" disabled={!ready} onClick={() => deck.act((api) => api.permission({ id: item.job.id, requestId: ask.requestId, allow: true, answers: picked }))}>Answer</button>
          <button className="btn" onClick={() => deck.act((api) => api.permission({ id: item.job.id, requestId: ask.requestId, allow: false, message: 'Skipped by the user.' }))}>Skip</button>
          <button className="btn btn-quiet" onClick={open}>Open job</button>
        </div>
      </>
    );
  }
  const qs = item.questions ?? [];
  const ready = qs.length > 0 && qs.every((q) => picked[q.n]);
  const send = () => deck.act((api) => api.reply(item.job.id, qs.map((q) => {
    const o = q.options.find((x) => x.letter === picked[q.n]);
    return `${q.n}. (${o.letter}) ${o.label}`;
  }).join('\n')));
  return (
    <>
      {qs.map((q) => (
        <Choices key={q.n} legend={`${q.n}/${q.total} ${q.title}`} value={picked[q.n]} onChange={(v) => setPicked((p) => ({ ...p, [q.n]: v }))}
          options={q.options.map((o) => ({ value: o.letter, key: o.letter, label: o.label, text: o.text, recommended: q.recommended === o.letter }))} />
      ))}
      {qs.length ? <div className="actions">
        <button className="btn btn-signal" disabled={!ready} onClick={send}>Send answers</button>
        <button className="btn btn-quiet" onClick={open}>Open job</button>
      </div> : null}
      {!qs.length && item.text ? <p className="said">{item.text}</p> : null}
      <ReplyBox onSend={(t) => deck.act((api) => api.reply(item.job.id, t))} />
      {!qs.length ? <div className="actions"><button className="btn btn-quiet" onClick={open}>Open job</button></div> : null}
    </>
  );
}

function Body({ item, deck, open }) {
  const resume = () => deck.act((api) => api.continueJob(item.job.id));
  const stop = () => deck.act((api) => api.stop(item.job.id));
  if (item.kind === 'question') return <QuestionBody item={item} deck={deck} open={open} />;
  if (item.kind === 'brief') return <BriefBody item={item} deck={deck} open={open} />;
  if (item.need) return <NeedBody item={item} deck={deck} />;
  if (['gate', 'conflict', 'limit'].includes(item.kind)) return <GateBody item={item} deck={deck} open={open} />;
  if (['run-failed', 'setup', 'refusal', 'land'].includes(item.kind)) return <RunBody item={item} deck={deck} open={open} />;
  if (item.kind === 'permission') {
    const { tool_name: tool, input = {} } = item.ask.request;
    return (
      <>
        <p className="said"><b>{tool}</b> wants to run:</p>
        <pre className="cmd">{input.command ?? input.file_path ?? JSON.stringify(input, null, 1)}</pre>
        <div className="actions">
          <button className="btn btn-signal" onClick={() => deck.act((api) => api.permission({ id: item.job.id, requestId: item.ask.requestId, allow: true }))}>Allow once</button>
          <button className="btn" onClick={() => deck.act((api) => api.permission({ id: item.job.id, requestId: item.ask.requestId, allow: false }))}>Deny</button>
          <button className="btn btn-quiet" onClick={open}>Open job</button>
        </div>
      </>
    );
  }
  if (item.kind === 'invariant') {
    return (
      <>
        <p className="said">The session did not start the way the stage requires, so it was stopped before doing any work.</p>
        <dl className="kv">
          <dt>Mismatch</dt><dd>{(item.job.initMismatches ?? ['unknown']).join(', ')}</dd>
        </dl>
        <div className="actions"><button className="btn" onClick={open}>Open job</button></div>
      </>
    );
  }
  if (item.kind === 'turn-cap') {
    return (
      <>
        <p className="said">Stopped for your review after <b className="num">{item.job.needsYou.turns}</b> turns.</p>
        <div className="actions">
          <button className="btn btn-signal" onClick={resume}>Continue</button>
          <button className="btn btn-quiet" onClick={stop}>Stop job</button>
          <button className="btn btn-quiet" onClick={open}>Open job</button>
        </div>
      </>
    );
  }
  if (item.kind === 'failure') {
    return (
      <>
        <p className="said">The session ended with <b>{item.job.crashReason ?? 'an error'}</b>.</p>
        <div className="actions"><button className="btn" onClick={open}>Open job</button></div>
      </>
    );
  }
  return (
    <>
      <p className="said">{item.check.detail}</p>
      {item.check.fix ? <p className="fix"><span>Fix</span>{item.check.fix}</p> : null}
      <div className="actions"><button className="btn" onClick={deck.refreshHealth}>Check again</button></div>
    </>
  );
}

const titleOf = (item) => (item.kind === 'health' ? `${item.name} check failed` : item.need ? item.need.title ?? 'Overage is active' : item.card?.title ?? 'Unknown card');

export default function NeedsYou({ items, deck, openJob }) {
  const view = useRef(null);
  const below = useBelow(view, 'li.need', items.length);
  return (
    <section className="needs" aria-labelledby="needs-h" data-hot={items.length > 0} data-load={items.length > 0}>
      <header className="lane-head">
        <span className="joint" aria-hidden="true" />
        <h2 id="needs-h">Needs you</h2>
        <Count n={items.length} signal />
      </header>
      <ScrollArea.Root className="scroll">
        <ScrollArea.Viewport className="scroll-view" ref={view}>
          <ul className="stack">
            <AnimatePresence initial={false} mode="popLayout">
              {items.map((item) => (
                <motion.li key={item.key} layout="position" className={`need need-${item.kind}`} data-kind={item.kind}
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -14 }} transition={{ ...spring, opacity: fade }}>
                  <div className="need-top">
                    <span className="need-kind">{KIND_WORD[item.kind]}</span>
                    {item.job ? <span className="num dim">{shortId(item.job.id)}</span> : null}
                  </div>
                  <h3>{titleOf(item)}</h3>
                  <Body item={item} deck={deck} open={() => openJob(item.job.id)} />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
          {items.length === 0 ? (
            <div className="calm">
              <p>Nothing is waiting on you.</p>
              <p className="dim">Questions, permissions, briefs, run gates and failures land here first.</p>
            </div>
          ) : null}
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar orientation="vertical" className="sb"><ScrollArea.Thumb className="sb-thumb" /></ScrollArea.Scrollbar>
      </ScrollArea.Root>
      {below > 0 ? <p className="more" role="status"><span className="num">+{below}</span> more below</p> : null}
    </section>
  );
}
