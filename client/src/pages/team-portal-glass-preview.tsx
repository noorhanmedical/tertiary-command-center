// PREVIEW ONLY — real Team Portal with iOS "winter frost" glass + no SketchUI.
//
// Route: /team-portal-glass-preview   (preview, NOT a live portal route)
//
// What this route shows, WITHOUT changing anything live:
//   1. iOS-styled frosted glass, WINTER THEME (icy blues/whites) on the left +
//      right rails — scoped under `.rail-glass-preview .rail-glass-winter`
//      (see index.css). The live rails keep their normal glass.
//   2. The Playground rendered WITHOUT the SketchUI look. <SketchDisabledForPreview>
//      forces PlaygroundSketchProvider to `enabled=false`, so every shared
//      component (buttons, surfaces, chart sections) renders its normal glass
//      variant instead of the hand-drawn / Rough.js canvas one. Production is
//      untouched (the shell never renders that provider).
//   3. TestGuy Robot (screening id 3, Taylor Family Practice) present in the
//      right-rail Call List AND the Ancillary Schedule. A preview-only fetch
//      interceptor appends a well-formed TestGuy row to the REAL responses for
//      the two feed endpoints — no backend/DB writes. His name-click still
//      routes through the real /api/patients/database/resolve/3 path, so his
//      full, real Plexus EHR opens in the Playground.
//
// The interceptor is installed on mount and fully restored on unmount, so it
// only ever affects this preview route. Nothing here is committed to the live
// portals.

import { useEffect, useState } from "react";
import ClinicWorkflowPortal from "@/components/workflow/ClinicWorkflowPortal";
import { queryClient } from "@/lib/queryClient";

// TestGuy Robot — the richly-seeded EHR fixture (id 3, Taylor Family Practice).
const TESTGUY_SCREENING_ID = 3;
const TESTGUY_NAME = "testguy robot";
const TESTGUY_DOB = "1966-03-15";
const TESTGUY_FACILITY = "Taylor Family Practice";

// A call-list row shaped like /api/scheduler-portal/cases output. Stable id
// prefix so we can dedupe and never double-insert.
function testGuyCallRow() {
  const nowIso = new Date().toISOString();
  return {
    id: `preview-testguy-${TESTGUY_SCREENING_ID}`,
    patientName: TESTGUY_NAME,
    patientDob: TESTGUY_DOB,
    facilityId: TESTGUY_FACILITY,
    nextActionAt: nowIso,
    assignedTeamMemberId: null,
    assignedRole: null,
    engagementStatus: "scheduled",
    lifecycleStatus: "ready",
    qualificationStatus: "qualified",
    patientScreeningId: TESTGUY_SCREENING_ID,
    executionCaseId: null,
    selectedServices: ["BrainWave"],
    engagementBucket: "outreach",
  };
}

// An ancillary-schedule row shaped like /api/technician-liaison/ancillary-schedule.
function testGuyAncillaryRow() {
  const day = new Date();
  const startsAt = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    10,
    0,
    0,
  ).toISOString();
  const endsAt = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    10,
    30,
    0,
  ).toISOString();
  return {
    id: `preview-testguy-anc-${TESTGUY_SCREENING_ID}`,
    patientName: TESTGUY_NAME,
    patientDob: TESTGUY_DOB,
    facilityId: TESTGUY_FACILITY,
    startsAt,
    endsAt,
    serviceType: "BrainWave",
    status: "scheduled",
    assignedUserId: null,
    patientScreeningId: TESTGUY_SCREENING_ID,
    executionCaseId: null,
    readiness: null,
  };
}

// Endpoints whose JSON array responses get a guaranteed TestGuy row.
function matchesCallList(url: string) {
  return url.includes("/api/scheduler-portal/cases");
}
function matchesAncillary(url: string) {
  return url.includes("/api/technician-liaison/ancillary-schedule");
}

function urlFromInput(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input instanceof Request) return input.url;
  return String(input);
}

// Ensures a TestGuy row is present in an array response (prepended if missing).
function ensureTestGuy(rows: unknown, row: Record<string, unknown>): unknown {
  if (!Array.isArray(rows)) return rows;
  const already = rows.some(
    (r) =>
      r &&
      typeof r === "object" &&
      (r as { patientScreeningId?: number }).patientScreeningId ===
        TESTGUY_SCREENING_ID,
  );
  if (already) return rows;
  return [row, ...rows];
}

