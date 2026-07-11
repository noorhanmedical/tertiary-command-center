#!/usr/bin/env node
// Smoke — Phase 3 PR 3.4. Static cross-file coherence.

import { readFileSync } from "node:fs";
import path from "node:path";
const root = path.resolve(process.cwd());
const read = (p) => readFileSync(path.join(root, p), "utf8");
const failures = [];
const fail = (m) => failures.push(m);

const idx = read("shared/schema/index.ts");
if (!/aiRecommendationLogs/.test(idx)) fail("shared/schema/index.ts must re-export aiRecommendationLogs");

const app = read("server/routes.ts");
if (!/registerAiRecommendationsRoutes\(app\)/.test(app)) fail("routes.ts must register registerAiRecommendationsRoutes");
if (!/from "\.\/routes\/aiRecommendations"/.test(app)) fail("routes.ts must import aiRecommendations");

const clientApp = read("client/src/App.tsx");
if (!/AiRecommendationsPage/.test(clientApp)) fail("App.tsx must mount AiRecommendationsPage");
if (!/\/admin\/ai-recommendations/.test(clientApp)) fail("App.tsx must route /admin/ai-recommendations");

if (failures.length) {
  console.error("[smoke-phase-3-ai-recommendation-log] FAIL");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("[smoke-phase-3-ai-recommendation-log] PASS");
