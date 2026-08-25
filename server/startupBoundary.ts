import {
  ADMIN_BOOTSTRAP_REQUIRED_CODE,
  AdminBootstrapRequiredError,
} from "./auth/bootstrapPolicy";

export type StartupBoundaryResult = "started" | "bootstrap_required";

type StartupBoundaryDependencies = {
  initialize: () => Promise<void>;
  listen: () => void;
  writeFatalSignal: (signal: typeof ADMIN_BOOTSTRAP_REQUIRED_CODE) => void;
  exit: (statusCode: number) => void;
};

/**
 * Keep bootstrap-required failures out of generic exception logging. Unknown
 * startup errors still propagate to the process-wide failure policy.
 */
export async function runStartupBoundary({
  initialize,
  listen,
  writeFatalSignal,
  exit,
}: StartupBoundaryDependencies): Promise<StartupBoundaryResult> {
  try {
    await initialize();
  } catch (error) {
    if (!(error instanceof AdminBootstrapRequiredError)) throw error;

    writeFatalSignal(ADMIN_BOOTSTRAP_REQUIRED_CODE);
    exit(1);
    return "bootstrap_required";
  }

  listen();
  return "started";
}
