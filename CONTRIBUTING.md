# Contributing to Plexus Command Center

## Prerequisites

Install these once on your machine:

- [Kiro](https://kiro.dev) — the IDE you'll work in
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) — runs the local database
- [Node.js 20](https://nodejs.org) — check with `node --version`
- Git access to this repo — ask the project owner to add you on GitHub

---

## First-time setup (~ 5 minutes)

**1. Clone the repo**
```bash
git clone https://github.com/noorhanmedical/tertiary-command-center.git
cd tertiary-command-center
```

**2. Install dependencies**
```bash
npm install
```

**3. Set up your local environment**
```bash
cp .env.local.example .env
```
No changes needed — the defaults work out of the box for local dev.

**4. Start the local database**
```bash
docker compose up -d
```
This starts a Postgres instance in the background. You only need to do this once per machine restart.

**5. Push the database schema**
```bash
npm run db:push
```
This creates all the tables in your local database.

**6. Start the app**
```bash
npm run dev
```
Open http://localhost:5000 — you should see the login screen.

**Default login:** `admin` / `admin` — change the password after first login.

---

## Daily workflow

```bash
# Make sure DB is running (safe to run even if already up)
docker compose up -d

# Start the app
npm run dev
```

Kiro's hot reload is active — edit any file and the browser updates instantly without a refresh.

---

## Making and shipping changes

1. **Create a feature branch**
   ```bash
   git checkout -b your-name/feature-description
   ```

2. **Make your changes** in Kiro — use the AI to help build, debug, and review

3. **Push and open a PR**
   ```bash
   git push -u origin your-name/feature-description
   ```
   Then open a Pull Request on GitHub.

4. **After the PR is merged to `main`** — the app automatically deploys to the live site via GitHub Actions. No AWS access needed.

---

## If you change the database schema

The schema lives in `shared/schema.ts`. After editing it:
```bash
npm run db:push
```
This applies the changes to your local database.

---

## Stopping the database

```bash
docker compose down        # stop (keeps your data)
docker compose down -v     # stop + wipe all local data (full reset)
```

---

## Common issues

**Port 5432 already in use**
Another Postgres is running locally. Stop it or change the port in `docker-compose.yml` and `DATABASE_URL` in your `.env`.

**`npm run db:push` fails**
Make sure the database is running: `docker compose up -d`, wait a few seconds, then retry.

**Can't log in after first boot**
Use `admin` / `admin`. If that fails, wipe the DB and start fresh:
```bash
docker compose down -v
docker compose up -d
npm run db:push
npm run dev
```
