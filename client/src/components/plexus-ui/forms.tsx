import * as React from "react";
import { Search, X, ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox as UICheckbox } from "@/components/ui/checkbox";
import { Switch as UISwitch } from "@/components/ui/switch";
import { RadioGroup as UIRadioGroup, RadioGroupItem as UIRadioGroupItem } from "@/components/ui/radio-group";
import {
  Select as UISelect,
  SelectTrigger as UISelectTrigger,
  SelectValue as UISelectValue,
  SelectContent as UISelectContent,
  SelectItem as UISelectItem,
} from "@/components/ui/select";

/* ══════════════════════════════════════════════════════════════════════
   PLEXUS WINTER UI — form controls (§15–§20, §22, §66, §67, §76)
   All controls wrap the existing shadcn/Radix primitives so keyboard nav,
   focus management, and ARIA come for free; winter styling is applied via
   className. Height 42–44px, radius 12px, periwinkle focus ring.
   ══════════════════════════════════════════════════════════════════════ */

const CONTROL =
  "h-11 rounded-[12px] bg-white text-[14px] text-[var(--w-text)] " +
  "border border-[var(--w-edge)] placeholder:text-[var(--w-text-muted)] " +
  "transition-[border-color,box-shadow] focus-visible:outline-none " +
  "focus-visible:border-[var(--w-blue)] focus-visible:shadow-[0_0_0_3px_rgba(95,126,234,0.22)] " +
  "disabled:opacity-50 disabled:cursor-not-allowed";

/** Field wrapper with label above (§15) + helper/error text (§66, §67). */
export function Field({
  label,
  htmlFor,
  required,
  optional,
  helper,
  error,
  children,
  className,
}: {
  label?: string;
  htmlFor?: string;
  required?: boolean;
  optional?: boolean;
  helper?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const helpId = htmlFor ? `${htmlFor}-help` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="text-[11px] font-semibold leading-4 uppercase tracking-[0.04em]"
          style={{ color: "var(--w-text-2)" }}
        >
          {label}
          {required && (
            <span className="ml-1 text-[var(--w-error)]" aria-hidden>
              *
            </span>
          )}
          {required && <span className="sr-only"> (required)</span>}
          {optional && <span className="ml-1 font-normal text-[var(--w-text-muted)]">(optional)</span>}
        </label>
      )}
      {children}
      {error ? (
        <p id={helpId} role="alert" className="text-[12px]" style={{ color: "var(--w-error)" }}>
          {error}
        </p>
      ) : helper ? (
        <p id={helpId} className="text-[12px]" style={{ color: "var(--w-text-muted)" }}>
          {helper}
        </p>
      ) : null}
    </div>
  );
}

/** TextField (§15). Renders a winter-styled input; error state adds a soft red border. */
export const TextField = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(({ className, invalid, ...props }, ref) => (
  <input
    ref={ref}
    aria-invalid={invalid || undefined}
    className={cn(
      CONTROL,
      "px-3.5",
      invalid && "border-[var(--w-error)] focus-visible:border-[var(--w-error)] focus-visible:shadow-[0_0_0_3px_rgba(217,84,93,0.18)]",
      className,
    )}
    {...props}
  />
));
TextField.displayName = "TextField";

/** Textarea (§15). */
export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "min-h-[96px] w-full rounded-[12px] bg-white px-3.5 py-2.5 text-[14px] text-[var(--w-text)]",
      "border border-[var(--w-edge)] placeholder:text-[var(--w-text-muted)]",
      "transition-[border-color,box-shadow] focus-visible:outline-none",
      "focus-visible:border-[var(--w-blue)] focus-visible:shadow-[0_0_0_3px_rgba(95,126,234,0.22)]",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

/** SearchInput (§20). Icon left, clear button right when populated. */
export const SearchInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
    value: string;
    onChange: (value: string) => void;
    onClear?: () => void;
  }
>(({ className, value, onChange, onClear, placeholder = "Search", ...props }, ref) => (
  <div className={cn("relative inline-flex w-full items-center", className)}>
    <Search
      className="pointer-events-none absolute left-3.5 size-[18px] text-[var(--w-text-muted)]"
      aria-hidden
    />
    <input
      ref={ref}
      type="text"
      role="searchbox"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn(
        "h-11 w-full rounded-[12px] bg-[#EEF4FA] pl-10 pr-9 text-[14px] text-[var(--w-text)]",
        "border border-transparent placeholder:text-[var(--w-text-muted)]",
        "transition-[border-color,box-shadow] focus-visible:outline-none",
        "focus-visible:border-[var(--w-blue)] focus-visible:shadow-[0_0_0_3px_rgba(95,126,234,0.22)]",
      )}
      {...props}
    />
    {value && (
      <button
        type="button"
        aria-label="Clear search"
        onClick={() => {
          onChange("");
          onClear?.();
        }}
        className="absolute right-2 inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--w-text-muted)] hover:bg-white/70 hover:text-[var(--w-text)]"
      >
        <X className="size-4" aria-hidden />
      </button>
    )}
  </div>
));
SearchInput.displayName = "SearchInput";

