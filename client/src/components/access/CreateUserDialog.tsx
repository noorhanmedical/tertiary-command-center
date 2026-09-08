// Phase 4B — create a new user account. Minimal, gated by users.manage.
// The new account starts with no roles; the operator assigns access from the
// detail drawer afterward. Password is write-only — never echoed back.

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { accessApi, describeAccessError } from "@/lib/access/accessApi";
import { useInvalidateAccessUser } from "@/hooks/api/access";

export function CreateUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const invalidate = useInvalidateAccessUser();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);

  function reset() {
    setUsername("");
    setPassword("");
    setDisplayName("");
    setEmail("");
  }

  async function submit() {
    if (!username.trim() || password.length < 8) {
      toast({ title: "Missing information", description: "Username and a password of at least 8 characters are required.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await accessApi.createUser({
        username: username.trim(),
        password,
        displayName: displayName.trim() || undefined,
        email: email.trim() || undefined,
      });
      invalidate();
      toast({ title: "User created", description: `${username.trim()} was created. Assign roles and access next.` });
      reset();
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Could not create user", description: describeAccessError(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!saving) { onOpenChange(v); if (!v) reset(); } }}>
      <DialogContent data-testid="dialog-create-user">
        <DialogHeader>
          <DialogTitle>New User</DialogTitle>
          <DialogDescription>
            Create an account, then assign roles, scope, and access from the user's detail panel.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-username">Username</Label>
            <Input id="new-username" value={username} onChange={(e) => setUsername(e.target.value)} data-testid="input-new-username" autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-password">Temporary Password</Label>
            <Input id="new-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="input-new-password" autoComplete="new-password" />
            <p className="text-xs text-slate-400">At least 8 characters. Not shown again after creation.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-display">Display Name (optional)</Label>
            <Input id="new-display" value={displayName} onChange={(e) => setDisplayName(e.target.value)} data-testid="input-new-display" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-email">Work Email (optional)</Label>
            <Input id="new-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-new-email" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving} data-testid="button-submit-create-user">
            {saving ? "Creating…" : "Create User"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
