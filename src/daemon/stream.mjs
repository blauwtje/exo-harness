const KNOWN_TYPES = new Set(['system', 'assistant', 'user', 'result', 'rate_limit_event', 'control_request', 'control_response']);

export function parseLine(raw) {
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return { kind: 'malformed', type: null, subtype: null, event: null, raw };
  }
  if (event === null || typeof event !== 'object' || Array.isArray(event)) {
    return { kind: 'malformed', type: null, subtype: null, event: null, raw };
  }
  const type = typeof event.type === 'string' ? event.type : null;
  const subtype = typeof event.subtype === 'string' ? event.subtype : null;
  return { kind: KNOWN_TYPES.has(type) ? 'known' : 'unknown', type, subtype, event, raw };
}
