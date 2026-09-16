/**
 * Server-side call-list PDF generation.
 *
 * Renders a durable PDF for a frozen call-list package using `pdf-lib` (pure
 * JS — no headless browser, smallest reliable option already in the repo). The
 * PDF is built ONLY from the immutable package + member snapshot passed in; it
 * NEVER queries live/mutable patient lists to decide membership. This removes
 * the prior requirement that a manager open the package in a browser to render
 * it client-side.
 *
 * Content mirrors the approved team-delivery call list: header (facility, team
 * member, cohort, service date, patient count) + one row per frozen member
 * (name, DOB, phone, services, reason). NO internal DB ids / primary keys / MRN
 * / secure tokens are printed.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

// Structural snapshot shapes (avoid coupling to the full Drizzle row types).
export type CallListPdfMember = {
  patientNameSnapshot?: string | null;
  patientDobSnapshot?: string | null;
  patientPhoneSnapshot?: string | null;
  servicesSnapshot?: unknown;
  reasonForCallSnapshot?: string | null;
};
export type CallListPdfPackage = {
  id: number;
  teamMemberNameSnapshot?: string | null;
  facilityId?: string | null;
  cohortLabelSnapshot?: string | null;
  serviceDate?: string | null;
  patientCount?: number | null;
  createdAt?: Date | string | null;
};

const PAGE_W = 612; // US Letter portrait
const PAGE_H = 792;
const MARGIN = 48;
const ROW_H = 22;
const HEADER_BLOCK_H = 96;

// Columns: label + relative x + max chars (truncation is deterministic).
const COLUMNS = [
  { key: "idx", label: "#", x: MARGIN, width: 24, max: 4 },
  { key: "name", label: "Patient", x: MARGIN + 26, width: 150, max: 30 },
  { key: "dob", label: "DOB", x: MARGIN + 178, width: 70, max: 12 },
  { key: "phone", label: "Phone", x: MARGIN + 250, width: 90, max: 16 },
  { key: "services", label: "Services", x: MARGIN + 342, width: 130, max: 26 },
  { key: "reason", label: "Reason", x: MARGIN + 474, width: 90, max: 18 },
] as const;

function sanitize(v: unknown): string {
  if (v == null) return "";
  // pdf-lib StandardFonts (WinAnsi) cannot encode arbitrary unicode; strip to
  // a safe ASCII-ish subset so rendering never throws on odd EHR characters.
  return String(v).replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim();
}
function trunc(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}\u2026`.replace(/\u2026/, "~");
}
function servicesText(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => sanitize(x)).filter(Boolean).join(", ");
  return sanitize(v);
}

function drawHeader(page: PDFPage, pkg: CallListPdfPackage, font: PDFFont, bold: PDFFont, memberCount: number) {
  let y = PAGE_H - MARGIN;
  page.drawText("Plexus Call List", { x: MARGIN, y, size: 18, font: bold, color: rgb(0.1, 0.1, 0.1) });
  y -= 22;
  const line = (label: string, value: string) => {
    page.drawText(label, { x: MARGIN, y, size: 10, font: bold, color: rgb(0.35, 0.35, 0.35) });
    page.drawText(sanitize(value) || "-", { x: MARGIN + 110, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
    y -= 15;
  };
  line("Team Member:", pkg.teamMemberNameSnapshot ?? "Unassigned");
  line("Facility:", pkg.facilityId ?? "-");
  line("Cohort:", pkg.cohortLabelSnapshot ?? "-");
  line("Service Date:", pkg.serviceDate ?? "-");
  line("Patients:", String(memberCount));
}

function drawColumnHeader(page: PDFPage, y: number, bold: PDFFont) {
  for (const c of COLUMNS) {
    page.drawText(c.label, { x: c.x, y, size: 9, font: bold, color: rgb(0.3, 0.3, 0.3) });
  }
  page.drawLine({ start: { x: MARGIN, y: y - 4 }, end: { x: PAGE_W - MARGIN, y: y - 4 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
}

/** Render a frozen package + members to a PDF Buffer. Deterministic; no I/O. */
export async function renderCallListPdf(pkg: CallListPdfPackage, members: CallListPdfMember[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Call List ${pkg.id}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  drawHeader(page, pkg, font, bold, members.length);
  let y = PAGE_H - MARGIN - HEADER_BLOCK_H;
  drawColumnHeader(page, y, bold);
  y -= ROW_H;

  members.forEach((m, i) => {
    if (y < MARGIN + ROW_H) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
      drawColumnHeader(page, y, bold);
      y -= ROW_H;
    }
    const cells: Record<string, string> = {
      idx: String(i + 1),
      name: trunc(sanitize(m.patientNameSnapshot), COLUMNS[1].max),
      dob: trunc(sanitize(m.patientDobSnapshot), COLUMNS[2].max),
      phone: trunc(sanitize(m.patientPhoneSnapshot), COLUMNS[3].max),
      services: trunc(servicesText(m.servicesSnapshot), COLUMNS[4].max),
      reason: trunc(sanitize(m.reasonForCallSnapshot), COLUMNS[5].max),
    };
    for (const c of COLUMNS) {
      page.drawText(cells[c.key] ?? "", { x: c.x, y, size: 9, font, color: rgb(0.12, 0.12, 0.12) });
    }
    y -= ROW_H;
  });

  // Page footers with page numbers (no PHI, no ids beyond the package label).
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawText(`Page ${i + 1} of ${pages.length}`, { x: PAGE_W - MARGIN - 80, y: MARGIN - 24, size: 8, font, color: rgb(0.5, 0.5, 0.5) });
  });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

