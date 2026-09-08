import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, X, ImageUp, CircleAlert } from "lucide-react";
import { getZonedTime } from "@/lib/worldTime/time";
import { slugify, suggestLandmark } from "@/lib/worldTime/locations";
import type { WorldTimeImageRecord, WorldTimeImageStatus } from "@/lib/worldTime/types";
import { WorldTimeCard } from "@/components/world-time/WorldTimeCard";

// ─────────────────────────────────────────────────────────────────────────
// WorldTimeImageApproval — admin surface for the World Time image workflow.
//
//   NEW LOCATION → propose candidate landmark image → PENDING_APPROVAL →
//   admin reviews the EXACT production card preview → APPROVE / REJECT →
//   only APPROVED imagery becomes visible on the Home dashboard.
//
// Timezone configuration and image approval are independent: an un-approved
// location still shows its time on the Plexus fallback gradient. This surface
// is mounted inside /admin/settings (AdminGuard) and every mutation is also
// enforced admin-only server-side.
// ─────────────────────────────────────────────────────────────────────────

type ClockCity = { label: string; timeZone: string };

const POSITION_PRESETS = [
  "center center",
  "center top",
  "center bottom",
  "left center",
  "right center",
  "center 35%",
  "center 40%",
  "center 45%",
  "center 50%",
  "center 55%",
  "center 58%",
];

const STATUS_META: Record<WorldTimeImageStatus, { label: string; className: string }> = {
  approved: { label: "Approved", className: "bg-emerald-100 text-emerald-700" },
  pending_approval: { label: "Pending approval", className: "bg-amber-100 text-amber-700" },
  rejected: { label: "Rejected", className: "bg-rose-100 text-rose-700" },
  needs_replacement: { label: "Needs replacement", className: "bg-orange-100 text-orange-700" },
  no_image: { label: "No image", className: "bg-slate-100 text-slate-600" },
};

