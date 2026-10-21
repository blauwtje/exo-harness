import { useEffect, useState } from 'react';

const FIELD_OF_ERROR = [
  [/^ceilings/, 'ceilings'], [/^hardStopFiveHour/, 'hardStop'], [/^maxConcurrent/, 'maxConcurrent'],
  [/^landDefault/, 'landDefault'], [/^landByProject/, 'landByProject'], [/^scouts/, 'scouts'],
];
const DIAL = ['fast', 'balanced', 'quality', 'off'];
const toPercent = (fraction) => String(Math.round(fraction * 1000) / 10);
const toFraction = (text) => Number(text) / 100;

const fieldOf = (message) => FIELD_OF_ERROR.find(([pattern]) => pattern.test(message))?.[1] ?? 'form';

function formFrom(settings) {
  return {
    fiveHour: toPercent(settings.ceilings.fiveHour),
    sevenDay: toPercent(settings.ceilings.sevenDay),
    hardStop: toPercent(settings.hardStopFiveHour),
    maxConcurrent: String(settings.maxConcurrent),
    landDefault: settings.landDefault,
    landByProject: settings.landByProject,
    scouts: settings.scouts.enabled,
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
  };
}

function Refusal({ errors, field }) {
  return errors[field] ? <span className="refusal" role="alert" id={`err-${field}`}>{errors[field]}</span> : null;
}

export default function Settings({ state, project, api, back }) {
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [note, setNote] = useState(null);
  const [dial, setDial] = useState('balanced');
  const [dialNote, setDialNote] = useState(null);

  const load = (next) => { setSettings(next); setForm(formFrom(next)); };
  useEffect(() => { api.getSettings().then(load, (e) => setErrors({ form: e.message })); }, [api]);

  if (!form) return <section className="settings" aria-busy="true"><Refusal errors={errors} field="form" /></section>;

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const setLand = (key) => (e) => {
    const { [key]: _dropped, ...rest } = form.landByProject;
    setForm({ ...form, landByProject: e.target.value ? { ...rest, [key]: e.target.value } : rest });
  };

  const save = async (e) => {
    e.preventDefault();
    setNote(null);
    try {
      load(await api.putSettings(patchFrom(form)));
      setErrors({});
      setNote('Saved. A ceiling raised above its default waits for approval in Needs you.');
    } catch (err) {
      setErrors({ [fieldOf(err.message)]: err.message });
    }
  };

  const allowOverage = async () => {
    try { await api.allowOverage(); setSettings({ ...settings, overageAllowed: true }); } catch (err) { setErrors({ overage: err.message }); }
  };

  const applyDial = async () => {
    try {
      const r = await api.setBudget(project.key, dial);
      setDialNote(r.gated ? 'Raising the budget waits for approval in Needs you.' : `Budget set to ${dial}.`);
      setErrors({});
    } catch (err) {
      setDialNote(null);
      setErrors({ dial: err.message });
    }
  };

  return (
    <section className="settings" aria-labelledby="settings-title">
      <h2 id="settings-title">Settings</h2>
      <form onSubmit={save} noValidate>
        <fieldset>
          <legend>Ceilings and hard stop (percent of the limit)</legend>
          <label htmlFor="set-five">Five-hour ceiling</label>
          <input id="set-five" type="number" value={form.fiveHour} onChange={set('fiveHour')} aria-describedby="err-ceilings" />
          <label htmlFor="set-seven">Seven-day ceiling</label>
          <input id="set-seven" type="number" value={form.sevenDay} onChange={set('sevenDay')} aria-describedby="err-ceilings" />
          <Refusal errors={errors} field="ceilings" />
          <label htmlFor="set-hard">Hard stop (five-hour)</label>
          <input id="set-hard" type="number" value={form.hardStop} onChange={set('hardStop')} aria-describedby="err-hardStop" />
          <Refusal errors={errors} field="hardStop" />
        </fieldset>
        <fieldset>
          <legend>Jobs</legend>
          <label htmlFor="set-conc">Concurrent jobs</label>
          <input id="set-conc" type="number" value={form.maxConcurrent} onChange={set('maxConcurrent')} aria-describedby="err-maxConcurrent" />
          <Refusal errors={errors} field="maxConcurrent" />
          <label htmlFor="set-land">Landing default</label>
          <select id="set-land" value={form.landDefault} onChange={set('landDefault')}>
            <option value="local">local</option><option value="pr">pr</option>
          </select>
          <Refusal errors={errors} field="landDefault" />
          {state.projects.map((p) => (
            <div key={p.key}>
              <label htmlFor={`land-${p.key}`}>Landing for {p.key}</label>
              <select id={`land-${p.key}`} value={form.landByProject[p.key] ?? ''} onChange={setLand(p.key)}>
                <option value="">default</option><option value="local">local</option><option value="pr">pr</option>
              </select>
            </div>
          ))}
          <Refusal errors={errors} field="landByProject" />
          <label htmlFor="set-scouts"><input id="set-scouts" type="checkbox" checked={form.scouts} onChange={set('scouts')} /> Scouts enabled</label>
          <Refusal errors={errors} field="scouts" />
        </fieldset>
        <Refusal errors={errors} field="form" />
        <div className="actions">
          <button type="submit" className="btn btn-edge">Save settings</button>
          <button type="button" className="btn btn-quiet" onClick={back}>Back to board</button>
        </div>
        {note ? <p role="status" className="dim">{note}</p> : null}
      </form>
      <div>
        <h3>Overage</h3>
        <p className="dim">{settings.overageAllowed ? 'Overage is allowed until the daemon restarts.' : 'Jobs do not start while usage is billed as overage.'}</p>
        <button className="btn btn-edge" disabled={settings.overageAllowed} onClick={allowOverage}>Allow overage</button>
        <Refusal errors={errors} field="overage" />
      </div>
      {project ? (
        <div>
          <h3>Budget dial for {project.key}</h3>
          <label htmlFor="set-dial">Budget</label>
          <select id="set-dial" value={dial} onChange={(e) => setDial(e.target.value)}>
            {DIAL.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <button className="btn btn-edge" onClick={applyDial}>Apply budget</button>
          <Refusal errors={errors} field="dial" />
          {dialNote ? <p role="status" className="dim">{dialNote}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
