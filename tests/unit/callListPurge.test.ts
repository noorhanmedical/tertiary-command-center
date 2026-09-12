// Task 4/6 — purge orchestration (idempotency, blob deletion, error isolation)
// via the dependency seam (no DB). The raw SQL PHI-nulling + FOR UPDATE guard
// is verified in staging against a live DB.
//
// Run: DATABASE_URL='postgres://u:p@localhost:5432/x' npx tsx tests/unit/callListPurge.test.ts

import assert from "node:assert/strict";
import { purgeExpiredCallListPackages } from "../../server/services/engagement/callListRetention";

let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const NOW = new Date("2026-12-20T00:00:00.000Z");

(async () => {
  console.log("callListPurge:");

  await check("purges due packages and deletes their PDF blobs", async () => {
    const deleted: number[] = [];
    const summary = await purgeExpiredCallListPackages(NOW, 500, {
      listDue: async () => [{ id: 1 }, { id: 2 }],
      purgeOne: async (id) => ({ purged: true, alreadyPurged: false, pdfBlobIdToDelete: id + 100 }),
      deleteBlobFn: async (blobId) => {
        deleted.push(blobId);
      },
    });
    assert.equal(summary.scanned, 2);
    assert.equal(summary.purged, 2);
    assert.equal(summary.blobsDeleted, 2);
    assert.deepEqual(deleted.sort(), [101, 102]);
    assert.equal(summary.errors, 0);
  });

  await check("already-purged rows are skipped (idempotent / re-purge safe)", async () => {
    const summary = await purgeExpiredCallListPackages(NOW, 500, {
      listDue: async () => [{ id: 1 }, { id: 2 }],
      purgeOne: async () => ({ purged: false, alreadyPurged: true, pdfBlobIdToDelete: null }),
      deleteBlobFn: async () => {
        throw new Error("should not be called for already-purged");
      },
    });
    assert.equal(summary.alreadyPurged, 2);
    assert.equal(summary.purged, 0);
    assert.equal(summary.blobsDeleted, 0);
  });

  await check("package with no PDF blob purges without a blob delete", async () => {
    let deleteCalls = 0;
    const summary = await purgeExpiredCallListPackages(NOW, 500, {
      listDue: async () => [{ id: 5 }],
      purgeOne: async () => ({ purged: true, alreadyPurged: false, pdfBlobIdToDelete: null }),
      deleteBlobFn: async () => {
        deleteCalls += 1;
      },
    });
    assert.equal(summary.purged, 1);
    assert.equal(summary.blobsDeleted, 0);
    assert.equal(deleteCalls, 0);
  });

  await check("blob-delete failure does NOT fail the purge (PHI already gone)", async () => {
    const summary = await purgeExpiredCallListPackages(NOW, 500, {
      listDue: async () => [{ id: 9 }],
      purgeOne: async () => ({ purged: true, alreadyPurged: false, pdfBlobIdToDelete: 900 }),
      deleteBlobFn: async () => {
        throw new Error("blob store offline");
      },
    });
    assert.equal(summary.purged, 1); // purge counted — PHI removed from DB
    assert.equal(summary.blobsDeleted, 0); // blob delete failed, not counted
    assert.equal(summary.errors, 0); // but the batch did NOT error
  });

  await check("one package failure isolates — others still purge", async () => {
    const summary = await purgeExpiredCallListPackages(NOW, 500, {
      listDue: async () => [{ id: 1 }, { id: 2 }, { id: 3 }],
      purgeOne: async (id) => {
        if (id === 2) throw new Error("row locked / transient");
        return { purged: true, alreadyPurged: false, pdfBlobIdToDelete: null };
      },
      deleteBlobFn: async () => {},
    });
    assert.equal(summary.scanned, 3);
    assert.equal(summary.purged, 2);
    assert.equal(summary.errors, 1);
  });

  await check("empty due list → no-op summary", async () => {
    const summary = await purgeExpiredCallListPackages(NOW, 500, {
      listDue: async () => [],
      purgeOne: async () => {
        throw new Error("should not run");
      },
      deleteBlobFn: async () => {},
    });
    assert.deepEqual(summary, { scanned: 0, purged: 0, alreadyPurged: 0, blobsDeleted: 0, errors: 0 });
  });

  console.log(`\ncallListPurge: ${passed} checks passed\n`);
})();
