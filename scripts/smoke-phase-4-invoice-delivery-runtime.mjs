// Smoke — Phase 4 PR 4.5 recipient resolution fixtures.

function resolveRecipientsFromSnapshot(snapshot) {
  const s = snapshot ?? {};
  return {
    to: typeof s.primaryEmail === "string" ? s.primaryEmail : null,
    cc: Array.isArray(s.ccEmails) ? s.ccEmails.filter((e) => typeof e === "string") : [],
    bcc: Array.isArray(s.bccEmails) ? s.bccEmails.filter((e) => typeof e === "string") : [],
    deliveryMethod: typeof s.deliveryMethod === "string" ? s.deliveryMethod : "download_only",
  };
}

const fails = [];
function expect(label, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fails.push(`${label} — actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  else console.log(`PASS  ${label}`);
}

expect("1. typed snapshot resolves primary + cc", resolveRecipientsFromSnapshot({ primaryEmail: "a@x.com", ccEmails: ["b@x.com"], deliveryMethod: "email" }),
  { to: "a@x.com", cc: ["b@x.com"], bcc: [], deliveryMethod: "email" },
);

expect("2. missing primaryEmail → null", resolveRecipientsFromSnapshot({ ccEmails: ["b@x.com"] }),
  { to: null, cc: ["b@x.com"], bcc: [], deliveryMethod: "download_only" },
);

expect("3. defaults to download_only deliveryMethod", resolveRecipientsFromSnapshot({}),
  { to: null, cc: [], bcc: [], deliveryMethod: "download_only" },
);

expect("4. bcc forwarded", resolveRecipientsFromSnapshot({ primaryEmail: "a@x.com", bccEmails: ["c@x.com"], deliveryMethod: "email" }),
  { to: "a@x.com", cc: [], bcc: ["c@x.com"], deliveryMethod: "email" },
);

expect("5. non-string entries dropped", resolveRecipientsFromSnapshot({ primaryEmail: 42, ccEmails: ["x@y.com", 5] }),
  { to: null, cc: ["x@y.com"], bcc: [], deliveryMethod: "download_only" },
);

if (fails.length > 0) {
  for (const f of fails) console.log(`FAIL  ${f}`);
  console.error(`Smoke failed: ${fails.length}`);
  process.exit(1);
}
console.log("Smoke passed: recipient resolver honors the contract.");
