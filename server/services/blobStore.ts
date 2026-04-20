import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { db } from "../db";
import { documentBlobs, type DocumentBlob } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

const STORAGE_ROOT = path.resolve(process.cwd(), "storage", "documents");

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

function assertLocalBlobsAllowed() {
  if (process.env.NODE_ENV === "production" && process.env.STORAGE_PROVIDER !== "s3") {
    throw new Error(
      "Refusing to write document blobs to the local filesystem in production. " +
      "Set STORAGE_PROVIDER=s3 (and AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / S3_BUCKET_NAME) " +
      "to enable durable document storage.",
    );
  }
}

export interface SaveBlobInput {
  ownerType: "uploaded_document" | "generated_note" | "test_fixture" | "marketing_material";
  ownerId: number;
  filename: string;
  contentType: string;
  buffer: Buffer;
  isTest?: boolean;
}

export async function saveBlob(input: SaveBlobInput): Promise<DocumentBlob> {
  assertLocalBlobsAllowed();
  const sha256 = crypto.createHash("sha256").update(input.buffer).digest("hex");
  const subdir = path.join(STORAGE_ROOT, input.ownerType, sha256.slice(0, 2));
  await ensureDir(subdir);
  const safeName = input.filename.replace(/[^a-zA-Z0-9._\-]/g, "_").slice(0, 120);
  const storagePath = path.join(subdir, `${sha256.slice(2, 16)}_${safeName}`);
  await fs.writeFile(storagePath, input.buffer);

  const [row] = await db.insert(documentBlobs).values({
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    filename: input.filename,
    contentType: input.contentType,
    sizeBytes: input.buffer.length,
    storagePath,
    sha256,
    isTest: input.isTest ?? false,
  }).returning();
  return row;
}

function assertPathInRoot(p: string) {
  const resolved = path.resolve(p);
  if (!resolved.startsWith(STORAGE_ROOT + path.sep) && resolved !== STORAGE_ROOT) {
    throw new Error(`Refusing to access path outside storage root: ${p}`);
  }
}

export async function readBlob(blobId: number): Promise<{ blob: DocumentBlob; buffer: Buffer } | null> {
  const [row] = await db.select().from(documentBlobs).where(eq(documentBlobs.id, blobId));
  if (!row) return null;
  try {
    assertPathInRoot(row.storagePath);
    const buffer = await fs.readFile(row.storagePath);
    return { blob: row, buffer };
  } catch (err: any) {
    console.error(`[blobStore] readBlob failed for id=${blobId}:`, err.message);
    return null;
  }
}

export async function getLatestBlobForOwner(
  ownerType: SaveBlobInput["ownerType"],
  ownerId: number,
): Promise<DocumentBlob | null> {
  const [row] = await db
    .select()
    .from(documentBlobs)
    .where(and(eq(documentBlobs.ownerType, ownerType), eq(documentBlobs.ownerId, ownerId)))
    .orderBy(desc(documentBlobs.id))
    .limit(1);
  return row ?? null;
}

export async function deleteBlob(blobId: number): Promise<void> {
  const [row] = await db.select().from(documentBlobs).where(eq(documentBlobs.id, blobId));
  if (!row) return;
  try { assertPathInRoot(row.storagePath); await fs.unlink(row.storagePath); }
  catch (err: any) { console.error(`[blobStore] unlink failed for id=${blobId}:`, err.message); }
  await db.delete(documentBlobs).where(eq(documentBlobs.id, blobId));
}

export async function deleteTestBlobs(): Promise<number> {
  const rows = await db.select().from(documentBlobs).where(eq(documentBlobs.isTest, true));
  for (const r of rows) {
    try { assertPathInRoot(r.storagePath); await fs.unlink(r.storagePath); }
    catch (err: any) { console.error(`[blobStore] unlink test blob ${r.id}:`, err.message); }
  }
  if (rows.length > 0) {
    await db.delete(documentBlobs).where(eq(documentBlobs.isTest, true));
  }
  return rows.length;
}
