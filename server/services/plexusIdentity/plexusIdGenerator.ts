/**
 * Plexus ID generator.
 *
 * Rules (Phase 2A audit §3.1):
 *   • Opaque + non-PHI.
 *   • Immutable after assignment.
 *   • Never derived from name / DOB / clinic / MRN / diagnosis / sex /
 *     insurance / any other patient attribute.
 *   • Never sequential in a way that leaks patient volume ordering.
 *   • Globally unique across all clinics.
 *   • `PLX-` prefix followed by an unambiguous ULID (Crockford Base32
 *     without I/L/O/U). Length = 4 + 26 = 30.
 *
 * The generator is a pure function of a crypto-random source. Uniqueness
 * against the database is enforced by the `global_plexus_patients.plexus_id`
 * UNIQUE constraint plus a bounded retry loop in the repository create
 * path (never in this generator).
 */

import { randomBytes } from "node:crypto";

const PLEXUS_ID_PREFIX = "PLX-";
const ULID_LENGTH = 26;

// Crockford Base32 (RFC-4648-style ULID): omits I / L / O / U to avoid
// visual ambiguity. 32 characters exactly.
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Reject anything that isn't a well-formed PLX-<26 char ULID>. */
export function isValidPlexusId(candidate: string): boolean {
  if (typeof candidate !== "string") return false;
  if (!candidate.startsWith(PLEXUS_ID_PREFIX)) return false;
  const body = candidate.slice(PLEXUS_ID_PREFIX.length);
  if (body.length !== ULID_LENGTH) return false;
  for (let i = 0; i < body.length; i++) {
    if (CROCKFORD_ALPHABET.indexOf(body[i]) === -1) return false;
  }
  return true;
}

/** Generate one Plexus ID. Guaranteed length + prefix; uniqueness is DB-enforced. */
export function generatePlexusId(): string {
  const bytes = randomBytes(ULID_LENGTH);
  const chars: string[] = new Array(ULID_LENGTH);
  for (let i = 0; i < ULID_LENGTH; i++) {
    chars[i] = CROCKFORD_ALPHABET[bytes[i] % 32];
  }
  return PLEXUS_ID_PREFIX + chars.join("");
}

/**
 * Helper for repositories: attempt up to `maxAttempts` times to
 * generate a Plexus ID that survives the DB unique-constraint check.
 * The caller supplies the DB check because we don't want this file to
 * depend on drizzle.
 */
export async function generateUniquePlexusId(
  isTaken: (id: string) => Promise<boolean>,
  maxAttempts = 8,
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const id = generatePlexusId();
    // eslint-disable-next-line no-await-in-loop
    if (!(await isTaken(id))) return id;
  }
  throw new Error(
    `generateUniquePlexusId: failed to allocate a unique Plexus ID after ${maxAttempts} attempts`,
  );
}
