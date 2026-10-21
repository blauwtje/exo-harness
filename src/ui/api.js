const KEY = 'exo-token';

export function readToken() {
  const hash = new URLSearchParams(location.hash.replace(/^#\/?/, ''));
  const bare = /^#([A-Za-z0-9_-]{16,})$/.exec(location.hash)?.[1];
  const fromUrl = hash.get('token') ?? bare ?? new URLSearchParams(location.search).get('token');
  if (fromUrl) {
    sessionStorage.setItem(KEY, fromUrl);
    history.replaceState(null, '', `${location.pathname}${location.hash.startsWith('#/jobs/') ? location.hash : '#/'}`);
  }
  return sessionStorage.getItem(KEY);
}

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function createApi(token) {
  const call = async (method, path, body) => {
    let res;
    try {
      res = await fetch(path, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body !== undefined && { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, 'The daemon is not reachable.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`);
    return data;
  };
  return {
    state: () => call('GET', '/api/state'),
    health: () => call('GET', '/api/health'),
    transcript: (id) => call('GET', `/api/jobs/${encodeURIComponent(id)}/transcript`),
    addProject: (path) => call('POST', '/api/projects', { path }),
    addCard: (projectKey, title, body) => call('POST', '/api/cards', { projectKey, title, body }),
    shape: (id) => call('POST', `/api/cards/${encodeURIComponent(id)}/shape`, {}),
    reply: (id, text) => call('POST', `/api/jobs/${encodeURIComponent(id)}/reply`, { text }),
    permission: ({ id, requestId, allow, ...extra }) =>
      call('POST', `/api/jobs/${encodeURIComponent(id)}/permission`, { requestId, allow, ...extra }),
    continueJob: (id) => call('POST', `/api/jobs/${encodeURIComponent(id)}/continue`, {}),
    stop: (id) => call('POST', `/api/jobs/${encodeURIComponent(id)}/stop`, {}),
    stopAll: () => call('POST', '/api/stop-all', {}),
    approve: (id) => call('POST', `/api/cards/${encodeURIComponent(id)}/approve`, {}),
    reject: (id) => call('POST', `/api/cards/${encodeURIComponent(id)}/reject`, {}),
    findCause: (id, jobId) => call('POST', `/api/cards/${encodeURIComponent(id)}/find-cause`, jobId === undefined ? {} : { jobId }),
    retry: (id) => call('POST', `/api/jobs/${encodeURIComponent(id)}/retry`, {}),
    finishLand: (id) => call('POST', `/api/jobs/${encodeURIComponent(id)}/finish-land`, {}),
    approveGate: (id) => call('POST', `/api/jobs/${encodeURIComponent(id)}/approve-gate`, {}),
    rejectGate: (id) => call('POST', `/api/jobs/${encodeURIComponent(id)}/reject-gate`, {}),
    resumeRun: (id) => call('POST', `/api/jobs/${encodeURIComponent(id)}/resume-run`, {}),
    discard: (id) => call('POST', `/api/jobs/${encodeURIComponent(id)}/discard`, {}),
    diff: (id, file) => call('GET', `/api/jobs/${encodeURIComponent(id)}/diff?file=${encodeURIComponent(file)}`),
    getSettings: () => call('GET', '/api/settings'),
    putSettings: (patch) => call('PUT', '/api/settings', patch),
    setBudget: (projectKey, value) => call('POST', '/api/budget', { projectKey, value }),
    reorderQueue: (ids) => call('POST', '/api/queue/reorder', { ids }),
    resumeQueue: () => call('POST', '/api/queue/resume', {}),
    approveNeed: (id) => call('POST', `/api/needs/${encodeURIComponent(id)}/approve`, {}),
    rejectNeed: (id) => call('POST', `/api/needs/${encodeURIComponent(id)}/reject`, {}),
    allowOverage: () => call('POST', '/api/overage/allow', {}),
    events: () => new EventSource(`/events?token=${encodeURIComponent(token)}`),
  };
}
