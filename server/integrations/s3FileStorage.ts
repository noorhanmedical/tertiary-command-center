import { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomBytes } from "crypto";
import type { IFileStorage, UploadFileParams, FileUploadResult, FileListItem } from "./types";

const PRESIGNED_URL_TTL_SECONDS = 24 * 60 * 60;

export class S3FileStorage implements IFileStorage {
  private client: S3Client;
  private bucket: string;

  constructor() {
    const region = process.env.AWS_REGION;
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const bucket = process.env.S3_BUCKET_NAME;

    if (!region || !bucket) {
      throw new Error(
        "S3 storage provider requires AWS_REGION and S3_BUCKET_NAME. " +
        "Provide AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY for static credentials, " +
        "or omit both and run under an IAM task/instance role for the SDK's default credential chain."
      );
    }

    if ((accessKeyId && !secretAccessKey) || (!accessKeyId && secretAccessKey)) {
      throw new Error(
        "S3 storage provider received only one of AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY — set both or neither."
      );
    }

    this.bucket = bucket;
    // When both keys are set, use them explicitly. Otherwise let the AWS SDK
    // walk its default credential chain (env → shared file → ECS task role →
    // EC2 instance role) so ECS Fargate task roles work out of the box.
    this.client = new S3Client(
      accessKeyId && secretAccessKey
        ? { region, credentials: { accessKeyId, secretAccessKey } }
        : { region }
    );
  }

  async uploadFile({ filename, content, contentType, folder }: UploadFileParams): Promise<FileUploadResult> {
    const safeFolder = (folder || "").replace(/\/+$/, "").replace(/^\/+/, "");
    const uniquePrefix = `${Date.now()}-${randomBytes(4).toString("hex")}`;
    const key = safeFolder ? `${safeFolder}/${uniquePrefix}-${filename}` : `${uniquePrefix}-${filename}`;
    const body = typeof content === "string" ? Buffer.from(content, "utf-8") : content;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentDisposition: `inline; filename="${filename.replace(/"/g, "'")}"`,
      })
    );

    const viewUrl = await this._presign(key, PRESIGNED_URL_TTL_SECONDS);
    return { id: key, viewUrl };
  }

  async getFileUrl(fileId: string, expiresInSeconds = PRESIGNED_URL_TTL_SECONDS): Promise<string> {
    return this._presign(fileId, expiresInSeconds);
  }

  async deleteFile(fileId: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: fileId })
    );
  }

  async listFiles(folder: string): Promise<FileListItem[]> {
    const prefix = folder.replace(/\/+$/, "") + "/";
    const resp = await this.client.send(
      new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, Delimiter: "/" })
    );

    const folders: FileListItem[] = (resp.CommonPrefixes || []).map((cp) => ({
      id: cp.Prefix!,
      name: cp.Prefix!.replace(prefix, "").replace(/\/$/, ""),
      isFolder: true,
      viewUrl: null,
    }));

    const files: FileListItem[] = (resp.Contents || [])
      .filter((obj) => obj.Key !== prefix)
      .map((obj) => ({
        id: obj.Key!,
        name: obj.Key!.split("/").pop() || obj.Key!,
        isFolder: false,
        viewUrl: null,
        size: obj.Size?.toString() || null,
        modifiedTime: obj.LastModified?.toISOString() || null,
      }));

    return [...folders, ...files];
  }

  private async _presign(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds }
    );
  }
}
