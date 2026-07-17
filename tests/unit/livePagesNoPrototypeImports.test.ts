// Live pages must never import prototype / playground / preview components.
//
// Extends teamPortalCanonicalRouteParity.test.ts to cover EVERY live page.
// A live page is one referenced from a canonical <Route> in App.tsx that
// is NOT a preview / prototype route.
//
// Forbidden import name fragments (case-insensitive):
//   TeamMemberPortalPlayground
//   PlexusIQOperatingCanvasPrototype
//   HomeDashboardPreview       (only allowed inside /home-preview)
//   HomeLiveDashboardPreview   (only allowed inside /home-preview)
//
// Runnable via: npx tsx tests/unit/livePagesNoPrototypeImports.test.ts

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const APP_TSX = path.join(ROOT, "client/src/App.tsx");
const PAGES_DIR = path.join(ROOT, "client/src/pages");

const PREVIEW_OR_PROTOTYPE_ROUTES = new Set([
  "/home-preview",
  "/plexus-iq-prototype",
]);

const FORBIDDEN_FRAGMENTS = [
  "TeamMemberPortalPlayground",
  "PlexusIQOperatingCanvasPrototype",
  "HomeDashboardPreview",
  "HomeLiveDashboardPreview",
];

const failures: string[] = [];
const appSrc = fs.readFileSync(APP_TSX, "utf8");

// Extract Route paths → the imported component name from App.tsx.
// Match:
//   import ComponentName from "@/pages/foo"
//   import { ComponentA, ComponentB } from "@/pages/bar"
// And:
//   <Route path="/foo"> ... <ComponentA /> ... </Route>
//   <Route path="/foo" component={ComponentA} />
// (Comments removed for the naive regex pass.)

const stripped = appSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

// path → set of component names referenced inside the route block
const routeMap = new Map<string, Set<string>>();
const routeBlockRe = /<Route\s+path="([^"]+)"([^>]*)>([\s\S]*?)<\/Route>/g;
let m: RegExpExecArray | null;
while ((m = routeBlockRe.exec(stripped)) !== null) {
  const [, routePath, , body] = m;
  const names = new Set<string>();
  for (const c of body.matchAll(/<([A-Z][A-Za-z0-9]+)\b/g)) names.add(c[1]);
  routeMap.set(routePath, names);
}
// Self-closing / component-prop form: <Route path="/x" component={Foo} />
const selfClosingRe = /<Route\s+path="([^"]+)"[^>]*component=\{([A-Za-z0-9]+)\}[^>]*\/>/g;
while ((m = selfClosingRe.exec(stripped)) !== null) {
  const [, p, name] = m;
  routeMap.set(p, new Set([name]));
}

// Map: imported name → source module
const importRe = /import\s+([A-Za-z0-9]+|\{[^}]+\})\s+from\s+"([^"]+)"/g;
const importedNameToModule = new Map<string, string>();
while ((m = importRe.exec(stripped)) !== null) {
  const [, spec, mod] = m;
  if (spec.startsWith("{")) {
    for (const name of spec.replace(/[{}]/g, "").split(",")) {
      const n = name.trim().split(/\s+as\s+/i)[0];
      if (n) importedNameToModule.set(n, mod);
    }
  } else {
    importedNameToModule.set(spec, mod);
  }
}

function resolvePagePath(mod: string): string | null {
  if (!mod.startsWith("@/pages/")) return null;
  const rel = mod.replace(/^@\/pages\//, "client/src/pages/");
  for (const ext of [".tsx", ".ts", "/index.tsx", "/index.ts"]) {
    const abs = path.join(ROOT, rel + ext);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

// For every LIVE route, check the imported page's source for forbidden fragments.
for (const [routePath, names] of routeMap.entries()) {
  if (PREVIEW_OR_PROTOTYPE_ROUTES.has(routePath)) continue;
  for (const name of names) {
    const mod = importedNameToModule.get(name);
    if (!mod) continue;
    const abs = resolvePagePath(mod);
    if (!abs) continue;
    const src = fs.readFileSync(abs, "utf8");
    for (const frag of FORBIDDEN_FRAGMENTS) {
      const importFrag = new RegExp(String.raw`^\s*import[^\n]+\b${frag}\b`, "m");
      const jsxFrag = new RegExp(String.raw`<${frag}\b`);
      if (importFrag.test(src) || jsxFrag.test(src)) {
        failures.push(
          `Live route ${routePath} → ${path.relative(ROOT, abs)} imports/renders forbidden "${frag}". Preview/prototype/playground components must not appear on live routes.`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error("livePagesNoPrototypeImports.test.ts: FAILURES:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log(`livePagesNoPrototypeImports.test.ts: all live pages clean (checked ${routeMap.size} <Route> paths)`);
