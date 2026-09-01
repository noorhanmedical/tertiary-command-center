// Slice E — pure semantic prerequisite resolution (no DB, no I/O).
//
// Requirement codes are NOT all raw document-type presence. This maps the
// semantically-meaningful ones onto the satisfied set:
//   • screening_form (BW/VW) is satisfied ONLY by current completed STRUCTURED
//     screening — a PDF/flag-only completion never satisfies it.
//   • order_note_signature is satisfied ONLY by a current SIGNED Order Note.
//
// Kept db-free so it is unit-testable without a live database (the stateful
// evaluator in procedurePrerequisites.ts gathers the context and calls this).

export type SemanticPrereqContext = {
  requiresStructuredScreening: boolean;
  structuredScreeningComplete: boolean;
  currentOrderNoteSigned: boolean;
};

export function applySemanticPrerequisites(
  satisfied: Set<string>,
  ctx: SemanticPrereqContext,
): Set<string> {
  const out = new Set(satisfied);
  if (ctx.requiresStructuredScreening) {
    out.delete("screening_form");
    if (ctx.structuredScreeningComplete) out.add("screening_form");
  }
  if (ctx.currentOrderNoteSigned) out.add("order_note_signature");
  else out.delete("order_note_signature");
  return out;
}
