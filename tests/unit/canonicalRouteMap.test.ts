// Canonical route map — static regression test.
//
// Locks the canonical route mounts + redirects that the source
// branch (origin/plexus-iq-admin-review-persistence-fix) established.
// Any drift from this map on the target branch fails the test.
//
// Runnable via:
//   npx tsx tests/unit/canonicalRouteMap.test.ts
// Exit 0 = pass; exit 1 = fail.

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const appTsx = fs.readFileSync(
  path.join(root, "client/src/App.tsx"),
  "utf8",
);

const failures: string[] = [];

// A canonical route rule expresses a per-path expectation:
//   - `component` = the exact component name that must render for that route
//   - `redirect`  = the exact redirect target if the route is a redirect
//   - `mustNotContain` = tokens that must NOT appear inside the route block
type Rule = {
  path: string;
  component?: string;
  redirect?: string;
  mustNotContain?: string[];
};

const CANONICAL_ROUTES: Rule[] = [
  // Home + preview
  { path: "/home", component: "Home" },
  { path: "/home-preview", component: "HomePreview" },

  // Team portal landing + PCS/ACS canonical mounts.
  { path: "/team-member-portals", component: "TeamMemberPortalsPage" },
  {
    path: "/patient-care-specialist-portal",
    component: "PatientCareSpecialistPortalPage",
  },
  {
    path: "/ancillary-care-specialist-portal",
    component: "AncillaryCareSpecialistPortalPage",
  },

  // Physician + clinician portal — source uses clinician-portal as canonical,
  // physician-portal redirects to it.
  { path: "/clinician-portal", component: "PhysicianPortalPage" },
  { path: "/physician-portal", redirect: "/clinician-portal" },

  // Executive / operational surfaces.
  { path: "/mission-control", component: "MissionControlPage" },
  { path: "/engagement-center", component: "EngagementCenterPage" },
  { path: "/team-ops", component: "TeamOpsPage" },
  { path: "/plexus-tasks", component: "PlexusTasksPage" },
  { path: "/plexus-iq", component: "PlexusIQPage" },
  { path: "/plexus-bank", component: "PlexusBankPage" },
  { path: "/imaging-central", component: "ImagingCentralPage" },
  {
    path: "/technician-central",
    redirect: "/imaging-central",
  },
  {
    path: "/ultrasound-central",
    redirect: "/imaging-central",
  },
  { path: "/clinic-analytics", component: "ClinicAnalyticsPage" },
  { path: "/clinic-onboarding", component: "ClinicOnboardingPage" },
  { path: "/analytics", component: "ClinicAnalyticsPage" },
  {
    path: "/clinical-intelligence",
    component: "ClinicalIntelligencePage",
  },

  // Unified admin settings hub + legacy redirects.
  { path: "/admin/settings", component: "AdminSettingsPage" },
  {
    path: "/admin",
    redirect: "/admin/settings?tab=system",
  },
  {
    path: "/admin/settings-center",
    redirect: "/admin/settings?tab=system",
  },
  {
    path: "/admin/billing-settings",
    redirect: "/admin/settings?tab=billing",
  },
  {
    path: "/admin/stovetop-heat-settings",
    redirect: "/admin/settings?tab=facility",
  },
  {
    path: "/call-list-audit",
    redirect: "/admin/settings?tab=logs&log=call-list-audit",
  },
  {
    path: "/billing/auditor",
    redirect: "/admin/settings?tab=logs&log=billing-auditor",
  },
  {
    path: "/billing/remittance",
    redirect: "/admin/settings?tab=logs&log=remittance",
  },
];

function findRouteBlock(pathValue: string): string | null {
  // Match either <Route path="X"> ... </Route> or <Route path="X" component=... />
  // Escape special regex chars in the path.
  const escaped = pathValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Handle self-closing components first: <Route path="X" component={Comp} />
  const selfClosing = new RegExp(
    `<Route\\s+path="${escaped}"\\s+component=\\{([A-Za-z0-9_]+)\\}\\s*/>`,
  );
  const scMatch = appTsx.match(selfClosing);
  if (scMatch) return scMatch[0];

  // Handle block-style: <Route path="X"> ... </Route>
  const openIdx = appTsx.search(
    new RegExp(`<Route\\s+path="${escaped}"\\s*>`),
  );
  if (openIdx === -1) return null;
  // Find the matching </Route> — nesting is not expected inside a single
  // route block in this file, but we still walk carefully.
  const rest = appTsx.slice(openIdx);
  const closeIdx = rest.indexOf("</Route>");
  if (closeIdx === -1) return null;
  return rest.slice(0, closeIdx + "</Route>".length);
}

for (const rule of CANONICAL_ROUTES) {
  const block = findRouteBlock(rule.path);
  if (!block) {
    failures.push(
      `Route "${rule.path}" is missing from client/src/App.tsx`,
    );
    continue;
  }

  if (rule.component) {
    // Self-closing style
    const selfClosingMatch = block.match(
      /<Route[^>]+component=\{([A-Za-z0-9_]+)\}/,
    );
    const inlineMatch = new RegExp(`<${rule.component}\\b`).test(block);
    const scMatchOk =
      selfClosingMatch && selfClosingMatch[1] === rule.component;
    if (!inlineMatch && !scMatchOk) {
      failures.push(
        `Route "${rule.path}" must render <${rule.component} .../>; got block:\n${block}`,
      );
    }
  }

  if (rule.redirect) {
    if (!new RegExp(`<Redirect\\s+to="${rule.redirect.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    )}"`).test(block)) {
      failures.push(
        `Route "${rule.path}" must redirect to "${rule.redirect}"; got block:\n${block}`,
      );
    }
  }

  if (rule.mustNotContain) {
    for (const tok of rule.mustNotContain) {
      if (block.includes(tok)) {
        failures.push(
          `Route "${rule.path}" must NOT contain "${tok}"; got block:\n${block}`,
        );
      }
    }
  }
}

// V2 leftovers: no live route should reintroduce the V2 preview pages
// that were retired once the canonical routes rendered the real shell.
const forbiddenV2Imports = [
  "@/pages/team-portal-v2",
  "@/pages/home-v2",
  "@/pages/physician-portal-v2",
];
for (const spec of forbiddenV2Imports) {
  if (appTsx.includes(spec)) {
    failures.push(
      `client/src/App.tsx must not import ${spec}; V2 preview routes were superseded by canonical routes.`,
    );
  }
}

if (failures.length > 0) {
  console.error("canonicalRouteMap.test.ts: FAILURES:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("canonicalRouteMap.test.ts: all tests passed");
