import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type PlexusProject = { id: number; title: string };
type PlexusUser = { id: string; username: string };

interface CreateTaskModalProps {
  open: boolean;
  onClose: () => void;
  defaultProjectId?: number | null;
}

export function CreateTaskModal({ open, onClose, defaultProjectId }: CreateTaskModalProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState<string>(defaultProjectId ? String(defaultProjectId) : "none");
  const [assignee, setAssignee] = useState<string>("none");
  const [urgency, setUrgency] = useState<string>("none");
  const [priority, setPriority] = useState<string>("normal");
  const [dueDate, setDueDate] = useState("");
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);

  const { data: projects = [] } = useQuery<PlexusProject[]>({
    queryKey: ["/api/plexus/projects"],
    enabled: open,
  });

  const { data: users = [] } = useQuery<PlexusUser[]>({
    queryKey: ["/api/plexus/users"],
    enabled: open,
  });

  const createProjectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/plexus/projects", {
        title: newProjectTitle.trim(),
        projectType: "operational",
      });
      return res.json();
    },
    onSuccess: (proj: PlexusProject) => {
      qc.invalidateQueries({ queryKey: ["/api/plexus/projects"] });
      setProjectId(String(proj.id));
      setNewProjectTitle("");
      setCreatingProject(false);
      toast({ title: "Project created" });
    },
    onError: (e: Error) => toast({ title: "Failed to create project", description: e.message, variant: "destructive" }),
  });

  const createTaskMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/plexus/tasks", {
        title: title.trim(),
        description: description.trim() || undefined,
        projectId: projectId !== "none" ? parseInt(projectId) : null,
        assignedToUserId: assignee !== "none" ? assignee : null,
        urgency,
        priority,
        dueDate: dueDate || null,
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/plexus/tasks"] });
      qc.invalidateQueries({ queryKey: ["/api/plexus/tasks/my-work"] });
      qc.invalidateQueries({ queryKey: ["/api/plexus/tasks/sent"] });
      qc.invalidateQueries({ queryKey: ["/api/plexus/tasks/urgent"] });
      toast({ title: "Task created" });
      handleClose();
    },
    onError: (e: Error) => toast({ title: "Failed to create task", description: e.message, variant: "destructive" }),
  });

  function handleClose() {
    setTitle(""); setDescription(""); setProjectId(defaultProjectId ? String(defaultProjectId) : "none");
    setAssignee("none"); setUrgency("none"); setPriority("normal"); setDueDate("");
    setNewProjectTitle(""); setCreatingProject(false);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-lg rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">New Task</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="task-title">Title <span className="text-red-500">*</span></Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to get done?"
              className="rounded-xl"
              data-testid="input-task-title"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="task-description">Description</Label>
            <Textarea
              id="task-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Additional context…"
              className="rounded-xl resize-none"
              rows={3}
              data-testid="input-task-description"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Project</Label>
              {creatingProject ? (
                <div className="flex gap-1.5">
                  <Input
                    value={newProjectTitle}
                    onChange={(e) => setNewProjectTitle(e.target.value)}
                    placeholder="Project name"
                    className="rounded-xl text-sm"
                    data-testid="input-new-project-title"
                  />
                  <Button
                    size="sm"
                    className="rounded-xl shrink-0"
                    onClick={() => createProjectMutation.mutate()}
                    disabled={!newProjectTitle.trim() || createProjectMutation.isPending}
                    data-testid="button-save-project"
                  >
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" className="rounded-xl shrink-0" onClick={() => setCreatingProject(false)}>×</Button>
                </div>
              ) : (
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger className="rounded-xl" data-testid="select-project">
                    <SelectValue placeholder="No project" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No project</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.title}</SelectItem>
                    ))}
                    <SelectItem value="__new__" onSelect={() => setCreatingProject(true)}>+ New project…</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Assign to</Label>
              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger className="rounded-xl" data-testid="select-assignee">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Urgency</Label>
              <Select value={urgency} onValueChange={setUrgency}>
                <SelectTrigger className="rounded-xl" data-testid="select-urgency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="EOD">EOD</SelectItem>
                  <SelectItem value="within 3 hours">Within 3 hours</SelectItem>
                  <SelectItem value="within 1 hour">Within 1 hour</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="rounded-xl" data-testid="select-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="task-due-date">Due Date</Label>
            <Input
              id="task-due-date"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="rounded-xl"
              data-testid="input-task-due-date"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" className="rounded-xl" onClick={handleClose} data-testid="button-cancel-task">
            Cancel
          </Button>
          <Button
            className="rounded-xl"
            onClick={() => createTaskMutation.mutate()}
            disabled={!title.trim() || createTaskMutation.isPending}
            data-testid="button-create-task"
          >
            {createTaskMutation.isPending ? "Creating…" : "Create Task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
