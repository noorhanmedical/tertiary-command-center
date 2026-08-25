export const ADMIN_BOOTSTRAP_REQUIRED_CODE = "ADMIN_BOOTSTRAP_REQUIRED" as const;

export class AdminBootstrapRequiredError extends Error {
  readonly code = ADMIN_BOOTSTRAP_REQUIRED_CODE;

  constructor() {
    super(ADMIN_BOOTSTRAP_REQUIRED_CODE);
    this.name = "AdminBootstrapRequiredError";
  }
}

/**
 * Fail closed unless startup can confirm that user provisioning has already
 * happened. Read failures and malformed counts intentionally collapse to the
 * same static error so database diagnostics and credential details cannot leak.
 */
export async function assertAdminBootstrapReady(
  readUserCount: () => Promise<number>,
): Promise<void> {
  let userCount: number;
  try {
    userCount = await readUserCount();
  } catch {
    throw new AdminBootstrapRequiredError();
  }

  if (!Number.isSafeInteger(userCount) || userCount < 1) {
    throw new AdminBootstrapRequiredError();
  }
}
