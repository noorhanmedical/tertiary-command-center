// DEMO MOCK DATA — Clinic Analytics.
//
// Replace with API-backed queries when endpoints are available. Likely
// shape:
//   GET /api/clinic-analytics/profiles            → ClinicProfile[]
//   GET /api/clinic-analytics/medications         → ClinicAnalyticsMedicationRow[]
//   GET /api/clinic-analytics/icd                 → ClinicAnalyticsIcdRow[]
//   GET /api/clinic-analytics/cpt                 → ClinicAnalyticsCptRow[]
//
// In production each clinic profile would carry its own medications/ICD/
// CPT catalog. For the demo we share one catalog across all three
// clinics so the UI behavior stays identical when the selector changes.

import type {
  ClinicAnalyticsCptRow,
  ClinicAnalyticsIcdRow,
  ClinicAnalyticsMedicationRow,
  ClinicProfile,
} from "./types";

export const CLINIC_ANALYTICS_SHARED_MEDS: ClinicAnalyticsMedicationRow[] = [
  { id: "m1", name: "Lisinopril", drugClass: "ACE Inhibitor", category: "Antihypertensives", monthlyScripts: 312, trend: "up", ancillaryRelevance: "VitalWave", revenueSignal: "High" },
  { id: "m2", name: "Amlodipine", drugClass: "Calcium Channel Blocker", category: "Cardiovascular", monthlyScripts: 268, trend: "up", ancillaryRelevance: "Ultrasound", revenueSignal: "High" },
  { id: "m3", name: "Metformin", drugClass: "Biguanide", category: "Antidiabetics", monthlyScripts: 241, trend: "flat", ancillaryRelevance: "VitalWave", revenueSignal: "Medium" },
  { id: "m4", name: "Gabapentin", drugClass: "Anticonvulsant", category: "Neurological", monthlyScripts: 198, trend: "up", ancillaryRelevance: "BrainWave", revenueSignal: "High" },
  { id: "m5", name: "Sertraline", drugClass: "SSRI", category: "Psychiatric", monthlyScripts: 176, trend: "flat", ancillaryRelevance: "BrainWave / PGX", revenueSignal: "Medium" },
  { id: "m6", name: "Oxycodone", drugClass: "Opioid Analgesic", category: "Pain Management", monthlyScripts: 84, trend: "down", ancillaryRelevance: "CGX / PGX", revenueSignal: "Medium" },
  { id: "m7", name: "Atorvastatin", drugClass: "Statin", category: "Cardiovascular", monthlyScripts: 289, trend: "up", ancillaryRelevance: "Ultrasound", revenueSignal: "High" },
  { id: "m8", name: "Pregabalin", drugClass: "Anticonvulsant", category: "Neurological", monthlyScripts: 112, trend: "up", ancillaryRelevance: "BrainWave", revenueSignal: "Medium" },
  { id: "m9", name: "Duloxetine", drugClass: "SNRI", category: "Psychiatric", monthlyScripts: 97, trend: "flat", ancillaryRelevance: "BrainWave", revenueSignal: "Low" },
  { id: "m10", name: "Hydrochlorothiazide", drugClass: "Thiazide Diuretic", category: "Antihypertensives", monthlyScripts: 154, trend: "flat", ancillaryRelevance: "VitalWave", revenueSignal: "Medium" },
];

