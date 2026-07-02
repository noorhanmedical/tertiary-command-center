---
name: Admin Review mobile rail layout
description: How the Admin Review dialog stays usable on phone viewports and how to e2e-test it despite auth gating.
---
**Rule:** In the Admin Review dialog's right rail, everything above the decision footer (Reference + AI clues + Changes) must live inside one `min-h-0 flex-1 overflow-y-auto` scroll zone; the footer sits outside it.
**Why:** shrink-0 blocks with unbounded content (esp. the AI clue bubbles list) push the Changes card and footer past the aside's `overflow-hidden` clip on short viewports — footer measured ~500px off-screen at 667px height. Below `md` the body must stack (`flex-col md:flex-row`) or the fixed 320px rail squeezes the left panel to a ~7px sliver and overflows horizontally.
**How to apply:** Keep new right-rail sections inside the scroll zone (`admin-review-rail-scroll-zone`), never as siblings of the footer. Testing the auth-gated dialog: insert a temp admin into `users` (bcryptjs hash into the `password` column — not `password_hash`), use batch "Taylor Family Practice - 2026-06-25" pending screenings, delete the user afterwards. Note: `admin-review-reference-buttons-group` testid wraps only the first button row, so gap measurements against it are misleading.
