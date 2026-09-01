// PlaygroundSketchProvider — visual-environment signal.
//
// The SketchUI ("digital notebook") visual language has been REMOVED
// platform-wide. This provider is kept for API compatibility (it still injects
// the palette CSS custom properties and satisfies useSketchEnv() consumers),
// but `isSketch` is now ALWAYS false — every shared component renders its
// normal, clean variant. The `enabled` prop is accepted but ignored.

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { SKETCH_CSS_VARS } from "./sketchTokens";

export type VisualLanguage = "sketch" | "glass";
export type PlaygroundEnvironment = "playground" | "shell";

export interface SketchEnvValue {
  environment: PlaygroundEnvironment;
  visualLanguage: VisualLanguage;
  /** Convenience: true when the SketchUI language is active. Always false now. */
  isSketch: boolean;
}

const SketchEnvContext = createContext<SketchEnvValue | null>(null);

/**
 * Deprecated no-op kept for API compatibility. SketchUI is removed globally, so
 * there is nothing to disable. Renders its children unchanged.
 */
export function SketchDisabledForPreview({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

interface PlaygroundSketchProviderProps {
  children: ReactNode;
  /** Accepted for API compatibility; ignored (SketchUI is removed). */
  enabled?: boolean;
  className?: string;
}

export function PlaygroundSketchProvider({
  children,
  className,
}: PlaygroundSketchProviderProps) {
  const value = useMemo<SketchEnvValue>(
    () => ({
      environment: "playground",
      visualLanguage: "glass",
      isSketch: false,
    }),
    [],
  );

  return (
    <SketchEnvContext.Provider value={value}>
      <div className={className} style={SKETCH_CSS_VARS as React.CSSProperties}>
        {children}
      </div>
    </SketchEnvContext.Provider>
  );
}

/**
 * Read the current visual environment. Always reports the clean (non-sketch)
 * language now.
 */
export function useSketchEnv(): SketchEnvValue {
  const ctx = useContext(SketchEnvContext);
  if (!ctx) {
    return { environment: "shell", visualLanguage: "glass", isSketch: false };
  }
  return ctx;
}
