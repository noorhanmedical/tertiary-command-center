import type { Express } from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import { storage } from "../storage";
import { addTestHistorySchema } from "./helpers";
import { parseHistoryCsv, parseHistoryImport } from "../services/ingest";
import { invalidatePatientDatabase } from "./patientDatabase";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

export function registerTestHistoryRoutes(
  app: Express,
) {

  app.get("/api/test-history", async (_req, res) => {
    try {
      const records = await storage.getAllTestHistory();
      res.json(records);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/test-history", async (req, res) => {
    try {
      const parsed = addTestHistorySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      }

      const record = await storage.createTestHistory(parsed.data);
      invalidatePatientDatabase();
      res.json(record);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/test-history/import", upload.single("file"), async (req, res) => {
    try {
      let text = "";
      const clinic = req.body.clinic || "NWPG";

      if (req.file) {
        const ext = req.file.originalname.toLowerCase();
        if (ext.endsWith(".xlsx") || ext.endsWith(".xls")) {
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(req.file.buffer);
          workbook.eachSheet((sheet) => {
            const rows: string[][] = [];
            sheet.eachRow({ includeEmpty: false }, (row) => {
              const vals: string[] = [];
              row.eachCell({ includeEmpty: true }, (cell) => vals.push(String(cell.value ?? "")));
              rows.push(vals);
            });
            if (rows.length === 0) return;
            text += sheet.name + "\n" + rows.map((r) => r.join(",")).join("\n") + "\n\n";
          });
        } else {
          text = req.file.buffer.toString("utf-8");
        }
      } else if (req.body.text) {
        text = req.body.text;
      } else {
        return res.status(400).json({ error: "No file or text provided" });
      }

      if (!text.trim()) {
        return res.status(400).json({ error: "Empty data" });
      }

      const isCsvFile = !!(req.file && req.file.originalname.toLowerCase().endsWith(".csv"));
      const records = isCsvFile ? (parseHistoryCsv(text) || []) : await parseHistoryImport(text);

      const validRecords = records.map((r) => ({
        patientName: r.patientName,
        dob: r.dob,
        testName: r.testName,
        dateOfService: r.dateOfService,
        insuranceType: r.insuranceType || "ppo",
        clinic,
      }));

      const created = await storage.createTestHistoryBulk(validRecords);
      invalidatePatientDatabase();
      res.json(created);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/test-history/:id", async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      await storage.deleteTestHistory(id);
      invalidatePatientDatabase();
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/test-history", async (_req, res) => {
    try {
      await storage.deleteAllTestHistory();
      invalidatePatientDatabase();
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
