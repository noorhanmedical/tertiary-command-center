// PatientAvatar — a symbolic, non-photographic patient avatar.
//
// Renders a refined generic silhouette by presented sex/gender (male / female /
// neutral fallback). This is SYMBOLIC ONLY — it never attempts to depict the
// real person and falls back to neutral whenever sex is unknown / nonbinary /
// unmapped. No initials, no photos.

type Sex = "male" | "female" | "neutral";

function normalizeSex(gender?: string | null): Sex {
  const g = (gender ?? "").trim().toLowerCase();
  if (["m", "male", "man"].includes(g)) return "male";
  if (["f", "female", "woman"].includes(g)) return "female";
  return "neutral";
}

export function PatientAvatar({
  gender,
  size = 44,
  className = "",
  testId,
}: {
  gender?: string | null;
  size?: number;
  className?: string;
  testId?: string;
}) {
  const sex = normalizeSex(gender);
  // Restrained winter tones per variant (background ring + silhouette fill).
  const theme =
    sex === "male"
      ? { bg: "#DCE6F5", fg: "#42618F" }
      : sex === "female"
        ? { bg: "#EAE3F5", fg: "#7564A6" }
        : { bg: "#E2E8F0", fg: "#64748B" };

  return (
    <span
      className={`inline-flex items-center justify-center rounded-full shrink-0 overflow-hidden ${className}`}
      style={{ width: size, height: size, background: theme.bg }}
      data-testid={testId}
      data-sex={sex}
      aria-hidden
    >
      <svg viewBox="0 0 44 44" width={size} height={size} role="img">
        {/* Head */}
        <circle cx="22" cy="16" r="8" fill={theme.fg} />
        {/* Shoulders — female variant slightly narrower/rounded to read distinct */}
        {sex === "female" ? (
          <path d="M8 44c0-8.2 6.3-14 14-14s14 5.8 14 14z" fill={theme.fg} />
        ) : (
          <path d="M7 44c0-8.8 6.7-15 15-15s15 6.2 15 15z" fill={theme.fg} />
        )}
      </svg>
    </span>
  );
}