export const CLINIC_ANALYTICS_SHARED_ICD: ClinicAnalyticsIcdRow[] = [
  { id: "i1", code: "I10", description: "Essential (primary) hypertension", category: "Cardiovascular", frequency: 412, revenueOpportunity: 84000, qualifyingAncillaries: ["VitalWave", "Ultrasound"], trend: "up" },
  { id: "i2", code: "E11.9", description: "Type 2 diabetes mellitus without complications", category: "Metabolic", frequency: 318, revenueOpportunity: 67500, qualifyingAncillaries: ["VitalWave"], trend: "up" },
  { id: "i3", code: "G62.9", description: "Polyneuropathy, unspecified", category: "Neurological", frequency: 187, revenueOpportunity: 71200, qualifyingAncillaries: ["BrainWave"], trend: "up" },
  { id: "i4", code: "I25.10", description: "Atherosclerotic heart disease of native coronary artery", category: "Cardiovascular", frequency: 142, revenueOpportunity: 58900, qualifyingAncillaries: ["Ultrasound", "EKG"], trend: "flat" },
  { id: "i5", code: "F41.1", description: "Generalized anxiety disorder", category: "Mental Health", frequency: 121, revenueOpportunity: 22400, qualifyingAncillaries: ["BrainWave", "PGX"], trend: "up" },
  { id: "i6", code: "G47.33", description: "Obstructive sleep apnea", category: "Neurological", frequency: 96, revenueOpportunity: 34800, qualifyingAncillaries: ["BrainWave"], trend: "up" },
  { id: "i7", code: "E78.5", description: "Hyperlipidemia, unspecified", category: "Metabolic", frequency: 276, revenueOpportunity: 41000, qualifyingAncillaries: ["Ultrasound"], trend: "flat" },
  { id: "i8", code: "F32.9", description: "Major depressive disorder, single episode", category: "Mental Health", frequency: 88, revenueOpportunity: 19800, qualifyingAncillaries: ["PGX"], trend: "down" },
];

export const CLINIC_ANALYTICS_SHARED_CPT: ClinicAnalyticsCptRow[] = [
  { id: "c1", code: "95885", description: "Needle EMG, limited study", service: "BrainWave", category: "BrainWave", fee: 168, monthlyFrequency: 64, payerAcceptance: 92, relatedAncillary: "Neuropathy panel" },
  { id: "c2", code: "95910", description: "Nerve conduction studies, 7-8", service: "BrainWave", category: "BrainWave", fee: 412, monthlyFrequency: 58, payerAcceptance: 88, relatedAncillary: "Neuropathy panel" },
  { id: "c3", code: "93923", description: "Lower extremity arterial study", service: "VitalWave", category: "VitalWave", fee: 224, monthlyFrequency: 72, payerAcceptance: 90, relatedAncillary: "PAD screening" },
  { id: "c4", code: "93970", description: "Duplex scan extremity veins, bilateral", service: "Ultrasound", category: "Ultrasound", fee: 286, monthlyFrequency: 81, payerAcceptance: 94, relatedAncillary: "Venous duplex" },
  { id: "c5", code: "93306", description: "Echocardiography, transthoracic, complete", service: "Ultrasound", category: "Ultrasound", fee: 348, monthlyFrequency: 47, payerAcceptance: 91, relatedAncillary: "Cardiac echo" },
  { id: "c6", code: "93000", description: "Electrocardiogram, complete", service: "EKG", category: "EKG", fee: 52, monthlyFrequency: 134, payerAcceptance: 96, relatedAncillary: "Cardiac screen" },
  { id: "c7", code: "81225", description: "CYP2C19 gene analysis", service: "PGX", category: "PGX/CGX", fee: 318, monthlyFrequency: 22, payerAcceptance: 74, relatedAncillary: "Pharmacogenomics" },
  { id: "c8", code: "81479", description: "Unlisted molecular pathology (CGX)", service: "CGX", category: "PGX/CGX", fee: 540, monthlyFrequency: 14, payerAcceptance: 68, relatedAncillary: "Cancer genomics" },
];

