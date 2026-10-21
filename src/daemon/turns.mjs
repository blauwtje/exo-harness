const HEADER = /^\*\*(\d+)\/(\d+)\s+(.+?)\*\*\s*$/;
const OPTION = /^-\s+\*\*\(([A-Za-z])\)\s*(.*?)\*\*\s*:?\s*(.*)$/;
const RECOMMENDED = /^Recommended:\s*\(([A-Za-z])\)/;
const BRIEF_PATH = /docs\/specs\/[\w./-]+\.md/;

export function parseQuestions(text) {
  const questions = [];
  let current = null;
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim();
    const header = HEADER.exec(line);
    if (header) {
      current = { n: Number(header[1]), total: Number(header[2]), title: header[3], options: [], recommended: null };
      questions.push(current);
      continue;
    }
    if (!current) continue;
    const option = OPTION.exec(line);
    if (option) {
      current.options.push({ letter: option[1].toUpperCase(), label: option[2], text: option[3] });
      continue;
    }
    const rec = RECOMMENDED.exec(line);
    if (rec) current.recommended = rec[1].toUpperCase();
  }
  return questions.filter((q) => q.options.length > 0);
}

export function classifyTurn(text) {
  const questions = parseQuestions(text);
  if (questions.length > 0) return { class: 'question', questions };
  return { class: BRIEF_PATH.test(text ?? '') ? 'done' : 'other', questions: [] };
}
