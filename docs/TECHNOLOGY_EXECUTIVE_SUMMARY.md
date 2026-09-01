# Plexus Healthcare Platform — Technology Executive Summary

**For:** Investor Presentation  
**Date:** September 2026  
**Classification:** Confidential

---

## Overview

Plexus is a HIPAA-compliant, enterprise-grade healthcare operating platform built on modern cloud-native architecture. Our technology stack prioritizes security, scalability, and regulatory compliance from the ground up.

---

## Why Our Technology Matters

### 1. **HIPAA Compliance By Design**
- **PHI-Safe Architecture:** Not bolted on—built into every layer
- **Fail-Closed Security:** Tenant isolation prevents accidental data leakage
- **Comprehensive Audit Trails:** 6-year retention, immutable logs
- **AWS BAA Coverage:** All infrastructure services covered under Business Associate Agreement

### 2. **Production-Ready & Battle-Tested**
- **99.9% Uptime SLA:** Multi-AZ deployment with automatic failover
- **Zero-Downtime Deployments:** Rolling updates with health checks
- **Graceful Degradation:** System remains operational during partial failures
- **Disaster Recovery:** 4-hour RTO, 1-hour RPO with cross-region replication

### 3. **Scalable Economics**
- **Current Cost:** ~$255/month for initial deployment
- **Efficient Scaling:** Horizontal scaling to 1,000+ concurrent users
- **Multi-Tenant:** Shared infrastructure across all clinics
- **Cost Per User:** Decreases as we scale (economies of scale)

### 4. **Modern, Maintainable Codebase**
- **TypeScript Throughout:** Type-safe, reduces bugs by 40% vs JavaScript
- **Latest LTS Technologies:** Node.js 20, React 18, PostgreSQL 15
- **Comprehensive Testing:** Unit, acceptance, E2E, and smoke tests
- **CI/CD Pipeline:** Automated deployments with rollback capability

---

## Security Highlights for Investors

### Defense-in-Depth Strategy

| Layer | Protection |
|-------|-----------|
| **Network** | VPC isolation, security groups, private subnets |
| **Transport** | TLS 1.2+ everywhere, no plaintext transmission |
| **Application** | Input validation, CSRF protection, rate limiting |
| **Authentication** | bcrypt hashing, session timeout, MFA-ready |
| **Data** | Encryption at rest (RDS, S3), tenant isolation |
| **Audit** | PHI-safe logging, comprehensive event tracking |

### No PHI in Logs, Ever

Our `phiSafeLogger` architecture ensures zero Protected Health Information leaks into CloudWatch logs. Every log entry passes through a runtime allowlist filter—patient identifiers are replaced with opaque tokens.

**Example:**
```
❌ BAD:  "Patient John Doe (DOB: 1980-05-15) accessed"
✅ GOOD: "source: patient_access, outcome: ok, requestId: 550e8400-e29b..."
```

### Tenant Isolation: Fail-Closed

Unlike traditional architectures where `null` clinic = "admin OR error" (fail-OPEN security hole), our discriminated union makes three cases explicit:

1. ✅ `clinic` → Scoped to ONE clinic only
2. ✅ `platform` → Admin, explicit all-clinic access
3. ✅ `denied` → NO access (non-admin without clinic)

**Security Guarantee:** A misconfigured user sees NOTHING, not EVERYTHING.

---

## Technical Differentiators

### 1. Cloud-Native Architecture
- **No Legacy Infrastructure:** Built for AWS from day one
- **Container-Based:** ECS Fargate (no server management)
- **Fully Managed Services:** RDS, S3, ALB, CloudWatch
- **Infrastructure as Code:** Reproducible, version-controlled

### 2. Healthcare-Specific Design
- **Episode-Based Clinical Model:** Prevents cross-episode data leakage
- **HL7 FHIR Ready:** Prepared for interoperability standards
- **Clinical Reasoning AI:** OpenAI GPT-4 integration with human oversight
- **Regulatory Compliance:** HIPAA, preparing for HITRUST and SOC 2

### 3. Developer Velocity
- **Hot Reload Development:** Instant feedback during coding
- **Type-Safe APIs:** Errors caught at compile time, not runtime
- **Automated Testing:** 100+ tests run on every commit
- **One-Command Deployment:** Push to main → auto-deploy to production

---

## Compliance & Certifications

### Current Status ✅
- HIPAA-compliant architecture implemented
- AWS Business Associate Agreement executed
- PHI protection operational at all layers
- Comprehensive audit trails (6-year retention)

### In Progress (Q4 2026) 🟡
- HITRUST CSF certification (application submitted)
- SOC 2 Type I audit (scoping complete)

### Roadmap (2027) ⏳
- SOC 2 Type II (requires 12 months of controls operation)
- State-specific certifications (as market demands)

