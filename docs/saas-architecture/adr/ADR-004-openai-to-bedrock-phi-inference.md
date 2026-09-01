# ADR-004: Migrate Clinical AI Inference from OpenAI to Amazon Bedrock

**Date:** 2026-08-25
**Status:** Proposed
**Deciders:** Platform owner (approval pending), Architecture review (Kiro-assisted)
**Parent:** [High-Level Design](../high-level-design.md) §2, §6

## Context

Plexus Ancillary uses a large language model for screening reasoning, note
generation, and scheduler assistance. Today this calls **OpenAI** directly
(`server/services/aiClient.ts`), sending clinical data (PHI) to an external
provider over the public internet.

Relevant facts established with the owner:

- The organization is **HIPAA-certified** and has an **AWS BAA in place**.
- A **licensed clinician reviews and approves every AI recommendation** before it
  drives action, which is expected to keep the product within FDA's **CDS
  exemption** (not SaMD) — pending regulatory confirmation.
- There is **no Google integration**; OpenAI is the only external AI processor.

The compliance concern (GAP-015): PHI is processed by an external provider whose
BAA/eligibility/retention/minimum-necessary posture is not evidenced in these
documents. The AWS BAA does **not** cover OpenAI.

The code is well-positioned for change: AI access is already behind a service
layer (`aiClient.ts` with `withRetry`, timeout, concurrency limiting, and
PHI-safe observability), so the provider can be swapped without a rewrite.

## Decision

**Migrate clinical AI inference from OpenAI to Amazon Bedrock**, using a
HIPAA-eligible foundation model, and process PHI through Bedrock under the
existing AWS BAA with a **dual-zone** architecture and full invocation logging.

### 1. Provider and model

- Use **Amazon Bedrock** (HIPAA-eligible; covered by the AWS BAA). This keeps PHI
  inference inside a BAA-covered boundary and removes the dependency on a separate
  OpenAI BAA.
- Target model: **Anthropic Claude** (closest fit to the current GPT-class
  clinical-reasoning usage). **Amazon Nova** is the lower-cost alternative to
  evaluate. Prompts are ported/validated per target model (Claude system-prompt
  structure differs from GPT).

### 2. Keep the service-layer abstraction

Introduce a Bedrock client behind the existing `aiClient` interface. Preserve the
current retry/timeout/concurrency and PHI-safe logging behavior. Run **both
providers behind a feature flag**, compare outputs on **synthetic data**, then cut
over. Retire OpenAI once Bedrock is validated.

### 3. Dual-zone PHI boundary

- The AI-invoking path may call Bedrock but must **not** hold direct access to the
  PHI datastore.
- A controlled gate fetches **minimum-necessary** patient fields, constructs the
  prompt, invokes Bedrock, parses the response, and writes results back to the
  PHI store.
- This limits blast radius: a compromised or prompt-injected AI path cannot
  directly exfiltrate the patient store.

### 4. Compliance controls

- **Enable Bedrock model invocation logging** to encrypted S3 (KMS), retained per
  HIPAA (6+ years). Invocation logs contain prompts → they are themselves PHI and
  must be access-restricted to audit/compliance roles.
- **Use VPC endpoints** for Bedrock so inference traffic stays off the public
  internet.
- **AI inference audit trail:** log per-inference metadata — tenant, user, patient
  record id, model id/version, prompt/response hashes, guardrails applied,
  approval status, reviewer, review outcome.
- **Human-in-the-loop stays enforced in software** (see ADR referenced from HLD
  §6): AI output is a draft (`adminApprovalStatus` in `screening.ts`), never
  auto-committed. This is the control that preserves the CDS exemption.

## Rationale

- Bedrock under the existing AWS BAA is the cleanest closure of GAP-015: PHI
  inference moves inside a boundary the organization already has a BAA for,
  instead of depending on a separate OpenAI agreement.
- PHI stays within AWS (VPC endpoints); invocation logging gives the AI audit
  trail HIPAA and future SOC 2/HITRUST expect.
- The dual-zone pattern is the AWS-recommended architecture for AI on PHI and
  materially reduces exfiltration risk.
- The existing `aiClient` abstraction makes this low-risk and reversible.

## Alternatives Considered

### Option A: Stay on OpenAI, sign an OpenAI BAA
- **Pros:** No model migration; keep current prompts.
- **Cons:** PHI still leaves AWS to a third party; second BAA to maintain; less
  clean audit story; VPC-private inference not available.
- **Why rejected as the target:** Bedrock-under-AWS-BAA is a stronger compliance
  posture. (A signed OpenAI BAA + minimum-necessary payload remains the required
  **interim** control until the Bedrock cutover completes.)

### Option B: Self-host an open-weight model (e.g., on EKS/EC2)
- **Pros:** Full control; no per-token provider cost.
- **Cons:** You own all compliance controls, scaling, patching, and model ops;
  significant undifferentiated heavy lifting for a small team.
- **Why rejected:** Operational burden not justified at this stage.

### Option C: Amazon Connect Health / managed clinical AI
- **Pros:** Purpose-built, fast to adopt for standard documentation/coding.
- **Cons:** Less customizable than a Bedrock pipeline; fit for the specific
  ancillary-qualification workflow is unproven.
- **Why rejected for now:** The custom Bedrock pipeline gives the control this
  workflow needs; Connect Health can be revisited for documentation/coding later.

## Consequences

### Positive
- PHI inference under the existing AWS BAA; GAP-015 closed cleanly.
- PHI-private inference (VPC endpoints); native invocation logging.
- Reduced exfiltration risk via dual-zone.
- Reversible, low-risk migration behind the existing abstraction.

### Negative (accepted trade-offs)
- Prompt engineering effort to port/validate for the target model.
- Output-parity validation required (compare on synthetic data before cutover).
- New AWS components to operate (Bedrock, VPC endpoints, invocation-log bucket).

### Risks
- **Behavioral difference between GPT and the target model.** Mitigation:
  parallel run behind a flag; compare on synthetic clinical cases; keep OpenAI
  until parity is accepted.
- **Invocation logs are PHI.** Mitigation: encrypt, restrict to audit roles,
  retain per policy, never expose in ordinary logs.
- **Interim window.** Until cutover, OpenAI still receives PHI. Mitigation:
  interim signed OpenAI BAA + minimum-necessary payload; prioritize the migration.

## References
- Code: `server/services/aiClient.ts`, `server/services/screening.ts`,
  `server/lib/aiObservability.ts`, `shared/schema/screening.ts`
- AWS: [HIPAA Compliance for Generative AI Solutions on AWS](https://aws.amazon.com/blogs/industries/hipaa-compliance-for-generative-ai-solutions-on-aws/)
- Power steering: `genai-and-phi.md`, `phi-data-handling.md`
- Gap register: `docs/GAP_ANALYSIS.md` (GAP-015, GAP-016, GAP-017)

## Related Artifacts
- [High-Level Design](../high-level-design.md) — §2 (external systems), §6 (clinical AI governance)
- [ADR-001](./ADR-001-multi-account-structure-and-promotion-pipeline.md) — accounts/networking the Bedrock endpoints live in
- PHI Data Flow Map (planned) — per-hop AI PHI flow
