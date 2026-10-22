import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Mark, PauseMotion } from './parts.jsx';
import { fadeRise, spring, useMotionPaused } from './motion.js';
import { KIND_WORD } from './NeedsYou.jsx';
import { NEEDS_YOU_KINDS } from './derive.js';

const FIELD_OF_ERROR = [
  [/^ceilings/, 'ceilings'], [/^hardStopFiveHour/, 'hardStop'], [/^maxConcurrent/, 'maxConcurrent'],
  [/^landDefault/, 'landDefault'], [/^landByProject/, 'landByProject'], [/^scouts/, 'scouts'],
  [/^needsYou/, 'needsYou'], [/^alerts/, 'alerts'],
];
const SECTION_OF_FIELD = {
  ceilings: 'limits', hardStop: 'limits', maxConcurrent: 'jobs', scouts: 'jobs',
  landDefault: 'landing', landByProject: 'landing', dial: 'spending', overage: 'spending',
  needsYou: 'needs', alerts: 'needs',
};
const QUIET_KINDS = Object.keys(KIND_WORD).filter((k) => !NEEDS_YOU_KINDS.includes(k));
const KINDS = [...NEEDS_YOU_KINDS, ...QUIET_KINDS];
const KIND_HINT = {
  question: 'An agent asks you something.', permission: 'An agent asks to use a tool.',
  brief: 'A brief waits for your approval before its run starts.', gate: 'A finished change waits for your approval.',
  conflict: 'A run cannot rebase onto its base.', 'run-failed': 'A run stopped before it finished.',
  setup: 'Setting up a worktree failed, so the run did not start.', refusal: 'exo refused to start a run.',
  land: 'Landing finished work stopped.', 'turn-cap': 'An agent paused after many turns so you can check its work.',
  invariant: 'A session started with the wrong settings and was stopped.', failure: 'A session crashed.',
  health: 'A health check on this machine failed.', limit: 'A run parked on a usage limit.',
  budget: 'A budget or ceiling change waits for your approval.', overage: 'Usage is billed as overage, so no new session starts.',
};
const WHERE = [['system', 'Desktop'], ['app', 'In the app'], ['none', 'No alert']];
const QUIET_ALERT = Object.freeze({ where: 'none', sound: false });
const alertsFrom = (saved) => ({ ...saved, ...Object.fromEntries(KINDS.map((k) => [k, saved?.[k] ?? QUIET_ALERT])) });
const DIAL = [['fast', 'Fast'], ['balanced', 'Balanced'], ['quality', 'Quality'], ['off', 'Off']];
const LAND = [['local', 'Merge locally'], ['pr', 'Open a pull request']];
const LAND_SHORT = { local: 'Merge locally', pr: 'Pull request' };
const toPercent = (fraction) => String(Math.round(fraction * 1000) / 10);
const toFraction = (text) => Number(text) / 100;

const fieldOf = (message) => FIELD_OF_ERROR.find(([pattern]) => pattern.test(message))?.[1] ?? 'form';
const RANGE = / must be above 0 and at most 1$/;
const PLAIN_RANGE = { ceilings: 'Ceilings must be above 0% and at most 100%.', hardStop: 'The hard stop must be above 0% and at most 100%.' };
const plain = (field, message) => {
  if (PLAIN_RANGE[field] && RANGE.test(message)) return PLAIN_RANGE[field];
  if (field === 'maxConcurrent') return `${message.replace(/^maxConcurrent/, 'Concurrent sessions')}.`;
  return message;
};

function formFrom(settings) {
  return {
    fiveHour: toPercent(settings.ceilings.fiveHour),
    sevenDay: toPercent(settings.ceilings.sevenDay),
    hardStop: toPercent(settings.hardStopFiveHour),
    maxConcurrent: String(settings.maxConcurrent),
    landDefault: settings.landDefault,
    landByProject: settings.landByProject,
    scouts: settings.scouts.enabled,
    needsYou: settings.needsYou ?? NEEDS_YOU_KINDS,
    alerts: alertsFrom(settings.alerts),
  };
}

function patchFrom(form) {
  return {
    ceilings: { fiveHour: toFraction(form.fiveHour), sevenDay: toFraction(form.sevenDay) },
    hardStopFiveHour: toFraction(form.hardStop),
    maxConcurrent: Number(form.maxConcurrent),
    landDefault: form.landDefault,
    landByProject: form.landByProject,
    scouts: { enabled: form.scouts },
    needsYou: form.needsYou,
    alerts: form.alerts,
  };
}

