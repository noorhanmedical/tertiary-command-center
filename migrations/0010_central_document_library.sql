-- Central Document Library (task #291)
--
-- A central library where any file can be uploaded once, tagged with a kind +
-- signature requirement, and assigned to one or more "surfaces" (places in
-- the platform where it should appear). Foundation for the upcoming
-- technician/liaison portal signature flow.

CREATE TABLE IF NOT EXISTS documents (
  id                          serial PRIMARY KEY,
  title                       text NOT NULL,
  description                 text NOT NULL DEFAULT '',
  kind                        text NOT NULL,
  signature_requirement       text NOT NULL DEFAULT 'none',
  filename                    text NOT NULL,
  content_type                text NOT NULL,
  size_bytes                  integer NOT NULL,
  version                     integer NOT NULL DEFAULT 1,
  -- The id of the doc that REPLACED this one. NULL means this row is current.
  superseded_by_document_id   integer,
  -- Patient-specific uploads (e.g. a completed signed consent for John Doe)
  -- are scoped to a patient screening — they only appear on that chart.
  patient_screening_id        integer REFERENCES patient_screenings(id) ON DELETE SET NULL,
  -- Optional facility scope for narrowing surfaces by clinic.
  facility                    text,
  -- Where this row came from (free-form, e.g. "uploaded_documents migration").
  source_notes                text,
  created_by_user_id          varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at                  timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Soft-delete: rows with deleted_at set are hidden from current/surface
  -- reads but remain in the table for audit history.
  deleted_at                  timestamp
);

CREATE INDEX IF NOT EXISTS idx_documents_kind                  ON documents(kind);
CREATE INDEX IF NOT EXISTS idx_documents_created_at            ON documents(created_at);
CREATE INDEX IF NOT EXISTS idx_documents_superseded            ON documents(superseded_by_document_id);
CREATE INDEX IF NOT EXISTS idx_documents_patient_screening_id  ON documents(patient_screening_id);
CREATE INDEX IF NOT EXISTS idx_documents_deleted_at            ON documents(deleted_at);

CREATE TABLE IF NOT EXISTS document_surface_assignments (
  id           serial PRIMARY KEY,
  document_id  integer NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  surface      text NOT NULL,
  created_at   timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_document_surface_assignments_doc_surface
  ON document_surface_assignments(document_id, surface);
CREATE INDEX IF NOT EXISTS idx_document_surface_assignments_surface
  ON document_surface_assignments(surface);
