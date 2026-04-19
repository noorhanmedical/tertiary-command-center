import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  Upload, FileText, Loader2, Search, RefreshCw, ClipboardList, Calendar, Trash2, Plus, Users, ExternalLink,
} from "lucide-react";
import { SiGooglesheets } from "react-icons/si";
import type { PatientTestHistory } from "@shared/schema";
import { ANCILLARY_TESTS } from "@shared/plexus";

const ALL_AVAILABLE_TESTS: string[] = [...ANCILLARY_TESTS];

function computeNextEligible(dos: string, insuranceType: string): { date: Date; eligible: boolean } | null {
  if (!dos) return null;
  const dosDate = new Date(dos.includes("T") ? dos : dos + "T00:00:00");
  if (isNaN(dosDate.getTime())) return null;
  const months = insuranceType === "medicare" ? 12 : 6;
  const next = new Date(dosDate);
  next.setMonth(next.getMonth() + months);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return { date: next, eligible: today >= next };
}

function formatDisplayDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export interface PatientDirectoryViewProps {
  testHistory: PatientTestHistory[];
  historyLoading: boolean;
  dirPasteText: string;
  setDirPasteText: (v: string) => void;
  dirSearch: string;
  setDirSearch: (v: string) => void;
  onImportFile: (file: File) => void;
  onImportText: (text: string) => void;
  onClearAll: () => void;
  importFilePending: boolean;
  importTextPending: boolean;
  onOpenHistory: () => void;
}

