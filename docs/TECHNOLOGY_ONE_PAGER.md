# Plexus Healthcare Platform — Technology One-Pager

**For Investor Meetings | September 2026**

---

## 🏥 What We Built

**Enterprise-grade healthcare operating platform** for ancillary screening operations
- HIPAA-compliant by design, not retrofit
- Production-ready with real patient workflows
- Built on AWS with 99.9% uptime target

---

## 🔒 Security & Compliance (The Hard Part)

### ✅ HIPAA Compliant
- AWS Business Associate Agreement executed
- PHI-safe logging (zero patient data in logs)
- Fail-closed tenant isolation
- 6-year audit retention
- Encryption at rest + in transit

### ✅ Production Hardened
- Multi-AZ deployment (automatic failover)
- Zero-downtime deployments
- Disaster recovery: 4-hour RTO, 1-hour RPO
- Comprehensive monitoring & alerting

### 🟡 Certifications In Progress
- HITRUST CSF (H1 2027)
- SOC 2 Type I (Q1 2027)
- SOC 2 Type II (Q2 2028)

---

## 💰 Cost Efficiency That Scales

| Metric | Value | Investor Insight |
|--------|-------|------------------|
| **Current AWS Cost** | $255/month | Production-ready for < $3K/year |
| **Cost at 100 users** | $500/month | 5x users, 2x cost |
| **Cost at 1,000 users** | $1,200/month | 100x users, 5x cost |
| **Cost per user at scale** | $0.45 | **98% reduction** vs. today |

**Why This Matters:** Multi-tenant architecture = economies of scale built in

---

## 🏗️ Modern Technology Stack

### Frontend
- **React + TypeScript** (type-safe, maintainable)
- **Radix UI** (WCAG 2.1 AA accessible)
- **TailwindCSS** (modern styling)

### Backend
- **Node.js 20 LTS** (long-term support)
- **Express + TypeScript** (proven, production-hardened)
- **PostgreSQL 15+** (ACID compliance, mature)

### Cloud Infrastructure
- **AWS ECS Fargate** (no server management)
- **RDS Multi-AZ** (automatic failover)
- **S3 with KMS encryption** (secure document storage)
- **ALB + CloudWatch** (load balancing & monitoring)

**Translation for Investors:** We use battle-tested, enterprise-grade tools—not bleeding-edge experiments.

---

## 🛡️ Technical Moat

### Why We're 18 Months Ahead of Competitors

1. **HIPAA Compliance is Hard**
   - Requires deep expertise (hire or train: 6-12 months)
   - AWS BAA takes 3-6 months to execute
   - Regulatory certifications: 12-18 months

2. **Multi-Tenant Architecture is Rare**
   - Most startups build single-tenant (expensive)
   - Re-architecting later costs 12-24 months

3. **Clinical Workflow Domain Knowledge**
   - Episode-based data model (prevents leakage)
   - Edge cases discovered through production use
   - Competitors face 12+ months of hardening

**Bottom Line:** Our head start compounds—it gets harder to catch us, not easier.

---

## 📊 Technical Health Metrics

| Metric | Current | Status |
|--------|---------|--------|
| **System Uptime** | 99.7% | 🟡 Tracking to 99.9% |
| **API Latency (p95)** | 450ms | ✅ Under 500ms target |
| **Security Vulnerabilities** | 0 critical | ✅ Secure |
| **Test Coverage** | 78% | 🟡 Target: 85% |
| **Deploy Frequency** | 2-3x/week | 🟡 Moving to daily |

---

## 🚀 Technical Roadmap Unlocks Revenue

| Timeline | What We Build | Revenue Impact |
|----------|---------------|----------------|
| **Q4 2026** | Analytics dashboard | Outcomes-based contracts |
| **Q1 2027** | Partner API | Integration deals ($50K+ each) |
| **Q2 2027** | Mobile app | 2x patient throughput |
| **Q3 2027** | EHR integrations (Epic, Cerner) | Enterprise sales ($500K+ deals) |
| **Q4 2027** | Telehealth | 3x addressable market |

---

## 🎯 Competitive Position

