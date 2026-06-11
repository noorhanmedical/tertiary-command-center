import assert from "node:assert/strict";
import {
  checkRecommendedTests,
  hasBlockingAncillaryWarning,
} from "../../shared/priorAncillaryHistory";

async function main() {
  const now = new Date("2026-06-11T00:00:00Z");

  // No prior tests -> no warnings.
  assert.deepEqual(checkRecommendedTests(["BrainWave"], [], now), []);

  // Within window blocks.
  {
    const ws = checkRecommendedTests(
      ["BrainWave"],
      [{ testName: "BrainWave", dateOfService: "2026-01-01", facility: null, source: null, notes: null }],
      now,
    );
    assert.equal(ws.length, 1);
    assert.equal(ws[0].reason, "duplicate_in_window");
    assert.equal(hasBlockingAncillaryWarning(ws), true);
  }

  // Outside window -> historical info, not blocking.
  {
    const ws = checkRecommendedTests(
      ["BrainWave"],
      [{ testName: "BrainWave", dateOfService: "2020-01-01", facility: null, source: null, notes: null }],
      now,
    );
    assert.equal(ws.length, 1);
    assert.equal(ws[0].reason, "duplicate_outside_window");
    assert.equal(hasBlockingAncillaryWarning(ws), false);
  }

  // Multiple priors -> picks most recent.
  {
    const ws = checkRecommendedTests(
      ["Echocardiogram TTE"],
      [
        { testName: "Echocardiogram TTE", dateOfService: "2018-05-01", facility: null, source: null, notes: null },
        { testName: "Echocardiogram TTE", dateOfService: "2026-04-01", facility: null, source: null, notes: null },
      ],
      now,
    );
    assert.equal(ws.length, 1);
    assert.equal(ws[0].previousDate, "2026-04-01");
    assert.equal(ws[0].reason, "duplicate_in_window");
  }

  // Unrestricted test name -> outside window with null interval.
  {
    const ws = checkRecommendedTests(
      ["Random Other Ultrasound"],
      [{ testName: "Random Other Ultrasound", dateOfService: "2026-01-01", facility: null, source: null, notes: null }],
      now,
    );
    assert.equal(ws.length, 1);
    assert.equal(ws[0].intervalDays, null);
  }

  console.log("Prior ancillary history test passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
