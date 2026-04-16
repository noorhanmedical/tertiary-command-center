import type { Express } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { storage } from "../storage";
import { parseReferenceImportWithAI } from "../services/screening";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

type BackgroundSyncPatients = () => void | Promise<void>;

export function registerPatientReferenceRoutes(
  app: Express,
  deps: { backgroundSyncPatients: BackgroundSyncPatients }
) {
  const { backgroundSyncPatients } = deps;

  app.get("/api/patient-references", async (req, res) => {
    try {
      const search = typeof req.query.search === "string" ? req.query.search : "";
      if (search.trim()) {
        const records = await storage.searchPatientReferences(search.trim());
        return res.json(records);
      }

      const records = await storage.getAllPatientReferences();
      res.json(records);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/patient-references/import", upload.single("file"), async (req: any, res) => {
    try {
      let text = "";

      if (req.file) {
        const ext = req.file.originalname.toLowerCase();
        if (ext.endsWith(".xlsx") || ext.endsWith(".xls")) {
          const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
          for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            text += sheetName + "\n" + XLSX.utils.sheet_to_csv(sheet) + "\n\n";
          }
        } else if (ext.endsWith(".csv")) {
          text = req.file.buffer.toString("utf-8");
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

      const validRecords = await parseReferenceImportWithAI(text);
      const created = await storage.createPatientReferenceBulk(validRecords);
      res.json(created);
      void backgroundSyncPatients();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/patient-references/:id", async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      await storage.deletePatientReference(id);
      res.json({ success: true });
      void backgroundSyncPatients();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/patient-references", async (_req, res) => {
    try {
      await storage.deleteAllPatientReferences();
      res.json({ success: true });
      void backgroundSyncPatients();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
