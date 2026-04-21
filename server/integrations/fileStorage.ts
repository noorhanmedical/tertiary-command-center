import type { IFileStorage, UploadFileParams, FileUploadResult, FileListItem } from "./types";
import { GoogleDriveFileStorage } from "./googleDriveFileStorage";
import { S3FileStorage } from "./s3FileStorage";

export type { IFileStorage, UploadFileParams, FileUploadResult, FileListItem };

export type StorageProvider = "google_drive" | "s3";

export function getStorageProvider(): StorageProvider {
  const p = process.env.STORAGE_PROVIDER || "google_drive";
  return p === "s3" ? "s3" : "google_drive";
}

// Note: production-only `STORAGE_PROVIDER=s3` enforcement lives in
// `server/lib/validateEnv.ts` (single source of truth, called at boot).

let _instance: IFileStorage | null = null;

export function getFileStorage(): IFileStorage {
  if (_instance) return _instance;
  const provider = getStorageProvider();
  if (provider === "s3") {
    _instance = new S3FileStorage();
  } else {
    _instance = new GoogleDriveFileStorage();
  }
  return _instance;
}

export function resetFileStorageInstance(): void {
  _instance = null;
}
