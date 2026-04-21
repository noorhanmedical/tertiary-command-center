import nodemailer, { type Transporter } from "nodemailer";

export interface OutreachEmailAttachment {
  filename: string;
  content: string | Buffer;
  contentType?: string;
}

export interface SendOutreachEmailInput {
  to: string | string[];
  cc?: string | string[];
  subject: string;
  body: string;
  attachments?: OutreachEmailAttachment[];
}

export interface SendOutreachEmailResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
}

let cachedTransporter: Transporter | null = null;

function buildTransporterFromEnv(): Transporter {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error(
      "Email is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM in the project secrets to enable outbound email.",
    );
  }
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`SMTP_PORT must be a valid port number (got "${process.env.SMTP_PORT}")`);
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

function getTransporter(): Transporter {
  if (!cachedTransporter) cachedTransporter = buildTransporterFromEnv();
  return cachedTransporter;
}

/** Test-only hook so the suite can swap in a stub transport. */
export function _setTransporterForTests(t: Transporter | null): void {
  cachedTransporter = t;
}

function isValidEmail(addr: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr.trim());
}

export function emailFromAddress(): string {
  const from = process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim();
  if (!from) {
    throw new Error(
      "No sender address configured. Set SMTP_FROM (or SMTP_USER) in the project secrets.",
    );
  }
  return from;
}

function normalizeRecipients(value: string | string[] | undefined, label: string): string[] {
  if (value == null) return [];
  const list = Array.isArray(value)
    ? value
    : value.split(/[,;]+/);
  const cleaned = list.map((v) => v.trim()).filter((v) => v.length > 0);
  for (const addr of cleaned) {
    if (!isValidEmail(addr)) {
      throw new Error(`"${addr}" is not a valid ${label} email address.`);
    }
  }
  return cleaned;
}

export async function sendOutreachEmail(
  input: SendOutreachEmailInput,
): Promise<SendOutreachEmailResult> {
  const to = normalizeRecipients(input.to, "recipient");
  if (to.length === 0) {
    throw new Error("At least one recipient is required.");
  }
  const cc = normalizeRecipients(input.cc, "CC");
  const subject = input.subject.trim();
  if (!subject) throw new Error("Subject is required.");
  const body = input.body;
  if (!body || !body.trim()) throw new Error("Email body is required.");

  const transporter = getTransporter();
  const from = emailFromAddress();

  const info = await transporter.sendMail({
    from,
    to,
    cc: cc.length > 0 ? cc : undefined,
    subject,
    text: body,
    attachments: input.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
    })),
  });

  return {
    messageId: info.messageId,
    accepted: (info.accepted ?? []).map(String),
    rejected: (info.rejected ?? []).map(String),
  };
}