/** SelectDropdown (§16) — winter-styled shadcn Select. Keyboard/Escape/outside-close via Radix. */
export interface SelectOption {
  value: string;
  label: string;
}
export function SelectDropdown({
  value,
  onValueChange,
  options,
  placeholder = "Select",
  className,
  ariaLabel,
}: {
  value?: string;
  onValueChange?: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <UISelect value={value} onValueChange={onValueChange}>
      <UISelectTrigger
        aria-label={ariaLabel}
        className={cn(
          "h-11 rounded-[12px] bg-white px-3.5 text-[14px] text-[var(--w-text)]",
          "border border-[var(--w-edge)] focus:ring-0",
          "focus-visible:border-[var(--w-blue)] focus-visible:shadow-[0_0_0_3px_rgba(95,126,234,0.22)]",
          className,
        )}
      >
        <UISelectValue placeholder={placeholder} />
      </UISelectTrigger>
      <UISelectContent className="rounded-[12px]">
        {options.map((o) => (
          <UISelectItem key={o.value} value={o.value} className="text-[14px]">
            {o.label}
          </UISelectItem>
        ))}
      </UISelectContent>
    </UISelect>
  );
}

/** Checkbox (§17) — 40px click target via wrapping label. */
export function Checkbox({
  id,
  checked,
  onCheckedChange,
  label,
  className,
  disabled,
  indeterminate,
}: {
  id?: string;
  checked?: boolean | "indeterminate";
  onCheckedChange?: (checked: boolean) => void;
  label?: React.ReactNode;
  className?: string;
  disabled?: boolean;
  indeterminate?: boolean;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "inline-flex min-h-10 cursor-pointer items-center gap-2.5 text-[14px] text-[var(--w-text)]",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <UICheckbox
        id={id}
        checked={indeterminate ? "indeterminate" : checked}
        onCheckedChange={(v) => onCheckedChange?.(v === true)}
        disabled={disabled}
        className="h-[18px] w-[18px] rounded-[5px] border-[var(--w-steel)] data-[state=checked]:border-[var(--w-blue)] data-[state=checked]:bg-[var(--w-blue)] focus-visible:ring-0 focus-visible:shadow-[0_0_0_3px_rgba(95,126,234,0.22)]"
      />
      {label && <span>{label}</span>}
    </label>
  );
}

/** RadioGroup (§18). */
export function RadioGroup({
  value,
  onValueChange,
  options,
  name,
  className,
}: {
  value?: string;
  onValueChange?: (v: string) => void;
  options: { value: string; label: React.ReactNode }[];
  name?: string;
  className?: string;
}) {
  return (
    <UIRadioGroup value={value} onValueChange={onValueChange} name={name} className={cn("gap-2.5", className)}>
      {options.map((o) => {
        const id = `${name ?? "radio"}-${o.value}`;
        return (
          <label
            key={o.value}
            htmlFor={id}
            className="inline-flex min-h-10 cursor-pointer items-center gap-2.5 text-[14px] text-[var(--w-text)]"
          >
            <UIRadioGroupItem
              id={id}
              value={o.value}
              className="h-[18px] w-[18px] border-[var(--w-steel)] text-[var(--w-blue)] focus-visible:ring-0 focus-visible:shadow-[0_0_0_3px_rgba(95,126,234,0.22)]"
            />
            <span>{o.label}</span>
          </label>
        );
      })}
    </UIRadioGroup>
  );
}

/** Toggle / Switch (§19). */
export function Toggle({
  id,
  checked,
  onCheckedChange,
  label,
  disabled,
  className,
}: {
  id?: string;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "inline-flex min-h-10 cursor-pointer items-center gap-3 text-[14px] text-[var(--w-text)]",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <UISwitch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="h-6 w-11 data-[state=checked]:bg-[var(--w-blue)] data-[state=unchecked]:bg-[#D8E0EA] focus-visible:ring-0 focus-visible:shadow-[0_0_0_3px_rgba(95,126,234,0.22)]"
      />
      {label && <span>{label}</span>}
    </label>
  );
}

/** FilterButton (§22) — opens a filter dropdown; shows active count. */
export const FilterButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: LucideIcon; count?: number }
>(({ className, children, icon: Icon, count, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    className={cn(
      "inline-flex h-11 items-center gap-2 rounded-[12px] bg-white px-3.5 text-[14px] font-medium text-[var(--w-text)]",
      "border border-[var(--w-edge)] transition-colors hover:bg-[var(--w-blue-soft)] focus-visible:outline-none",
      className,
    )}
    {...props}
  >
    {Icon && <Icon className="size-[18px] text-[var(--w-text-2)]" aria-hidden />}
    {children}
    {typeof count === "number" && count > 0 && (
      <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--w-blue)] px-1.5 text-[11px] font-semibold text-white">
        {count}
      </span>
    )}
    <ChevronDown className="size-4 text-[var(--w-text-muted)]" aria-hidden />
  </button>
));
FilterButton.displayName = "FilterButton";

/** FilterChip (§22) — active-filter pill on soft blue, with remove. */
export function FilterChip({
  label,
  onRemove,
  className,
}: {
  label: React.ReactNode;
  onRemove?: () => void;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--w-blue-soft)] pl-3 pr-1.5 text-[12px] font-medium text-[var(--w-text)]",
        className,
      )}
    >
      {label}
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove filter`}
          onClick={onRemove}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[var(--w-text-2)] hover:bg-white/70"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </span>
  );
}
