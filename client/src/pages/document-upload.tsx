import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, FileText, CheckCircle, ExternalLink, Loader2, ScanText, ClipboardList } from "lucide-react";
import { VALID_FACILITIES } from "@shared/plexus";
import { PageHeader } from "@/components/PageHeader";

const ANCILLARY_TYPES = ["BrainWave", "VitalWave", "Ultrasound"] as const;

type DocType = "report" | "informed_consent" | "screening_form";

interface UploadResult {
  facility: string;
  patientName: string;
  ancillaryType: string;
  docType: DocType;
  driveWebViewLink: string | null;
  driveFileId: string | null;
}

interface UploadCardProps {
  docType: DocType;
  title: string;
  description: string;
  color: string;
  icon: React.ReactNode;
}

function UploadCard({ docType, title, description, color, icon }: UploadCardProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [facility, setFacility] = useState("");
  const [ancillaryType, setAncillaryType] = useState("");
  const [patientName, setPatientName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isOcrLoading, setIsOcrLoading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);

  const ocrMutation = useMutation({
    mutationFn: async (f: File) => {
      const formData = new FormData();
      formData.append("file", f);
      const res = await fetch("/api/documents/ocr-name", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "OCR failed" }));
        throw new Error(err.error || "OCR failed");
      }
      return res.json() as Promise<{ patientName: string }>;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ facility, patientName, ancillaryType, docType, file }: {
      facility: string; patientName: string; ancillaryType: string; docType: DocType; file: File;
    }) => {
      const formData = new FormData();
      formData.append("facility", facility);
      formData.append("patientName", patientName);
      formData.append("ancillaryType", ancillaryType);
      formData.append("docType", docType);
      formData.append("file", file);
      const res = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error || "Upload failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setResult({
        facility,
        patientName,
        ancillaryType,
        docType,
        driveWebViewLink: data.webViewLink ?? null,
        driveFileId: data.driveFileId ?? null,
      });
      toast({ title: "Uploaded to Google Drive" });
    },
    onError: (err: Error) => {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    },
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    if (!f) return;

    setIsOcrLoading(true);
    try {
      const data = await ocrMutation.mutateAsync(f);
      if (data.patientName && data.patientName !== "Unknown") {
        setPatientName(data.patientName);
        toast({ title: "Patient name extracted", description: data.patientName });
      }
    } catch {
    } finally {
      setIsOcrLoading(false);
    }
  };

  const handleSubmit = () => {
    if (!facility || !ancillaryType || !patientName.trim() || !file) return;
    uploadMutation.mutate({ facility, patientName: patientName.trim(), ancillaryType, docType, file });
  };

  const handleReset = () => {
    setFacility("");
    setAncillaryType("");
    setPatientName("");
    setFile(null);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  if (result) {
    return (
      <Card className={`p-6 rounded-2xl border ${color} flex flex-col gap-4`} data-testid={`upload-success-${docType}`}>
        <div className="flex items-center gap-3">
          <CheckCircle className="w-6 h-6 text-emerald-600 shrink-0" />
          <div>
            <p className="font-semibold text-slate-800">{title} Uploaded</p>
            <p className="text-sm text-slate-500">{result.patientName} · {result.ancillaryType} · {result.facility}</p>
          </div>
        </div>
        {result.driveWebViewLink && (
          <a
            href={result.driveWebViewLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-emerald-600 hover:text-emerald-700 hover:underline"
            data-testid={`link-drive-${docType}`}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            View in Google Drive
          </a>
        )}
        <Button variant="outline" size="sm" onClick={handleReset} className="self-start" data-testid={`button-upload-another-${docType}`}>
          Upload Another
        </Button>
      </Card>
    );
  }

  return (
    <Card className={`p-6 rounded-2xl border ${color} flex flex-col gap-4`} data-testid={`upload-card-${docType}`}>
      <div className="flex items-center gap-3 mb-1">
        {icon}
        <div>
          <h2 className="text-base font-semibold text-slate-800">{title}</h2>
          <p className="text-xs text-slate-500">{description}</p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label>Facility</Label>
          <Select value={facility} onValueChange={setFacility}>
            <SelectTrigger data-testid={`select-facility-${docType}`}>
              <SelectValue placeholder="Select facility" />
            </SelectTrigger>
            <SelectContent>
              {VALID_FACILITIES.map((f) => (
                <SelectItem key={f} value={f}>{f}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Ancillary Type</Label>
          <Select value={ancillaryType} onValueChange={setAncillaryType}>
            <SelectTrigger data-testid={`select-ancillary-${docType}`}>
              <SelectValue placeholder="Select ancillary type" />
            </SelectTrigger>
            <SelectContent>
              {ANCILLARY_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5">
            PDF File
            {isOcrLoading && (
              <span className="flex items-center gap-1 text-xs text-indigo-500 font-normal">
                <Loader2 className="w-3 h-3 animate-spin" />
                Extracting patient name…
              </span>
            )}
          </Label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            onChange={handleFileChange}
            className="block w-full text-sm text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200 cursor-pointer"
            data-testid={`input-file-${docType}`}
          />
          {file && (
            <p className="text-xs text-slate-400 truncate">{file.name}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5">
            Patient Name
            {isOcrLoading ? (
              <span className="text-xs text-slate-400 font-normal">auto-filling…</span>
            ) : patientName && patientName !== "Unknown" ? (
              <span className="flex items-center gap-0.5 text-xs text-emerald-600 font-normal">
                <ScanText className="w-3 h-3" />
                OCR extracted
              </span>
            ) : null}
          </Label>
          <input
            type="text"
            value={patientName}
            onChange={(e) => setPatientName(e.target.value)}
            placeholder="Enter or confirm patient name"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            data-testid={`input-patient-name-${docType}`}
          />
        </div>
      </div>

      <Button
        onClick={handleSubmit}
        disabled={!facility || !ancillaryType || !patientName.trim() || !file || uploadMutation.isPending || isOcrLoading}
        className="w-full mt-1"
        data-testid={`button-submit-${docType}`}
      >
        {uploadMutation.isPending ? (
          <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Uploading…</>
        ) : (
          <><Upload className="w-4 h-4 mr-2" />Upload to Drive</>
        )}
      </Button>
    </Card>
  );
}

export default function DocumentUploadPage() {
  return (
    <div className="flex-1 overflow-y-auto p-6 bg-[hsl(210,35%,96%)]">
      <div className="max-w-5xl mx-auto">
        <PageHeader
          icon={Upload}
          iconAccent="bg-indigo-100 text-indigo-700"
          title="Document Upload"
          subtitle="Upload patient reports, informed consent forms, and screening forms to Google Drive. Patient names are auto-extracted via AI."
          className="mb-8"
        />

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          <UploadCard
            docType="report"
            title="Upload Report"
            description="Upload a completed patient diagnostic report PDF"
            color="border-blue-200 bg-blue-50/30"
            icon={<FileText className="w-6 h-6 text-blue-600 shrink-0" />}
          />
          <UploadCard
            docType="informed_consent"
            title="Upload Informed Consent"
            description="Upload a signed patient informed consent form"
            color="border-emerald-200 bg-emerald-50/30"
            icon={<CheckCircle className="w-6 h-6 text-emerald-600 shrink-0" />}
          />
          <UploadCard
            docType="screening_form"
            title="Upload Screening Form"
            description="Upload a completed patient screening form PDF"
            color="border-violet-200 bg-violet-50/30"
            icon={<ClipboardList className="w-6 h-6 text-violet-600 shrink-0" />}
          />
        </div>
      </div>
    </div>
  );
}
