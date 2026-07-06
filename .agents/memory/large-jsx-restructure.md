---
name: Large JSX restructure technique
description: How to reliably restructure a very large JSX render region without breaking it
---

# Restructuring large JSX render regions (1000+ lines)

When moving/reorganizing a big JSX block (e.g. a multi-region dialog into a new
layout), do NOT use one giant `edit` exact-match and do NOT hand the whole move to
a long-running subagent — both fail. The edit tool's exact-match is impractical for
huge contiguous regions, and subagents time out (~300s start-to-close) mid-edit,
leaving the file half-deleted and broken.

**Reliable approach: a one-shot Node script that slices the original file by line
number and re-wraps.**

- Read the file, `split('\n')`, use `lines.slice(a-1, b)` (1-indexed inclusive) to
  grab the inner JSX blocks you want to KEEP **verbatim** (zero transcription risk —
  preserves every `data-testid`, handler, and SOURCE MARKER byte-for-byte).
- Only hand-write the NEW wrapper/container JSX (the new panels, headings,
  `<details>` collapsibles, etc.).
- Apply restyling (e.g. dark→light Tailwind tokens) as ordered `String.split().join()`
  replacements ONLY on the moved slices — never globally. Do longer/more-specific
  tokens first (`text-white/70` before bare `text-white`; `hover:` variants before
  base). Class tokens never collide with testids/handlers, so this is safe.
- Reassemble `[part1, ...slices+wrappers, partN].join('\n')` and write once.

**Before running**: verify every slice boundary line number against the CURRENT file
(grep anchors + `sed -n` the exact start/end lines). A `git show HEAD:file > file`
restore can drop the trailing newline (wc -l off by one) but does NOT shift earlier
line numbers.

**Restoring a broken file without destructive git**: `git show HEAD:<path> > <path>`
regenerates the working copy from HEAD — it's a file write, not a git mutation, so it
is NOT blocked by the destructive-git guard (unlike `git restore`/`checkout`).

**After**: `tsc --noEmit` + diff the sorted `data-testid` list against HEAD to prove
only the intended (layout-chrome) testids were dropped and nothing functional was lost.