const entries = (v) => Object.entries(v).sort();
const FLAT = { landByProject: entries, alerts: entries, needsYou: (v) => [...v].sort() };
const flat = (f, keys) => JSON.stringify(keys.map((k) => (FLAT[k] ?? ((v) => v))(f[k])));
const SECTION_KEYS = {
  needs: ['needsYou', 'alerts'], limits: ['fiveHour', 'sevenDay', 'hardStop'], jobs: ['maxConcurrent', 'scouts'], landing: ['landDefault', 'landByProject'], display: [],
};
const ALL_KEYS = Object.values(SECTION_KEYS).flat();

function savedNote(sent, got) {
  const held = ['fiveHour', 'sevenDay'].filter((k) => sent.ceilings[k] > got.ceilings[k]);
  if (!held.length) return 'Saved.';
  const which = held.length === 2 ? 'Both higher ceilings wait' : `The higher ${held[0] === 'fiveHour' ? 'five-hour' : 'seven-day'} ceiling waits`;
  return `Saved. ${which} for your approval in Needs you.`;
}

function Refusal({ errors, field }) {
  return errors[field] ? <motion.p className="refusal" role="alert" id={`err-${field}`} {...fadeRise}>{errors[field]}</motion.p> : null;
}

function Row({ id, label, hint, children, errors, field, wide }) {
  return (
    <div className={`set-row${wide ? ' set-row-wide' : ''}`}>
      <div className="set-label">
        <label htmlFor={id}>{label}</label>
        {hint ? <p className="set-hint" id={`${id}-hint`}>{hint}</p> : null}
      </div>
      <div className="set-control">{children}</div>
      {errors && field ? <Refusal errors={errors} field={field} /> : null}
    </div>
  );
}

const outOfRange = (text) => !(Number(text) > 0 && Number(text) <= 100);
const describe = (...ids) => ids.filter(Boolean).join(' ') || undefined;

function Percent({ id, value, onChange, error }) {
  return (
    <span className="set-unit">
      <input id={id} type="number" inputMode="decimal" min="1" max="100" value={value} onChange={onChange} aria-invalid={error ? 'true' : undefined} aria-describedby={describe(`${id}-hint`, error ? `err-${error}` : null)} />
      <span aria-hidden="true">%</span>
    </span>
  );
}

function Section({ id, title, lead, dirty, failed, children }) {
  return (
    <section className="set-sec" id={`set-${id}`} aria-labelledby={`set-${id}-title`} data-section={id}>
      <header className="set-sec-head">
        <div className="set-sec-words">
          <h3 id={`set-${id}-title`} className="set-sec-title" tabIndex={-1}>{title}</h3>
          <p className="set-sec-lead">{lead}</p>
        </div>
        {failed ? <span className="pill pill-fail set-sec-flag">Needs a fix</span> : dirty ? <span className="pill pill-accent set-sec-flag">Not saved</span> : null}
      </header>
      <div className="set-sec-body">{children}</div>
    </section>
  );
}

function WhyBelowFull() {
  return (
    <div className="set-why" role="note" aria-labelledby="set-why-title">
      <h4 className="set-row-title" id="set-why-title">Why a ceiling sits below 100%</h4>
      <p>A ceiling only holds back new sessions. Before one starts, exo adds what a session of that kind usually costs, so it stops a little early.</p>
      <p>Sessions already running keep spending, and you use the same plan when you work with Claude yourself. The room above the ceiling is for both.</p>
      <p>The hard stop sits higher and ends running sessions after their current task. The seven-day ceiling sits lowest, because running out of the weekly limit locks you out for days, not hours.</p>
    </div>
  );
}

function StatusText({ state }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {state ? <motion.span key={state.key} className={`set-state set-state-${state.key}`} {...fadeRise}>{state.mark}<span>{state.text}</span></motion.span> : null}
    </AnimatePresence>
  );
}

const desktopPermission = () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

