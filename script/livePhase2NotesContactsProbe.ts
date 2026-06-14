// livePhase2NotesContactsProbe — Phase 2 PR 2.10.
//
// Read-only DB probe verifying the PR 2.6 + 2.7 tables exist and
// carry the expected columns. Does not insert (audit-friendly).
//
// Honest skip when DATABASE_URL is unavailable.

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log("[probe:phase2-notes-contacts] DATABASE_URL unavailable — skipped live DB probe.");
    return;
  }
  const { pool } = await import("../server/db");

  const tables = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('patient_notes', 'contacts')`,
  );
  const present = new Set(tables.rows.map((r) => r.table_name));
  if (!present.has("patient_notes")) {
    console.error("[probe:phase2-notes-contacts] patient_notes table missing — apply migration 0030");
    process.exit(1);
  }
  if (!present.has("contacts")) {
    console.error("[probe:phase2-notes-contacts] contacts table missing — apply migration 0031");
    process.exit(1);
  }
  console.log("[probe:phase2-notes-contacts] both new tables present ✓");

  // patient_notes columns.
  const notes = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'patient_notes'`,
  );
  const noteCols = new Set(notes.rows.map((r) => r.column_name));
  const REQUIRED_NOTE_COLS = [
    "id", "patient_screening_id", "execution_case_id", "note_type",
    "body", "author_user_id", "is_internal", "metadata", "archived_at",
    "created_at", "updated_at",
  ];
  const missingNote = REQUIRED_NOTE_COLS.filter((c) => !noteCols.has(c));
  if (missingNote.length > 0) {
    console.error(`[probe:phase2-notes-contacts] patient_notes missing columns: ${missingNote.join(", ")}`);
    process.exit(1);
  }
  console.log("[probe:phase2-notes-contacts] patient_notes shape OK ✓");

  // contacts columns.
  const contacts = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'contacts'`,
  );
  const contactCols = new Set(contacts.rows.map((r) => r.column_name));
  const REQUIRED_CONTACT_COLS = [
    "id", "category", "name", "role", "organization", "facility_id",
    "phone", "email", "notes", "user_id", "is_on_call", "metadata",
    "archived_at", "created_at", "updated_at",
  ];
  const missingContact = REQUIRED_CONTACT_COLS.filter((c) => !contactCols.has(c));
  if (missingContact.length > 0) {
    console.error(`[probe:phase2-notes-contacts] contacts missing columns: ${missingContact.join(", ")}`);
    process.exit(1);
  }
  console.log("[probe:phase2-notes-contacts] contacts shape OK ✓");
}

main().catch((err) => {
  console.error("[probe:phase2-notes-contacts] failed:", err);
  process.exit(1);
});
