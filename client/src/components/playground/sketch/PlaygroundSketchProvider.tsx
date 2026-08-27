// PlaygroundSketchProvider — signals the SketchUI visual environment.
//
// Anything rendered inside the Playground canvas lives under this provider.
// Shared Plexus components can read `useSketchEnv()` to switch to their
// playground-sketch variant WITHOUT duplicating application logic:
//
//   const { isSketch } = useSketchEnv();
//   return isSketch ? <SketchButton .../> : <PlexusButton .../>;
//
// Detection is context-based on purpose — never sniff CSS selectors or the
// DOM to decide visual language.
//
// The provider also injects the sketch CSS custom properties onto its root
// wrapper so non-canvas primitives can reference the pencil palette.

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { SKETCH_CSS_VARS } from "./sketchTokens";

export type VisualLanguage = "sketch" | "glass";
export type PlaygroundEnvironment = "playground" | "shell";

export interface SketchEnvValue {
  environment: PlaygroundEnvironment;
  visualLanguage: VisualLanguage;
  /** Convenience: true when the SketchUI language is active. */
  isSketch: boolean;
}

const SketchEnvContext = createContext<SketchEnvValue | null>(null);

interface PlaygroundSketchProviderProps {
  children: ReactNode;
  /** Escape hatch to disable sketch language (defaults to on inside Playground). */
  enabled?: boolean;
  className?: string;
}

export function PlaygroundSketchProvider({
  children,
  enabled = true,
  className,
}: PlaygroundSketchProviderProps) {
  const value = useMemo<SketchEnvValue>(
    () => ({
      environment: "playground",
      visualLanguage: enabled ? "sketch" : "glass",
      isSketch: enabled,
    }),
    [enabled],
  );

  return (
    <SketchEnvContext.Provider value={value}>
      <div
        data-playground-sketch={enabled ? "true" : "false"}
        className={className}
        style={SKETCH_CSS_VARS as React.CSSProperties}
      >
        {children}
      </div>
    </SketchEnvContext.Provider>
  );
}

/**
 * Read the current visual environment. Returns a shell/glass default when
 * called outside a PlaygroundSketchProvider so shared components render their
 * normal variant on the platform chrome.
 */
export function useSketchEnv(): SketchEnvValue {
  const ctx = useContext(SketchEnvContext);
  if (!ctx) {
    return { environment: "shell", visualLanguage: "glass", isSketch: false };
  }
  return ctx;
}
