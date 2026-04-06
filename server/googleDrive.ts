import { google, drive_v3 } from "googleapis";

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

export async function getDriveStatus(): Promise<{ connected: boolean; email: string | null }> {
  try {
    const drive = await getUncachableGoogleDriveClient();
    const resp = await drive.about.get({ fields: "user" });
    const email = resp.data.user?.emailAddress ?? null;
    return { connected: true, email };
  } catch {
    return { connected: false, email: null };
  }
}

export async function isGoogleDriveConnected(): Promise<boolean> {
  const { connected } = await getDriveStatus();
  return connected;
}

export async function getDriveUserEmail(): Promise<string | null> {
  const { email } = await getDriveStatus();
  return email;
}

const VALID_FACILITIES = ["Taylor Family Practice", "NWPG - Spring", "NWPG - Veterans"] as const;

export async function initializeDriveFolderTree(): Promise<void> {
  try {
    const { getSetting, setSetting } = await import("./dbSettings");
    const drive = await getUncachableGoogleDriveClient();

    const rootKey = "DRIVE_FOLDER_plexus_ancillary_platform";
    let rootId = await getSetting(rootKey);
    if (!rootId) {
      rootId = await getOrCreateFolder(drive, "Plexus Ancillary Platform");
      await setSetting(rootKey, rootId);
      console.log("[Drive] Created root folder: Plexus Ancillary Platform");
    }

    for (const facility of VALID_FACILITIES) {
      const facilitySafeKey = facility.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
      const facilityKey = `DRIVE_FOLDER_facility_${facilitySafeKey}`;
      let facilityFolderId = await getSetting(facilityKey);
      if (!facilityFolderId) {
        facilityFolderId = await getOrCreateFolder(drive, facility, rootId);
        await setSetting(facilityKey, facilityFolderId);
        console.log(`[Drive] Created facility folder: ${facility}`);
      }

      for (const ancType of ALL_ANCILLARY_TYPES) {
        const ancSafeKey = ancType.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
        const ancKey = `DRIVE_FOLDER_facility_ancillary_${facilitySafeKey}_${ancSafeKey}`;
        let ancFolderId = await getSetting(ancKey);
        if (!ancFolderId) {
          ancFolderId = await getOrCreateFolder(drive, ancType, facilityFolderId);
          await setSetting(ancKey, ancFolderId);
          console.log(`[Drive] Created ancillary folder: ${facility} / ${ancType}`);
        }

        const clinDocsKey = `DRIVE_FOLDER_facility_clinical_docs_${facilitySafeKey}_${ancSafeKey}`;
        let clinDocsFolderId = await getSetting(clinDocsKey);
        if (!clinDocsFolderId) {
          clinDocsFolderId = await getOrCreateFolder(drive, "Clinical Documents", ancFolderId);
          await setSetting(clinDocsKey, clinDocsFolderId);
        }

        const reportKey = `DRIVE_FOLDER_facility_report_${facilitySafeKey}_${ancSafeKey}`;
        let reportFolderId = await getSetting(reportKey);
        if (!reportFolderId) {
          reportFolderId = await getOrCreateFolder(drive, "Report", ancFolderId);
          await setSetting(reportKey, reportFolderId);
        }
      }
    }

    console.log("[Drive] Folder tree initialization complete.");
  } catch (err: any) {
    console.warn("[Drive] Folder tree init skipped (Drive not connected or error):", err.message);
  }
}