import { getPackageWithMembers, setGenerationStatus } from "../../repositories/callListPackages.repo";
import { saveBlob } from "../blobStore";

export type GeneratePdfResult =
  | { ok: true; packageId: number; pdfBlobId: number; patientCount: number; status: "ready" }
  | { ok: false; packageId: number; status: "failed" | "not_found"; error: string };

/**
 * Generate + store the PDF for a package server-side, from its FROZEN snapshot.
 * Idempotent-friendly: `force=false` skips a package that already has a ready
 * PDF (returns the existing blob). `force=true` renders a fresh artifact
 * WITHOUT touching membership. On failure the package is marked `failed`
 * (retryable) — assignments/membership are never mutated here.
 */
export async function generateAndStoreCallListPdf(
  id: number,
  opts: { force?: boolean } = {},
): Promise<GeneratePdfResult> {
  const loaded = await getPackageWithMembers(id);
  if (!loaded) return { ok: false, packageId: id, status: "not_found", error: "package not found" };
  const { pkg, members } = loaded as { pkg: CallListPdfPackage & { pdfBlobId?: number | null; generationStatus?: string }; members: CallListPdfMember[] };

  if (!opts.force && pkg.generationStatus === "ready" && pkg.pdfBlobId != null) {
    return { ok: true, packageId: id, pdfBlobId: pkg.pdfBlobId, patientCount: members.length, status: "ready" };
  }

  try {
    await setGenerationStatus(id, "generating", { errorCode: null });
    const buffer = await renderCallListPdf(pkg, members);
    if (!buffer || buffer.length === 0) throw new Error("rendered PDF is empty");
    const blob = await saveBlob({
      ownerType: "call_list_package",
      ownerId: id,
      filename: `call-list-${id}-${pkg.serviceDate ?? "list"}.pdf`,
      contentType: "application/pdf",
      buffer,
    });
    await setGenerationStatus(id, "ready", { pdfBlobId: blob.id, errorCode: null });
    return { ok: true, packageId: id, pdfBlobId: blob.id, patientCount: members.length, status: "ready" };
  } catch (e) {
    await setGenerationStatus(id, "failed", { errorCode: "server_render_failed" }).catch(() => {});
    return { ok: false, packageId: id, status: "failed", error: (e as Error)?.message ?? String(e) };
  }
}
