# Plexus Healthcare Platform — Technology & Infrastructure Scope

**Document Classification:** Investor Presentation  
**Last Updated:** September 2026  
**Version:** 1.0

---

## Executive Summary

Plexus is an enterprise-grade healthcare operating platform built with security, compliance, and scalability as foundational requirements. This document provides a comprehensive technical overview of our architecture, infrastructure, and HIPAA compliance posture for investor evaluation.

**Key Technical Highlights:**
- Modern, scalable cloud-native architecture on AWS
- HIPAA-compliant by design with PHI protection at every layer
- Production-ready with comprehensive audit trails and fail-closed security
- Built for multi-tenant healthcare operations with 99.9% uptime target

---

## Table of Contents

1. [Technology Stack](#1-technology-stack)
2. [Infrastructure & Cloud Architecture](#2-infrastructure--cloud-architecture)
3. [Security Architecture](#3-security-architecture)
4. [HIPAA Compliance & PHI Protection](#4-hipaa-compliance--phi-protection)
5. [Data Architecture & Isolation](#5-data-architecture--data-isolation)
6. [Operational Excellence](#6-operational-excellence)
7. [Development & Deployment](#7-development--deployment)
8. [Scalability & Performance](#8-scalability--performance)
9. [Business Continuity & Disaster Recovery](#9-business-continuity--disaster-recovery)
10. [Regulatory & Compliance Framework](#10-regulatory--compliance-framework)

---

## 1. Technology Stack

### 1.1 Application Layer

**Frontend**
- **Framework:** React 18.3+ with TypeScript 5.6
- **UI Library:** Radix UI (accessible, WCAG 2.1 AA compliant components)
- **Styling:** TailwindCSS 4.x (utility-first, performance-optimized)
- **State Management:** TanStack Query (React Query) for server state
- **Build Tool:** Vite 7.x (fast development, optimized production builds)

**Backend**
- **Runtime:** Node.js 20 LTS (long-term support through April 2026)
- **Framework:** Express 5.x (proven, production-hardened)
- **Language:** TypeScript 5.6 (type-safe, maintainable)
- **API Design:** RESTful with PHI-safe error handling

**Database**
- **Primary Database:** PostgreSQL 15+ (RDS managed service)
- **ORM:** Drizzle ORM (type-safe, migration-first)
- **Connection Pooling:** pg 8.16 with connection limits and health monitoring
- **Schema Migrations:** Drizzle Kit with versioned, auditable migrations

### 1.2 Core Dependencies

**Security & Authentication**
- passport.js (authentication framework)
- bcryptjs (password hashing with secure defaults)
- express-session (secure session management)
- connect-pg-simple (session persistence in PostgreSQL)

**Document Management**
- pdf-lib (PDF generation and manipulation)
- exceljs (Excel report generation)
- AWS S3 SDK (encrypted document storage)

**AI Integration**
- OpenAI SDK 6.x (clinical reasoning support via GPT-4)
- Configurable retry logic with exponential backoff
- Request rate limiting and concurrent operation controls

**Healthcare Standards**
- FHIR R4 data models (preparation for interoperability)
- HL7 v2.x message parsing (future integration ready)

---

## 2. Infrastructure & Cloud Architecture

### 2.1 AWS Cloud Architecture

```
                    ┌──────────────────────────────────────┐
   Internet ───────▶│  Route 53 + ACM Certificate (TLS)   │
                    └──────────────┬───────────────────────┘
                                   │ HTTPS (443)
                    ┌──────────────▼───────────────────────┐
                    │  Application Load Balancer (ALB)    │
                    │  • TLS 1.2+ termination             │
                    │  • WAF protection                    │
                    │  • Health checks (/healthz)          │
                    │  • Multi-AZ deployment               │
                    └──────────────┬───────────────────────┘
                                   │ HTTP (5000)
                    ┌──────────────┴───────────────────────┐
                    │                                      │
            ┌───────▼────────┐                  ┌────────▼────────┐
            │ ECS Fargate    │                  │ ECS Fargate     │
            │ Task (AZ-A)    │  ←── Scale ──→  │ Task (AZ-B)     │
            │ • CPU: 1 vCPU  │                  │ • CPU: 1 vCPU   │
            │ • Mem: 2 GB    │                  │ • Mem: 2 GB     │
            │ • Stateless    │                  │ • Stateless     │
            └───────┬────────┘                  └────────┬────────┘
                    │                                    │
                    ├────────────── PostgreSQL ──────────┤
                    │                                    │
                    │         ┌──────────────────┐       │
                    │         │ RDS PostgreSQL   │       │
                    │         │ • Multi-AZ       │       │
                    │         │ • Encrypted      │       │
                    │         │ • Auto-backups   │       │
                    │         │ • Version 15+    │       │
                    │         └──────────────────┘       │
                    │                                    │
                    ├──────────── S3 Storage ────────────┤
                    │                                    │
                    │         ┌──────────────────┐       │
                    │         │ S3 Bucket (PHI)  │       │
                    │         │ • SSE-S3/KMS     │       │
                    │         │ • Versioning     │       │
                    │         │ • Block public   │       │
                    │         │ • Access logs    │       │
                    │         └──────────────────┘       │
                    │                                    │
                    └──────── Secrets Manager ───────────┘
                                      │
                              ┌───────▼────────┐
                              │ AWS Secrets    │
                              │ • DB creds     │
                              │ • API keys     │
                              │ • Encrypted    │
                              └────────────────┘
```

### 2.2 AWS Service Utilization

| Service | Purpose | Configuration | HIPAA Eligibility |
|---------|---------|---------------|-------------------|
| **ECS Fargate** | Container orchestration | Multi-AZ, auto-scaling, rolling updates | ✅ Eligible |
| **RDS PostgreSQL** | Primary database | Multi-AZ, encrypted at rest/transit, automated backups | ✅ Eligible |
| **S3** | Document storage (PHI) | SSE-KMS encryption, versioning, MFA delete, access logging | ✅ Eligible |
| **ALB** | Load balancing | TLS 1.2+ only, health checks, connection draining | ✅ Eligible |
| **CloudWatch** | Logging & monitoring | PHI-filtered logs, metric alarms, 90-day retention | ✅ Eligible |
| **Secrets Manager** | Credential storage | Automatic rotation, encryption at rest, audit logs | ✅ Eligible |
| **ECR** | Container registry | Image scanning, encryption at rest | ✅ Eligible |
| **Route 53** | DNS management | Health checks, DNSSEC ready | ✅ Eligible |
| **ACM** | TLS certificates | Auto-renewal, strong cipher suites | ✅ Eligible |
| **IAM** | Access control | Role-based, least privilege, MFA enforcement | ✅ Eligible |

**BAA Status:** All services listed are covered under AWS Business Associate Agreement (BAA) and are HIPAA-eligible when properly configured.

### 2.3 Compute Specifications

**Current Production Configuration:**
- **Task CPU:** 1 vCPU per task
- **Task Memory:** 2 GB per task
- **Desired Count:** 2 tasks minimum (HA)
- **Max Tasks:** 8 (auto-scaling based on CPU/memory)
- **Health Check:** `/healthz` endpoint (no DB dependency)
- **Readiness Check:** `/readyz` endpoint (validates DB connectivity)
- **Deployment:** Rolling updates with circuit breaker

**Scaling Policy:**
- Scale up: CPU > 70% for 2 minutes
- Scale down: CPU < 30% for 5 minutes
- Cooldown: 3-minute intervals

---

## 3. Security Architecture

### 3.1 Defense-in-Depth Strategy

**Layer 1: Network Security**
- VPC with private subnets for compute and data layers
- Security groups with least-privilege ingress/egress rules
- ALB in public subnet, all other resources in private subnets
- No direct internet access for application or database layers
- VPC Flow Logs enabled for network traffic monitoring

**Layer 2: Application Security**
- TLS 1.2+ enforced for all client connections
- Secure session management with httpOnly, secure, sameSite cookies
- CSRF protection on all state-changing endpoints
- Rate limiting per IP and per user (middleware-enforced)
- Input validation using Zod schema validators
- Parameterized queries (SQL injection prevention)

**Layer 3: Authentication & Authorization**
- Passport.js-based authentication
- bcrypt password hashing (cost factor: 10)
- Role-based access control (RBAC): admin, clinician, scheduler, biller
- Session timeout: 24 hours of inactivity
- Multi-factor authentication ready (infrastructure in place)

**Layer 4: Data Security**
- Encryption at rest: RDS (AWS-managed keys), S3 (SSE-S3 or SSE-KMS)
- Encryption in transit: TLS 1.2+ everywhere
- Database connections require SSL/TLS (`sslmode=require`)
- Secrets stored in AWS Secrets Manager, never in code or environment variables

**Layer 5: Tenant Isolation**
- Fail-closed tenant scoping (see Section 5.2)
- Explicit discriminated union prevents ambiguous null scopes
- AsyncLocalStorage-based scope enforcement at repository layer
- Admin access explicitly marked as `platform` scope

### 3.2 Authentication Flow

```
┌──────────┐     1. Login Request      ┌─────────────────┐
│  Client  │  ────────────────────────▶ │   Express App   │
│ (Browser)│                            │  (middleware)   │
└──────────┘                            └────────┬────────┘
     ▲                                           │
     │                                           │ 2. Validate
     │                                           │    Credentials
     │                                           ▼
     │                                  ┌─────────────────┐
     │                                  │   PostgreSQL    │
     │                                  │  (users table)  │
     │                                  └────────┬────────┘
     │                                           │
     │                                           │ 3. Create
     │                                           │    Session
     │                                           ▼
     │                                  ┌─────────────────┐
     │                                  │  Session Store  │
     │                                  │  (PostgreSQL)   │
     │                                  └────────┬────────┘
     │                                           │
     │  4. Set secure cookie                    │
     │  (httpOnly, secure, sameSite)            │
     └───────────────────────────────────────────┘
```

### 3.3 Access Control Matrix

| Role | Patient Data | Clinical Data | Admin Review | Billing | User Management |
|------|--------------|---------------|--------------|---------|-----------------|
| **Admin** | Full | Full | Full | Full | Full |
| **Clinician** | Full | Full | Approve/Review | Summary view | None |
| **Scheduler** | Limited (scheduling) | Summary | None | None | None |
| **Biller** | Limited (financial) | None | None | Full | None |

Access control is enforced at:
1. **Route level:** Middleware checks `req.session.role`
2. **UI level:** Components conditionally render based on permissions
3. **Data level:** Database queries scoped by role + tenant context

---

## 4. HIPAA Compliance & PHI Protection

### 4.1 HIPAA Technical Safeguards Implementation

| Safeguard | Implementation | Status |
|-----------|----------------|--------|
| **Access Control** | Role-based permissions, unique user IDs, automatic session timeout | ✅ Implemented |
| **Audit Controls** | Comprehensive audit logging with PHI-safe structured logging | ✅ Implemented |
| **Integrity Controls** | Digital signatures (procedure notes), checksum validation | ✅ Implemented |
| **Transmission Security** | TLS 1.2+ for all network traffic, encrypted S3 uploads | ✅ Implemented |
| **Encryption** | At-rest (RDS, S3) and in-transit (TLS) encryption | ✅ Implemented |

### 4.2 PHI-Safe Logging Architecture

**Core Principle:** No PHI in logs, ever.

**Implementation:**
- Centralized `phiSafeLogger.ts` module with allowlist-based projection
- All log entries pass through `projectPayload()` runtime filter
- Patient identifiers replaced with opaque tokens (HMAC-based)
- Structured logging with predefined enums (no free-form text)
- CloudWatch logs filtered for any accidental PHI patterns

**Log Entry Schema:**
```typescript
type LogSafePayload = {
  source: LogSafeTag;              // Predefined tags only
  outcome?: LogSafeTag;            // "created" | "failed" | etc
  operation?: LogSafeOperation;    // "api_request" | "database_readiness"
  category?: LogSafeErrorCategory; // "client_error" | "internal_error"
  requestId?: LogSafeRequestId;    // UUID for request correlation
  statusCode?: number;             // HTTP status (100-599 only)
  durationMs?: number;             // Performance metrics
  // NO patient names, DOB, SSN, phone, email, address, or diagnosis
};
```

**Example PHI-Safe Log:**
```json
{
  "source": "api_request",
  "operation": "patient_lookup",
  "outcome": "ok",
  "statusCode": 200,
  "durationMs": 42,
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
  // Note: NO patient ID, name, or other identifiers
}
```

### 4.3 Audit Trail

**Audit Events Captured:**
- User authentication (login/logout)
- Patient record access (view, edit, create)
- Clinical data modifications
- Admin review decisions
- Document generation and signing
- Communication logs (calls, emails)
- Billing transactions
- Permission changes
- System configuration changes

**Audit Storage:**
- Primary: `patient_journey_events` table (immutable, append-only)
- Secondary: CloudWatch Logs (90-day retention minimum)
- Fields: timestamp, actor (user ID), action, resource type, outcome
- Retention: 6 years (HIPAA minimum: 6 years from creation or last use)

**Audit Access:**
- Read-only for compliance officers and auditors
- Exportable for regulatory review
- Searchable by date, user, action type, patient episode

### 4.4 Data Minimization

**Principles:**
1. Collect only data necessary for clinical and operational purposes
2. Access restricted by role and need-to-know
3. PHI redacted in non-clinical contexts
4. Automatic purging of temporary data (staging tables, cached files)

**Implementation:**
- Patient screening data: retained per regulatory requirements
- Call recordings: optional, retained 30 days unless legally required
- Temporary uploads: deleted within 24 hours if not linked to patient record
- Session data: deleted on logout or 24-hour expiry

---

## 5. Data Architecture & Data Isolation

### 5.1 Database Schema Design

**Core Principles:**
- Multi-tenant architecture with explicit clinic scoping
- Episode-based clinical data (prevents cross-episode leakage)
- Immutable audit trail (append-only event log)
- Normalized schema with foreign key constraints
- Version-controlled migrations (Drizzle Kit)

**Key Entity Model:**
```
global_plexus_patients (canonical patient identity)
  └─ patient_clinic_memberships (tenant boundary)
      └─ patient_screenings (operational workhorse)
          ├─ patient_ancillary_cases (per-service episodes)
          │   ├─ patient_episode_documents (per-episode docs)
          │   │   └─ patient_episode_document_versions
          │   └─ outreach_calls (communication log)
          └─ patient_journey_events (audit trail)
```

### 5.2 Tenant Isolation (Fail-Closed Architecture)

**Problem Solved:** Previous architecture used `clinicId: number | null` where `null` was ambiguous (admin OR unassigned user), creating a fail-OPEN security hole.

**Solution:** Explicit discriminated union with three distinct states:

```typescript
type TenantContext =
  | { kind: "clinic"; clinicId: number }     // Scoped to one clinic
  | { kind: "platform" }                     // Admin, explicit all-clinic access
  | { kind: "denied"; reason: string }       // NO access, fail closed
```

**Enforcement:**
1. **Middleware layer:** `tenantContext` middleware populates `req.tenant`
2. **AsyncLocalStorage:** Scope propagates through async call chain
3. **Repository layer:** `resolveScopedClinicId()` throws on denied scope
4. **Effect:** Cannot accidentally query across tenant boundaries

**Security Guarantee:** A non-admin user without a clinic assignment sees NO data (not "all data").

### 5.3 Data Classification

| Data Type | Classification | Storage | Encryption | Access |
|-----------|----------------|---------|------------|--------|
| **Patient Demographics** | PHI | PostgreSQL | At-rest (RDS encryption) | Role-based, tenant-scoped |
| **Clinical Data** | PHI | PostgreSQL | At-rest (RDS encryption) | Clinician + admin only |
| **Documents (orders, reports)** | PHI | S3 | SSE-KMS | Pre-signed URLs, time-limited |
| **Communication Logs** | PHI | PostgreSQL | At-rest (RDS encryption) | Audit trail, role-based |
| **Audit Events** | PHI + metadata | PostgreSQL + CloudWatch | At-rest + TLS in transit | Compliance officer access |
| **User Credentials** | Sensitive | PostgreSQL | bcrypt hashed | System only |
| **Session Tokens** | Sensitive | PostgreSQL | Encrypted cookie | System only |

---

## 6. Operational Excellence

### 6.1 Health Checks & Monitoring

**Liveness Check** (`/healthz`)
- Purpose: Fast health verification for ALB
- Method: HTTP GET, returns 200 OK
- Dependencies: None (no DB, no external calls)
- Frequency: ALB polls every 15 seconds
- Use case: Restart unhealthy tasks

**Readiness Check** (`/readyz`)
- Purpose: Database connectivity verification
- Method: HTTP GET, executes `SELECT 1`
- Response: `{ status: "ready" }` (200) or `{ status: "not_ready" }` (503)
- Use case: Blue/green deployment, load balancer cutover

**Observability:**
- Structured logging to CloudWatch Logs
- Metrics: Request count, latency (p50/p95/p99), error rate, DB pool stats
- Alarms: Error rate > 5%, p95 latency > 2s, DB connection pool exhaustion
- Dashboards: Real-time operational metrics in CloudWatch

### 6.2 Graceful Shutdown

**SIGTERM Handling:**
1. ALB deregisters task from target group
2. App receives SIGTERM signal
3. HTTP server stops accepting new connections
4. Existing requests drain (up to 25 seconds)
5. WebSocket upgrade listeners detached
6. PostgreSQL connection pool closes
7. Process exits with code 0

**Deregistration Delay:** 30 seconds (matches ALB target group setting)

**Force Exit Timeout:**
- Development: 10 seconds (fast restarts)
- Production: 25 seconds (under ECS's 30s stopTimeout)

### 6.3 Background Jobs

**Architecture:** In-process background jobs with PostgreSQL advisory locks

**Jobs:**
1. **Patient Sync** (Google Sheets → PostgreSQL)
   - Frequency: Hourly
   - Lock: `pg_try_advisory_lock(hash('patient_sync'))`
   - Behavior: Skip if another task already running

2. **Billing Sync** (PostgreSQL → Google Sheets)
   - Frequency: Daily
   - Lock: `pg_try_advisory_lock(hash('billing_sync'))`

3. **Notes Export** (Generate PDFs for scheduled visits)
   - Frequency: Every 30 minutes
   - Lock: `pg_try_advisory_lock(hash('notes_export'))`

**Multi-Task Coordination:**
- Only ONE task across the ECS service executes each job at a time
- Failed lock acquisition → log + skip (not queued)
- Lock released on job completion or process exit
- No duplicate processing, no job state store required

### 6.4 Error Handling

**Application Errors:**
- Caught by centralized error handler middleware
- PHI-safe logging (no patient data in error messages)
- User-facing errors: generic messages
- Developer/operator errors: detailed structured logs

**Database Errors:**
- Connection pooling with retry logic
- Circuit breaker pattern for external dependencies
- Transactional integrity for multi-step operations
- Automatic rollback on failure

**External API Errors:**
- OpenAI: Exponential backoff with jitter (up to 3 retries)
- Rate limiting (max 10 concurrent requests)
- Fallback: Graceful degradation (manual note entry available)

---

## 7. Development & Deployment

### 7.1 Development Workflow

**Local Development:**
- Docker Compose for local PostgreSQL
- Hot module reload (Vite + tsx)
- Local S3 emulation or Google Drive fallback
- Seeded test data (`npm run seed:*` scripts)

**Testing:**
- Unit tests: `tests/unit/*.test.ts`
- Acceptance tests: `tests/acceptance/*.test.ts`
- End-to-end tests: Playwright (headless Chromium)
- Smoke tests: `script/smokeCanonicalApis.ts`
- QA matrix: 8 test patients (A-H) covering all workflows

**Quality Gates:**
- TypeScript strict mode (zero `any` in production code)
- ESLint + Prettier (enforced pre-commit)
- No uncommitted migrations
- Drizzle schema validation before build

### 7.2 CI/CD Pipeline

**GitHub Actions Workflow:**
```yaml
Trigger: Push to main branch
Steps:
  1. Checkout code
  2. Authenticate to AWS via OIDC (no stored secrets)
  3. Build Docker image (multi-stage)
  4. Push to Amazon ECR (tagged with git SHA + latest)
  5. Update ECS service (force new deployment)
  6. ECS performs rolling update
  7. Health checks validate new tasks
  8. Old tasks drained and terminated
```

**Deployment Strategy:**
- Rolling updates (minimum 100% healthy, maximum 200%)
- Circuit breaker: Rollback on 2 consecutive health check failures
- Zero-downtime: ALB maintains connections during deployment
- Rollback: Revert ECR image tag, force new deployment

**Database Migrations:**
- Executed at container startup (before app starts)
- Command: `npx drizzle-kit push --force`
- Idempotent: Safe to run multiple times
- Versioned: SQL migration files in `/migrations` directory

### 7.3 Environment Management

| Environment | AWS Account | Branch | Purpose |
|-------------|-------------|--------|---------|
| **Development** | Local/Replit | `dev/*` | Feature development, local testing |
| **Staging** | AWS Staging | `staging` | Pre-production validation, QA testing |
| **Production** | AWS Production | `main` | Live customer-facing environment |

**Configuration:**
- Secrets: AWS Secrets Manager (staging + production)
- Environment variables: ECS task definition
- Feature flags: Database-driven (admin-configurable)

---

## 8. Scalability & Performance

### 8.1 Horizontal Scaling

**Current Capacity:**
- 2 tasks @ 1 vCPU each = 2 vCPUs total
- Maximum 8 tasks = 8 vCPUs total

**Bottlenecks & Mitigation:**
1. **Database connections:**
   - Mitigation: Connection pooling (pg), RDS Proxy (future)
   - Current: 10 connections per task = 20 total (at 2 tasks)
   - Max: 80 connections (at 8 tasks)

2. **OpenAI API rate limits:**
   - Mitigation: Request queuing, max 10 concurrent
   - Fallback: Manual clinical reasoning entry

3. **Document generation:**
   - Mitigation: Async processing, background job for batch PDFs
   - Current: ~500ms per PDF (acceptable for user-triggered)

### 8.2 Performance Metrics

**Target SLAs:**
- **API latency (p95):** < 500ms for read operations, < 2s for writes
- **Page load time:** < 3s for initial load, < 200ms for subsequent navigation
- **Document generation:** < 1s for single PDF, < 30s for batch
- **Availability:** 99.9% (allows ~43 minutes downtime per month)

**Current Performance (Production Baseline):**
- Patient Directory load: ~120ms (p95)
- Patient Detail page: ~180ms (p95)
- Plexus IQ clinical reasoning: ~2.5s (dependent on OpenAI)
- Qualification workflow: ~3s end-to-end

**Caching Strategy:**
- Frontend: TanStack Query with stale-while-revalidate
- Backend: No caching layer yet (future: Redis for session + reference data)
- Static assets: CloudFront CDN (future enhancement)

### 8.3 Database Performance

**Query Optimization:**
- Indexes on all foreign keys and frequently queried columns
- Composite indexes for common JOIN patterns
- `EXPLAIN ANALYZE` results reviewed for slow queries (> 100ms)

**Connection Pooling:**
- Min connections: 2 per task
- Max connections: 10 per task
- Idle timeout: 30 seconds
- Connection timeout: 5 seconds

**Read Replicas (Future):**
- RDS read replica for analytics queries
- Read/write splitting in application layer

---

## 9. Business Continuity & Disaster Recovery

### 9.1 Backup Strategy

**Database Backups:**
- **Automated daily snapshots:** RDS automatic backups (retained 7 days)
- **Manual snapshots:** Before major deployments, retained 30 days
- **Point-in-time recovery:** Up to 7 days back (RDS PITR)
- **Cross-region replication:** Enabled to `us-west-2` (DR region)

**Document Backups:**
- **S3 versioning:** Enabled (retain all versions)
- **S3 replication:** Cross-region replication to DR bucket
- **Lifecycle policy:** Transition to Glacier after 90 days (cost optimization)

**Configuration Backups:**
- Infrastructure as Code (CDK) in version control
- Secrets: AWS Secrets Manager with automatic rotation
- Runbooks: Documented in `/docs` directory

### 9.2 Disaster Recovery Plan

**RTO (Recovery Time Objective):** 4 hours  
**RPO (Recovery Point Objective):** 1 hour (database), 0 (documents via S3 versioning)

**DR Scenarios:**

1. **Single ECS task failure:**
   - Detection: ALB health check failure (15s)
   - Recovery: ECS launches replacement task (30-60s)
   - Impact: No user impact (remaining tasks handle load)

2. **Full ECS service failure:**
   - Detection: CloudWatch alarm (2 minutes)
   - Recovery: Redeploy ECS service from ECR latest (5 minutes)
   - Impact: 5-7 minutes downtime

3. **RDS database failure:**
   - Detection: RDS failover to standby (Multi-AZ, automatic)
   - Recovery: 60-120 seconds (DNS switch to standby)
   - Impact: Brief connection errors, app retries succeed

4. **Availability Zone outage:**
   - Detection: ALB stops routing to failed AZ (15s)
   - Recovery: Auto-scaling launches tasks in healthy AZ (2-3 minutes)
   - Impact: Minimal (if >= 2 AZs running)

5. **Regional outage (catastrophic):**
   - Detection: Manual monitoring (5-10 minutes)
   - Recovery: Deploy to DR region (us-west-2)
     - Restore RDS from snapshot (30 minutes)
     - Deploy ECS service (10 minutes)
     - Update Route 53 DNS (5 minutes, 5-10 min propagation)
   - Impact: ~1 hour total downtime
   - Data loss: < 1 hour (last automated snapshot)

### 9.3 Incident Response

**Severity Levels:**
- **P0 (Critical):** System down, no workaround
- **P1 (High):** Major functionality broken
- **P2 (Medium):** Minor functionality broken, workaround exists
- **P3 (Low):** Cosmetic issues, future enhancement

**Response Times:**
- P0: Immediate response (24/7 on-call)
- P1: < 1 hour
- P2: < 4 hours
- P3: Next business day

**Escalation Path:**
1. Engineering team → CTO
2. CTO → CEO (for customer communication)
3. External: AWS Support (Enterprise plan)

---

## 10. Regulatory & Compliance Framework

### 10.1 HIPAA Compliance Checklist

| Requirement | Implementation | Evidence |
|-------------|----------------|----------|
| **Administrative Safeguards** | | |
| Risk Assessment | Annual security risk assessment | [Documented in internal security portal] |
| Workforce Training | HIPAA training for all staff (annual) | [Training records] |
| BAA with Vendors | AWS BAA signed, documented | [Legal files] |
| **Physical Safeguards** | | |
| Facility Access | AWS data center physical security | [AWS compliance documentation] |
| Workstation Security | Encrypted laptops, MFA, screen locks | [IT policy] |
| **Technical Safeguards** | | |
| Unique User IDs | Enforced by Passport.js auth | [Code: `server/auth`] |
| Emergency Access | Admin break-glass procedure | [Runbook: `docs/EMERGENCY_ACCESS.md`] |
| Automatic Logoff | 24-hour session timeout | [Code: `server/index.ts`] |
| Encryption | RDS, S3, TLS 1.2+ | [AWS config, code] |
| Audit Logs | Append-only event log, 6-year retention | [Database schema, CloudWatch] |
| Integrity Controls | Document checksums, version control | [Code: `server/lib/documentIntegrity.ts`] |

### 10.2 Compliance Certifications (Roadmap)

**Current Status:**
- ✅ HIPAA-compliant architecture
- ✅ AWS BAA executed
- ✅ PHI protection implemented
- ✅ Audit trail operational

**In Progress (Q4 2026):**
- 🟡 HITRUST CSF certification (application pending)
- 🟡 SOC 2 Type I audit (scoping phase)

**Planned (2027):**
- ⏳ SOC 2 Type II (12 months of controls operation)
- ⏳ State-specific certifications (as needed)

### 10.3 Third-Party Vendor Compliance

| Vendor | Service | BAA Signed | HIPAA Eligible | Purpose |
|--------|---------|------------|----------------|---------|
| **AWS** | Infrastructure | ✅ Yes | ✅ Yes | All cloud infrastructure |
| **OpenAI** | AI reasoning | ✅ Yes | ✅ Yes (Enterprise) | Clinical reasoning support |
| **GitHub** | Version control | N/A | N/A | No PHI stored in code |
| **Replit** | Development platform | N/A | N/A | Development only (no production PHI) |

**Vendor Review Process:**
1. Security questionnaire
2. BAA requirement assessment
3. Compliance certification review (SOC 2, ISO 27001)
4. Annual re-assessment

---

## 11. Future Technical Roadmap

### 11.1 Near-Term (Q4 2026)

1. **Redis for caching**
   - Session storage migration (off PostgreSQL)
   - Reference data caching (CPT codes, payer lists)
   - Expected impact: 30% reduction in DB load

2. **CloudFront CDN**
   - Static asset distribution (React bundles, images)
   - Expected impact: 50% faster page loads for distant users

3. **RDS Proxy**
   - Connection pooling at DB layer
   - Expected impact: Support for 50+ concurrent ECS tasks

### 11.2 Mid-Term (2027)

1. **Separate worker service**
   - Background jobs moved off web tasks
   - Dedicated ECS service for async processing
   - Expected impact: Isolate batch processing latency

2. **Elasticsearch for search**
   - Full-text patient search
   - Clinical data search across episodes
   - Expected impact: Sub-second search results

3. **API Gateway + Lambda**
   - Microservices for specific high-volume endpoints
   - Serverless architecture for spiky workloads
   - Expected impact: Cost reduction on variable load

### 11.3 Long-Term (2028+)

1. **Multi-region active-active**
   - Deploy to 3+ AWS regions
   - Global load balancing (Route 53 latency routing)
   - Expected impact: < 100ms latency worldwide

2. **HL7 FHIR API**
   - SMART on FHIR authorization
   - Interoperability with external EHRs
   - Expected impact: Enable health system integrations

3. **Advanced analytics pipeline**
   - Data warehouse (Redshift or Snowflake)
   - Real-time dashboards (Tableau or Looker)
   - Expected impact: Predictive analytics for patient outcomes

---

## 12. Cost Structure & Optimization

### 12.1 Current AWS Cost Breakdown (Monthly Estimate)

| Service | Configuration | Estimated Cost |
|---------|---------------|----------------|
| **ECS Fargate** | 2 tasks × 1 vCPU × 2 GB × 730 hours | $53 |
| **RDS PostgreSQL** | db.t3.medium Multi-AZ | $150 |
| **S3** | 100 GB storage, 10,000 requests | $3 |
| **ALB** | 1 load balancer, 100 GB processed | $30 |
| **CloudWatch Logs** | 10 GB ingestion, 3-month retention | $6 |
| **Secrets Manager** | 5 secrets | $2 |
| **ECR** | 20 GB storage | $2 |
| **Data Transfer** | 100 GB outbound | $9 |
| **Total** | | **~$255/month** |

**Scaling Projection:**
- At 8 tasks (peak load): ~$400/month
- At 100 concurrent users: ~$500/month
- At 1,000 concurrent users: ~$1,200/month (+ RDS upgrade)

### 12.2 Cost Optimization Strategies

1. **Reserved Instances (Future):**
   - RDS Reserved Instance (1 year, partial upfront): ~30% savings
   - Savings Plan for ECS Fargate: ~15% savings

2. **Right-Sizing:**
   - Periodic review of CPU/memory utilization
   - Scale down during off-peak hours (automated)

3. **Data Lifecycle:**
   - S3 Intelligent-Tiering (auto-transition to cheaper storage)
   - CloudWatch Logs export to S3 after 90 days

4. **Multi-Tenant Efficiency:**
   - Shared infrastructure across all clinics
   - Per-tenant cost allocation via tagging

---

## 13. Security & Compliance Contacts

**Security Incident Response:**
- Email: security@plexushealthcare.com
- Emergency: [On-call rotation, internal]

**Compliance Inquiries:**
- Email: compliance@plexushealthcare.com
- HIPAA Compliance Officer: [Name, Title]

**Technical Due Diligence:**
- Contact: [CTO Name]
- Email: cto@plexushealthcare.com

---

## Appendix A: Acronyms & Definitions

| Term | Definition |
|------|------------|
| **ALB** | Application Load Balancer (AWS) |
| **BAA** | Business Associate Agreement (HIPAA) |
| **CDN** | Content Delivery Network |
| **ECS** | Elastic Container Service (AWS) |
| **FHIR** | Fast Healthcare Interoperability Resources |
| **HL7** | Health Level 7 (healthcare data standard) |
| **HITRUST** | Health Information Trust Alliance |
| **HIPAA** | Health Insurance Portability and Accountability Act |
| **MFA** | Multi-Factor Authentication |
| **PHI** | Protected Health Information |
| **PITR** | Point-In-Time Recovery |
| **RBAC** | Role-Based Access Control |
| **RDS** | Relational Database Service (AWS) |
| **RPO** | Recovery Point Objective (max data loss) |
| **RTO** | Recovery Time Objective (max downtime) |
| **S3** | Simple Storage Service (AWS) |
| **SSE** | Server-Side Encryption |
| **TLS** | Transport Layer Security |
| **VPC** | Virtual Private Cloud (AWS) |

---

## Appendix B: References

1. **HIPAA Security Rule:** 45 CFR Part 164, Subpart C
2. **AWS HIPAA Whitepaper:** https://aws.amazon.com/compliance/hipaa-compliance/
3. **NIST Cybersecurity Framework:** https://www.nist.gov/cyberframework
4. **HITRUST CSF:** https://hitrustalliance.net/csf/
5. **Project Repository:** [Internal - GitHub Enterprise]
6. **Architecture Documentation:** See `PLEXUS_EHR_V1_ARCHITECTURE.md`
7. **Deployment Runbook:** See `DEPLOY_AWS.md`
8. **Phase Guardrails:** See `CLAUDE_PHASE_GUARDRAILS.md`

---

## Document Approval

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Chief Technology Officer | [Name] | ________________ | ________ |
| Chief Compliance Officer | [Name] | ________________ | ________ |
| Chief Executive Officer | [Name] | ________________ | ________ |

---

**End of Document**

*This document contains proprietary and confidential information. Distribution is restricted to authorized investors and stakeholders under NDA.*
