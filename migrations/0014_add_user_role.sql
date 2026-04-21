-- Add role column to users table for RBAC
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" text NOT NULL DEFAULT 'clinician';

-- Update the seeded admin user to have the admin role
UPDATE "users" SET "role" = 'admin' WHERE "username" = 'admin';
