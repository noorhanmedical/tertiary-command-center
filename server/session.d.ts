import "express-session";

declare module "express-session" {
  interface SessionData {
    userId: string;
    username: string;
    role: string;
    /** The clinic this user belongs to. null for admin (bypasses filtering). */
    clinicId: number | null;
  }
}
