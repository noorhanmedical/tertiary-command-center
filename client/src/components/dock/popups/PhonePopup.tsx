// Phone dock popup — quick call launch surface.
//
// If a patient is active in context, prepopulates their name/phone.
// Provides a quick Call button and an "Open in Playground" to launch
// the full CallWorkspace. Does NOT rebuild call architecture — uses
// existing canonical call infrastructure.

import { useState } from "react";
import { Phone, X, Maximize2, User } from "lucide-react";
import { Button } from "@/components/ui/button";

export type PhonePopupProps = {
  open: boolean;
  onClose: () => void;
  onOpenInPlayground?: () => void;
  /** Active patient context (from selected Playground tab). */
  patientContext?: {
    name: string;
    phone?: string | null;
    patientScreeningId?: number | null;
  } | null;
  /** Recent call outcome for this patient. */
  lastOutcome?: string | null;
  /** Callback scheduled. */
  callbackAt?: string | null;
  className?: string;
};

export function PhonePopup({
  open,
  onClose,
  onOpenInPlayground,
  patientContext,
  lastOutcome,
  callbackAt,
  className = "",
}: PhonePopupProps) {
  if (!open) return null;

  const hasPatient = !!patientContext;
  const phoneHref = patientContext?.phone
    ? `tel:${patientContext.phone.replace(/[^\d+]/g, "")}`
    : null;

  return (
    <div
      className={`w-[280px] rounded-[20px] border border-slate-200/80 bg-white/90 shadow-[0_18px_60px_rgba(15,23,42,0.12)] backdrop-blur-xl ${className}`}
      data-testid="phone-popup"
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <Phone className="h-4 w-4 text-emerald-600" />
          <span className="text-sm font-semibold text-slate-900">Quick Call</span>
        </div>
        <div className="flex items-center gap-1">
          {onOpenInPlayground && (
            <button type="button" onClick={onOpenInPlayground} className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100" title="Open Call Workspace" data-testid="phone-open-playground">
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          )}
          <button type="button" onClick={onClose} className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100" data-testid="phone-popup-close">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="px-4 py-3 space-y-3">
        {hasPatient ? (
          <>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <User className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-medium text-slate-900">{patientContext!.name}</div>
                <div className="text-xs text-slate-500">{patientContext!.phone || "No phone on file"}</div>
              </div>
            </div>
            {lastOutcome && (
              <div className="text-[11px] text-slate-500">
                Last: <span className="font-medium capitalize">{lastOutcome.replace(/_/g, " ")}</span>
              </div>
            )}
            {callbackAt && (
              <div className="text-[11px] text-amber-600">
                Callback: {new Date(callbackAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </div>
            )}
            {phoneHref ? (
              <a href={phoneHref} className="block">
                <Button size="sm" className="w-full h-9 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="phone-popup-call">
                  <Phone className="h-4 w-4" /> Call {patientContext!.name.split(" ")[0]}
                </Button>
              </a>
            ) : (
              <Button size="sm" className="w-full h-9" disabled data-testid="phone-popup-call-disabled">
                No phone number
              </Button>
            )}
          </>
        ) : (
          <div className="text-center py-4">
            <Phone className="h-8 w-8 text-slate-200 mx-auto mb-2" />
            <p className="text-xs text-slate-500">Select a patient to make a quick call.</p>
          </div>
        )}
      </div>

      {onOpenInPlayground && (
        <div className="border-t border-slate-100 px-4 py-2.5">
          <Button size="sm" variant="ghost" className="w-full h-7 gap-1.5 text-[11px] text-slate-600 hover:text-slate-800" onClick={onOpenInPlayground} data-testid="phone-expand-playground">
            <Maximize2 className="h-3 w-3" /> Full Call Workspace
          </Button>
        </div>
      )}
    </div>
  );
}
