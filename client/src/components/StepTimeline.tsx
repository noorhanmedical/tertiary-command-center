import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";

export function StepTimeline({ current, onNavigate, canGoToResults }: { current: "home" | "build" | "results"; onNavigate: (step: "home" | "build" | "results") => void; canGoToResults: boolean }) {
  const steps = [
    { id: "home" as const, label: "Home", num: 1 },
    { id: "build" as const, label: "Build Schedule", num: 2 },
    { id: "results" as const, label: "Final Schedule", num: 3 },
  ];
  const currentIdx = steps.findIndex((s) => s.id === current);

  return (
    <div className="flex items-center justify-center gap-0 py-2 px-4 border-b bg-white/50 dark:bg-card/50" data-testid="step-timeline">
      {steps.map((step, i) => {
        const isActive = step.id === current;
        const isPast = i < currentIdx;
        const isClickable = true;

        return (
          <div key={step.id} className="flex items-center">
            {i > 0 && (
              <div className={`w-8 sm:w-12 h-px mx-1 ${isPast || isActive ? "bg-primary" : "bg-border"}`} />
            )}
            <Button
              variant={isActive ? "default" : "ghost"}
              size="sm"
              onClick={() => isClickable && onNavigate(step.id)}
              disabled={!isClickable}
              className={`gap-1.5 text-xs ${
                isActive
                  ? ""
                  : isPast
                  ? "text-primary"
                  : ""
              }`}
              data-testid={`step-${step.id}`}
            >
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                isActive
                  ? "bg-primary-foreground text-primary"
                  : isPast
                  ? "bg-primary/20 text-primary"
                  : "bg-muted text-muted-foreground"
              }`}>
                {isPast ? <Check className="w-3 h-3" /> : step.num}
              </span>
              <span className="hidden sm:inline">{step.label}</span>
            </Button>
          </div>
        );
      })}
    </div>
  );
}
