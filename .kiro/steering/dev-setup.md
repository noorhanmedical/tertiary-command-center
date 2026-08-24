# Plexus Command Center — Developer Context

## What this project is
A clinical operations platform for managing patient screening, scheduling, billing, and documents. Built with React + TypeScript (frontend), Express + TypeScript (backend), PostgreSQL (database), and deployed to AWS ECS Fargate.

## Stack
- **Frontend**: React 18, Vite, Tailwind CSS, shadcn/ui (Radix), TanStack Query, Wouter (routing)
- **Backend**: Express 5, Drizzle ORM, Passport (auth), connect-pg-simple (sessions)
- **Database**: PostgreSQL 15 via Drizzle ORM — schema lives in `shared/schema.ts`
- **Shared types**: `shared/` folder is imported by both client and server — use `@shared/` alias
- **Client alias**: `@/` maps to `client/src/`

## Local dev setup (one-time)
1. Install Docker Desktop
2. `cp .env.local.example .env`
3. `docker compose up -d` — starts local Postgres
4. `npm install`
5. `npm run db:push` — pushes schema to local DB
6. `npm run dev` — starts app at http://localhost:5000

Default login after first boot: `admin` / `admin` (change it immediately)

## Running the app
```bash
docker compose up -d   # ensure DB is running
npm run dev            # starts Express + Vite HMR on port 5000
```
Hot reload is active — save a file and the browser updates instantly.

## Project structure
```
client/src/          # React frontend
  components/        # Shared UI components
  calendar/          # Calendar feature module
  pages/             # Route-level page components
server/              # Express backend
  routes/            # API route handlers
  lib/               # Server utilities
  middleware/         # Express middleware
shared/              # Types and schema shared between client + server
  schema.ts          # Drizzle ORM schema (single source of truth for DB)
script/              # One-off scripts and probes (not part of app)
infrastructure/      # AWS CDK stack (deployment only)
```

## Key conventions
- All database tables are defined in `shared/schema.ts` — never write raw SQL migrations
- Run `npm run db:push` after changing the schema to apply changes to your local DB
- API routes follow REST patterns under `/api/...`
- Authentication is session-based (Passport local strategy)
- Use `@shared/` imports for anything shared between client and server
- Components use shadcn/ui patterns — check `components/ui/` before building new primitives

## What NOT to touch
- `infrastructure/` — AWS CDK deployment code, only the project owner deploys
- `.env` — never commit, never share in chat
- `migrations/` — managed by Drizzle, don't edit manually

## Deployment
Handled automatically via GitHub Actions on merge to `main`. Developers push to a feature branch, open a PR, and after merge the CI/CD pipeline builds and deploys to AWS ECS. No AWS access needed.