export function PatientDirectoryView({ testHistory, historyLoading, dirPasteText, setDirPasteText, dirSearch, setDirSearch, onImportFile, onImportText, onClearAll, importFilePending, importTextPending, onOpenHistory }: PatientDirectoryViewProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [addRecordOpen, setAddRecordOpen] = useState(false);
  const [addRecordName, setAddRecordName] = useState("");
  const [addRecordTest, setAddRecordTest] = useState("");
  const [addRecordDos, setAddRecordDos] = useState<Date | undefined>(new Date());
  const [addRecordInsurance, setAddRecordInsurance] = useState<"ppo" | "medicare">("ppo");

  const [patientsSyncedAt, setPatientsSyncedAt] = useState<string | null>(null);
  const [patientsSheetUrl, setPatientsSheetUrl] = useState<string | null>(null);

  const { data: googleStatus } = useQuery<{
    sheets: {
      connected: boolean;
      lastSyncedPatients: string | null;
      patientsSpreadsheetUrl: string | null;
    };
    drive: { connected: boolean; email: string | null };
  }>({ queryKey: ["/api/google/status"], refetchInterval: 30000 });

  useEffect(() => {
    if (!googleStatus?.sheets) return;
    setPatientsSyncedAt(googleStatus.sheets.lastSyncedPatients ?? null);
    setPatientsSheetUrl(googleStatus.sheets.patientsSpreadsheetUrl ?? null);
  }, [googleStatus]);

  const syncPatientsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/google/sync/patients");
      return res.json();
    },
    onSuccess: (data) => {
      if (data.syncedAt) {
        setPatientsSyncedAt(data.syncedAt);
        if (data.spreadsheetUrl) setPatientsSheetUrl(data.spreadsheetUrl);
        toast({ title: "Synced to Google Sheets", description: `${data.patientCount} patients, ${data.testHistoryCount} test records pushed` });
      } else {
        toast({ title: "Sync queued", description: "Another sync is in progress; your changes will be included" });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
  });

  const addRecordMutation = useMutation({
    mutationFn: async () => {
      const _d = addRecordDos || new Date();
      const dos = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, "0")}-${String(_d.getDate()).padStart(2, "0")}`;
      const res = await apiRequest("POST", "/api/test-history", {
        patientName: addRecordName.trim(),
        testName: addRecordTest.trim(),
        dateOfService: dos,
        insuranceType: addRecordInsurance,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/test-history"] });
      toast({ title: "Record added" });
      setAddRecordOpen(false);
      setAddRecordName("");
      setAddRecordTest("");
      setAddRecordDos(new Date());
      setAddRecordInsurance("ppo");
    },
    onError: (e: unknown) => {
      toast({ title: "Failed to add record", description: e instanceof Error ? e.message : "Failed to add record", variant: "destructive" });
    },
  });

  const patientMap = new Map<string, { displayName: string; dob?: string; records: PatientTestHistory[] }>();
  for (const record of testHistory) {
    const key = record.patientName.trim().toLowerCase();
    const existing = patientMap.get(key);
    if (existing) {
      existing.records.push(record);
      if (!existing.dob && record.dob) existing.dob = record.dob;
    } else {
      patientMap.set(key, { displayName: record.patientName, dob: record.dob || undefined, records: [record] });
    }
  }

  const patients = Array.from(patientMap.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
  const filtered = dirSearch ? patients.filter(p => p.displayName.toLowerCase().includes(dirSearch.toLowerCase())) : patients;

  return (
    <div className="flex flex-col h-full relative z-10">
      <Dialog open={addRecordOpen} onOpenChange={setAddRecordOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Record</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <Label className="text-xs">Patient Name</Label>
              <Input
                placeholder="Full name"
                value={addRecordName}
                onChange={(e) => setAddRecordName(e.target.value)}
                data-testid="input-add-record-name"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Test Name</Label>
              <Select value={addRecordTest} onValueChange={setAddRecordTest}>
                <SelectTrigger data-testid="select-add-record-test">
                  <SelectValue placeholder="Select test" />
                </SelectTrigger>
                <SelectContent>
                  {ALL_AVAILABLE_TESTS.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Date of Service</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full justify-start gap-2 font-normal" data-testid="button-add-record-dos">
                    <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                    {addRecordDos ? `${addRecordDos.getFullYear()}-${String(addRecordDos.getMonth() + 1).padStart(2, "0")}-${String(addRecordDos.getDate()).padStart(2, "0")}` : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarPicker mode="single" selected={addRecordDos} onSelect={setAddRecordDos} initialFocus />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Insurance Type</Label>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={addRecordInsurance === "ppo" ? "default" : "outline"}
                  onClick={() => setAddRecordInsurance("ppo")}
                  className="flex-1"
                  data-testid="button-add-record-ppo"
                >PPO</Button>
                <Button
                  size="sm"
                  variant={addRecordInsurance === "medicare" ? "default" : "outline"}
                  onClick={() => setAddRecordInsurance("medicare")}
                  className="flex-1"
                  data-testid="button-add-record-medicare"
                >Medicare</Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAddRecordOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              disabled={!addRecordName.trim() || !addRecordTest.trim() || !addRecordDos || addRecordMutation.isPending}
              onClick={() => addRecordMutation.mutate()}
              data-testid="button-add-record-submit"
            >
              {addRecordMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              Add Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <header className="bg-white/85 dark:bg-card/85 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-2 flex-wrap border-b">
          <div className="flex items-center gap-2">
            <SidebarTrigger data-testid="button-sidebar-toggle-dir" />
            <div>
              <h1 className="text-base font-bold tracking-tight flex items-center gap-2">
                <Users className="w-4 h-4" />
                Patient Directory
              </h1>
              <p className="text-xs text-muted-foreground">{patients.length} patients · {testHistory.length} completed tests</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={() => syncPatientsMutation.mutate()}
                disabled={syncPatientsMutation.isPending}
                className="gap-1.5 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                data-testid="button-sync-patients-sheets"
              >
                {syncPatientsMutation.isPending ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <SiGooglesheets className="w-3.5 h-3.5" />
                )}
                Sync to Sheets
              </Button>
              {patientsSyncedAt && (
                <span className="text-[10px] text-slate-400 whitespace-nowrap">
                  Synced {new Date(patientsSyncedAt).toLocaleTimeString()}
                  {patientsSheetUrl && (
                    <a href={patientsSheetUrl} target="_blank" rel="noopener noreferrer" className="ml-1 text-emerald-600 hover:underline inline-flex items-center gap-0.5">
                      <ExternalLink className="w-2.5 h-2.5" />Open
                    </a>
                  )}
                </span>
              )}
              {googleStatus?.drive?.email && (
                <span className="text-[10px] text-slate-400 whitespace-nowrap" data-testid="text-drive-email-patients">
                  Drive: {googleStatus.drive.email}
                </span>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={onOpenHistory}
              className="gap-1.5"
              data-testid="button-ancillary-test-history"
            >
              <ClipboardList className="w-3.5 h-3.5" />
              Ancillary Test History
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAddRecordOpen(true)}
              className="gap-1.5"
              data-testid="button-add-record"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Record
            </Button>
            {testHistory.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={onClearAll}
                className="gap-1.5 text-red-600"
                data-testid="button-clear-directory"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear All
              </Button>
            )}
          </div>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-4">
        <div className="max-w-5xl mx-auto space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Upload className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-semibold">Upload File</span>
              </div>
              <p className="text-xs text-muted-foreground mb-2">Import from Excel or CSV: Name, DOB, Test, DOS, Insurance</p>
              <input
                type="file"
                accept=".xlsx,.xls,.csv,.txt"
                className="text-xs"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onImportFile(file);
                  e.target.value = "";
                }}
                data-testid="input-dir-file"
              />
              {importFilePending && (
                <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" /> Importing...
                </div>
              )}
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <FileText className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-semibold">Paste Data</span>
              </div>
              <Textarea
                placeholder="Paste test history data (Name, DOB, Test, Date of Service, Insurance)..."
                value={dirPasteText}
                onChange={(e) => setDirPasteText(e.target.value)}
                className="text-xs min-h-[80px] mb-2"
                data-testid="input-dir-paste"
              />
              <Button
                size="sm"
                disabled={!dirPasteText.trim() || importTextPending}
                onClick={() => onImportText(dirPasteText)}
                className="gap-1.5"
                data-testid="button-import-dir"
              >
                {importTextPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                Import
              </Button>
            </Card>
          </div>

          {testHistory.length > 0 && (
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 text-muted-foreground shrink-0" />
              <Input
                placeholder="Search patients..."
                value={dirSearch}
                onChange={(e) => setDirSearch(e.target.value)}
                className="text-xs h-8 max-w-xs"
                data-testid="input-dir-search"
              />
            </div>
          )}

          {historyLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 && testHistory.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No patient records yet. Import test history to get started.</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">No patients match your search.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filtered.map((patient) => {
                const sortedRecords = [...patient.records].sort((a, b) => b.dateOfService.localeCompare(a.dateOfService));
                return (
                  <Card key={patient.displayName} className="p-4 space-y-3" data-testid={`card-patient-dir-${patient.displayName.replace(/\s+/g, "-").toLowerCase()}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-sm text-slate-900 dark:text-foreground">{patient.displayName}</p>
                        {patient.dob && (
                          <p className="text-xs text-muted-foreground mt-0.5">DOB: {patient.dob}</p>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0 mt-0.5">{patient.records.length} test{patient.records.length !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="space-y-2">
                      {sortedRecords.map((record) => {
                        const eligible = computeNextEligible(record.dateOfService, record.insuranceType);
                        return (
                          <div key={record.id} className="bg-slate-50 dark:bg-muted/40 rounded-lg px-3 py-2 space-y-1" data-testid={`row-dir-test-${record.id}`}>
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="text-xs font-medium text-slate-800 dark:text-foreground">{record.testName}</span>
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                record.insuranceType === "medicare"
                                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                                  : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                              }`}>
                                {record.insuranceType === "medicare" ? "Medicare" : "PPO"}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2 text-[11px] flex-wrap">
                              <span className="text-muted-foreground">DOS: {record.dateOfService}</span>
                              {eligible ? (
                                <span className={`font-medium ${eligible.eligible ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}>
                                  {eligible.eligible ? "Eligible now" : `Eligible ${formatDisplayDate(eligible.date)}`}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
