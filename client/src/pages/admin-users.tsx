import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Link } from "wouter";
import { Users, ArrowLeft, Plus, Trash2, UserX, UserCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

type TeamUser = { id: string; username: string; active: boolean };

export default function AdminUsersPage() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TeamUser | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<TeamUser | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  const { data: users = [], isLoading } = useQuery<TeamUser[]>({
    queryKey: ["/api/users"],
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/users", { username: username.trim(), password }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setAddOpen(false);
      setUsername("");
      setPassword("");
      setFieldError(null);
      toast({ title: "User created", description: `Account "${username.trim()}" has been created.` });
    },
    onError: (err: any) => {
      const raw: string = err?.message ?? "";
      const jsonStart = raw.indexOf("{");
      let serverMsg = "";
      if (jsonStart !== -1) {
        try {
          const parsed = JSON.parse(raw.slice(jsonStart));
          serverMsg = parsed?.message ?? "";
        } catch {}
      }
      const lower = (serverMsg || raw).toLowerCase();
      if (lower.includes("already exists") || lower.includes("duplicate") || raw.startsWith("409")) {
        setFieldError("That username is already taken.");
      } else {
        setFieldError(serverMsg || "Failed to create user.");
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setDeleteTarget(null);
      toast({ title: "User removed", description: "The account has been permanently deleted." });
    },
    onError: (err: any) => {
      const raw: string = err?.message ?? "";
      const jsonStart = raw.indexOf("{");
      let msg = "Failed to delete user.";
      if (jsonStart !== -1) {
        try { msg = JSON.parse(raw.slice(jsonStart))?.message || msg; } catch {}
      }
      toast({ title: "Error", description: msg, variant: "destructive" });
      setDeleteTarget(null);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/users/${id}/deactivate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setDeactivateTarget(null);
      toast({ title: "User deactivated", description: "The account has been deactivated." });
    },
    onError: (err: any) => {
      const raw: string = err?.message ?? "";
      const jsonStart = raw.indexOf("{");
      let msg = "Failed to deactivate user.";
      if (jsonStart !== -1) {
        try { msg = JSON.parse(raw.slice(jsonStart))?.message || msg; } catch {}
      }
      toast({ title: "Error", description: msg, variant: "destructive" });
      setDeactivateTarget(null);
    },
  });

  function handleAddSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldError(null);
    if (!username.trim()) {
      setFieldError("Username is required.");
      return;
    }
    if (!password) {
      setFieldError("Password is required.");
      return;
    }
    createMutation.mutate();
  }

  return (
    <div className="min-h-full flex-1 overflow-auto bg-[radial-gradient(circle_at_top,_rgba(191,219,254,0.45),_rgba(248,250,252,1)_40%,_rgba(239,246,255,0.92)_100%)]">
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-6 px-6 py-6">
        <div className="flex items-center gap-3">
          <Link href="/admin">
            <Button variant="ghost" size="icon" className="rounded-xl" data-testid="button-back-admin">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="rounded-2xl bg-amber-100 p-3 text-amber-700">
            <Users className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">User Management</h1>
            <p className="text-sm text-slate-600">Create and manage team accounts.</p>
          </div>
          <div className="ml-auto">
            <Button
              onClick={() => { setAddOpen(true); setFieldError(null); setUsername(""); setPassword(""); }}
              data-testid="button-add-user"
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              Add User
            </Button>
          </div>
        </div>

        <Card className="rounded-3xl border border-white/60 bg-white/75 shadow-[0_18px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
              Loading users…
            </div>
          ) : users.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
              No users found.
            </div>
          ) : (
            <table className="w-full text-sm" data-testid="table-users">
              <thead>
                <tr className="border-b border-slate-100 text-left">
                  <th className="px-6 py-3 font-medium text-slate-500">Username</th>
                  <th className="px-6 py-3 font-medium text-slate-500">ID</th>
                  <th className="px-6 py-3 font-medium text-slate-500">Status</th>
                  <th className="px-6 py-3 font-medium text-slate-500 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {users.map((u) => (
                  <tr key={u.id} data-testid={`row-user-${u.id}`} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-3 font-medium text-slate-800" data-testid={`text-username-${u.id}`}>
                      {u.username}
                    </td>
                    <td className="px-6 py-3 text-slate-400 font-mono text-xs">{u.id}</td>
                    <td className="px-6 py-3">
                      {u.active ? (
                        <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-200" data-testid={`status-active-${u.id}`}>
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-slate-100 text-slate-500" data-testid={`status-inactive-${u.id}`}>
                          Inactive
                        </Badge>
                      )}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {u.active && u.username !== "admin" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                            onClick={() => setDeactivateTarget(u)}
                            data-testid={`button-deactivate-${u.id}`}
                          >
                            <UserX className="h-3.5 w-3.5" />
                            Deactivate
                          </Button>
                        )}
                        {!u.active && (
                          <span className="text-xs text-slate-400 italic flex items-center gap-1">
                            <UserCheck className="h-3.5 w-3.5" />
                            Deactivated
                          </span>
                        )}
                        {u.username !== "admin" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1 text-red-500 hover:text-red-600 hover:bg-red-50"
                            onClick={() => setDeleteTarget(u)}
                            data-testid={`button-delete-${u.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent data-testid="dialog-add-user">
          <DialogHeader>
            <DialogTitle>Add User</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-username">Username</Label>
              <Input
                id="new-username"
                data-testid="input-new-username"
                value={username}
                onChange={(e) => { setUsername(e.target.value); setFieldError(null); }}
                placeholder="e.g. jsmith"
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-password">Initial password</Label>
              <Input
                id="new-password"
                type="password"
                data-testid="input-new-password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setFieldError(null); }}
                placeholder="Set a temporary password"
                autoComplete="new-password"
              />
            </div>
            {fieldError && (
              <p className="text-sm text-red-600" data-testid="text-field-error">{fieldError}</p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)} data-testid="button-cancel-add">
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending} data-testid="button-confirm-add">
                {createMutation.isPending ? "Creating…" : "Create User"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent data-testid="dialog-confirm-delete">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.username}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the account. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deactivateTarget} onOpenChange={(o) => { if (!o) setDeactivateTarget(null); }}>
        <AlertDialogContent data-testid="dialog-confirm-deactivate">
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate "{deactivateTarget?.username}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark the account as inactive. The user will still exist but will be flagged as deactivated. You can delete the account afterwards if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-deactivate">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700"
              onClick={() => deactivateTarget && deactivateMutation.mutate(deactivateTarget.id)}
              data-testid="button-confirm-deactivate"
            >
              {deactivateMutation.isPending ? "Deactivating…" : "Deactivate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
