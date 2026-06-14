// billingReportsApi — Phase 4 PR 4.8.

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export type EodReport = Record<string, any> & { date: string };
export type WeeklyReport = Record<string, any> & { weekStart: string };
export type MonthlyReport = Record<string, any> & { month: string };

export async function fetchEod(date?: string, facilityId?: string): Promise<EodReport> {
  const qs = new URLSearchParams();
  if (date) qs.set("date", date);
  if (facilityId) qs.set("facilityId", facilityId);
  const res = await fetch(`/api/billing-reports/eod${qs.toString() ? `?${qs}` : ""}`, { credentials: "include" });
  return jsonOrThrow<EodReport>(res);
}

export async function fetchWeekly(weekStart?: string, facilityId?: string): Promise<WeeklyReport> {
  const qs = new URLSearchParams();
  if (weekStart) qs.set("weekStart", weekStart);
  if (facilityId) qs.set("facilityId", facilityId);
  const res = await fetch(`/api/billing-reports/weekly${qs.toString() ? `?${qs}` : ""}`, { credentials: "include" });
  return jsonOrThrow<WeeklyReport>(res);
}

export async function fetchMonthly(month?: string, facilityId?: string): Promise<MonthlyReport> {
  const qs = new URLSearchParams();
  if (month) qs.set("month", month);
  if (facilityId) qs.set("facilityId", facilityId);
  const res = await fetch(`/api/billing-reports/monthly${qs.toString() ? `?${qs}` : ""}`, { credentials: "include" });
  return jsonOrThrow<MonthlyReport>(res);
}
