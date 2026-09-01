import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Tabs as UITabs,
  TabsList as UITabsList,
  TabsTrigger as UITabsTrigger,
  TabsContent as UITabsContent,
} from "@/components/ui/tabs";

/* ══════════════════════════════════════════════════════════════════════
   PLEXUS WINTER UI — tab system (§23)
   One primary pattern: understated segmented/pill tabs. Wraps shadcn Tabs
   (Radix roving-tabindex keyboard nav preserved). States: active / inactive /
   hover / focus / disabled.
   ══════════════════════════════════════════════════════════════════════ */

export const Tabs = UITabs;
export const TabsContent = UITabsContent;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof UITabsList>,
  React.ComponentPropsWithoutRef<typeof UITabsList>
>(({ className, ...props }, ref) => (
  <UITabsList
    ref={ref}
    className={cn(
      "inline-flex h-10 items-center gap-1 rounded-[12px] p-1",
      "bg-[var(--w-blue-soft)] text-[var(--w-text-2)]",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = "PlexusTabsList";

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof UITabsTrigger>,
  React.ComponentPropsWithoutRef<typeof UITabsTrigger>
>(({ className, ...props }, ref) => (
  <UITabsTrigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-[9px] px-3.5 py-1.5",
      "text-[13px] font-medium transition-colors",
      "hover:text-[var(--w-text)] focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_rgba(95,126,234,0.22)]",
      "data-[state=active]:bg-white data-[state=active]:text-[var(--w-text)] data-[state=active]:shadow-[0_1px_3px_rgba(24,34,52,0.10)]",
      "disabled:pointer-events-none disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = "PlexusTabsTrigger";
