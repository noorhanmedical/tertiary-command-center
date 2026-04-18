import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";

const FACILITIES = ["Taylor Family Practice", "NWPG - Spring", "NWPG - Veterans"] as const;

type QualMode = "permissive" | "standard" | "conservative";

const QUAL_MODE_LABELS: Record<QualMode, string> = {
  permissive: "Permissive",
  standard: "Standard",
  conservative: "Conservative",
};

const QUAL_MODE_DESCRIPTIONS: Record<QualMode, string> = {
  permissive: "Qualify for everything with any reasonable clinical justification",
  standard: "Balanced qualification based on standard clinical criteria",
  conservative: "Qualify only when criteria are clearly met",
};

export function QualificationModeSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: modes, isLoading } = useQuery<Record<string, string>>({
    queryKey: ["/api/settings/qualification-modes"],
  });

  const [pendingModes, setPendingModes] = useState<Record<string, QualMode>>({});

  const saveMutation = useMutation({
    mutationFn: async ({ facility, mode }: { facility: string; mode: QualMode }) => {
      const res = await apiRequest("POST", "/api/settings/qualification-modes", { facility, mode });
      return res.json();
    },
    onSuccess: (_, { facility, mode }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/qualification-modes"] });
      setPendingModes((prev) => {
        const next = { ...prev };
        delete next[facility];
        return next;
      });
      toast({ title: "Saved", description: `${facility}: ${QUAL_MODE_LABELS[mode]}` });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save", description: err.message, variant: "destructive" });
    },
  });

  function getMode(facility: string): QualMode {
    if (pendingModes[facility]) return pendingModes[facility];
    const val = modes?.[facility];
    if (val === "standard" || val === "conservative") return val;
    return "permissive";
  }

  return (
    <div data-testid="section-qualification-modes">
      <div className="space-y-3">
        {FACILITIES.map((facility) => {
          const currentMode = getMode(facility);
          const savedMode: QualMode = (() => {
            const val = modes?.[facility];
            if (val === "standard" || val === "conservative") return val;
            return "permissive";
          })();
          const isDirty = pendingModes[facility] !== undefined && pendingModes[facility] !== savedMode;

          return (
            <Card key={facility} className="p-4" data-testid={`card-qual-mode-${facility.replace(/\s+/g, "-")}`}>
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800 dark:text-foreground" data-testid={`text-facility-${facility.replace(/\s+/g, "-")}`}>{facility}</div>
                  <div className="text-xs text-muted-foreground mt-0.5" data-testid={`text-mode-desc-${facility.replace(/\s+/g, "-")}`}>
                    {QUAL_MODE_DESCRIPTIONS[currentMode]}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Select
                      value={currentMode}
                      onValueChange={(val) => {
                        if (val === "permissive" || val === "standard" || val === "conservative") {
                          setPendingModes((prev) => ({ ...prev, [facility]: val }));
                        }
                      }}
                    >
                      <SelectTrigger className="w-40 h-8 text-xs" data-testid={`select-qual-mode-${facility.replace(/\s+/g, "-")}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="permissive" data-testid="option-permissive">Permissive</SelectItem>
                        <SelectItem value="standard" data-testid="option-standard">Standard</SelectItem>
                        <SelectItem value="conservative" data-testid="option-conservative">Conservative</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  <Button
                    size="sm"
                    variant={isDirty ? "default" : "outline"}
                    className="h-8 text-xs"
                    disabled={saveMutation.isPending || !isDirty}
                    onClick={() => saveMutation.mutate({ facility, mode: currentMode })}
                    data-testid={`button-save-qual-mode-${facility.replace(/\s+/g, "-")}`}
                  >
                    {saveMutation.isPending && saveMutation.variables?.facility === facility ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      "Save"
                    )}
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
