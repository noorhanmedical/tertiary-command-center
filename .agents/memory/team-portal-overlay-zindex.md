---
name: Team Portal overlay z-index
description: Why floating UI (dropdowns, popovers, menus) opens behind the Team Portal and how to fix it.
---

# Team Portal overlay z-index

Any floating/portalled UI rendered inside the Team Member Portal (TeamPortalShell)
must use `z-[90]` or higher on its content layer.

**Why:** The portal renders as a full-screen overlay at `z-[80]`. Radix/shadcn
floating layers default lower — `SelectContent`/`PopoverContent`/`DropdownMenuContent`
are `z-50` — so without an override they open *behind* the overlay and appear
invisible/unclickable. This bit the "Viewing as" + "Clinic" selects and the
call-row phone/calendar popovers.

**How to apply:** When adding any Select/Popover/Dropdown/Dialog-like floating
element inside the portal, set `className="z-[90]"` (or higher) on the
`*Content` element. Verify by opening it over the overlay, not just in isolation.