function driveQueryEscape(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export async function uploadTextAsGoogleDoc(
  filename: string,
  content: string,
  parentFolderId?: string
): Promise<{ id: string; webViewLink: string }> {
  const drive = await getUncachableGoogleDriveClient();

  const { Readable } = await import("stream");
  const stream = Readable.from([Buffer.from(content, "utf-8")]);

  const requestBody: drive_v3.Schema$File = {
    name: filename,
    mimeType: "application/vnd.google-apps.document",
    ...(parentFolderId ? { parents: [parentFolderId] } : {}),
  };

  const resp = await drive.files.create({
    requestBody,
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

export async function getOrCreateFolder(
  drive: Awaited<ReturnType<typeof getUncachableGoogleDriveClient>>,
  name: string,
  parentId?: string
): Promise<string> {
  const q = [
    `name = ${driveQueryEscape(name)}`,
    `mimeType = 'application/vnd.google-apps.folder'`,
    `trashed = false`,
  ];
  if (parentId) {
    q.push(`${driveQueryEscape(parentId)} in parents`);
  }

  const listResp = await drive.files.list({
    q: q.join(" and "),
    fields: "files(id)",
    spaces: "drive",
  });

  const existing = listResp.data.files?.[0];
  if (existing?.id) {
    return existing.id;
  }

  const createBody: drive_v3.Schema$File = {
    name,
    mimeType: "application/vnd.google-apps.folder",
    ...(parentId ? { parents: [parentId] } : {}),
  };

  const createResp = await drive.files.create({
    requestBody: createBody,
    fields: "id",
  });

  return createResp.data.id!;
}

export interface FolderTree {
  clinicalDocsFolderId: string;
  reportFolderId: string;
  informedConsentFolderId: string;
  facilityFolderId: string;
  patientFolderId: string;
  ancillaryTypeFolderId: string;
}

const ALL_ANCILLARY_TYPES = ["BrainWave", "VitalWave", "Ultrasound"] as const;

async function ensureAncillarySubfolders(
  drive: Awaited<ReturnType<typeof getUncachableGoogleDriveClient>>,
  getSetting: (key: string) => Promise<string | null>,
  setSetting: (key: string, value: string) => Promise<void>,
  patientFolderId: string,
  facilitySafeKey: string,
  patientSafeKey: string
): Promise<void> {
  for (const ancType of ALL_ANCILLARY_TYPES) {
    const ancSafeKey = ancType.replace(/\s+/g, "_");
    const ancillaryKey = `DRIVE_FOLDER_ancillary_${facilitySafeKey}_${patientSafeKey}_${ancSafeKey}`;
    let ancillaryTypeFolderId = await getSetting(ancillaryKey);
    if (!ancillaryTypeFolderId) {
      ancillaryTypeFolderId = await getOrCreateFolder(drive, ancType, patientFolderId);
      await setSetting(ancillaryKey, ancillaryTypeFolderId);
    }
    const clinicalDocsKey = `DRIVE_FOLDER_clinical_docs_${facilitySafeKey}_${patientSafeKey}_${ancSafeKey}`;
    let clinicalDocsFolderId = await getSetting(clinicalDocsKey);
    if (!clinicalDocsFolderId) {
      clinicalDocsFolderId = await getOrCreateFolder(drive, "Clinical Documents", ancillaryTypeFolderId);
      await setSetting(clinicalDocsKey, clinicalDocsFolderId);
    }
    const reportKey = `DRIVE_FOLDER_report_${facilitySafeKey}_${patientSafeKey}_${ancSafeKey}`;
    let reportFolderId = await getSetting(reportKey);
    if (!reportFolderId) {
      reportFolderId = await getOrCreateFolder(drive, "Report", ancillaryTypeFolderId);
      await setSetting(reportKey, reportFolderId);
    }
  }
}

export async function ensurePlexusFolderTree(
  facility: string,
  patientName: string,
  ancillaryType: string
): Promise<FolderTree> {
  const { getSetting, setSetting } = await import("./dbSettings");
  const drive = await getUncachableGoogleDriveClient();

  const rootKey = "DRIVE_FOLDER_plexus_ancillary_platform";
  let rootId = await getSetting(rootKey);
  if (!rootId) {
    rootId = await getOrCreateFolder(drive, "Plexus Ancillary Platform");
    await setSetting(rootKey, rootId);
  }

  const facilitySafeKey = facility.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
  const facilityKey = `DRIVE_FOLDER_facility_${facilitySafeKey}`;
  let facilityFolderId = await getSetting(facilityKey);
  if (!facilityFolderId) {
    facilityFolderId = await getOrCreateFolder(drive, facility, rootId);
    await setSetting(facilityKey, facilityFolderId);
  }

  const patientSafeKey = patientName.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
  const patientKey = `DRIVE_FOLDER_patient_${facilitySafeKey}_${patientSafeKey}`;
  let patientFolderId = await getSetting(patientKey);
  if (!patientFolderId) {
    patientFolderId = await getOrCreateFolder(drive, patientName, facilityFolderId);
    await setSetting(patientKey, patientFolderId);
    await ensureAncillarySubfolders(drive, getSetting, setSetting, patientFolderId, facilitySafeKey, patientSafeKey);
  }

  const ancillarySafeKey = ancillaryType.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
  const ancillaryKey = `DRIVE_FOLDER_ancillary_${facilitySafeKey}_${patientSafeKey}_${ancillarySafeKey}`;
  let ancillaryTypeFolderId = await getSetting(ancillaryKey);
  if (!ancillaryTypeFolderId) {
    ancillaryTypeFolderId = await getOrCreateFolder(drive, ancillaryType, patientFolderId);
    await setSetting(ancillaryKey, ancillaryTypeFolderId);
  }

  const clinicalDocsKey = `DRIVE_FOLDER_clinical_docs_${facilitySafeKey}_${patientSafeKey}_${ancillarySafeKey}`;
  let clinicalDocsFolderId = await getSetting(clinicalDocsKey);
  if (!clinicalDocsFolderId) {
    clinicalDocsFolderId = await getOrCreateFolder(drive, "Clinical Documents", ancillaryTypeFolderId);
    await setSetting(clinicalDocsKey, clinicalDocsFolderId);
  }

  const reportKey = `DRIVE_FOLDER_report_${facilitySafeKey}_${patientSafeKey}_${ancillarySafeKey}`;
  let reportFolderId = await getSetting(reportKey);
  if (!reportFolderId) {
    reportFolderId = await getOrCreateFolder(drive, "Report", ancillaryTypeFolderId);
    await setSetting(reportKey, reportFolderId);
  }

  const informedConsentKey = `DRIVE_FOLDER_informed_consent_${facilitySafeKey}_${patientSafeKey}_${ancillarySafeKey}`;
  let informedConsentFolderId = await getSetting(informedConsentKey);
  if (!informedConsentFolderId) {
    informedConsentFolderId = await getOrCreateFolder(drive, "Informed Consent", ancillaryTypeFolderId);
    await setSetting(informedConsentKey, informedConsentFolderId);
  }

  return {
    clinicalDocsFolderId,
    reportFolderId,
    informedConsentFolderId,
    facilityFolderId,
    patientFolderId,
    ancillaryTypeFolderId,
  };
}

export async function getFacilityFolderId(facility: string): Promise<string> {
  const { getSetting, setSetting } = await import("./dbSettings");
  const drive = await getUncachableGoogleDriveClient();

  const rootKey = "DRIVE_FOLDER_plexus_ancillary_platform";
  let rootId = await getSetting(rootKey);
  if (!rootId) {
    rootId = await getOrCreateFolder(drive, "Plexus Ancillary Platform");
    await setSetting(rootKey, rootId);
  }

  const facilityKey = `DRIVE_FOLDER_facility_${facility.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "")}`;
  let facilityFolderId = await getSetting(facilityKey);
  if (!facilityFolderId) {
    facilityFolderId = await getOrCreateFolder(drive, facility, rootId);
    await setSetting(facilityKey, facilityFolderId);
  }

  return facilityFolderId;
}

export async function uploadPdfToFolder(
  filename: string,
  buffer: Buffer,
  folderId: string
): Promise<{ id: string; webViewLink: string }> {
  const drive = await getUncachableGoogleDriveClient();

  const { Readable } = await import("stream");
  const stream = Readable.from([buffer]);

  const resp = await drive.files.create({
    requestBody: {
      name: filename,
      mimeType: "application/pdf",
      parents: [folderId],
    },
    media: {
      mimeType: "application/pdf",
      body: stream,
    },
    fields: "id,webViewLink",
  });

  return {
    id: resp.data.id!,
    webViewLink: resp.data.webViewLink!,
  };
}
