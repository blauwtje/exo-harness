// why: the queue lives in state.queue so a restart reads the order, priority and pauses back (Decisions 15, 16).
export function createQueue(state) {
  const q = (state.queue ??= {});
  q.order ??= [];
  q.projectPriority ??= [];
  q.pauses ??= [];
  q.paused ??= q.pauses[0] ?? null;

  const projectOf = (id) => {
    const job = state.jobs.find((j) => j.id === id);
    return state.cards.find((c) => c.id === job?.cardId)?.projectKey;
  };
  const rank = (id) => {
    const i = q.projectPriority.indexOf(projectOf(id));
    return i < 0 ? q.projectPriority.length : i;
  };
  const sync = () => { q.paused = q.pauses[0] ?? null; };

  return {
    enqueue(id) {
      if (!q.order.includes(id)) q.order.push(id);
    },
    // why: admit may refuse one job (its stage window is full) while another is still allowed.
    next(admit) {
      if (q.paused) return null;
      const ranked = q.order.map((id, i) => ({ id, i, r: rank(id) })).sort((a, b) => a.r - b.r || a.i - b.i);
      const pick = ranked.find((c) => admit(c.id));
      if (!pick) return null;
      q.order.splice(q.order.indexOf(pick.id), 1);
      return pick.id;
    },
    reorder(ids) {
      const same = Array.isArray(ids) && ids.length === q.order.length && new Set(ids).size === ids.length && ids.every((id) => q.order.includes(id));
      if (!same) return { error: 'ids must be exactly the queued jobs' };
      q.order = [...ids];
      return {};
    },
    setPriority(projectIds) {
      q.projectPriority = [...projectIds];
    },
    pause(cause) {
      q.pauses = [...q.pauses.filter((p) => p.reason !== cause.reason), cause];
      sync();
    },
    resume(reason) {
      q.pauses = q.pauses.filter((p) => p.reason !== reason);
      sync();
    },
    snapshot() {
      return structuredClone({ order: q.order, projectPriority: q.projectPriority, paused: q.paused, pauses: q.pauses });
    },
  };
}
