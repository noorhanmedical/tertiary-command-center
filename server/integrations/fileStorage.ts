import type { IFileStorage, UploadFileParams, FileUploadResult, FileListItem } from "./types";
import { S3FileStorage } from "./s3FileStorage";

export type { IFileStorage, UploadFileParams, FileUploadResult, FileListItem };

// Google Drive storage has been removed. S3 is the only external file-storage
// provider. Document bytes are always persisted locally (blobStore) + in the
// documentBlobs table; this provider is only the optional external mirror.
export type StorageProvider = "s3";

export function getStorageProvider(): StorageProvider {
  return "s3";
}

// Note: production-only `STORAGE_PROVIDER=s3` enforcement lives in
// `server/lib/validateEnv.ts` (single source of truth, called at boot).

let _instance: IFileStorage | null = null;

export function getFileStorage(): IFileStorage {
  if (_instance) return _instance;
  _instance = new S3FileStorage();
  return _instance;
}

export function resetFileStorageInstance(): void {
  _instance = null;
}
