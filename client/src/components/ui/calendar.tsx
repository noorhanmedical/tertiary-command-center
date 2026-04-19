import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker } from "react-day-picker"

import { cn } from "@/lib/utils"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-4", className)}
      classNames={{
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month: "space-y-4",
        caption: "flex justify-center pt-1 relative items-center",
        caption_label: "text-base font-semibold text-slate-900 tracking-tight",
        nav: "space-x-1 flex items-center",
        nav_button: cn(
          "h-8 w-8 rounded-full inline-flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors"
        ),
        nav_button_previous: "absolute left-1",
        nav_button_next: "absolute right-1",
        table: "w-full border-collapse",
        head_row: "flex",
        head_cell:
          "text-slate-400 w-11 font-medium text-[11px] uppercase tracking-wider py-2",
        row: "flex w-full mt-1",
        cell: "h-11 w-11 text-center text-sm p-0 relative focus-within:relative focus-within:z-20",
        day: cn(
          "h-11 w-11 p-0 inline-flex items-center justify-center rounded-2xl text-sm font-medium text-slate-800 transition-colors",
          "hover:bg-slate-100 aria-selected:opacity-100"
        ),
        day_range_end: "day-range-end",
        day_selected:
          "bg-violet-600 text-white hover:bg-violet-600 hover:text-white focus:bg-violet-600 focus:text-white shadow-sm",
        day_today: "ring-1 ring-slate-300",
        day_outside: "day-outside text-slate-300 hover:bg-transparent cursor-default",
        day_disabled: "text-slate-300 opacity-50",
        day_range_middle:
          "aria-selected:bg-violet-100 aria-selected:text-violet-900",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        IconLeft: ({ className, ...props }) => (
          <ChevronLeft className={cn("h-4 w-4", className)} {...props} />
        ),
        IconRight: ({ className, ...props }) => (
          <ChevronRight className={cn("h-4 w-4", className)} {...props} />
        ),
      }}
      {...props}
    />
  )
}
Calendar.displayName = "Calendar"

export { Calendar }
