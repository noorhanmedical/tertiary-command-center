import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Folder,
  FileText,
  Search,
  ChevronRight,
  Home,
  ExternalLink,
  MoveRight,
  Loader2,
  X,
  FileImage,
  FileSpreadsheet,
  File,
} from "lucide-react";

interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  webViewLink: string | null;
  size: string | null;
  modifiedTime: string | null;
}

interface SearchResult {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  webViewLink: string | null;
  path: string;
}

interface FolderTreeNode {
  id: string;
  name: string;
  children: FolderTreeNode[];
}

interface BreadcrumbItem {
  id: string;
  name: string;
}

function getMimeIcon(mimeType: string) {
  if (mimeType === "application/vnd.google-apps.folder") return <Folder className="w-5 h-5 text-amber-500" />;
  if (mimeType === "application/vnd.google-apps.document" || mimeType === "application/msword" || mimeType.includes("word"))
    return <FileText className="w-5 h-5 text-blue-500" />;
  if (mimeType === "application/vnd.google-apps.spreadsheet" || mimeType.includes("sheet") || mimeType.includes("excel"))
    return <FileSpreadsheet className="w-5 h-5 text-emerald-500" />;
  if (mimeType === "application/pdf") return <FileText className="w-5 h-5 text-red-500" />;
  if (mimeType.startsWith("image/")) return <FileImage className="w-5 h-5 text-violet-500" />;
  return <File className="w-5 h-5 text-slate-400" />;
}

function FolderTreePicker({
  node,
  onSelect,
  selectedId,
  level = 0,
}: {
  node: FolderTreeNode;
  onSelect: (id: string, name: string) => void;
  selectedId: string | null;
  level?: number;
}) {
  const [expanded, setExpanded] = useState(level === 0);

  return (
    <div>
      <button
        className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-sm text-left hover:bg-slate-100 dark:hover:bg-muted/50 transition-colors ${
          selectedId === node.id ? "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 font-medium" : ""
        }`}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={() => onSelect(node.id, node.name)}
        data-testid={`folder-picker-${node.id}`}
      >
        {node.children.length > 0 && (
          <span
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
            className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-muted transition-colors"
          >
            <ChevronRight className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`} />
          </span>
        )}
        {node.children.length === 0 && <span className="w-4" />}
        <Folder className="w-4 h-4 text-amber-500 shrink-0" />
        <span className="truncate">{node.name}</span>
      </button>
      {expanded && node.children.map((child) => (
        <FolderTreePicker key={child.id} node={child} onSelect={onSelect} selectedId={selectedId} level={level + 1} />
      ))}
    </div>
  );
}

