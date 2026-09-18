import { useEffect, useState } from "react";
import { useLocation } from "wouter";

/**
 * PageContextIndicator — the active workspace/page label that sits next to the
 * "Plexus OS" brand in the dark top banner, rendered as:
 *
 *     Plexus OS  ×  Plexus Bank
 *
 * The "× Page" is the active-context indicator: a soft mint-green tint, a gentle
 * illuminate-on-load, a slight angled (inclined) underline accent, and a very
 * slow, low-amplitude "breathing" glow so it feels alive without being flashy.
 * Restrained / iOS-like; honors prefers-reduced-motion.
 *
 * This is the single source of truth for the active-page label so the treatment
 * can be rolled out consistently. Routes not in the map render nothing (the
 * brand stays alone), so there is no regression on unmapped pages.
 */

// Route → page label. Longest-prefix match wins so nested routes resolve to
// their parent workspace label. Add entries here to extend coverage.
// `/home` (and `/`) intentionally have NO entry — the brand stands alone on
// the root so the indicator only appears once you're inside a workspace.
const ROUTE_LABELS: { prefix: string; label: string }[] = [
  // Pilots
  { prefix: "/patient-directory", label: "Plexus EHR" },
  { prefix: "/plexus-iq", label: "Plexus IQ" },
  { prefix: "/plexus-bank", label: "Plexus Bank" },
  // Clinical / scheduling
  { prefix: "/ancillary-documents", label: "Ancillary Documents" },
  { prefix: "/document-library", label: "Document Library" },
  { prefix: "/document-upload", label: "Document Upload" },
  { prefix: "/schedule", label: "Global Schedule" },
  { prefix: "/dashboard", label: "Schedule Dashboard" },
  { prefix: "/appointments", label: "Appointments" },
  { prefix: "/imaging-central", label: "Imaging Central" },
  { prefix: "/clinic-analytics", label: "Clinic Analytics" },
  { prefix: "/analytics", label: "Clinic Analytics" },
  { prefix: "/clinic-onboarding", label: "Clinic Onboarding" },
  { prefix: "/clinical-intelligence", label: "Clinical Intelligence" },
  // Qualification / engagement
  { prefix: "/patient-intake", label: "Qualification" },
  { prefix: "/qualification", label: "Qualification" },
  { prefix: "/outreach-patients", label: "Outreach" },
  { prefix: "/engagement-center", label: "Engagement" },
  // Billing / finance
  { prefix: "/billing", label: "Billing" },
  { prefix: "/invoices", label: "Invoices" },
  // Ops / team / admin
  { prefix: "/team-ops", label: "Team Ops" },
  { prefix: "/team-member-portals", label: "Team Portals" },
  { prefix: "/plexus-tasks", label: "Plexus Tasks" },
  { prefix: "/clinician-portal", label: "Clinician Portal" },
  { prefix: "/admin/access", label: "Access Management" },
  { prefix: "/admin", label: "Admin" },
];

function resolveLabel(location: string): string | null {
  let best: { prefix: string; label: string } | null = null;
  for (const entry of ROUTE_LABELS) {
    if (location === entry.prefix || location.startsWith(entry.prefix + "/")) {
      if (!best || entry.prefix.length > best.prefix.length) best = entry;
    }
  }
  return best?.label ?? null;
}

/** Fade-out / fade-in duration (ms). Kept in sync with the CSS transition. */
const FADE_MS = 220;

export function PageContextIndicator() {
  const [location] = useLocation();
  const target = resolveLabel(location);

  // `label` is the value currently rendered; `visible` drives the crossfade.
  // On every route change we fade the current label out, swap the text while
  // it is invisible, then fade the new one in — so switching pages always
  // animates, even to a page that was already open (the transition is driven
  // by the route change, not by mount).
  const [label, setLabel] = useState<string | null>(target);
  const [visible, setVisible] = useState(false);

  // Fade in whenever a (non-null) label becomes the rendered one.
  useEffect(() => {
    if (label == null) return;
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, [label]);

  // React to route/target changes: fade out, then swap the rendered label.
  useEffect(() => {
    if (target === label) return;
    setVisible(false);
    const t = setTimeout(() => setLabel(target), FADE_MS);
    return () => clearTimeout(t);
  }, [target, label]);

  if (label == null) return null;

  return (
    <span
      className="pctx hidden sm:inline-flex items-center"
      data-testid="page-context-indicator"
      data-visible={visible ? "true" : "false"}
      aria-label={`Current page: ${label}`}
    >
      <style>{`
        .pctx { margin-left: 16px; gap: 12px; }
        .pctx-sep {
          font-size: 20px; font-weight: 200; line-height: 1;
          color: rgba(255,255,255,0.28);
          transform: translateY(-1px);
        }
        .pctx-label {
          position: relative;
          font-size: 22px; font-weight: 300; letter-spacing: -0.01em; line-height: 1.2;
          color: #bff0d6;
          text-shadow: 0 0 10px rgba(120, 220, 170, 0.30);
          white-space: nowrap;
          /* Crossfade: hidden by default; the wrapper's data-visible flips it. */
          opacity: 0;
          transform: translateX(5px);
          transition:
            opacity 220ms cubic-bezier(0.22, 1, 0.36, 1),
            transform 220ms cubic-bezier(0.22, 1, 0.36, 1),
            color 300ms ease,
            text-shadow 300ms ease;
        }
        .pctx[data-visible="true"] .pctx-label {
          opacity: 1;
          transform: translateX(0);
        }
        /* Slight angled (inclined) accent under the active page name. */
        .pctx-label::after {
          content: "";
          position: absolute;
          left: -2px; right: -2px; bottom: -7px;
          height: 2px;
          border-radius: 2px;
          background: linear-gradient(90deg,
            rgba(120,220,170,0) 0%,
            rgba(120,220,170,0.75) 42%,
            rgba(196,255,222,0.95) 100%);
          transform: skewX(-16deg) scaleX(1);
          transform-origin: left center;
          filter: drop-shadow(0 0 6px rgba(120,220,170,0.45));
          opacity: 0;
          animation:
            pctxUnderline 1400ms 220ms cubic-bezier(0.22, 1, 0.36, 1) forwards,
            pctxBreathe 6s 1700ms ease-in-out infinite;
        }
        .pctx:hover .pctx-label {
          color: #d6ffe8;
          text-shadow: 0 0 14px rgba(140, 235, 185, 0.45);
        }
        @keyframes pctxUnderline {
          0%   { opacity: 0; transform: skewX(-16deg) scaleX(0.55); }
          100% { opacity: 0.85; transform: skewX(-16deg) scaleX(1); }
        }
        /* Very slow, low-amplitude glow — "alive", not a pulse. */
        @keyframes pctxBreathe {
          0%, 100% { opacity: 0.7; }
          50%      { opacity: 0.95; }
        }
        @media (prefers-reduced-motion: reduce) {
          .pctx-label { transition: none; opacity: 1; transform: none; }
          .pctx-label::after { animation: none; opacity: 0.85; transform: skewX(-16deg) scaleX(1); }
        }
      `}</style>
      <span className="pctx-sep" aria-hidden>×</span>
      <span className="pctx-label">{label}</span>
    </span>
  );
}
