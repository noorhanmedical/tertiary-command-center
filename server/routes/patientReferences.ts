import type { Express } from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import { storage } from "../storage";
import { parseReferenceImportWithAI } from "../services/screening";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

export function registerPatientReferenceRoutes(
  app: Express,
) {

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
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/patient-references/:id", async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      await storage.deletePatientReference(id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/patient-references", async (_req, res) => {
    try {
      await storage.deleteAllPatientReferences();
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
