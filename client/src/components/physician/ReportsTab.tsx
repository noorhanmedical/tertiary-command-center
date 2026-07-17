import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface ReportRow {
  id: number;
  patientScreeningId: number | null;
  patientName: string | null;
  patientDob: string | null;
  clinic: string | null;
  serviceType: string;
  resultStatus: string;
  procedureStatus: string | null;
  signatureStatus: string | null;
  billingStatus: string | null;
  completedAt: string | null;
  updatedAt: string | null;
}

const SERVICE_TYPES = ["BrainWave", "VitalWave", "Ultrasound", "PGx"];

function fmtDate(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

export function ReportsTab() {
  const [clinic, setClinic] = useState("");
  const [ancillaryType, setAncillaryType] = useState("all");
  const [resultStatus, setResultStatus] = useState("all");

  const params = new URLSearchParams();
  if (clinic.trim()) params.set("clinic", clinic.trim());
  if (ancillaryType !== "all") params.set("ancillaryType", ancillaryType);
  if (resultStatus !== "all") params.set("resultStatus", resultStatus);
  const qs = params.toString();

  const { data: rows = [], isLoading } = useQuery<ReportRow[]>({
    queryKey: ["/api/physician-portal/reports", clinic, ancillaryType, resultStatus],
    queryFn: async () => {
      const res = await fetch(`/api/physician-portal/reports${qs ? `?${qs}` : ""}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load reports");
      return res.json();
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Filter by clinic…"
          value={clinic}
          onChange={(e) => setClinic(e.target.value)}
          className="w-[200px]"
          data-testid="input-reports-clinic"
        />
        <Select value={ancillaryType} onValueChange={setAncillaryType}>
          <SelectTrigger className="w-[180px]" data-testid="select-reports-service">
            <SelectValue placeholder="Ancillary type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {SERVICE_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={resultStatus} onValueChange={setResultStatus}>
          <SelectTrigger className="w-[180px]" data-testid="select-reports-status">
            <SelectValue placeholder="Result status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="uploaded">Uploaded</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Patient</TableHead>
              <TableHead>Clinic</TableHead>
              <TableHead>Service</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>Signature</TableHead>
              <TableHead>Billing</TableHead>
              <TableHead>Completed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground" data-testid="text-reports-empty">No reports found.</TableCell></TableRow>
            ) : rows.map((r) => (
              <TableRow key={r.id} data-testid={`row-report-${r.id}`}>
                <TableCell>
                  <div className="font-medium">{r.patientName ?? "Unknown"}</div>
                  <div className="text-xs text-muted-foreground">{r.patientDob ?? ""}</div>
                </TableCell>
                <TableCell className="text-sm">{r.clinic ?? "—"}</TableCell>
                <TableCell><Badge variant="outline">{r.serviceType}</Badge></TableCell>
                <TableCell><Badge variant="secondary">{r.resultStatus}</Badge></TableCell>
                <TableCell className="text-sm">{(r.signatureStatus ?? "needs_signature").replace(/_/g, " ")}</TableCell>
                <TableCell className="text-sm">{(r.billingStatus ?? "not_ready").replace(/_/g, " ")}</TableCell>
                <TableCell className="text-sm">{fmtDate(r.completedAt ?? r.updatedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
