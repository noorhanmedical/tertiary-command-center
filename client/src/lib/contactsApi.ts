// contactsApi — Phase 2 PR 2.7

export type ContactCategory =
  | "facility"
  | "physician"
  | "vendor_report"
  | "escalation"
  | "team_member";

export type ContactRow = {
  id: number;
  category: ContactCategory;
  name: string;
  role: string | null;
  organization: string | null;
  facilityId: string | null;
  phone: string;
  email: string | null;
  notes: string | null;
  userId: string | null;
  isOnCall: boolean;
  metadata: Record<string, unknown>;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchContacts(filters: {
  category?: ContactCategory;
  facilityId?: string;
  includeArchived?: boolean;
} = {}): Promise<ContactRow[]> {
  const qs = new URLSearchParams();
  if (filters.category) qs.set("category", filters.category);
  if (filters.facilityId) qs.set("facilityId", filters.facilityId);
  if (filters.includeArchived) qs.set("includeArchived", "true");
  const res = await fetch(`/api/contacts${qs.toString() ? `?${qs}` : ""}`, { credentials: "include" });
  return jsonOrThrow<ContactRow[]>(res);
}

export const CONTACT_CATEGORY_LABELS: Record<ContactCategory, string> = {
  facility: "Facility",
  physician: "Physician",
  vendor_report: "Vendor / report",
  escalation: "Escalation",
  team_member: "Team member",
};
