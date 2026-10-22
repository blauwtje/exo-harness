export default function Overview({ state, project, deck }) {
  const mine = new Set(state.cards.filter((c) => c.projectKey === project.key).map((c) => c.id));
  const n = [...(deck.sinceLook ?? [])].filter((id) => mine.has(id)).length;
  if (!n) return null;
  return (
    <p className="moved-chip">
      <span className="moved-ring" aria-hidden="true" />
      <span>{n} moved since you last looked</span>
    </p>
  );
}
