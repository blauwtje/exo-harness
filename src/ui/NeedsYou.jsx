import { useRef, useState } from 'react';
import * as RadioGroup from '@radix-ui/react-radio-group';
import * as ScrollArea from '@radix-ui/react-scroll-area';
import { AnimatePresence, motion } from 'motion/react';
import { Count, fade, spring, useBelow } from './parts.jsx';
import { shortId } from './derive.js';

const KIND_WORD = {
  permission: 'Permission', question: 'Question', invariant: 'Invariant', 'turn-cap': 'Turn cap', failure: 'Failure', health: 'Health',
};

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

const titleOf = (item) => (item.kind === 'health' ? `${item.name} check failed` : item.card?.title ?? 'Unknown card');

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
              <p className="dim">Questions, permissions, broken invariants and health failures land here first.</p>
            </div>
          ) : null}
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar orientation="vertical" className="sb"><ScrollArea.Thumb className="sb-thumb" /></ScrollArea.Scrollbar>
      </ScrollArea.Root>
      {below > 0 ? <p className="more" role="status"><span className="num">+{below}</span> more below</p> : null}
    </section>
  );
}
