// USE_PATIENT_DIRECTORY_ACTIVATION flag accessor.
//
// Lives in its own tiny module so callers (route registration,
// validation harness, smoke tests) can read the flag without
// transitively importing the storage layer / db.
// Default: OFF.

export function isPatientDirectoryActivationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.USE_PATIENT_DIRECTORY_ACTIVATION;
  return v === "1" || v === "true" || v === "yes";
}
