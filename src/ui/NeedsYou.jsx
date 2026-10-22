import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as RadioGroup from '@radix-ui/react-radio-group';
import { AnimatePresence, motion, useIsPresent } from 'motion/react';
import { base, ease, exit, fadeRise, spring } from './motion.js';
import { shortId } from './derive.js';

export const KIND_WORD = {
  permission: 'Permission', question: 'Question', invariant: 'Invariant', 'turn-cap': 'Turn cap', failure: 'Failure', health: 'Health',
  brief: 'Brief', gate: 'Gate', conflict: 'Conflict', 'run-failed': 'Run failed', setup: 'Setup', refusal: 'Refused', land: 'Land',
  limit: 'Limit', budget: 'Budget', overage: 'Overage',
};

const NEXT_SHOWN = 3;
const NONE = 'none';

function plain(text) {
  const s = String(text ?? '');
  return s
    .replace(/\s+(?:at|in)\s+\/[^\s'"`,;)]+/g, '')
    .replace(/:\s+\/[^\s'"`,;)]+/g, '')
    .replace(/(?:\/[^\s/'"`,;:)]+){2,}\/?/g, (p) => p.split('/').filter(Boolean).pop() ?? p)
    .trim();
}

export const titleOf = (item) => (item.kind === 'health' ? `${item.name} check failed` : item.need ? item.need.title ?? 'Overage is active' : item.card?.title ?? 'Unknown task');

function Fold({ label, children }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="turn-fold">
      <button type="button" className="fold" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>{label}</button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div id={id} className="turn-fold-body" key="body" {...fadeRise}>
            <div className="turn-fold-inner">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function FixLine({ text }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); } catch { return; }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2500);
  };
  return (
    <div className="fix">
      <span>Fix</span>
      <div className="fix-row">
        <code className="fix-cmd" tabIndex={0} aria-label="Fix command">{text}</code>
        <button type="button" className="btn btn-quiet fix-copy" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        <span className="sr" role="status">{copied ? 'Copied' : ''}</span>
      </div>
    </div>
  );
}

function Facts({ rows }) {
  const shown = rows.filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!shown.length) return null;
  return <dl className="kv">{shown.map(([k, v]) => <div key={k} className="kv-row"><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

function Frame({ item, headline, children, actions, details, detailLabel = 'Details' }) {
  return (
    <>
      <p className="ask-context">
        <span className="pill pill-need">{KIND_WORD[item.kind] ?? item.kind}</span>
        {item.card?.title ? <span className="ask-title">{item.card.title}</span> : null}
      </p>
      <h3 className="ask-headline turn-headline" tabIndex={-1}>{headline}</h3>
      {children}
      {actions ? <div className="actions turn-actions">{actions}</div> : null}
      {details ? <Fold label={detailLabel}>{details}</Fold> : null}
    </>
  );
}

const jobRow = (item) => (item.job ? [['Session', shortId(item.job.id)]] : []);

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
      <textarea id={id} rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply in your own words" />
      <button type="submit" className={primary ? 'btn btn-primary' : 'btn btn-secondary'} disabled={!text.trim()}>Send reply</button>
    </form>
  );
}

function QuestionDecision({ item, deck, open }) {
  const [picked, setPicked] = useState({});
  const [replying, setReplying] = useState(false);
  const openBtn = <button className="btn btn-quiet" onClick={open}>Open session</button>;
  const details = <Facts rows={jobRow(item)} />;
  if (item.ask) {
    const qs = item.ask.request.input?.questions ?? [];
    const ready = qs.every((q) => picked[q.question]);
    const one = qs.length === 1;
    return (
      <Frame item={item} headline={one ? qs[0].question : `Answer ${qs.length} questions`} details={details}
        actions={<>
          <button className="btn btn-primary" disabled={!ready} onClick={() => deck.act((api) => api.permission({ id: item.job.id, requestId: item.ask.requestId, allow: true, answers: picked }))}>Answer</button>
          <button className="btn btn-secondary" onClick={() => deck.act((api) => api.permission({ id: item.job.id, requestId: item.ask.requestId, allow: false, message: 'Skipped by the user.' }))}>Skip</button>
          {openBtn}
        </>}>
        {qs.map((q) => (
          <Choices key={q.question} legend={q.question} hideLegend={one} value={picked[q.question]} onChange={(v) => setPicked((p) => ({ ...p, [q.question]: v }))}
            options={(q.options ?? []).map((o, i) => ({ value: o.label, key: String.fromCharCode(65 + i), label: o.label, text: o.description }))} />
        ))}
      </Frame>
    );
  }
  const qs = item.questions ?? [];
  const sendReply = (t) => deck.act((api) => api.reply(item.job.id, t));
  if (!qs.length) {
    return (
      <Frame item={item} headline="Reply to the agent" details={details} actions={openBtn}>
        {item.text ? <p className="said turn-said-long">{item.text}</p> : null}
        <ReplyBox onSend={sendReply} primary />
      </Frame>
    );
  }
  const ready = qs.every((q) => picked[q.n]);
  const one = qs.length === 1;
  const send = () => deck.act((api) => api.reply(item.job.id, qs.map((q) => {
    const o = q.options.find((x) => x.letter === picked[q.n]);
    return `${q.n}. (${o.letter}) ${o.label}`;
  }).join('\n')));
  return (
    <Frame item={item} headline={one ? qs[0].title : `Answer ${qs.length} questions`} details={details}
      actions={<>
        <button className="btn btn-primary" disabled={!ready} onClick={send}>Send answers</button>
        <button type="button" className="fold" aria-expanded={replying} onClick={() => setReplying((r) => !r)}>Reply in your own words</button>
        {openBtn}
      </>}>
      {qs.map((q) => (
        <Choices key={q.n} legend={`${q.n}/${q.total} ${q.title}`} hideLegend={one} value={picked[q.n]} onChange={(v) => setPicked((p) => ({ ...p, [q.n]: v }))}
          options={q.options.map((o) => ({ value: o.letter, key: o.letter, label: o.label, text: o.text, recommended: q.recommended === o.letter }))} />
      ))}
      {replying ? <ReplyBox onSend={sendReply} /> : null}
    </Frame>
  );
}

const GATE_COPY = {
  gate: ['Approve this change?', 'Check the points below, then approve or reject.'],
  limit: ['Continue after the usage limit?', 'The run parked on a usage limit. Approve to continue it, or reject.'],
  conflict: ['Fix a rebase conflict', 'The run cannot rebase onto its base. Find the cause, or rebase by hand, then approve.'],
};

function GateDecision({ item, deck, open }) {
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
  const [headline, said] = GATE_COPY[item.kind];
  const details = (
    <>
      <Facts rows={[...jobRow(item), ['Branch', item.job.run?.branch ?? NONE], ['Base', n.base ?? NONE]]} />
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
    </>
  );
  return (
    <Frame item={item} headline={headline} details={details} detailLabel="Show the change"
      actions={<>
        {conflict ? <button className="btn btn-primary" onClick={() => deck.act((api) => api.findCause(item.card.id, item.job.id))}>Find cause</button> : null}
        {conflict ? <button className="btn btn-secondary" aria-pressed={manual} onClick={() => setManual((m) => !m)}>Manual</button> : null}
        <button className={conflict ? 'btn btn-secondary' : 'btn btn-primary'} onClick={() => deck.act((api) => api.approveGate(item.job.id))}>Approve</button>
        <button className="btn btn-secondary" onClick={() => deck.act((api) => api.rejectGate(item.job.id))}>Reject</button>
        <button className="btn btn-quiet" onClick={open}>Open session</button>
      </>}>
      <p className="said">{said}</p>
      {n.gates?.length ? <ul className="gates">{n.gates.map((g) => <li key={g}>{g.replace(/^-\s*/, '')}</li>)}</ul> : null}
      {manual ? <div className="fix"><span>Rebase by hand in</span>{n.worktree}</div> : null}
    </Frame>
  );
}

const RUN_ACTION = {
  resume: { label: 'Resume', call: (api, id) => api.resumeRun(id) },
  retry: { label: 'Retry', call: (api, id) => api.retry(id) },
  discard: { label: 'Discard', call: (api, id) => api.discard(id), bad: true },
};

function Full({ text }) {
  return text && plain(text) !== String(text) ? <p className="turn-full mono">{text}</p> : null;
}

function RunDecision({ item, deck, open }) {
  const n = item.job.needsYou;
  const branch = ['Branch', item.job.run?.branch];
  const openBtn = (primary) => <button className={primary ? 'btn btn-primary' : 'btn btn-quiet'} onClick={open}>Open session</button>;
  const retry = <button className="btn btn-primary" onClick={() => deck.act((api) => (item.kind === 'land' ? api.finishLand(item.job.id) : api.retry(item.job.id)))}>Retry</button>;
  if (item.kind === 'run-failed') {
    const options = (n.options ?? []).filter((o) => RUN_ACTION[o]);
    const safe = options.find((o) => !RUN_ACTION[o].bad);
    return (
      <Frame item={item} headline="The run stopped"
        details={<><Facts rows={[...jobRow(item), ['Phase', n.phase ?? NONE], branch]} /><Full text={n.reason} /></>}
        actions={<>
          {options.map((o) => (
            <button key={o} className={`btn${RUN_ACTION[o].bad ? ' btn-danger' : o === safe ? ' btn-primary' : ' btn-secondary'}`} onClick={() => deck.act((api) => RUN_ACTION[o].call(api, item.job.id))}>{RUN_ACTION[o].label}</button>
          ))}
          {openBtn(!safe)}
        </>}>
        <p className="said">{plain(n.reason) || 'The run ended before it finished.'}</p>
      </Frame>
    );
  }
  if (item.kind === 'setup') {
    return (
      <Frame item={item} headline="Worktree setup failed"
        details={<><Facts rows={[...jobRow(item), ['Command', n.command], branch]} />{n.tail ? <pre className="cmd" aria-label="Setup output">{n.tail.trimEnd()}</pre> : null}</>}
        actions={<>{retry}{openBtn(false)}</>}>
        <p className="said">The setup step failed, so the run did not start.</p>
      </Frame>
    );
  }
  if (item.kind === 'refusal') {
    return (
      <Frame item={item} headline="exo refused the run"
        details={<><Facts rows={[...jobRow(item), branch]} /><Full text={n.text} />{n.status ? <pre className="cmd" aria-label="Main checkout status">{n.status.trimEnd()}</pre> : null}</>}
        actions={<>{retry}{openBtn(false)}</>}>
        <p className="said">{plain(n.text)}</p>
      </Frame>
    );
  }
  return (
    <Frame item={item} headline="Landing stopped"
      details={<><Facts rows={[...jobRow(item), ['Action', n.action], branch]} /><Full text={n.text} /></>}
      actions={<>{retry}{openBtn(false)}</>}>
      <p className="said">The run passed, but landing on <b>{n.base}</b> stopped: {plain(n.text)}</p>
    </Frame>
  );
}

function NeedDecision({ item, deck }) {
  const n = item.need;
  if (n.kind === 'overage') {
    return (
      <Frame item={item} headline="Allow overage?"
        actions={<button className="btn btn-primary" onClick={() => deck.act((api) => api.allowOverage())}>Allow</button>}>
        <p className="said">Overage is active, so no new session starts and running sessions drain. Allow it for this session, or wait for the window to reset.</p>
      </Frame>
    );
  }
  return (
    <Frame item={item} headline={n.title ?? 'Approve a budget change?'}
      actions={<>
        <button className="btn btn-primary" onClick={() => deck.act((api) => api.approveNeed(n.id))}>Approve</button>
        <button className="btn btn-secondary" onClick={() => deck.act((api) => api.rejectNeed(n.id))}>Reject</button>
      </>}>
      <p className="said">{n.change?.ceilings ? `New ceilings: ${Object.entries(n.change.ceilings).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(', ')}` : `Budget for ${n.change?.projectKey}: ${n.change?.dial}`}</p>
    </Frame>
  );
}

function Decision({ item, deck, open }) {
  if (item.kind === 'question') return <QuestionDecision item={item} deck={deck} open={open} />;
  if (item.need) return <NeedDecision item={item} deck={deck} />;
  if (GATE_COPY[item.kind]) return <GateDecision item={item} deck={deck} open={open} />;
  if (['run-failed', 'setup', 'refusal', 'land'].includes(item.kind)) return <RunDecision item={item} deck={deck} open={open} />;
  const details = <Facts rows={jobRow(item)} />;
  const openBtn = (primary) => <button className={primary ? 'btn btn-primary' : 'btn btn-quiet'} onClick={open}>Open session</button>;
  if (item.kind === 'brief') {
    return (
      <Frame item={item} headline="Approve the brief?" details={<Facts rows={[...jobRow(item), ['Brief', item.job.brief]]} />}
        actions={<>
          <button className="btn btn-primary" onClick={() => deck.act((api) => api.approve(item.card.id))}>Approve</button>
          <button className="btn btn-secondary" onClick={() => deck.act((api) => api.reject(item.card.id))}>Reject</button>
          {openBtn(false)}
        </>}>
        <p className="said">Approving starts the run.</p>
      </Frame>
    );
  }
  if (item.kind === 'permission') {
    const { tool_name: tool, input = {} } = item.ask.request;
    return (
      <Frame item={item} headline={`Allow ${tool}?`} details={details}
        actions={<>
          <button className="btn btn-primary" onClick={() => deck.act((api) => api.permission({ id: item.job.id, requestId: item.ask.requestId, allow: true }))}>Allow once</button>
          <button className="btn btn-secondary" onClick={() => deck.act((api) => api.permission({ id: item.job.id, requestId: item.ask.requestId, allow: false }))}>Deny</button>
          {openBtn(false)}
        </>}>
        <pre className="cmd" aria-label="What it wants to run">{input.command ?? input.file_path ?? JSON.stringify(input, null, 1)}</pre>
      </Frame>
    );
  }
  if (item.kind === 'invariant') {
    return (
      <Frame item={item} headline="This session started with the wrong settings" details={details} actions={openBtn(true)}>
        <p className="said">It was stopped before doing any work. Wrong: <span className="mono">{(item.job.initMismatches ?? ['unknown']).join(', ')}</span></p>
      </Frame>
    );
  }
  if (item.kind === 'turn-cap') {
    return (
      <Frame item={item} headline={<>Keep going after <span className="num">{item.job.needsYou.turns}</span> turns?</>} details={details}
        actions={<>
          <button className="btn btn-primary" onClick={() => deck.act((api) => api.continueJob(item.job.id))}>Continue</button>
          <button className="btn btn-secondary" onClick={() => deck.act((api) => api.stop(item.job.id))}>Stop session</button>
          {openBtn(false)}
        </>}>
        <p className="said">The agent paused so you can check its work.</p>
      </Frame>
    );
  }
  if (item.kind === 'failure') {
    const reason = item.job.crashReason;
    return (
      <Frame item={item} headline="The session crashed"
        details={<><Facts rows={jobRow(item)} /><Full text={reason} /></>}
        actions={openBtn(true)}>
        <p className="said">{reason ? `It ended with ${plain(reason)}.` : 'It ended with an error.'}</p>
      </Frame>
    );
  }
  const detail = item.check.detail;
  return (
    <Frame item={item} headline={`${item.name} check failed`}
      details={detail && plain(detail) !== detail ? <Full text={detail} /> : null}
      actions={<button className="btn btn-primary" onClick={deck.refreshHealth}>Check again</button>}>
      {detail ? <p className="said">{plain(detail)}</p> : null}
      {item.check.fix ? <FixLine text={item.check.fix} /> : null}
    </Frame>
  );
}

function Live({ children }) {
  const present = useIsPresent();
  return <div className="turn-live" inert={!present} aria-hidden={present ? undefined : true}>{children}</div>;
}

const typing = (el) => !!el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="radio"]');

const STACK_BELOW_OWN_WIDTH = 760;

const withHealthFirst = (items) => [...items.filter((x) => x.kind === 'health'), ...items.filter((x) => x.kind !== 'health')];

const SETTLE_MS = 2500;
const FULL_ROW_WHEN_OPEN = '1 1 100%';
const BESIDE_CALM_LINE = '0 1 auto';

const CALM_ROW = { padding: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--s2) var(--s5)' };
const HEAD_COUNT = { color: 'var(--need-ink)', fontSize: 'var(--fs-section)', lineHeight: 'var(--lh-body)', fontWeight: 'var(--fw-display)' };
const CALM = { fontSize: 'var(--fs-body)', lineHeight: 'var(--lh-body)' };
const STATION = { width: 14, height: 14, flex: 'none', borderRadius: '50%', border: '3px solid var(--control)', background: 'var(--sheet)' };

const slide = {
  enter: (d) => ({ opacity: 0, x: 12 * d }),
  center: { opacity: 1, x: 0, transition: { duration: base, ease } },
  exit: (d) => ({ opacity: 0, x: -12 * d, transition: { duration: exit(base), ease } }),
};

function Waiting({ items: raw, deck, openJob, quiet }) {
  const root = useRef(null);
  const [narrow, setNarrow] = useState(false);
  const items = useMemo(() => withHealthFirst(raw), [raw]);
  const [pin, setPin] = useState(null);
  const [dir, setDir] = useState(1);
  const [all, setAll] = useState(false);
  const lastIdx = useRef(0);
  const inside = useRef(false);
  const seen = useRef(new Set());
  const n = items.length;
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return undefined;
    const fit = () => setNarrow(el.getBoundingClientRect().width < STACK_BELOW_OWN_WIDTH);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [n > 0]);
  const found = pin === null ? -1 : items.findIndex((x) => x.key === pin);
  const idx = pin === null ? 0 : found >= 0 ? found : Math.max(0, Math.min(lastIdx.current, n - 1));
  const current = n ? items[idx] : null;
  const shownKey = current?.key ?? null;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const shownRef = useRef(shownKey);
  shownRef.current = shownKey;

  const markSeen = () => { for (const x of itemsRef.current) seen.current.add(x.key); };
  const hold = () => {
    if (!shownRef.current) return;
    markSeen();
    setPin((p) => p ?? shownRef.current);
  };

  useEffect(() => {
    lastIdx.current = idx;
    if (pin !== null && shownKey && shownKey !== pin) setPin(shownKey);
  }, [idx, shownKey, pin]);

  useEffect(() => {
    if (!n || pin !== null) return undefined;
    const t = setTimeout(hold, SETTLE_MS);
    return () => clearTimeout(t);
  }, [n, pin]);

  useEffect(() => {
    const on = (e) => { if (root.current && !root.current.contains(e.target)) inside.current = false; };
    document.addEventListener('focusin', on);
    return () => document.removeEventListener('focusin', on);
  }, []);

  useEffect(() => {
    if (!inside.current || !root.current) return;
    const active = document.activeElement;
    if (active?.closest?.('.turn-nav')) return;
    if (active && active !== document.body && root.current.contains(active) && !active.closest('[inert]')) return;
    const target = shownKey
      ? root.current.querySelector(`li[data-key="${CSS.escape(shownKey)}"] .turn-headline`)
      : root.current.querySelector('.turn-calm');
    target?.focus();
  }, [shownKey]);

  const go = (d) => {
    if (n < 2) return;
    markSeen();
    setDir(d);
    setPin(items[(idx + d + n) % n].key);
  };
  const jump = (key) => {
    const j = items.findIndex((x) => x.key === key);
    markSeen();
    setDir(j >= idx ? 1 : -1);
    setPin(key);
    inside.current = true;
    requestAnimationFrame(() => root.current?.querySelector(`li[data-key="${CSS.escape(key)}"] .turn-headline`)?.focus());
  };

  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    const on = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.defaultPrevented) return;
      if (e.key !== 'j' && e.key !== 'k') return;
      if (typing(e.target) || document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      goRef.current(e.key === 'j' ? 1 : -1);
    };
    document.addEventListener('keydown', on);
    return () => document.removeEventListener('keydown', on);
  }, []);

  if (!n) {
    return (
      <section className="turn turn-empty" aria-labelledby="turn-h" ref={root} style={CALM_ROW}>
        <h2 id="turn-h" className="sr">Needs you</h2>
        <p className="turn-calm" tabIndex={-1} style={CALM}>
          <span style={STATION} aria-hidden="true" />
          <span>Nothing waits for you</span>
        </p>
        {quiet}
      </section>
    );
  }

  const others = [];
  for (let k = 1; k < n; k++) others.push(items[(idx + k) % n]);
  const visible = all ? others : others.slice(0, NEXT_SHOWN);
  const hidden = others.length - NEXT_SHOWN;
  const ahead = pin === null ? [] : items.slice(0, idx).filter((x) => !seen.current.has(x.key));

  return (
    <section className="turn" aria-labelledby="turn-h" data-hot="true" ref={root} onPointerDownCapture={hold}>
      <div className={others.length && !narrow ? 'ask-card turn-card' : 'ask-card turn-card turn-card-solo'}>
        <header className="turn-head">
          <h2 id="turn-h" className="turn-h"><span className="mark mark-waiting" aria-hidden="true"><i /></span>Needs you <span className="num" style={HEAD_COUNT}>{n}</span></h2>
          {quiet}
          {n > 1 && narrow ? (
            <div className="turn-nav" role="group" aria-label="Move between decisions">
              <span className="turn-pos num">{idx + 1} of {n}</span>
              <button type="button" className="btn btn-quiet btn-sm" aria-keyshortcuts="k" onClick={() => go(-1)}><span aria-hidden="true">‹ </span>Previous</button>
              <button type="button" className="btn btn-quiet btn-sm" aria-keyshortcuts="j" onClick={() => go(1)}>Next<span aria-hidden="true"> ›</span></button>
            </div>
          ) : null}
        </header>
        <div className="turn-main">
          {ahead.length ? (
            <p className="turn-ahead" role="status">
              <span>{ahead.length} more came in ahead: <b>{titleOf(ahead[0])}</b></span>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => jump(ahead[0].key)}>Show it</button>
            </p>
          ) : null}
          <ul className="turn-list" onFocus={() => { inside.current = true; hold(); }}>
            <AnimatePresence initial={false} mode="popLayout" custom={dir}>
              <motion.li key={current.key} data-key={current.key} data-kind={current.kind} className="turn-now"
                custom={dir} variants={slide} initial="enter" animate="center" exit="exit">
                <Live>
                  <Decision item={current} deck={deck} open={() => openJob(current.job.id)} />
                </Live>
              </motion.li>
            </AnimatePresence>
          </ul>
        </div>
        {others.length && !narrow ? (
          <aside className="turn-next" aria-labelledby="turn-next-h">
            <h3 id="turn-next-h" className="turn-next-h">Next<span className="turn-next-count num">{others.length}</span></h3>
            <div className="turn-next-body">
              <ul className="turn-next-list">
                <AnimatePresence initial={false} mode="popLayout">
                  {visible.map((x) => (
                    <motion.li key={x.key} layout="position" transition={{ layout: spring }} {...fadeRise}>
                      <button type="button" className="turn-next-row" onClick={() => jump(x.key)}>
                        <span className="pill turn-next-kind">{KIND_WORD[x.kind] ?? x.kind}</span>
                        <span className="turn-next-title">{titleOf(x)}</span>
                      </button>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
              {hidden > 0 ? (
                <button type="button" className="fold turn-more" aria-expanded={all} onClick={() => setAll((a) => !a)}>{all ? 'Show fewer' : `Show ${hidden} more`}</button>
              ) : null}
            </div>
          </aside>
        ) : null}
      </div>
    </section>
  );
}

const QUIET = { display: 'flex', flexDirection: 'column', gap: 'var(--s2)', minWidth: 0, maxWidth: '72ch' };
const QUIET_H = { margin: 0, fontSize: 'var(--fs-small)', lineHeight: 'var(--lh-small)', fontWeight: 'var(--fw-medium)' };
const QUIET_COUNT = { display: 'inline-grid', placeItems: 'center', minWidth: 22, height: 22, padding: '0 6px', borderRadius: 'var(--r-pill)', background: 'var(--raised)', color: 'var(--ink)', fontSize: 'var(--fs-small)' };
const QUIET_NOTE = { margin: 0, color: 'var(--muted)', fontSize: 'var(--fs-small)', lineHeight: 'var(--lh-small)' };
const QUIET_LIST = { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--s1)' };
const QUIET_ROW = { display: 'inline-flex', alignItems: 'center', gap: 'var(--s2)', minWidth: 0, fontWeight: 'var(--fw)' };
const QUIET_CARD = { boxShadow: 'var(--shadow-card)', marginTop: 'var(--s2)' };

function QuietHistory({ items, deck, openJob }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!items.length) return null;
  return (
    <section className="quiet" aria-labelledby={`${id}-h`} style={{ ...QUIET, flex: open ? FULL_ROW_WHEN_OPEN : BESIDE_CALM_LINE }}>
      <h3 id={`${id}-h`} style={QUIET_H}>
        <button type="button" className="fold" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
          Quiet history<span className="num" style={QUIET_COUNT}>{items.length}</span>
        </button>
      </h3>
      {open ? (
        <div id={id} style={QUIET}>
          <p style={QUIET_NOTE}>Kinds you left out of Needs you. Pick them in <a className="link" href="#/settings">Settings</a>.</p>
          <ul style={QUIET_LIST}>
            {items.map((x) => (
              <li key={x.key} data-key={x.key} data-kind={x.kind}>
                <Fold label={<span style={QUIET_ROW}><span className="pill">{KIND_WORD[x.kind] ?? x.kind}</span><span>{titleOf(x)}</span></span>}>
                  <div className="ask-card" style={QUIET_CARD}>
                    <Decision item={x} deck={deck} open={() => openJob(x.job?.id)} />
                  </div>
                </Fold>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

const STACK = { display: 'flex', flexDirection: 'column', gap: 'var(--s2)', minWidth: 0 };

export default function NeedsYou({ items, history = [], deck, openJob }) {
  return (
    <div style={STACK} data-block="needs">
      <Waiting items={items} deck={deck} openJob={openJob} quiet={<QuietHistory items={history} deck={deck} openJob={openJob} />} />
    </div>
  );
}
