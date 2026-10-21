import { useEffect, useMemo, useRef, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import * as ScrollArea from '@radix-ui/react-scroll-area';
import { Status, Mark } from './parts.jsx';
import { fmt, isLive, ledgerOf, shortId, timelineRows, usd } from './derive.js';

const KIND_MARK = { start: 'queued', say: 'running', tool: 'running', think: 'queued', output: 'queued', you: 'done', turn: 'done', error: 'crashed', limit: 'stopped', ask: 'waiting', answer: 'done', raw: 'stopped' };

function Row({ label, value, unit, wrong, sub }) {
  return (
    <div className={`ledger-row${sub ? ' ledger-sub' : ''}`} data-wrong={wrong || undefined}>
      <dt>{label}</dt>
      <dd className="num">{value}{unit && value !== '—' ? <small>{unit}</small> : null}</dd>
    </div>
  );
}

function Ledger({ events, job }) {
  const l = useMemo(() => ledgerOf(events, job), [events, job]);
  const total = [l.input, l.output, l.cacheRead, l.cacheWrite].some((n) => n != null)
    ? (l.input ?? 0) + (l.output ?? 0) + (l.cacheRead ?? 0) + (l.cacheWrite ?? 0) : null;
  return (
    <section className="ledger" aria-labelledby="ledger-h">
      <h2 id="ledger-h" className="section-h">Ledger</h2>
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
      <dl className="ledger-meta">
        <Row label="Model" value={l.model ?? '—'} />
        <Row label="Effort" value={l.effort ?? '—'} />
        <Row label="Claude Code" value={l.claudeVersion ?? '—'} />
        <Row label="exo plugin" value={l.exoVersion ?? '—'} />
      </dl>
    </section>
  );
}

function Timeline({ rows, follow }) {
  const end = useRef(null);
  useEffect(() => { const v = end.current?.closest('.scroll-view'); if (follow && v) v.scrollTop = v.scrollHeight; }, [rows.length, follow]);
  if (!rows.length) return <p className="lane-empty">No events yet. Rows arrive here as the agent works.</p>;
  return (
    <ol className="timeline">
      {rows.map((r, i) => (
        <li key={r.key} className={`tl tl-${r.kind}`}>
          <span className="tl-no num">{String(i + 1).padStart(3, '0')}</span>
          <Mark status={KIND_MARK[r.kind] ?? 'queued'} label={r.kind} />
          <div className="tl-body"><b>{r.title}</b><p>{r.text}</p></div>
        </li>
      ))}
      <li ref={end} aria-hidden="true" className="tl-end" />
    </ol>
  );
}

function Scroll({ children, label }) {
  return (
    <ScrollArea.Root className="scroll">
      <ScrollArea.Viewport className="scroll-view" aria-label={label} tabIndex={0}>{children}</ScrollArea.Viewport>
      <ScrollArea.Scrollbar orientation="vertical" className="sb"><ScrollArea.Thumb className="sb-thumb" /></ScrollArea.Scrollbar>
    </ScrollArea.Root>
  );
}

function Reply({ onSend }) {
  const [text, setText] = useState('');
  return (
    <form className="reply" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { onSend(text.trim()); setText(''); } }}>
      <label className="sr" htmlFor="job-reply">Reply to the agent</label>
      <textarea id="job-reply" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply in your own words" />
      <button type="submit" className="btn" disabled={!text.trim()}>Send reply</button>
    </form>
  );
}

export default function JobView({ job, card, events, deck, back }) {
  const [follow, setFollow] = useState('follow');
  const rows = useMemo(() => timelineRows(events), [events]);
  const live = isLive(job);
  return (
    <section className="jobview" aria-labelledby="job-h">
      <header className="job-head">
        <button className="link" onClick={back}>Back to board</button>
        <h1 id="job-h">{card?.title ?? 'Job'}</h1>
        <div className="job-sub">
          <Status job={job} />
          <span className="dim">{job.stage ?? 'stage unknown'}</span>
          <span className="num dim" title={job.id}>{shortId(job.id)}…</span>
          <button className="btn btn-edge" disabled={!live} onClick={() => deck.act((api) => api.stop(job.id))}
            title={live ? undefined : 'Finished: this job has already ended.'}>Stop job</button>
        </div>
      </header>
      <div className="job-grid">
        <Tabs.Root defaultValue="timeline" className="tabs">
          <div className="tabs-bar">
            <Tabs.List className="tabs-list" aria-label="Job output">
              <Tabs.Trigger value="timeline" className="tab">Timeline <span className="num dim">{rows.length}</span></Tabs.Trigger>
              <Tabs.Trigger value="transcript" className="tab">Transcript <span className="num dim">{events.length}</span></Tabs.Trigger>
            </Tabs.List>
            <ToggleGroup.Root type="single" value={follow} onValueChange={(v) => v && setFollow(v)} className="seg" aria-label="Timeline scrolling">
              <ToggleGroup.Item value="follow" className="seg-item">Follow tail</ToggleGroup.Item>
              <ToggleGroup.Item value="hold" className="seg-item">Hold</ToggleGroup.Item>
            </ToggleGroup.Root>
          </div>
          <Tabs.Content value="timeline" className="tab-panel"><Scroll label="Timeline"><Timeline rows={rows} follow={follow === 'follow'} /></Scroll></Tabs.Content>
          <Tabs.Content value="transcript" className="tab-panel">
            <Scroll label="Raw transcript">
              {events.length ? <pre className="raw">{events.map((e) => JSON.stringify(e)).join('\n')}</pre> : <p className="lane-empty">The transcript is empty.</p>}
            </Scroll>
          </Tabs.Content>
        </Tabs.Root>
        <div className="job-side">
          <Ledger events={events} job={job} />
          {job.status === 'waiting' ? <Reply onSend={(t) => deck.act((api) => api.reply(job.id, t))} /> : null}
        </div>
      </div>
    </section>
  );
}
