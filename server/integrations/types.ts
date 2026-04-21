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
