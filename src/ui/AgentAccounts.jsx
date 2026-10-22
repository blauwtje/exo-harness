import { useEffect, useState } from 'react';
import { stageName, stagesInWorkOrder } from './accounts.js';

const DEFAULT_ID = 'default';

export default function AgentAccounts({ state, api }) {
  const accounts = state.accounts ?? [];
  const [picks, setPicks] = useState(null);
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api?.getSettings().then((s) => setPicks(s.accountByStage ?? {}), (e) => setError(e.message));
  }, [api]);

  if (!accounts.length || !picks) return error ? <p className="refusal" role="alert">{error}</p> : null;

  const known = new Set(accounts.map((a) => a.id));
  const pickOf = (stage) => (known.has(picks[stage]) ? picks[stage] : DEFAULT_ID);
  const nameOf = (id) => accounts.find((a) => a.id === id)?.name ?? id;

  const choose = async (stage, id) => {
    const before = picks;
    setPicks({ ...picks, [stage]: id });
    setNote(null); setError(null);
    try {
      const saved = await api.putSettings({ accountByStage: { [stage]: id } });
      setPicks(saved.accountByStage ?? {});
      setNote(`Saved. ${stageName(stage)} uses ${nameOf(id)}.`);
    } catch (e) {
      setPicks(before);
      setError(e.message);
    }
  };

  return (
    <section className="aa" aria-labelledby="aa-title">
      <h2 id="aa-title" className="section-h">Which account each agent uses</h2>
      {accounts.length < 2 ? (
        <p className="aa-lead">Every agent uses {accounts[0].name}. <a href="#/usage">Add an account</a> on the Usage page to split the work.</p>
      ) : (
        <>
          <p className="aa-lead">A new session signs in with the account picked for its kind.</p>
          <ul className="aa-rows">
            {stagesInWorkOrder(picks).map((stage) => (
              <li key={stage} className="aa-row" data-stage={stage}>
                <span className="aa-kind" id={`aa-${stage}`}>{stageName(stage)}</span>
                <div className="aa-pick" role="radiogroup" aria-labelledby={`aa-${stage}`}>
                  {accounts.map((a) => (
                    <label key={a.id} className="aa-opt">
                      <input type="radio" name={`aa-${stage}`} value={a.id} checked={pickOf(stage) === a.id} onChange={() => choose(stage, a.id)} />
                      <span>{a.name}</span>
                    </label>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <p role="status" className="aa-note">{note}</p>
        </>
      )}
      {error ? <p className="refusal" role="alert">{error}</p> : null}
    </section>
  );
}