export function PlexusDrive() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: googleStatus } = useQuery<{
    drive: { connected: boolean; email: string | null };
  }>({ queryKey: ["/api/google/status"], refetchInterval: 60000 });

  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([{ id: "", name: "Plexus Drive" }]);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [moveTarget, setMoveTarget] = useState<DriveItem | null>(null);
  const [moveDestId, setMoveDestId] = useState<string | null>(null);
  const [moveDestName, setMoveDestName] = useState<string | null>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => setDebouncedSearch(searchQuery), 400);
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); };
  }, [searchQuery]);

  const folderUrl = currentFolderId
    ? `/api/plexus-drive/folder?folderId=${encodeURIComponent(currentFolderId)}`
    : "/api/plexus-drive/folder";

  const driveConnected = googleStatus?.drive?.connected === true;

  const { data: folderData, isLoading: folderLoading } = useQuery<{ folderId: string; files: DriveItem[] }>({
    queryKey: [folderUrl],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: driveConnected && !debouncedSearch,
  });

  const searchUrl = `/api/plexus-drive/search?q=${encodeURIComponent(debouncedSearch)}`;
  const { data: searchData, isLoading: searchLoading } = useQuery<{ results: SearchResult[] }>({
    queryKey: [searchUrl],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: driveConnected && debouncedSearch.length > 0,
  });

  const { data: folderTree, isLoading: treeLoading } = useQuery<FolderTreeNode>({
    queryKey: ["/api/plexus-drive/folder-tree"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: driveConnected && moveTarget !== null,
  });

  const moveMutation = useMutation({
    mutationFn: async ({ fileId, destinationFolderId }: { fileId: string; destinationFolderId: string }) => {
      const res = await apiRequest("POST", "/api/plexus-drive/move", { fileId, destinationFolderId });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Item moved successfully" });
      setMoveTarget(null);
      setMoveDestId(null);
      setMoveDestName(null);
      queryClient.invalidateQueries({ queryKey: ["/api/plexus-drive/folder"] });
      queryClient.invalidateQueries({ queryKey: [folderUrl] });
    },
    onError: (err: any) => {
      toast({ title: "Move failed", description: err.message, variant: "destructive" });
    },
  });

  const navigateInto = (folder: DriveItem) => {
    setCurrentFolderId(folder.id);
    setBreadcrumb((prev) => [...prev, { id: folder.id, name: folder.name }]);
    setSearchQuery("");
  };

  const navigateTo = (crumbIndex: number) => {
    const crumb = breadcrumb[crumbIndex];
    setBreadcrumb((prev) => prev.slice(0, crumbIndex + 1));
    setCurrentFolderId(crumb.id || null);
    setSearchQuery("");
  };

  const isSearching = debouncedSearch.length > 0;
  const files = folderData?.files || [];
  const searchResults = searchData?.results || [];
  const isLoading = isSearching ? searchLoading : folderLoading;

  return (
    <div className="mt-10" data-testid="plexus-drive-panel">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center shadow-sm">
            <Folder className="w-4.5 h-4.5 text-white" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-foreground">Plexus Drive</h3>
        </div>
        {googleStatus?.drive?.email && (
          <span className="text-xs text-muted-foreground flex items-center gap-1.5" data-testid="text-drive-connected-account">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
            Connected: {googleStatus.drive.email}
          </span>
        )}
        {googleStatus && !googleStatus.drive?.connected && (
          <span className="text-xs text-amber-600 flex items-center gap-1.5" data-testid="text-drive-disconnected">
            <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
            Drive not connected
          </span>
        )}
      </div>

      <Card className="rounded-2xl border border-slate-200/60 dark:border-border bg-white dark:bg-card shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-border flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
          <div className="flex items-center gap-1.5 flex-wrap" data-testid="plexus-drive-breadcrumb">
            {breadcrumb.map((crumb, i) => (
              <span key={`${crumb.id}-${i}`} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
                <button
                  className={`text-sm font-medium transition-colors flex items-center gap-1 ${
                    i === breadcrumb.length - 1
                      ? "text-slate-900 dark:text-foreground"
                      : "text-indigo-600 dark:text-indigo-400 hover:text-indigo-800"
                  }`}
                  onClick={() => navigateTo(i)}
                  disabled={i === breadcrumb.length - 1}
                  data-testid={`breadcrumb-${i}`}
                >
                  {i === 0 && <Home className="w-3.5 h-3.5" />}
                  {i === 0 ? "" : crumb.name}
                  {i === 0 && <span className="ml-1">Plexus Drive</span>}
                </button>
              </span>
            ))}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <Input
              placeholder="Search files and folders..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 text-sm h-8"
              data-testid="input-plexus-drive-search"
            />
            {searchQuery && (
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                onClick={() => setSearchQuery("")}
                data-testid="button-clear-search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="min-h-[200px]">
          {!driveConnected && googleStatus !== undefined && (
            <div className="flex flex-col items-center justify-center py-16 gap-3" data-testid="drive-not-connected-message">
              <Folder className="w-10 h-10 text-amber-400" />
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Google Drive is not connected</p>
              <p className="text-xs text-muted-foreground text-center max-w-xs">
                Configure the Google service account credentials to enable Drive access.
              </p>
            </div>
          )}

          {driveConnected && isLoading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {driveConnected && !isLoading && isSearching && (
            <div className="p-4">
              {searchResults.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">No results found for "{debouncedSearch}"</div>
              ) : (
                <div className="space-y-1" data-testid="search-results">
                  {searchResults.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-muted/30 group transition-colors"
                      data-testid={`search-result-${item.id}`}
                    >
                      <div className="shrink-0">{getMimeIcon(item.mimeType)}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 dark:text-foreground truncate">{item.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{item.path}</p>
                      </div>
                      {item.webViewLink && (
                        <a
                          href={item.webViewLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-500 hover:text-indigo-700 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                          title="Open in Plexus Drive"
                          data-testid={`link-open-drive-${item.id}`}
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {driveConnected && !isLoading && !isSearching && (
            <div className="p-4">
              {files.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">This folder is empty.</div>
              ) : (
                <div className="space-y-1" data-testid="folder-contents">
                  {files.map((item) => (
                    <div
                      key={item.id}
                      className={`flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-muted/30 group transition-colors ${
                        item.isFolder ? "cursor-pointer" : ""
                      }`}
                      onClick={item.isFolder ? () => navigateInto(item) : undefined}
                      data-testid={`drive-item-${item.id}`}
                    >
                      <div className="shrink-0">{getMimeIcon(item.mimeType)}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 dark:text-foreground truncate">{item.name}</p>
                        {item.modifiedTime && (
                          <p className="text-xs text-muted-foreground">
                            {new Date(item.modifiedTime).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          className="flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-600 px-2 py-1 rounded hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                          onClick={(e) => { e.stopPropagation(); setMoveTarget(item); setMoveDestId(null); setMoveDestName(null); }}
                          title="Move"
                          data-testid={`button-move-${item.id}`}
                        >
                          <MoveRight className="w-3.5 h-3.5" />
                          Move
                        </button>
                        {item.webViewLink && (
                          <a
                            href={item.webViewLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-indigo-500 hover:text-indigo-700 transition-colors"
                            title="Open in Plexus Drive"
                            onClick={(e) => e.stopPropagation()}
                            data-testid={`link-open-drive-${item.id}`}
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      <Dialog open={moveTarget !== null} onOpenChange={(v) => { if (!v) { setMoveTarget(null); setMoveDestId(null); setMoveDestName(null); } }}>
        <DialogContent className="max-w-md" data-testid="dialog-move">
          <DialogHeader>
            <DialogTitle>Move "{moveTarget?.name}"</DialogTitle>
          </DialogHeader>
          <div className="mb-2 text-sm text-muted-foreground">Select a destination folder:</div>
          <div className="border rounded-lg max-h-72 overflow-y-auto p-2 bg-slate-50 dark:bg-muted/20" data-testid="move-folder-tree">
            {treeLoading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {folderTree && (
              <FolderTreePicker
                node={folderTree}
                onSelect={(id, name) => { setMoveDestId(id); setMoveDestName(name); }}
                selectedId={moveDestId}
              />
            )}
          </div>
          {moveDestName && (
            <p className="text-xs text-muted-foreground mt-1">
              Destination: <span className="font-medium text-slate-800 dark:text-foreground">{moveDestName}</span>
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setMoveTarget(null); setMoveDestId(null); setMoveDestName(null); }}
              data-testid="button-cancel-move"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (moveTarget && moveDestId) {
                  moveMutation.mutate({ fileId: moveTarget.id, destinationFolderId: moveDestId });
                }
              }}
              disabled={!moveDestId || moveMutation.isPending}
              data-testid="button-confirm-move"
            >
              {moveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Move Here
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
