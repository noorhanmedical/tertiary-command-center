import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const requiredFiles = [
  "src/features/command-center/types/commandCenterTypes.ts",
  "src/features/command-center/context/CommandCenterContext.tsx",
  "src/features/command-center/components/CommandLeftRail.tsx",
  "src/features/command-center/components/PanelPopupCard.tsx",
  "src/features/command-center/playground/CommandPlayground.tsx",
  "src/features/command-center/components/CommandRightContextPanel.tsx",
  "src/features/command-center/providers/phoneProviderTypes.ts",
  "src/features/command-center/providers/ringCentralProvider.ts",
  "src/features/command-center/providers/manualPhoneProvider.ts",
];

const requiredText = {
  "src/features/command-center/components/CommandLeftRail.tsx": [
    "calendar",
    "phone",
    "marketing",
    "email",
    "search",
    "scratchpad",
    "left-[96px]",
  ],
  "src/features/command-center/components/PanelPopupCard.tsx": [
    "promoteToPlayground",
    "setSelectedContext",
    "SquareArrowOutUpRight",
  ],
  "src/features/command-center/providers/phoneProviderTypes.ts": [
    "PhoneProviderAdapter",
    "ringcentral",
    "dialpad",
    "aircall",
    "eightByEight",
    "goto",
    "manual",
  ],
  "src/features/command-center/playground/CommandPlayground.tsx": [
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