function KindRow({ kind, picked, alert, pick, change }) {
  const word = KIND_WORD[kind];
  const id = `kind-${kind}`;
  return (
    <div className={`set-kind${picked ? ' set-kind-on' : ''}`} data-kind={kind}>
      <input id={id} type="checkbox" className="set-kind-pick" checked={picked} onChange={() => pick(kind)} aria-describedby={`${id}-hint`} />
      <div className="set-label">
        <label htmlFor={id}>{word}</label>
        <p className="set-hint" id={`${id}-hint`}>{KIND_HINT[kind]}</p>
      </div>
      <select className="set-kind-where" aria-label={`Alert for ${word}`} disabled={!picked} value={alert.where} onChange={(e) => change({ kind, where: e.target.value })}>
        {WHERE.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
      <span className="set-switch set-kind-sound">
        <input type="checkbox" role="switch" aria-label={`Sound for ${word}`} disabled={!picked} checked={alert.sound} onChange={(e) => change({ kind, sound: e.target.checked })} />
        <span className="set-kind-sound-word" aria-hidden="true">Sound</span>
      </span>
    </div>
  );
}

function KindGroup({ id, title, kinds, form, pick, change }) {
  return (
    <div className="set-kinds" role="group" aria-labelledby={id}>
      <p className="set-group-title" id={id}>{title}</p>
      {kinds.map((k) => <KindRow key={k} kind={k} picked={form.needsYou.includes(k)} alert={form.alerts[k]} pick={pick} change={change} />)}
    </div>
  );
}

function NeedsSection({ form, edit, errors, dirty, failed }) {
  const [desktop, setDesktop] = useState(desktopPermission);
  const pick = (kind) => {
    const picked = form.needsYou.includes(kind);
    edit({ ...form, needsYou: picked ? form.needsYou.filter((k) => k !== kind) : [...form.needsYou, kind] });
  };
  const change = ({ kind, ...next }) => {
    if (next.where === 'system' && desktop === 'default') Notification.requestPermission().then(setDesktop, () => setDesktop('denied'));
    edit({ ...form, alerts: { ...form.alerts, [kind]: { ...form.alerts[kind], ...next } } });
  };
  const wantsDesktop = form.needsYou.some((k) => form.alerts[k]?.where === 'system');
  const blocked = wantsDesktop && (desktop === 'denied' || desktop === 'unsupported');
  return (
    <Section id="needs" title="Needs you" lead="Pick what asks for you. The rest waits in a quiet history. Alerts only go off for kinds you show here." dirty={dirty} failed={failed}>
      <div className="set-kinds-head" aria-hidden="true"><span>Show</span><span>Alert</span><span>Sound</span></div>
      <KindGroup id="set-kinds-usual" title="Usually in Needs you" kinds={NEEDS_YOU_KINDS} form={form} pick={pick} change={change} />
      <KindGroup id="set-kinds-quiet" title="Usually in the quiet history" kinds={QUIET_KINDS} form={form} pick={pick} change={change} />
      {blocked ? <p className="set-kinds-note" role="note">This browser blocks desktop alerts, so those show in the app instead.</p> : null}
      <Refusal errors={errors} field="needsYou" />
      <Refusal errors={errors} field="alerts" />
    </Section>
  );
}

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function Settings({ state, project, api, back }) {
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [note, setNote] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dial, setDial] = useState('balanced');
  const [dialNote, setDialNote] = useState(null);
  const [dialSaved, setDialSaved] = useState('balanced');
  const [dialSaving, setDialSaving] = useState(false);
  const [current, setCurrent] = useState('needs');
  const [focusField, setFocusField] = useState(null);
  const [motionPaused] = useMotionPaused();
  const root = useRef(null);
  const jumping = useRef(null);

  const load = (next) => { setSettings(next); setForm(formFrom(next)); };
  useEffect(() => { api.getSettings().then(load, (e) => setErrors({ form: e.message })); }, [api]);

  const ready = Boolean(form);
  useEffect(() => {
    const el = root.current;
    const scroller = el?.closest('.page');
    if (!el || !scroller) return undefined;
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (jumping.current) return;
      const sections = [...el.querySelectorAll('[data-section]')];
      if (!sections.length) return;
      const top = scroller.getBoundingClientRect().top + 120;
      const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
      let next = sections[0].dataset.section;
      for (const s of sections) if (s.getBoundingClientRect().top <= top) next = s.dataset.section;
      if (atEnd && scroller.scrollTop > 0) next = sections[sections.length - 1].dataset.section;
      setCurrent(next);
    };
    const onScroll = () => {
      if (jumping.current) {
        clearTimeout(jumping.current);
        jumping.current = setTimeout(() => { jumping.current = null; }, 160);
        return;
      }
      if (!frame) frame = requestAnimationFrame(measure);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => { scroller.removeEventListener('scroll', onScroll); if (frame) cancelAnimationFrame(frame); };
  }, [ready]);

  useEffect(() => {
    if (!focusField) return;
    const input = document.getElementById(focusField);
    input?.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
    input?.focus({ preventScroll: true });
    setFocusField(null);
  }, [focusField]);

  if (!form) {
    return (
      <section className="settings" aria-labelledby="settings-title" aria-busy={!errors.form} ref={root}>
        <header className="set-head">
          <h1 id="settings-title" className="page-h">Settings</h1>
        </header>
        {errors.form ? <Refusal errors={errors} field="form" /> : <div className="set-loading" aria-hidden="true"><i /><i /><i /></div>}
      </section>
    );
  }

  const saved = formFrom(settings);
  const dirty = flat(form, ALL_KEYS) !== flat(saved, ALL_KEYS);
  const dirtyIn = (sec) => (sec === 'spending' ? dial !== dialSaved : flat(form, SECTION_KEYS[sec]) !== flat(saved, SECTION_KEYS[sec]));
  const failedIn = (sec) => Object.keys(errors).some((f) => SECTION_OF_FIELD[f] === sec);
  const edit = (next) => { setForm(next); setNote(null); setErrors({}); };
  const set = (key) => (e) => edit({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const setLand = (key) => (e) => {
    const { [key]: _dropped, ...rest } = form.landByProject;
    edit({ ...form, landByProject: e.target.value ? { ...rest, [key]: e.target.value } : rest });
  };
  const invalid = (field) => (errors[field] ? 'true' : undefined);

  const badFive = errors.ceilings && outOfRange(form.fiveHour);
  const badSeven = errors.ceilings && outOfRange(form.sevenDay);
  const ceilingsAt = badSeven || !badFive ? 'seven' : 'five';
  const overrides = Object.keys(form.landByProject).length;
  const firstLand = state.projects[0] ? `land-${state.projects[0].key}` : null;
  const INPUT_OF_FIELD = {
    hardStop: 'set-hard', maxConcurrent: 'set-conc', landDefault: 'set-land', landByProject: firstLand, scouts: 'set-scouts',
  };

  const save = async (e) => {
    e.preventDefault();
    if (saving) return;
    setNote(null);
    setSaving(true);
    const patch = patchFrom(form);
    try {
      const next = await api.putSettings(patch);
      load(next);
      setErrors({});
      setNote(savedNote(patch, next));
    } catch (err) {
      const field = fieldOf(err.message);
      setErrors({ [field]: plain(field, err.message) });
      const bad = field === 'ceilings'
        ? (outOfRange(form.sevenDay) || !outOfRange(form.fiveHour) ? 'set-seven' : 'set-five')
        : INPUT_OF_FIELD[field];
      if (bad) setFocusField(bad);
    } finally {
      setSaving(false);
    }
  };

  const allowOverage = async () => {
    try { await api.allowOverage(); setSettings({ ...settings, overageAllowed: true }); setErrors({}); } catch (err) { setErrors({ overage: err.message }); }
  };

  const saveDial = async () => {
    if (dialSaving) return;
    setDialNote(null);
    setDialSaving(true);
    try {
      const r = await api.setBudget(project.key, dial);
      setDialSaved(dial);
      setDialNote(r.gated ? 'Saved. Raising the budget waits for your approval in Needs you.' : 'Saved.');
      setErrors({});
    } catch (err) {
      setErrors({ dial: err.message });
    } finally {
      setDialSaving(false);
    }
  };

  const stateOf = (busy, text, unsaved) => {
    if (busy) return { key: 'saving', text: 'Saving', mark: null };
    if (text) return { key: 'saved', text, mark: <span aria-hidden="true"><Mark status="done" label="Saved" /></span> };
    if (unsaved) return { key: 'dirty', text: 'Unsaved changes', mark: <span aria-hidden="true"><Mark status="queued" label="Not saved" /></span> };
    return null;
  };
  const saveState = stateOf(saving, note, dirty);
  const dialState = stateOf(dialSaving, dialNote, dial !== dialSaved);
  const dialWord = DIAL.find(([v]) => v === dial)?.[1];

  const shown = form.needsYou.filter((k) => KINDS.includes(k));
  const alerting = shown.filter((k) => form.alerts[k].where !== 'none').length;
  const sections = [
    { id: 'needs', title: 'Needs you', value: `${shown.length} of ${KINDS.length} kinds, ${alerting} with an alert` },
    { id: 'limits', title: 'Usage limits', value: `${form.fiveHour}% / ${form.sevenDay}%, stop ${form.hardStop}%` },
    { id: 'jobs', title: 'Sessions', value: `${form.maxConcurrent} at once, scouts ${form.scouts ? 'on' : 'off'}` },
    { id: 'landing', title: 'Landing', value: `${LAND_SHORT[form.landDefault] ?? form.landDefault}${overrides ? `, ${overrides} override${overrides > 1 ? 's' : ''}` : ''}` },
    { id: 'spending', title: 'Spending', value: `${project ? `${dialWord}, ` : ''}overage ${settings.overageAllowed ? 'allowed' : 'blocked'}` },
    { id: 'display', title: 'Display', value: motionPaused ? 'Motion paused' : 'Motion on' },
  ];

  const jump = (id) => (e) => {
    e.preventDefault();
    const target = document.getElementById(`set-${id}`);
    if (!target) return;
    setCurrent(id);
    clearTimeout(jumping.current);
    jumping.current = setTimeout(() => { jumping.current = null; }, 600);
    target.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
    document.getElementById(`set-${id}-title`)?.focus({ preventScroll: true });
  };

  return (
    <section className="settings" aria-labelledby="settings-title" ref={root}>
      <header className="set-head">
        <h1 id="settings-title" className="page-h">Settings</h1>
        <p className="set-intro">What asks for you, how much exo may use, how many sessions run, and where finished work goes.</p>
      </header>

      <div className="set-layout">
        <nav className="set-index" aria-label="Settings sections">
          <ol>
            {sections.map((s) => {
              const on = current === s.id;
              const failed = failedIn(s.id);
              const changed = dirtyIn(s.id);
              return (
                <li key={s.id}>
                  <a href={`#set-${s.id}`} className="set-index-link" aria-current={on ? 'location' : undefined} onClick={jump(s.id)}>
                    {on ? <motion.span className="set-index-mark" layoutId="set-index-mark" transition={spring} aria-hidden="true" /> : null}
                    <span className="set-index-title">
                      {s.title}
                      {failed ? <span className="set-index-flag set-index-fail"><span className="sr">, needs a fix</span></span>
                        : changed ? <span className="set-index-flag set-index-dirty"><span className="sr">, not saved</span></span> : null}
                    </span>
                    <span className="set-index-value">{s.value}</span>
                  </a>
                </li>
              );
            })}
          </ol>
        </nav>

        <form id="set-form" onSubmit={save} noValidate className="set-form">
          <NeedsSection form={form} edit={edit} errors={errors} dirty={dirtyIn('needs')} failed={failedIn('needs')} />

          <Section id="limits" title="Usage limits" lead="A share of your plan's limit. New sessions wait once usage reaches it." dirty={dirtyIn('limits')} failed={failedIn('limits')}>
            <Row id="set-five" label="Five-hour ceiling" hint="Of the rolling five-hour window." errors={errors} field={ceilingsAt === 'five' ? 'ceilings' : null}>
              <Percent id="set-five" value={form.fiveHour} onChange={set('fiveHour')} error={badFive ? 'ceilings' : null} />
            </Row>
            <Row id="set-seven" label="Seven-day ceiling" hint="Of the weekly limit." errors={errors} field={ceilingsAt === 'seven' ? 'ceilings' : null}>
              <Percent id="set-seven" value={form.sevenDay} onChange={set('sevenDay')} error={badSeven ? 'ceilings' : null} />
            </Row>
            <Row id="set-hard" label="Hard stop (five-hour)" hint="Running sessions stop after their current task." errors={errors} field="hardStop">
              <Percent id="set-hard" value={form.hardStop} onChange={set('hardStop')} error={errors.hardStop ? 'hardStop' : null} />
            </Row>
            <WhyBelowFull />
          </Section>

          <Section id="jobs" title="Sessions" lead="How much runs at once, and where new work comes from." dirty={dirtyIn('jobs')} failed={failedIn('jobs')}>
            <Row id="set-conc" label="Concurrent sessions" hint="How many sessions run at the same time, 1 to 16." errors={errors} field="maxConcurrent">
              <input id="set-conc" type="number" inputMode="numeric" min="1" max="16" value={form.maxConcurrent} onChange={set('maxConcurrent')} aria-invalid={invalid('maxConcurrent')} aria-describedby={describe('set-conc-hint', errors.maxConcurrent ? 'err-maxConcurrent' : null)} />
            </Row>
            <Row id="set-scouts" label="Scouts enabled" hint="Scouts look through issues for new work." errors={errors} field="scouts">
              <span className="set-switch">
                <input id="set-scouts" type="checkbox" role="switch" checked={form.scouts} onChange={set('scouts')} aria-describedby="set-scouts-hint" />
                <span className="set-switch-word" aria-hidden="true">{form.scouts ? 'On' : 'Off'}</span>
              </span>
            </Row>
          </Section>

          <Section id="landing" title="Landing" lead="What happens to finished work once a session is done." dirty={dirtyIn('landing')} failed={failedIn('landing')}>
            <Row id="set-land" label="Landing default" hint="Used by every project unless it has its own choice below." errors={errors} field="landDefault">
              <select id="set-land" value={form.landDefault} onChange={set('landDefault')} aria-describedby={describe('set-land-hint', errors.landDefault ? 'err-landDefault' : null)}>
                {LAND.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
              </select>
            </Row>
            {state.projects.length ? (
              <div className="set-group" role="group" aria-labelledby="set-per-title">
                <p className="set-group-title" id="set-per-title">Per project</p>
                {state.projects.map((p) => (
                  <Row id={`land-${p.key}`} key={p.key} label={`Landing for ${p.key}`} errors={errors} field={p === state.projects[0] ? 'landByProject' : null}>
                    <select id={`land-${p.key}`} value={form.landByProject[p.key] ?? ''} onChange={setLand(p.key)}>
                      <option value="">Use the default</option>
                      {LAND.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
                    </select>
                  </Row>
                ))}
              </div>
            ) : <Refusal errors={errors} field="landByProject" />}
          </Section>

          <Section id="spending" title="Spending" lead={project ? 'The effort agents spend on this project, and whether sessions may run on overage.' : 'Whether jobs may run while usage is billed as overage.'} dirty={dirtyIn('spending')} failed={failedIn('spending')}>
            {project ? (
              <>
                <Row id="set-dial" label="Budget for this project" hint="Sets the model and effort agents use. Saved on its own." errors={errors} field="dial">
                  <select id="set-dial" value={dial} onChange={(e) => { setDial(e.target.value); setDialNote(null); setErrors({}); }} aria-describedby="set-dial-hint">
                    {DIAL.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
                  </select>
                </Row>
                <div className="set-sec-save">
                  <button type="button" className="btn btn-secondary" aria-disabled={dialSaving || undefined} onClick={saveDial}>Save budget</button>
                  <p role="status" className="set-status"><StatusText state={dialState} /></p>
                </div>
              </>
            ) : null}
            <div className="set-row">
              <div className="set-label">
                <h4 className="set-row-title">Overage</h4>
                <p className="set-hint" id="set-over-hint">
                  {settings.overageAllowed ? 'Allowed until the daemon restarts.' : 'Sessions do not start while usage is billed as overage.'}
                </p>
              </div>
              <div className="set-control">
                <button type="button" className="btn btn-secondary" disabled={settings.overageAllowed} aria-describedby="set-over-hint" onClick={allowOverage}>
                  Allow overage
                </button>
              </div>
              <Refusal errors={errors} field="overage" />
            </div>
          </Section>

          <Section id="display" title="Display" lead="How the deck looks on this device. Changes apply at once." dirty={false} failed={false}>
            <div className="set-row">
              <div className="set-label">
                <h4 className="set-row-title">Motion</h4>
                <p className="set-hint">Moving lines and glows play once, then rest. Kept in this browser.</p>
              </div>
              <div className="set-control"><PauseMotion className="set-motion" /></div>
            </div>
          </Section>

        </form>
      </div>

      <div className="set-save">
        <button type="submit" form="set-form" className="btn btn-primary" aria-disabled={saving || undefined}>Save settings</button>
        <p role="status" className="set-status"><StatusText state={saveState} /></p>
        <Refusal errors={errors} field="form" />
      </div>
    </section>
  );
}
