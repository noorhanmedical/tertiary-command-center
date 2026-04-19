import type { IFileStorage, UploadFileParams, FileUploadResult, FileListItem } from "./fileStorage";

export class GoogleDriveFileStorage implements IFileStorage {
  async uploadFile({ filename, content, contentType, folder }: UploadFileParams): Promise<FileUploadResult> {
    if (contentType === "text/plain" || typeof content === "string") {
      const { uploadTextAsGoogleDoc } = await import("../googleDrive");
      const result = await uploadTextAsGoogleDoc(
        filename,
        typeof content === "string" ? content : content.toString("utf-8"),
        folder
      );
      return { id: result.id, viewUrl: result.webViewLink ?? "" };
    } else {
      const { uploadPdfToFolder } = await import("../googleDrive");
      if (!folder) throw new Error("folder (Drive folder ID) is required for PDF uploads");
      const buf = typeof content === "string" ? Buffer.from(content, "utf-8") : content;
      const result = await uploadPdfToFolder(filename, buf, folder);
      return { id: result.id, viewUrl: result.webViewLink ?? "" };
    }
  }

  async getFileUrl(fileId: string): Promise<string> {
    return `https://drive.google.com/file/d/${fileId}/view`;
  }

  async deleteFile(fileId: string): Promise<void> {
    const { getUncachableGoogleDriveClient } = await import("../googleDrive");
    const drive = await getUncachableGoogleDriveClient();
    await drive.files.delete({ fileId });
  }

  async listFiles(folderId: string): Promise<FileListItem[]> {
    const { getUncachableGoogleDriveClient } = await import("../googleDrive");
    const drive = await getUncachableGoogleDriveClient();
    const escapedId = folderId.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const resp = await drive.files.list({
      q: `'${escapedId}' in parents and trashed = false`,
      fields: "files(id,name,mimeType,webViewLink,size,modifiedTime)",
      orderBy: "folder,name",
      pageSize: 200,
      spaces: "drive",
    });
    return (resp.data.files || []).map((f) => ({
      id: f.id!,
      name: f.name!,
      isFolder: f.mimeType === "application/vnd.google-apps.folder",
      viewUrl: f.webViewLink || null,
      size: f.size || null,
      modifiedTime: f.modifiedTime || null,
    }));
  }
}