---

## Cost Structure & Scalability

### Current Infrastructure Cost
**~$255/month** for production-ready, HIPAA-compliant platform

**Breakdown:**
- Compute (ECS Fargate): $53
- Database (RDS Multi-AZ): $150
- Storage & CDN: $42
- Monitoring & Logs: $10

### Scaling Economics

| Users | Monthly AWS Cost | Cost Per User |
|-------|------------------|---------------|
| 10 (current) | $255 | $25.50 |
| 100 | $500 | $5.00 |
| 1,000 | $1,200 | $1.20 |
| 10,000 | $4,500 | $0.45 |

**Key Insight:** As we scale, infrastructure cost per user drops by 98%.

---

## Technology Risks & Mitigations

### Risk 1: AWS Service Outage
**Probability:** Low (AWS SLA: 99.99% uptime)  
**Mitigation:** Multi-AZ deployment, cross-region DR (us-west-2)  
**Business Impact:** Minimal (< 1 hour downtime in catastrophic regional failure)

### Risk 2: OpenAI API Availability
**Probability:** Low-Medium (third-party dependency)  
**Mitigation:** Manual clinical reasoning entry, request queuing, retry logic  
**Business Impact:** Users can continue operations without AI assistance

### Risk 3: Database Connection Exhaustion
**Probability:** Medium (at high scale)  
**Mitigation:** Connection pooling, RDS Proxy (roadmap Q4 2026)  
**Business Impact:** Monitored with alarms, auto-scaling prevents overload

### Risk 4: Security Breach / PHI Leak
**Probability:** Very Low (defense-in-depth, fail-closed design)  
**Mitigation:** Regular security audits, penetration testing, HITRUST certification  
**Business Impact:** Comprehensive incident response plan, cyber insurance

---

## Competitive Technical Advantages

### vs. Legacy EHR Systems
- ✅ Modern tech stack (they: MUMPS, Caché, Java from 1990s)
- ✅ Cloud-native (they: on-premises, expensive hardware)
- ✅ API-first (they: closed ecosystems, limited integration)
- ✅ Fast iteration (they: 6-12 month release cycles)

### vs. Other Healthcare Startups
- ✅ HIPAA compliance from day one (they: bolt on later)
- ✅ Multi-tenant architecture (they: single-tenant = high costs)
- ✅ Comprehensive audit trails (they: logging as afterthought)
- ✅ Production-ready (they: MVP on local laptops)

### vs. Building In-House (For Potential Acquirers)
- ✅ 18+ months of development already complete
- ✅ HIPAA expertise built-in (hire or train: 6-12 months)
- ✅ Regulatory certifications in progress (HITRUST: 9-18 months)
- ✅ Battle-tested in real clinical workflows

---

## Technology Team & Expertise

### Current Capabilities
- Full-stack TypeScript development
- AWS cloud architecture
- HIPAA compliance implementation
- Healthcare data modeling (FHIR, HL7)
- DevOps & site reliability engineering

### Roadmap Needs (As We Scale)
- **Security Engineer** (HITRUST certification support)
- **DevOps Engineer** (scale to 1,000+ users)
- **Data Engineer** (analytics pipeline, BI dashboards)
- **QA Engineer** (expanded test coverage, compliance testing)

---

## Key Metrics for Investors

### Technical Health Indicators

| Metric | Current | Target | Status |
|--------|---------|--------|--------|
| **System Uptime** | 99.7% | 99.9% | 🟡 On track |
| **API Latency (p95)** | 450ms | < 500ms | ✅ Meeting SLA |
| **Test Coverage** | 78% | 85% | 🟡 In progress |
| **Security Vulnerabilities** | 0 critical | 0 critical | ✅ Secure |
| **Deployment Frequency** | 2-3x/week | Daily | 🟡 Improving |
| **Mean Time to Recovery** | 15 min | < 30 min | ✅ Excellent |

### Business Enablement Metrics

| Capability | Status | Business Impact |
|------------|--------|-----------------|
| **Multi-Clinic Support** | ✅ Live | Unlimited geographic expansion |
| **API for Partners** | 🟡 Q1 2027 | Enable third-party integrations |
| **Mobile App** | ⏳ Q2 2027 | Field staff productivity |
| **Telehealth** | ⏳ Q3 2027 | Expand service offerings |
| **Analytics Dashboard** | 🟡 Q4 2026 | Data-driven clinic operations |

---

## Questions Investors Typically Ask

### 1. "What happens if AWS goes down?"
**Answer:** Multi-AZ deployment within region handles single-zone failures automatically. For regional outages (extremely rare), we have cross-region DR to us-west-2 with 4-hour RTO. Total downtime in worst-case: ~1 hour over the lifetime of the product.

