-- marketing_materials table — admin-curated brochures/sheets/templates
-- shown on the Communication Hub's Materials tab. File bytes live on the
-- configured object store (local FS in dev, S3 in prod).
CREATE TABLE IF NOT EXISTS marketing_materials (
  id serial PRIMARY KEY,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  filename text NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL,
  storage_path text NOT NULL,
  sha256 text NOT NULL,
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_marketing_materials_created_at
  ON marketing_materials (created_at);
CREATE INDEX IF NOT EXISTS idx_marketing_materials_sha256
  ON marketing_materials (sha256);
