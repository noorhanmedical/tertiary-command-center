import type { IFileStorage, UploadFileParams, FileUploadResult, FileListItem } from "./types";
import { GoogleDriveFileStorage } from "./googleDriveFileStorage";
import { S3FileStorage } from "./s3FileStorage";

export type { IFileStorage, UploadFileParams, FileUploadResult, FileListItem };

export function getStorageProvider(): "google_drive" | "s3" {
  const p = process.env.STORAGE_PROVIDER || "google_drive";
  return p === "s3" ? "s3" : "google_drive";
}

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