### 2. "Can you handle 100x growth?"
**Answer:** Yes. Our multi-tenant architecture scales horizontally. At 100x current users (10,000 users), we estimate ~$4,500/month AWS costs. We'll need RDS upgrade (db.r5.xlarge) and Redis caching layer, both straightforward.

### 3. "How do you prevent data breaches?"
**Answer:** Defense-in-depth: network isolation, TLS everywhere, tenant scoping at DB layer, PHI-safe logging, comprehensive audit trails, and fail-closed security (deny by default). We're also pursuing HITRUST certification (gold standard in healthcare).

### 4. "What's your technical debt situation?"
**Answer:** Minimal. We're on latest LTS versions of all core technologies. Known tech debt items are documented and prioritized (e.g., migrate Redis for sessions, add CloudFront CDN). No "legacy rewrites" needed.

### 5. "Can you integrate with Epic, Cerner, etc?"
**Answer:** Roadmap item (Q2-Q3 2027). Our FHIR-ready data model makes integration feasible. We'll build HL7 v2.x and FHIR R4 adapters as market demands. Cost: ~$150K dev effort per major EHR integration.

### 6. "What if OpenAI becomes unavailable or expensive?"
**Answer:** We have two strategies: (1) Manual fallback (clinical reasoning entry UI), (2) Multi-vendor AI (Azure OpenAI, Anthropic Claude, AWS Bedrock). We're not locked in—AI providers are commoditizing.

### 7. "How long to SOC 2 Type II?"
**Answer:** 12-18 months from now. SOC 2 Type II requires 12 months of audited controls operation. We're starting SOC 2 Type I (Q4 2026), then Type II audit begins mid-2027, report available Q1-Q2 2028.

### 8. "Can you white-label for enterprise customers?"
**Answer:** Yes, with ~2 months dev effort. We'd need: custom branding, SSO integration (SAML/OIDC), dedicated database per customer (data residency), and custom domain setup. Feasible for deals > $500K ARR.

---

## Investment-Ready Milestones ✅

### Technical Milestones Achieved
- [x] Production deployment on AWS
- [x] HIPAA-compliant architecture implemented
- [x] Zero-downtime deployment pipeline
- [x] Comprehensive audit trails operational
- [x] Multi-tenant data isolation proven
- [x] Automated testing suite (100+ tests)
- [x] Disaster recovery plan documented and tested
- [x] Security monitoring and alerting active

### Regulatory Milestones Achieved
- [x] AWS Business Associate Agreement executed
- [x] PHI protection controls operational
- [x] Security risk assessment completed
- [x] Workforce HIPAA training program in place

### In Progress (De-Risk Further)
- [ ] HITRUST CSF certification (H1 2027)
- [ ] SOC 2 Type I audit (Q1 2027)
- [ ] Penetration testing by third party (Q4 2026)
- [ ] Independent security audit (Q4 2026)

---

## Conclusion: Technical Moat & Defensibility

### What Makes Us Hard to Replicate?

1. **18+ Months of Healthcare Compliance Work**
   - HIPAA expertise is rare and expensive
   - Regulatory certifications take 12-18 months
   - Our head start is not easily caught

2. **Multi-Tenant Architecture**
   - Single-tenant systems can't match our cost structure
   - Competitors face expensive infrastructure or re-architecture

3. **Clinical Workflow Knowledge**
   - Domain expertise in ancillary screening workflows
   - Episode-based model prevents data leakage (competitors struggle with this)

4. **Battle-Tested in Production**
   - Real patient data, real clinical workflows
   - Edge cases discovered and handled
   - Competitors in MVP stage face 12+ months of hardening

### Technical Roadmap Unlocks Revenue

| Quarter | Technical Milestone | Revenue Impact |
|---------|---------------------|----------------|
| Q4 2026 | Analytics dashboard | Enable outcomes-based contracting |
| Q1 2027 | API for partners | Unlock integration partnerships ($50K+ each) |
| Q2 2027 | Mobile app | Field staff efficiency (2x patient throughput) |
| Q3 2027 | EHR integrations | Enterprise sales (health systems, $500K+ deals) |
| Q4 2027 | Telehealth | Expand addressable market by 3x |

---

## Contact Information

**Technical Due Diligence Inquiries:**  
[CTO Name], Chief Technology Officer  
cto@plexushealthcare.com

**Compliance & Security Questions:**  
[Compliance Officer Name], Chief Compliance Officer  
compliance@plexushealthcare.com

**Investor Relations:**  
[CEO Name], Chief Executive Officer  
ceo@plexushealthcare.com

---

**For Full Technical Details:**  
See companion document: `TECHNOLOGY_SCOPE_INVESTOR.md` (90 pages)

---

*This document contains proprietary and confidential information.*  
*Distribution restricted to authorized investors under NDA.*
