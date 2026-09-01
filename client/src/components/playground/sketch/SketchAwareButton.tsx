// SketchAwareButton — one button that respects the visual-split contract.
//
// Inside the Playground canvas (under PlaygroundSketchProvider) it renders the
// hand-drawn SketchButton. Everywhere else (Team Portal shell, standalone
// pages) it renders the normal shadcn Button. Shared components that appear in
// BOTH places (CallWorkspace, PatientChart sections, Tasks, ...) can swap their
// `<Button>` for `<SketchAwareButton>` WITHOUT forking business logic — the
// visual language is chosen by context, per the design boundary (§21, §24).
//
// It accepts the shadcn Button variant vocabulary so migration is mechanical:
//   default | secondary | outline | ghost | destructive  + size default|sm|lg|icon
// and maps those to SketchButton variants when in the Playground.

import { forwardRef } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useSketchEnv } from "./PlaygroundSketchProvider";
import { SketchButton, type SketchButtonVariant, type SketchButtonSize } from "./SketchPrimitives";

type ShadcnVariant = NonNullable<ButtonProps["variant"]>;
type ShadcnSize = NonNullable<ButtonProps["size"]>;

const VARIANT_MAP: Record<ShadcnVariant, SketchButtonVariant> = {
  default: "primary",
  secondary: "secondary",
  outline: "secondary",
  ghost: "ghost",
  destructive: "danger",
};

function toSketchSize(size: ShadcnSize | undefined, isIcon: boolean): SketchButtonSize {
  if (isIcon) return size === "lg" ? "md" : "sm";
  return size === "sm" ? "sm" : "md";
}

export interface SketchAwareButtonProps extends ButtonProps {
  /** Stable identity for the sketch border geometry (defaults to the label). */
  seedId?: string;
  /** Active/selected state — rendered as a soft pencil wash in sketch mode. */
  active?: boolean;
}

export const SketchAwareButton = forwardRef<HTMLButtonElement, SketchAwareButtonProps>(
  ({ variant, size, seedId, active, className, children, ...rest }, ref) => {
    const { isSketch } = useSketchEnv();
    const v: ShadcnVariant = variant ?? "default";
    const s: ShadcnSize = size ?? "default";

    if (!isSketch) {
      return (
        <Button ref={ref} variant={v} size={s} className={className} {...rest}>
          {children}
        </Button>
      );
    }

    const isIcon = s === "icon";
    const sketchVariant: SketchButtonVariant = isIcon ? "icon" : VARIANT_MAP[v];

    return (
      <SketchButton
        ref={ref}
        variant={sketchVariant}
        size={toSketchSize(s, isIcon)}
        seedId={seedId}
        active={active}
        className={className}
        {...rest}
      >
        {children}
      </SketchButton>
    );
  },
);
SketchAwareButton.displayName = "SketchAwareButton";
