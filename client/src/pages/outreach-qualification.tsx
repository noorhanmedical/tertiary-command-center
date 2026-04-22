import { useState } from "react";
import OutreachBuildPane from "@/components/qualification/OutreachBuildPane";

export default function OutreachQualificationPage() {
  const [pasteText, setPasteText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [importUnlocked, setImportUnlocked] = useState(false);
  const [importCodeInput, setImportCodeInput] = useState("");
  const [importCodeError, setImportCodeError] = useState(false);

  return (
    <OutreachBuildPane
      pasteText={pasteText}
      setPasteText={setPasteText}
      dragOver={dragOver}
      setDragOver={setDragOver}
      importUnlocked={importUnlocked}
      setImportUnlocked={setImportUnlocked}
      importCodeInput={importCodeInput}
      setImportCodeInput={setImportCodeInput}
      importCodeError={importCodeError}
      setImportCodeError={setImportCodeError}
    />
  );
}
