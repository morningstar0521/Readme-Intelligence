/** Empty state for intelligence cards (F-40). The copy is fixed by the PRD. */
export function EmptyState({ text = 'Not found in README' }: { text?: string }) {
  return <p className="py-1 text-sm italic text-fg-2">{text}</p>;
}
