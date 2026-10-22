import { useEffect, useState } from 'react';
import { leftWords, meterLevel, renewWords, resetWords } from './accounts.js';

function useClockTicking(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}

const CEILING = { session: 'fiveHour', weekly: 'sevenDay' };

function Limit({ limit, ceilings, now }) {
  const passed = typeof limit.resetsAt === 'number' && limit.resetsAt * 1000 <= now;
  const fresh = !limit.stale && !passed && typeof limit.percent === 'number';
  const used = fresh ? Math.min(100, Math.max(0, Math.round(limit.percent))) : null;
  const ceiling = ceilings?.[CEILING[limit.group]];
  const tick = typeof ceiling === 'number' ? Math.round(ceiling * 100) : null;
  const loud = used != null && tick != null && used >= tick;
  return (
    <li className="limit" data-limit={limit.id} data-fresh={fresh} data-level={fresh ? meterLevel(used / 100, tick == null ? null : tick / 100) : undefined} data-loud={loud || undefined}>
      <div className="limit-top">
        <span className="limit-label">{limit.label}</span>
        {fresh ? <span className="limit-used"><span className="limit-num num">{used}%</span> used</span>
          : <span className="limit-none">No fresh reading</span>}
      </div>
      <div className="limit-bar" aria-hidden="true">
        {fresh ? <i className="limit-fill" style={{ width: `${used}%` }} /> : null}
        {tick != null ? <b className="limit-tick" style={{ left: `${tick}%` }} /> : null}
      </div>
      <p className="limit-when">
        {fresh && limit.resetsAt ? <><span>{resetWords(limit.resetsAt, now)}</span><span className="limit-left">{leftWords(limit.resetsAt, now)}</span></>
          : fresh ? <span>Reset time not known</span>
            : <span>Updates the next time Claude runs on this account.</span>}
        {tick != null ? <span className="limit-ceiling"><a href="#/settings" title="New sessions wait at the ceiling. Settings explains why.">Ceiling {tick}%<span className="sr">, new sessions wait here</span></a></span> : null}
      </p>
    </li>
  );
}

function SignIn({ account, api, refresh }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const check = async () => {
    setBusy(true); setNote(null);
    try {
      const got = await api.checkAccount(account.id);
      setNote(got.signedIn ? 'Signed in.' : 'Still not signed in. Run the command, then check again.');
      refresh();
    } catch (e) { setNote(e.message); } finally { setBusy(false); }
  };
  const copy = () => navigator.clipboard?.writeText(account.loginCommand).then(() => setNote('Copied.'), () => setNote('Copy failed. Select the text instead.'));
  return (
    <div className="acct-signin">
      <p className="acct-signin-lead">{account.signedIn === false ? 'Not signed in yet. Run this in a terminal, sign in in the browser, then check again.' : 'Not checked yet. If you have not signed in, run this in a terminal first.'}</p>
      <div className="acct-cmd">
        <code>{account.loginCommand}</code>
        <button type="button" className="btn btn-quiet btn-sm" onClick={copy}>Copy</button>
      </div>
      <div className="acct-actions">
        <button type="button" className="btn btn-secondary btn-sm" aria-disabled={busy || undefined} onClick={busy ? undefined : check}>{busy ? 'Checking' : 'Check again'}</button>
        <p role="status" className="acct-note">{note}</p>
      </div>
    </div>
  );
}

function Remove({ account, api, refresh, fallback }) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState(null);
  const remove = async () => {
    setError(null);
    try { await api.removeAccount(account.id); refresh(); } catch (e) { setError(e.message); }
  };
  if (!asking) return <button type="button" className="btn btn-quiet btn-sm acct-remove" onClick={() => setAsking(true)}>Remove</button>;
  return (
    <div className="acct-confirm" role="group" aria-label={`Remove ${account.name}?`}>
      <p>Remove {account.name}? Agents set to it move to {fallback}. Its login folder stays on disk.</p>
      <div className="acct-actions">
        <button type="button" className="btn btn-danger btn-sm" onClick={remove}>Remove {account.name}</button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => { setAsking(false); setError(null); }}>Keep</button>
      </div>
      {error ? <p className="refusal" role="alert">{error}</p> : null}
    </div>
  );
}

