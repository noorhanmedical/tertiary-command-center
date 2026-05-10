import { User } from "lucide-react";

// Patient silhouette icon — used in the navy patient banner / avatar slot in
// place of initials. Picks a stylized SVG silhouette by sex/gender, falling
// back to the generic lucide User icon when sex is missing or unknown.
//
// Gender is a free-text field on the screening row (M / F / Male / Female /
// male / female), so we normalize on the first lowercase letter.
export function PatientSilhouette({
  gender,
  className,
}: {
  gender?: string | null;
  className?: string;
}) {
  const g = (gender ?? "").trim().toLowerCase();
  const isMale = g.startsWith("m");
  const isFemale = g.startsWith("f");

  if (isMale) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        className={className}
        aria-hidden="true"
        data-testid="silhouette-male"
      >
        <circle cx="12" cy="8" r="3.75" />
        <path d="M3.5 19.5C3.5 15.91 6.41 13 10 13h4c3.59 0 6.5 2.91 6.5 6.5V21h-17v-1.5z" />
      </svg>
    );
  }

  if (isFemale) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        className={className}
        aria-hidden="true"
        data-testid="silhouette-female"
      >
        <path d="M7.5 8.5a4.5 4.5 0 1 1 9 0v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-3z" />
        <path d="M6.5 19.5C6.5 16.46 8.96 14 12 14s5.5 2.46 5.5 5.5V21h-11v-1.5z" />
      </svg>
    );
  }

  return (
    <User
      className={className}
      aria-hidden="true"
      data-testid="silhouette-unknown"
    />
  );
}
