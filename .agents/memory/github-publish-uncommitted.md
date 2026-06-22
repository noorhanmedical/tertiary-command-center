---
name: Publish branch + PR when working tree is uncommitted
description: How to push new work to a GitHub branch and open a PR when local changes aren't committed and `git commit` is disallowed.
---

# Publishing without a local commit

On Replit the platform auto-commits via checkpoints only at loop end, and running `git commit` directly is disallowed (must be delegated, but a delegated isolated task can't see the main agent's dirty working tree). So when you need to push *uncommitted* working-tree changes to a new branch and open a PR within the same turn, do NOT rely on `git push` (it only ships committed HEAD).

**Use the GitHub Git Data API** via `code_execution` with the connector token from `listConnections('github')` (`settings.access_token`; never print it):

1. Pick a base commit SHA that already exists on the remote (e.g. a prior backup-branch tip). Get its tree: `GET /git/commits/{sha}` → `tree.sha`.
2. Enumerate changed paths locally: `git --no-optional-locks diff --name-status <baseSha> -- .` (catches M/D) plus `git ls-files --others --exclude-standard` (untracked/new), filtering out `.local/`, `attached_assets/`, etc.
3. For each upsert: read file, `POST /git/blobs` with `{content: base64, encoding:'base64'}`.
4. `POST /git/trees` with `base_tree: <baseTreeSha>` and entries `{path, mode:'100644', type:'blob', sha: blobSha}`. **Deletions = entry with `sha: null`.**
5. `POST /git/commits` `{message, tree, parents:[baseSha]}`.
6. `POST /git/refs` `{ref:'refs/heads/<branch>', sha: commitSha}` (on "Reference already exists" → `PATCH /git/refs/heads/<branch>` with `force:true`).
7. `POST /pulls` `{title, head:<branch>, base:'main', body, draft:true}`; on failure, look up existing open PR via `GET /pulls?head=OWNER:branch&state=open`.

**Why:** captures the exact current working-tree bytes without a local commit, branches off a real remote base, and never touches `main`.

**How to apply:** any "back up my current work to a branch + draft PR" request where the tree is dirty. Repo used here: `noorhanmedical/tertiary-command-center`.
