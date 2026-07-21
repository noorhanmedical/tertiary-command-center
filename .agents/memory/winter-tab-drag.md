---
name: Winter desktop tab drag interactions
description: Banner tab reorder/split drag rules and the iframe-reload trap on /winter-home
---
- Rule: tab-strip reorder must not change the render order of the pane layer. Panes render sorted by stable id.
- **Why:** reordering the pane array moves iframe DOM nodes, which forces the embedded apps to fully reload mid-drag — the page freezes and drags time out.
- **How to apply:** any drag/reorder UI that hosts iframes must keep iframe-bearing nodes in a stable render order (or position via CSS), never reorder the array they're keyed from.
- Also: never put side effects (other setState calls) inside a setState updater for pointer-release handlers; compute from current state in the handler body instead.
- e2e drags with pointer capture: instruct the tester to do FAST gestures (few mouse.move steps, no mid-drag screenshots) — long-held drags kill the Playwright notebook.
