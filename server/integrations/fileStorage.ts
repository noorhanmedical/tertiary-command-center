export interface UploadFileParams {
  filename: string;
  content: Buffer | string;
  contentType: string;
  folder?: string;
}

export interface FileUploadResult {
  id: string;
  viewUrl: string;
}

export interface FileListItem {
  id: string;
  name: string;
  isFolder: boolean;
  viewUrl: string | null;
  size?: string | null;
  modifiedTime?: string | null;
}

export interface IFileStorage {
  uploadFile(params: UploadFileParams): Promise<FileUploadResult>;
  getFileUrl(fileId: string, expiresInSeconds?: number): Promise<string>;
  deleteFile(fileId: string): Promise<void>;
  listFiles(folder: string): Promise<FileListItem[]>;
}

export function getStorageProvider(): "google_drive" | "s3" {
  const p = process.env.STORAGE_PROVIDER || "google_drive";
  return p === "s3" ? "s3" : "google_drive";
}

let _instance: IFileStorage | null = null;

export function getFileStorage(): IFileStorage {
  if (_instance) return _instance;
  const provider = getStorageProvider();
  if (provider === "s3") {
    const { S3FileStorage } = require("./s3FileStorage");
    _instance = new S3FileStorage();
  } else {
    const { GoogleDriveFileStorage } = require("./googleDriveFileStorage");
    _instance = new GoogleDriveFileStorage();
  }
  return _instance!;
}

export function resetFileStorageInstance(): void {
  _instance = null;
}
