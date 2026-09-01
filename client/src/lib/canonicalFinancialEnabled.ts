// Phase 2J — combined client gate for the canonical financial ledger surface.
// True when ANY of the three 2J flags is on. Default OFF ⇒ the Finance surface
// renders EXACTLY as Phase 2H left it and issues ZERO canonical-financial requests.
import { isCanonicalClaimsEnabled } from "@/lib/canonicalClaimsFlag";
import { isCanonicalInvoicesEnabled } from "@/lib/canonicalInvoicesFlag";
import { isCanonicalPaymentsEnabled } from "@/lib/canonicalPaymentsFlag";

export function isAnyCanonicalFinancialEnabled(): boolean {
  return isCanonicalClaimsEnabled() || isCanonicalInvoicesEnabled() || isCanonicalPaymentsEnabled();
}
