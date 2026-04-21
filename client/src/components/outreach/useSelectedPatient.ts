import { useEffect, useState } from "react";

export function useSelectedPatient() {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    function readHash() {
      const h = window.location.hash.replace(/^#/, "");
      const m = h.match(/^p(\d+)$/);
      setSelectedId(m ? Number(m[1]) : null);
    }
    readHash();
    window.addEventListener("hashchange", readHash);
    return () => window.removeEventListener("hashchange", readHash);
  }, []);

  function selectPatient(patientId: number | null) {
    if (patientId == null) window.location.hash = "";
    else window.location.hash = `p${patientId}`;
  }

  return { selectedId, selectPatient };
}