function StatusBadge({ status }: { status: WorldTimeImageStatus }) {
  const m = STATUS_META[status] ?? STATUS_META.no_image;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${m.className}`}>
      {m.label}
    </span>
  );
}

function LocationApprovalRow({
  city,
  record,
  now,
}: {
  city: ClockCity;
  record: WorldTimeImageRecord | undefined;
  now: Date;
}) {
  const { toast } = useToast();
  const slug = slugify(city.label);
  const suggestion = useMemo(() => suggestLandmark(slug, city.label), [slug, city.label]);

  // Draft candidate — prefilled from the current record, else from the iconic
  // landmark suggestion for this location.
  const [assetUrl, setAssetUrl] = useState(record?.assetUrl ?? suggestion.bundledAsset ?? "");
  const [landmarkName, setLandmarkName] = useState(record?.landmarkName ?? suggestion.landmarkName);
  const [imagePosition, setImagePosition] = useState(record?.imagePosition ?? suggestion.imagePosition);

  useEffect(() => {
    setAssetUrl(record?.assetUrl ?? suggestion.bundledAsset ?? "");
    setLandmarkName(record?.landmarkName ?? suggestion.landmarkName);
    setImagePosition(record?.imagePosition ?? suggestion.imagePosition);
  }, [record?.assetUrl, record?.landmarkName, record?.imagePosition, suggestion]);

  const status: WorldTimeImageStatus = record?.status ?? "no_image";
  const time = getZonedTime(city.timeZone, now);

  // Persistent inline error so a failed request is always visible (a missed
  // toast otherwise reads as "nothing happens"). Surfaces the HTTP status so an
  // unregistered route (404 — dev server not restarted) is diagnosable.
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/world-time/images"] });
    queryClient.invalidateQueries({ queryKey: ["/api/settings/world-time/images"] });
  };
  const onErr = (title: string) => (e: any) => {
    const msg = e?.message ?? "Request failed";
    setError(`${title}: ${msg}`);
    toast({ title, description: msg, variant: "destructive" });
  };

  const propose = useMutation({
    mutationFn: async () => {
      setError(null);
      const res = await apiRequest("PUT", `/api/admin/world-time/images/${slug}`, {
        assetUrl: assetUrl.trim(),
        landmarkName: landmarkName.trim(),
        imagePosition: imagePosition.trim(),
      });
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Candidate saved", description: `${city.label} is pending approval.` });
    },
    onError: onErr("Could not save candidate"),
  });

  const approve = useMutation({
    mutationFn: async () => {
      setError(null);
      return (await apiRequest("POST", `/api/admin/world-time/images/${slug}/approve`, {})).json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Image approved", description: `${city.label} now uses its approved image.` });
    },
    onError: onErr("Could not approve"),
  });

  const reject = useMutation({
    mutationFn: async () => {
      setError(null);
      return (await apiRequest("POST", `/api/admin/world-time/images/${slug}/reject`, {})).json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Image rejected", description: `${city.label} reverted to the fallback background.` });
    },
    onError: onErr("Could not reject"),
  });

  // Approve directly from the editor: if no candidate is persisted yet (e.g. a
  // seeded city, or a fresh draft), save it first so the server has a record to
  // approve — then approve. One click, no "propose first" dead-end.
  const approveFlow = async () => {
    setError(null);
    try {
      if (!record || record.assetUrl !== assetUrl.trim() || record.landmarkName !== landmarkName.trim()) {
        await propose.mutateAsync();
      }
      await approve.mutateAsync();
    } catch {
      /* onError handlers already surfaced the failure */
    }
  };

  // The admin preview shows the CANDIDATE image (whatever is drafted/stored),
  // so the reviewer approves the final visual result. The production dashboard
  // only ever renders APPROVED records (enforced separately).
  const previewImage = assetUrl.trim()
    ? { assetUrl: assetUrl.trim(), imagePosition, landmarkName }
    : null;

  const busy = propose.isPending || approve.isPending || reject.isPending;

  return (
    <div className="rounded-xl border border-slate-200 p-4" data-testid={`wt-approval-${slug}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-slate-900">{city.label}</h4>
            <StatusBadge status={status} />
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {city.timeZone} · proposed landmark: <span className="font-medium text-slate-700">{landmarkName || "—"}</span>
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-4 md:grid-cols-[260px_1fr]">
        {/* Exact production card preview (rendered on a dark mat so the card
            reads the same way it does on the Home dashboard). */}
        <div>
          <div className="rounded-2xl bg-slate-900 p-3">
            <WorldTimeCard
              label={city.label}
              time={time.digital}
              abbr={time.abbr}
              date={time.date}
              image={previewImage}
              localHour={time.hours}
              className="w-full"
              data-testid={`wt-preview-${slug}`}
            />
          </div>
          <p className="mt-1 text-center text-[11px] text-slate-400">
            {previewImage ? "Live production preview" : "Fallback (no image)"}
          </p>
        </div>

        {/* Candidate editor + actions */}
        <div className="space-y-2.5">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label className="text-xs">Image URL</Label>
              <Input
                value={assetUrl}
                placeholder="/world-time/dubai.svg or https://…"
                onChange={(e) => setAssetUrl(e.target.value)}
                className="h-8"
                data-testid={`wt-asseturl-${slug}`}
              />
            </div>
            <div>
              <Label className="text-xs">Landmark</Label>
              <Input
                value={landmarkName}
                onChange={(e) => setLandmarkName(e.target.value)}
                className="h-8"
                data-testid={`wt-landmark-${slug}`}
              />
            </div>
            <div>
              <Label className="text-xs">Crop / focal point</Label>
              <Select value={imagePosition} onValueChange={setImagePosition}>
                <SelectTrigger className="h-8" data-testid={`wt-position-${slug}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(POSITION_PRESETS.includes(imagePosition) ? POSITION_PRESETS : [imagePosition, ...POSITION_PRESETS]).map(
                    (p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={busy || !assetUrl.trim() || !landmarkName.trim()}
              onClick={() => propose.mutate()}
              data-testid={`wt-propose-${slug}`}
            >
              <ImageUp className="h-3.5 w-3.5" />
              {record ? "Save / replace candidate" : "Propose candidate"}
            </Button>
            <Button
              type="button"
              size="sm"
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
              disabled={busy || !assetUrl.trim() || status === "approved"}
              onClick={() => approveFlow()}
              data-testid={`wt-approve-${slug}`}
            >
              <Check className="h-3.5 w-3.5" />
              Approve
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 text-rose-600 hover:text-rose-700"
              disabled={busy || status === "rejected" || status === "no_image"}
              onClick={() => reject.mutate()}
              data-testid={`wt-reject-${slug}`}
            >
              <X className="h-3.5 w-3.5" />
              Reject
            </Button>
          </div>

          {error && (
            <p
              className="flex items-start gap-1.5 rounded-md bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-700"
              data-testid={`wt-error-${slug}`}
            >
              <CircleAlert className="mt-px h-3 w-3 shrink-0" />
              <span>
                {error}
                {/^Could not.*: 404/.test(error) ? " — the dev server likely needs a restart (npm run dev)." : ""}
              </span>
            </p>
          )}

          {status !== "approved" && (
            <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <CircleAlert className="h-3 w-3" />
              Only an approved image appears on the Home dashboard. Until then this location uses the Plexus fallback.
            </p>
          )}
          {record?.approvedBy && status === "approved" && (
            <p className="text-[11px] text-slate-400">
              Approved by {record.approvedBy}
              {record.approvedAt ? ` · ${new Date(record.approvedAt).toLocaleDateString()}` : ""}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function WorldTimeImageApproval() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const { data: clockData } = useQuery<{ cities: ClockCity[] }>({
    queryKey: ["/api/settings/world-clocks"],
  });
  const { data: imageData, isLoading } = useQuery<{ images: Record<string, WorldTimeImageRecord> }>({
    queryKey: ["/api/admin/world-time/images"],
  });

  const cities = clockData?.cities ?? [];
  const registry = imageData?.images ?? {};

  return (
    <div className="space-y-3" data-testid="world-time-image-approval">
      <p className="text-sm text-slate-500">
        Review and approve the background imagery used by the World Time cards on the Home dashboard. Each preview shows the
        exact production treatment. Approving an image is explicit — selecting or saving a candidate is not approval.
      </p>
      {isLoading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : cities.length === 0 ? (
        <p className="text-sm text-slate-400">No World Time locations are configured yet.</p>
      ) : (
        <div className="space-y-3">
          {cities.map((city) => (
            <LocationApprovalRow
              key={`${city.label}-${city.timeZone}`}
              city={city}
              record={registry[slugify(city.label)]}
              now={now}
            />
          ))}
        </div>
      )}
    </div>
  );
}
