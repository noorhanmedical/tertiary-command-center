// Documents workspace tab — renders the existing document library.

import type { WorkspaceRenderProps } from "../types";
import { PortalDocumentLibraryTab } from "@/components/portal/PortalDocumentLibraryTab";

export function DocumentsWorkspaceTab({ workspace }: WorkspaceRenderProps) {
  return (
    <div className="h-full overflow-auto" data-testid={`workspace-documents-${workspace.id}`}>
      <PortalDocumentLibraryTab />
    </div>
  );
}
