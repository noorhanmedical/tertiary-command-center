import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const requiredFiles = [
  "client/src/features/command-center/types/commandCenterTypes.ts",
  "client/src/features/command-center/context/CommandCenterContext.tsx",
  "client/src/features/command-center/components/CommandLeftRail.tsx",
  "client/src/features/command-center/components/PanelPopupCard.tsx",
  "client/src/features/command-center/playground/CommandPlayground.tsx",
  "client/src/features/command-center/components/CommandRightContextPanel.tsx",
  "client/src/features/command-center/providers/phoneProviderTypes.ts",
  "client/src/features/command-center/providers/ringCentralProvider.ts",
  "client/src/features/command-center/providers/manualPhoneProvider.ts",
];

const requiredText = {
  "client/src/features/command-center/components/CommandLeftRail.tsx": [
    "calendar",
    "phone",
    "marketing",
    "email",
    "search",
    "scratchpad",
    "left-[96px]",
  ],
  "client/src/features/command-center/components/PanelPopupCard.tsx": [
    "promoteToPlayground",
    "setSelectedContext",
    "SquareArrowOutUpRight",
  ],
  "client/src/features/command-center/providers/phoneProviderTypes.ts": [
    "PhoneProviderAdapter",
    "ringcentral",
    "dialpad",
    "aircall",
    "eightByEight",
    "goto",
    "manual",
  ],
  "client/src/features/command-center/playground/CommandPlayground.tsx": [
    "CalendarDateWorkspace",
    "PhoneWorkspace",
    "MarketingWorkspace",
    "EmailWorkspace",
    "ScratchpadWorkspace",
  ],
};

const failures = [];

for (const rel of requiredFiles) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) failures.push(`Missing file: ${rel}`);
}

for (const [rel, needles] of Object.entries(requiredText)) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) continue;
  const content = fs.readFileSync(abs, "utf8");
  for (const needle of needles) {
    if (!content.includes(needle)) failures.push(`Missing "${needle}" in ${rel}`);
  }
}

if (failures.length) {
  console.error("Command center QA failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Command center QA passed.");