### vs. Legacy EHRs (Epic, Cerner, Allscripts)
| Them | Us |
|------|-----|
| MUMPS, Java from 1990s | Modern TypeScript, React |
| On-premises, expensive hardware | Cloud-native, pay-as-you-grow |
| 6-12 month release cycles | Deploy 2-3x/week |
| Closed ecosystems | API-first, integration-ready |

### vs. Healthcare Startups
| Them | Us |
|------|-----|
| HIPAA bolted on later | Compliant from day one |
| Single-tenant (high costs) | Multi-tenant (economies of scale) |
| MVP on laptops | Battle-tested in production |
| Logging as afterthought | PHI-safe audit trails |

---

## 💡 Answers to Tough Technical Questions

### "What if AWS goes down?"
Multi-AZ = automatic failover (60 seconds). Regional outage (rare) = cross-region DR (4 hours). Worst-case downtime over product lifetime: ~1 hour.

### "Can you handle 100x growth?"
Yes. Horizontal scaling to 10,000 users = $4,500/month AWS costs. Need RDS upgrade + Redis caching (both standard).

### "What's your technical debt?"
Minimal. Latest LTS versions. Known items documented (e.g., CloudFront CDN, Redis sessions). No legacy rewrites needed.

### "Can you integrate with Epic/Cerner?"
Roadmap Q3 2027. FHIR-ready data model makes it feasible. Cost: ~$150K dev per major EHR. Unlocks $500K+ enterprise deals.

### "What if OpenAI becomes unavailable?"
Two strategies: (1) Manual fallback UI, (2) Multi-vendor AI (Azure, Claude, AWS Bedrock). Not locked in.

---

## 📈 Investment-Ready Evidence

### ✅ Technical Milestones Achieved (18 Months of Work)
- Production deployment on AWS
- HIPAA-compliant architecture
- Zero-downtime deployments
- Comprehensive audit trails
- Multi-tenant isolation proven
- 100+ automated tests
- Disaster recovery tested

### ✅ Regulatory Milestones Achieved
- AWS BAA executed
- PHI controls operational
- Security risk assessment complete
- HIPAA training program in place

### 🟡 In Progress (De-Risking Further)
- HITRUST certification (gold standard)
- SOC 2 Type I audit
- Third-party penetration testing
- Independent security audit

---

## 🏆 Why Our Technology is Defensible

1. **18+ months of compliance work**
   - Hard to replicate, expensive to hire
   
2. **Production-hardened**
   - Real workflows, edge cases handled
   - Competitors face 12+ months catching up

3. **Multi-tenant cost advantage**
   - Competitors can't match our economics
   - Re-architecting later is painful

4. **Clinical domain expertise**
   - Episode-based model is non-trivial
   - Data leakage prevention is healthcare-specific

**The Gap Widens:** Every month we operate, we discover more edge cases and build more defensibility.

---

## 💵 The Ask & ROI on Technical Investment

### If You Invest, We'll Spend Tech Budget On:

**Q4 2026 ($120K):**
- HITRUST certification prep
- Third-party security audit
- Analytics dashboard MVP

**2027 ($480K):**
- DevOps engineer (scale to 1,000 users)
- Security engineer (SOC 2 compliance)
- Mobile app development
- EHR integration (Epic/Cerner)

**Expected ROI:**
- HITRUST certification → Unlocks enterprise contracts
- Analytics dashboard → Enables outcomes-based pricing (higher margins)
- EHR integrations → $500K+ deal sizes
- Mobile app → 2x operational efficiency

---

## 📞 Next Steps

**Want to dig deeper?**

📄 **90-page technical deep-dive:** `TECHNOLOGY_SCOPE_INVESTOR.md`  
📄 **12-page executive summary:** `TECHNOLOGY_EXECUTIVE_SUMMARY.md`  
🔍 **Live demo:** Schedule technical walkthrough  
🗣️ **Due diligence call:** CTO available for technical Q&A

---

**Contact:**  
[CTO Name], Chief Technology Officer  
cto@plexushealthcare.com  
[Phone Number]

---

*Confidential — For Authorized Investors Only*
