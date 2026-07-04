---
name: Mockup sandbox + canvas iframe gotchas
description: Recovering the mockup-sandbox preview artifact and reliably placing/presenting live iframes on the canvas
---

# applyCanvasActions / presentArtifact payload quirks

`applyCanvasActions` `create-auto` uses key `shape` (+ `shapeIds`/`names`). But `update` actions use a
different shape: `{ type:"update", shapeId, updates:{ shapeType:"iframe", state, url, componentPath, name } }`
— NOT `shape`, and `shapeType` inside `updates` is MANDATORY (two separate errors nudge you there).

`presentArtifact` REQUIRES an `artifactId` and only works for real registered artifacts. Mockup preview
iframes are not artifacts, so it errors. Fallback: `focusCanvasShapes({ shapeIds, animateMs:500 })`.

# Mockup sandbox preview server

The `artifacts/mockup-sandbox` artifact serves component previews behind the public
edge proxy at path `/__mockup/`. Live preview URL shape:
`https://<REPLIT_DOMAINS>/__mockup/preview/{ComponentName}` (no port suffix — the edge
proxy maps `/__mockup/` to the artifact's `localPort`). Components live in
`src/components/mockups/`; files in that root use the bare component name in the URL.

**If previews 404 / the artifact isn't registered:** the artifact.toml `localPort` must
match the port the dev server actually listens on, and a workflow must run the server on
that port. Recovery that worked:
1. Register/repair the toml with `verifyAndReplaceArtifactToml({tempFilePath, artifactTomlPath})` using ABSOLUTE paths.
2. Align `localPort` in `.replit-artifact/artifact.toml` with the workflow's `PORT` (we used 8000), re-run verifyAndReplace.
3. Create the workflow via `configureWorkflow` (cmd `cd artifacts/mockup-sandbox && npm install && PORT=8000 BASE_PATH=/__mockup/ NODE_ENV=development npm run dev`, port 8000, outputType console, isCanvasWorkflow true).

**Why:** the edge proxy only routes to the port declared in the toml; a mismatch yields a
blank/404 iframe even though vite is up.

**Other traps:**
- The bash tool blocks `npm install` / `npm run dev` — install deps only via the workflow command or the packager.
- A corrupt `node_modules/lucide-react` ("Failed to resolve entry") is fixed by `rm -rf node_modules/lucide-react node_modules/.vite` then restarting the workflow (npm install refetches it).
- The external-URL screenshot tool caches by URL — append `?cb=N` to force a fresh capture. A blank first capture is usually just SPA hydration timing, not a real failure.

# Canvas iframe lifecycle

- Create placeholders with `state: "building"` (URL optional), flip to `state: "live"` (URL required) once the preview is up.
- `applyCanvasActions` **update** actions need an `updates` object, and `shapeType` must
  appear BOTH at the action level AND inside `updates` (e.g. `{type:"update", shapeId, shapeType:"iframe", updates:{shapeType:"iframe", url, state, componentName, componentPath}}`). Omitting either raises a validation error.

# Presenting canvas work

`presentArtifact({artifactId, shapeIds})` can fail with `Available artifacts: []` even
with a correct-looking artifactId (the artifact registry this callback reads was empty in
practice). When it does, fall back to `focusCanvasShapes({shapeIds, animateMs:500})` to
pan/zoom the user to the shapes — that reliably navigates them to your work.
**Why:** the user otherwise can't find off-screen shapes you just placed.
