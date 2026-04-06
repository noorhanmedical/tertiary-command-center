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

async function getAccessToken(): Promise<string> {
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
      "/api/v2/connection?include_secrets=true&connector_names=google-sheet",
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
    throw new Error("Google Sheet not connected");
  }
  return accessToken;
}

export async function getUncachableGoogleSheetClient() {
  const accessToken = await getAccessToken();
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.sheets({ version: "v4", auth: oauth2Client });
}

export async function isGoogleSheetsConnected(): Promise<boolean> {
  try {
    const sheets = await getUncachableGoogleSheetClient();
    await sheets.spreadsheets.get({ spreadsheetId: "probe" });
    return true;
  } catch (err: unknown) {
    const status = (err as { status?: number; code?: number }).status ?? (err as { status?: number; code?: number }).code;
    if (status === 404 || status === 400) {
      return true;
    }
    return false;
  }
}

export async function getOrCreateSpreadsheet(
  settingKey: string,
  title: string
): Promise<string> {
  const { getSetting, setSetting } = await import("./dbSettings");

  const envId = process.env[settingKey];
  if (envId) return envId;

  const dbId = await getSetting(settingKey);
  if (dbId) return dbId;

  const sheets = await getUncachableGoogleSheetClient();
  const resp = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title },
      sheets: [],
    },
  });

  const id = resp.data.spreadsheetId!;
  await setSetting(settingKey, id);
  return id;
}

export async function getOrCreateSpreadsheetInFolder(
  settingKey: string,
  title: string,
  folderId: string
): Promise<string> {
  const { getSetting, setSetting } = await import("./dbSettings");
  const { getUncachableGoogleDriveClient } = await import("./googleDrive");
  const drive = await getUncachableGoogleDriveClient();

  const dbId = await getSetting(settingKey);
  if (dbId) {
    try {
      const fileResp = await drive.files.get({
        fileId: dbId,
        fields: "parents",
      });
      const parents: string[] = fileResp.data.parents ?? [];
      if (!parents.includes(folderId)) {
        const currentParents = parents.join(",");
        await drive.files.update({
          fileId: dbId,
          addParents: folderId,
          removeParents: currentParents || undefined,
          fields: "id,parents",
        });
      }
    } catch (e) {
      console.warn(`Could not verify/move spreadsheet ${dbId} to folder ${folderId}:`, (e as Error).message);
    }
    return dbId;
  }

  const sheets = await getUncachableGoogleSheetClient();
  const resp = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title },
      sheets: [],
    },
  });

  const spreadsheetId = resp.data.spreadsheetId!;

  try {
    const fileResp = await drive.files.get({
      fileId: spreadsheetId,
      fields: "parents",
    });
    const currentParents = fileResp.data.parents?.join(",") ?? "";
    await drive.files.update({
      fileId: spreadsheetId,
      addParents: folderId,
      removeParents: currentParents || undefined,
      fields: "id,parents",
    });
  } catch (e) {
    console.warn(`Could not move new spreadsheet ${spreadsheetId} to folder ${folderId}:`, (e as Error).message);
  }

  await setSetting(settingKey, spreadsheetId);
  return spreadsheetId;
}

export async function upsertSheetData(
  spreadsheetId: string,
  sheetTitle: string,
  headers: string[],
  rows: (string | number | boolean | null)[][]
): Promise<void> {
  const sheets = await getUncachableGoogleSheetClient();

  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const existingSheet = spreadsheet.data.sheets?.find(
    (s) => s.properties?.title === sheetTitle
  );

  if (!existingSheet) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: { title: sheetTitle },
            },
          },
        ],
      },
    });
  }

  const quotedTitle = `'${sheetTitle.replace(/'/g, "''")}'`;

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: quotedTitle,
  });

  const values = [headers, ...rows.map((r) => r.map((v) => (v === null || v === undefined ? "" : String(v))))];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${quotedTitle}!A1`,
    valueInputOption: "RAW",
    requestBody: { values },
  });
}