const SIGNED = { true: ['done', 'Signed in'], false: ['need', 'Not signed in'], null: ['quiet', 'Not checked'] };

function Account({ account, ceilings, now, api, refresh, fallback }) {
  const [tone, word] = SIGNED[String(account.signedIn ?? null)];
  const renews = account.renewsAt ? renewWords(account.renewsAt) : null;
  const title = `acct-${account.id}`;
  return (
    <section className="acct" aria-labelledby={title} data-account={account.id}>
      <header className="acct-head">
        <div className="acct-who">
          <h2 id={title} className="acct-name">{account.name}{account.isDefault ? <span className="pill acct-default">Default</span> : null}</h2>
          {account.email ? <p className="acct-email">{account.email}</p> : null}
        </div>
        {account.isDefault ? null : <Remove account={account} api={api} refresh={refresh} fallback={fallback} />}
      </header>
      <dl className="acct-facts">
        <div><dt>Plan</dt><dd className="acct-plan">{account.plan?.label ?? 'Not known'}</dd></div>
        <div>
          <dt>Renewal</dt>
          <dd className="acct-renews">{renews ?? 'Not known'}{renews && account.renewsEstimated ? <span className="acct-est">counted from your start date</span> : null}</dd>
        </div>
        <div><dt>Sign-in</dt><dd><span className={`acct-signed acct-signed-${tone}`}>{word}</span></dd></div>
      </dl>
      {account.signedIn === true ? null : <SignIn account={account} api={api} refresh={refresh} />}
      {account.limits.length ? (
        <ul className="limits" aria-label={`Limits for ${account.name}`}>
          {account.limits.map((l) => <Limit key={l.id} limit={l} ceilings={ceilings} now={now} />)}
        </ul>
      ) : <p className="acct-empty">No limits read yet. They show up once Claude has run on this account.</p>}
    </section>
  );
}

function AddAccount({ api, refresh }) {
  const [name, setName] = useState('');
  const [dir, setDir] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const add = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) { setError('Give the account a name.'); return; }
    setBusy(true); setError(null); setNote(null);
    try {
      const got = await api.addAccount(name.trim(), dir.trim() || undefined);
      setName(''); setDir('');
      setNote(`Added ${got.name}. Sign it in above.`);
      refresh();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <section className="acct acct-add" aria-labelledby="acct-add-title">
      <h2 id="acct-add-title" className="acct-name">Add account</h2>
      <p className="acct-add-lead">A second Claude plan, for example for work. Pick which agents use it on the Agents page.</p>
      <form className="acct-form" onSubmit={add} noValidate>
        <label className="acct-field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} autoComplete="off" aria-invalid={error && !name.trim() ? 'true' : undefined} />
        </label>
        <label className="acct-field">
          <span>Folder <span className="acct-opt">(optional)</span></span>
          <input value={dir} onChange={(e) => setDir(e.target.value)} placeholder="Empty: exo makes one" autoComplete="off" spellCheck={false} aria-describedby="acct-dir-hint" />
          <span className="acct-hint" id="acct-dir-hint">Where this account keeps its Claude login, a full path.</span>
        </label>
        <div className="acct-actions">
          <button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>Add account</button>
          <p role="status" className="acct-note">{note}</p>
        </div>
        {error ? <p className="refusal" role="alert">{error}</p> : null}
      </form>
    </section>
  );
}

export default function Usage({ state, deck }) {
  const now = useClockTicking();
  const accounts = state.accounts ?? [];
  const ceilings = deck.settings?.ceilings;
  const fallback = accounts.find((a) => a.isDefault)?.name ?? 'the default account';
  return (
    <section className="usage-page" aria-labelledby="usage-title">
      <header className="page-head">
        <h1 id="usage-title" className="page-h">Usage</h1>
        <p className="usage-lead">How much of each plan is used, and when it resets. The mark on a bar is your ceiling: new sessions wait there.</p>
      </header>
      {accounts.length ? accounts.map((a) => <Account key={a.id} account={a} ceilings={ceilings} now={now} api={deck.api} refresh={deck.refresh} fallback={fallback} />)
        : <p className="acct-empty">No account data yet.</p>}
      {deck.api ? <AddAccount api={deck.api} refresh={deck.refresh} /> : null}
    </section>
  );
}
