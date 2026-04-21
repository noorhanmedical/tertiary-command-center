import {
  TEAM_MEMBERS,
  CLINIC_SPREADSHEET_CONNECTIONS,
  SHARED_CALENDAR_SPREADSHEET_ID,
} from "../../shared/platformSettings";
import { getStorageProvider } from "../integrations/fileStorage";

export function getPlatformSettingsSnapshot() {
  return {
    teamMembers: TEAM_MEMBERS,
    clinicSpreadsheetConnections: CLINIC_SPREADSHEET_CONNECTIONS,
    sharedCalendarSpreadsheetId: SHARED_CALENDAR_SPREADSHEET_ID,
    storageProvider: getStorageProvider(),
  };
}