export const CLINIC_ANALYTICS_PROFILES: ClinicProfile[] = [
  {
    id: "summit",
    name: "Summit Family Medicine",
    location: "Phoenix, AZ",
    status: "Active",
    providers: 6,
    examRooms: 12,
    dailyVolume: 138,
    totalPatients: 9420,
    emr: "Athenahealth",
    specialty: "Primary Care / Internal Medicine",
    mainContact: "Dr. Elena Marsh",
    phone: "(602) 555-0142",
    goLiveDate: "2024-03-18",
    activeAncillaryServices: ["BrainWave", "VitalWave", "Ultrasound", "EKG"],
    opportunityScore: 87,
    payorMix: { medicare: 46, ppo: 28, medicaid: 9, cash: 5, commercial: 12, highValueAncillary: true, riskNotes: "Strong Medicare base supports high-reimbursement ancillaries." },
    financial: { monthlyRevenue: 742000, ancillaryOpportunity: 218000, arDays: 31, collectionRate: 94, denialRate: 6, billingReadinessScore: 88, financialRisk: "Low" },
    demographics: { totalPatients: 9420, averageAge: 58, medicareEligiblePct: 51, chronicDiseasePct: 44, commonDiagnoses: ["Hypertension", "Type 2 Diabetes", "Hyperlipidemia", "Neuropathy"], highRiskCount: 1240 },
    capacity: { providers: 6, examRooms: 12, dailyVolume: 138, staffCount: 28, ancillaryCapacityScore: 90, supports: { brainWave: true, vitalWave: true, ultrasound: true }, implementationComplexity: "Low" },
    team: { totalStaff: 28, officeManager: "Karen Diaz", medicalAssistants: 8, billingContact: "Ray Okafor", turnoverRate: 11, trainingNeedScore: 2, operationalMaturityScore: 86 },
    credit: { score: 88, operationalRisk: "Low", financialRisk: "Low", complianceRisk: "Low", staffingRisk: "Moderate", recommendation: "Approve" },
    ai: {
      strengths: ["High Medicare-eligible population", "Mature EMR utilization", "Existing ancillary infrastructure"],
      concerns: ["Front-desk staffing turnover", "Prior auth backlog on imaging"],
      revenueOpportunities: ["Expand neuropathy BrainWave volume", "Add cardiac echo ultrasound days"],
      suggestedAncillaries: ["BrainWave", "Ultrasound (Echo)", "VitalWave"],
      implementationRisks: ["MA training bandwidth during peak season"],
      finalRecommendation: "Strong onboarding candidate — fast path to ancillary revenue with low operational risk.",
    },
    revenue: { medicationImpact: 96000, icdImpact: 184000, cptImpact: 142000, totalOpportunity: 422000, plexusSharePct: 35, clinicSharePct: 65 },
    medications: CLINIC_ANALYTICS_SHARED_MEDS,
    icdCodes: CLINIC_ANALYTICS_SHARED_ICD,
    cptCodes: CLINIC_ANALYTICS_SHARED_CPT,
  },
  {
    id: "riverside",
    name: "Riverside Cardiology Group",
    location: "Austin, TX",
    status: "In Review",
    providers: 4,
    examRooms: 8,
    dailyVolume: 92,
    totalPatients: 5380,
    emr: "Epic",
    specialty: "Cardiology",
    mainContact: "Dr. Priya Nadar",
    phone: "(512) 555-0188",
    goLiveDate: "2025-01-06",
    activeAncillaryServices: ["VitalWave", "Ultrasound", "EKG"],
    opportunityScore: 72,
    payorMix: { medicare: 58, ppo: 22, medicaid: 4, cash: 3, commercial: 13, highValueAncillary: true, riskNotes: "Heavy Medicare concentration — monitor reimbursement policy shifts." },
    financial: { monthlyRevenue: 1120000, ancillaryOpportunity: 264000, arDays: 38, collectionRate: 91, denialRate: 9, billingReadinessScore: 79, financialRisk: "Moderate" },
    demographics: { totalPatients: 5380, averageAge: 66, medicareEligiblePct: 64, chronicDiseasePct: 58, commonDiagnoses: ["CAD", "Hypertension", "Hyperlipidemia", "Atrial Fibrillation"], highRiskCount: 1610 },
    capacity: { providers: 4, examRooms: 8, dailyVolume: 92, staffCount: 22, ancillaryCapacityScore: 76, supports: { brainWave: false, vitalWave: true, ultrasound: true }, implementationComplexity: "Medium" },
    team: { totalStaff: 22, officeManager: "Sandra Cole", medicalAssistants: 5, billingContact: "Miguel Santos", turnoverRate: 18, trainingNeedScore: 3, operationalMaturityScore: 74 },
    credit: { score: 76, operationalRisk: "Moderate", financialRisk: "Moderate", complianceRisk: "Low", staffingRisk: "Elevated", recommendation: "Approve with caution" },
    ai: {
      strengths: ["Cardiology specialty aligns with ultrasound/echo", "High AR per visit", "Engaged physician champion"],
      concerns: ["Elevated denial rate", "Staffing turnover above benchmark", "No BrainWave capability today"],
      revenueOpportunities: ["Scale echo and venous duplex volume", "Introduce VitalWave PAD screening"],
      suggestedAncillaries: ["Ultrasound (Echo)", "VitalWave"],
      implementationRisks: ["Epic integration scope", "Denial-management workflow gaps"],
      finalRecommendation: "Approve with caution — high revenue ceiling offset by billing and staffing risk; require remediation plan.",
    },
    revenue: { medicationImpact: 64000, icdImpact: 212000, cptImpact: 178000, totalOpportunity: 454000, plexusSharePct: 38, clinicSharePct: 62 },
    medications: CLINIC_ANALYTICS_SHARED_MEDS,
    icdCodes: CLINIC_ANALYTICS_SHARED_ICD,
    cptCodes: CLINIC_ANALYTICS_SHARED_CPT,
  },
  {
    id: "lakeside",
    name: "Lakeside Community Health",
    location: "Toledo, OH",
    status: "Prospect",
    providers: 3,
    examRooms: 6,
    dailyVolume: 64,
    totalPatients: 4110,
    emr: "eClinicalWorks",
    specialty: "Family Medicine / FQHC",
    mainContact: "Dr. Omar Bello",
    phone: "(419) 555-0119",
    goLiveDate: "2025-04-22",
    activeAncillaryServices: ["EKG"],
    opportunityScore: 54,
    payorMix: { medicare: 24, ppo: 14, medicaid: 48, cash: 9, commercial: 5, highValueAncillary: false, riskNotes: "High Medicaid mix lowers ancillary reimbursement and raises denial risk." },
    financial: { monthlyRevenue: 318000, ancillaryOpportunity: 74000, arDays: 52, collectionRate: 82, denialRate: 15, billingReadinessScore: 58, financialRisk: "Elevated" },
    demographics: { totalPatients: 4110, averageAge: 47, medicareEligiblePct: 27, chronicDiseasePct: 39, commonDiagnoses: ["Type 2 Diabetes", "Hypertension", "Depression", "Obesity"], highRiskCount: 720 },
    capacity: { providers: 3, examRooms: 6, dailyVolume: 64, staffCount: 15, ancillaryCapacityScore: 52, supports: { brainWave: false, vitalWave: false, ultrasound: false }, implementationComplexity: "High" },
    team: { totalStaff: 15, officeManager: "Tina Brooks", medicalAssistants: 3, billingContact: "Outsourced (RCM partner)", turnoverRate: 27, trainingNeedScore: 4, operationalMaturityScore: 51 },
    credit: { score: 49, operationalRisk: "High", financialRisk: "Elevated", complianceRisk: "Moderate", staffingRisk: "High", recommendation: "Needs remediation" },
    ai: {
      strengths: ["Underserved population with chronic disease burden", "Motivated medical director"],
      concerns: ["High Medicaid mix", "Low billing readiness", "No ancillary infrastructure", "High staff turnover"],
      revenueOpportunities: ["Start with EKG + VitalWave pilot", "Grant-supported chronic care management"],
      suggestedAncillaries: ["VitalWave (pilot)", "EKG"],
      implementationRisks: ["Equipment capital needs", "Workflow maturity", "Reimbursement viability"],
      finalRecommendation: "Needs remediation — meaningful clinical need but operational and financial readiness must improve before go-live.",
    },
    revenue: { medicationImpact: 28000, icdImpact: 58000, cptImpact: 39000, totalOpportunity: 125000, plexusSharePct: 40, clinicSharePct: 60 },
    medications: CLINIC_ANALYTICS_SHARED_MEDS,
    icdCodes: CLINIC_ANALYTICS_SHARED_ICD,
    cptCodes: CLINIC_ANALYTICS_SHARED_CPT,
  },
];
