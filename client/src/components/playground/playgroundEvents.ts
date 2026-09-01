// Playground event bus — allows components outside the provider (like
// dock handlers defined before the JSX return) to request workspace opens.
//
// Pattern: handler calls dispatchOpenWorkspace() → PlaygroundEventListener
// (inside the provider) receives it and calls openWorkspace().

import type { OpenInPlaygroundRequest } from "./types";

const EVENT_NAME = "plexus:open-workspace";

export function dispatchOpenWorkspace(request: OpenInPlaygroundRequest): void {
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: request }));
}

export function listenForOpenWorkspace(handler: (request: OpenInPlaygroundRequest) => void): () => void {
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<OpenInPlaygroundRequest>).detail;
    if (detail) handler(detail);
  };
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
