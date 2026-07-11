#!/usr/bin/env node
// Smoke — Phase 3 PR 3.7.

import { readFileSync } from "node:fs";
import path from "node:path";
const root = path.resolve(process.cwd());
const read = (p) => readFileSync(path.join(root, p), "utf8");
const failures = [];
const fail = (m) => failures.push(m);

const app = read("server/routes.ts");
if (!/registerCallPriorityRoutes\(app\)/.test(app)) fail("routes.ts must register callPriority routes");
if (!/from "\.\/routes\/callPriority"/.test(app)) fail("routes.ts must import callPriority");

const client = read("client/src/App.tsx");
if (!/CallPriorityPage/.test(client)) fail("App.tsx must mount CallPriorityPage");
if (!/\/call-priority/.test(client)) fail("App.tsx must route /call-priority");

const api = read("client/src/lib/callPriorityApi.ts");
if (!/fetchCallPriority\(/.test(api)) fail("client API must export fetchCallPriority");

if (failures.length) {
  console.error("[smoke-phase-3-call-priority-intelligence] FAIL");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("[smoke-phase-3-call-priority-intelligence] PASS");
