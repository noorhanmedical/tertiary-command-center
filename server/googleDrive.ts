import { google } from "googleapis";

interface ConnectorSettings {
  access_token?: string;
  oauth?: {
    credentials?: {
      access_token?: string;
    };
  };
  expires_at?: string;
}

interface ConnectorConnection {
  settings: ConnectorSettings;
}

async function getDriveAccessToken(): Promise<string> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? "depl " + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken) {
    throw new Error("X-Replit-Token not found for repl/depl");
  }

  const response = await fetch(
    "https://" +
      hostname +
      "/api/v2/connection?include_secrets=true&connector_names=google-drive",
    {
      headers: {
        Accept: "application/json",
        "X-Replit-Token": xReplitToken,
      },
    }
  );

  const data = (await response.json()) as { items?: ConnectorConnection[] };
  const connection = data.items?.[0];

  const accessToken =
    connection?.settings?.access_token ||
    connection?.settings?.oauth?.credentials?.access_token;

  if (!connection || !accessToken) {
    throw new Error("Google Drive not connected");
  }
  return accessToken;
}

export async function getUncachableGoogleDriveClient() {
  const accessToken = await getDriveAccessToken();
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.drive({ version: "v3", auth: oauth2Client });
}

export async function isGoogleDriveConnected(): Promise<boolean> {
  try {
    const drive = await getUncachableGoogleDriveClient();
    await drive.about.get({ fields: "user" });
    return true;
  } catch {
    return false;
  }
}

export async function uploadTextAsGoogleDoc(
  filename: string,
  content: string
): Promise<{ id: string; webViewLink: string }> {
  const drive = await getUncachableGoogleDriveClient();

  const { Readable } = await import("stream");
  const stream = Readable.from([Buffer.from(content, "utf-8")]);

  const resp = await drive.files.create({
    requestBody: {
      name: filename,
      mimeType: "application/vnd.google-apps.document",
    },
    media: {
      mimeType: "text/plain",
      body: stream,
    },
    fields: "id,webViewLink",
  });

  return {
    id: resp.data.id!,
    webViewLink: resp.data.webViewLink!,
  };
}