// A marker so we NEVER double-wrap window.fetch (which caused infinite
// recursion / a hung page across Vite HMR reloads).
const TESTGUY_WRAP_FLAG = "__testguyPreviewWrapped__";

type TaggedFetch = typeof window.fetch & {
  [TESTGUY_WRAP_FLAG]?: boolean;
  __testguyOriginal__?: typeof window.fetch;
};

function installTestGuyFetch() {
  const current = window.fetch as TaggedFetch;
  if (current[TESTGUY_WRAP_FLAG]) return; // already wrapped — do not nest

  const originalFetch = current.bind(window);

  const wrapped = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const res = await originalFetch(input, init);
    const url = urlFromInput(input);

    const isCall = matchesCallList(url);
    const isAnc = matchesAncillary(url);
    if ((!isCall && !isAnc) || !res.ok) return res;

    try {
      const clone = res.clone();
      const data = await clone.json();
      if (!Array.isArray(data)) return res;
      const merged = ensureTestGuy(
        data,
        isCall ? testGuyCallRow() : testGuyAncillaryRow(),
      );
      // CLEAN headers only — reusing res.headers can carry a stale
      // content-encoding/content-length that breaks decoding (blank screen).
      return new Response(JSON.stringify(merged), {
        status: 200,
        statusText: "OK",
        headers: { "Content-Type": "application/json" },
      });
    } catch {
      return res;
    }
  }) as TaggedFetch;

  wrapped[TESTGUY_WRAP_FLAG] = true;
  wrapped.__testguyOriginal__ = originalFetch;
  window.fetch = wrapped;
}

function uninstallTestGuyFetch() {
  const current = window.fetch as TaggedFetch;
  if (current[TESTGUY_WRAP_FLAG] && current.__testguyOriginal__) {
    window.fetch = current.__testguyOriginal__;
  }
}

/**
 * PREVIEW-ONLY fetch interceptor. Installs on mount (idempotent, never
 * double-wraps) and uninstalls on unmount. On mount it also invalidates the two
 * right-rail feed queries so they refetch through the wrapped fetch and pick up
 * TestGuy even if they loaded a moment earlier.
 */
function useTestGuyFeedInterceptor() {
  useEffect(() => {
    installTestGuyFetch();
    queryClient.invalidateQueries({ queryKey: ["team-workspace-call-list"] });
    queryClient.invalidateQueries({
      queryKey: ["team-workspace-ancillary-schedule"],
    });
    return () => uninstallTestGuyFetch();
  }, []);
}

export default function TeamPortalGlassPreviewPage() {
  const [role, setRole] = useState<
    "patientCareSpecialist" | "ancillaryCareSpecialist"
  >("patientCareSpecialist");

  useTestGuyFeedInterceptor();

  return (
    <div className="rail-glass-preview rail-glass-winter relative h-full w-full">
      {/* Preview banner + PCS/ACS toggle (floats above the portal; does not
          alter the portal layout). */}
      <div className="pointer-events-none absolute left-1/2 top-2 z-[100] -translate-x-1/2">
        <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-indigo-200/70 bg-white/70 px-3 py-1.5 shadow-lg backdrop-blur-md">
          <span className="text-[11px] font-semibold text-indigo-700">
            Purple-blue glass rails — PREVIEW (live portal unchanged, no SketchUI)
          </span>
          <div className="inline-flex overflow-hidden rounded-full border border-indigo-300/70">
            <button
              type="button"
              onClick={() => setRole("patientCareSpecialist")}
              className={`px-3 py-1 text-[11px] font-semibold ${
                role === "patientCareSpecialist"
                  ? "bg-indigo-600 text-white"
                  : "bg-white/60 text-indigo-700"
              }`}
              data-testid="glass-preview-toggle-pcs"
            >
              PCS
            </button>
            <button
              type="button"
              onClick={() => setRole("ancillaryCareSpecialist")}
              className={`px-3 py-1 text-[11px] font-semibold ${
                role === "ancillaryCareSpecialist"
                  ? "bg-indigo-600 text-white"
                  : "bg-white/60 text-indigo-700"
              }`}
              data-testid="glass-preview-toggle-acs"
            >
              ACS
            </button>
          </div>
        </div>
      </div>

      {/* The REAL portal shell — rendered EXACTLY as live (header + playground
          untouched). Only the rails are restyled via the .rail-glass-preview
          scope in index.css. `key` remounts cleanly on PCS/ACS toggle. */}
      <ClinicWorkflowPortal key={role} role={role} />
    </div>
  );
}
