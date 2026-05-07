const { spawnSync } = require("node:child_process");

const candidates = process.env.AIOS_PYTHON
  ? [{ command: process.env.AIOS_PYTHON, argsPrefix: [] }]
  : process.platform === "win32"
    ? [
        { command: "py", argsPrefix: ["-3"] },
        { command: "python", argsPrefix: [] },
        { command: "python3", argsPrefix: [] }
      ]
    : [
        { command: "python3", argsPrefix: [] },
        { command: "python", argsPrefix: [] }
      ];

const python = candidates.find((candidate) => {
  const result = spawnSync(candidate.command, [...candidate.argsPrefix, "--version"], {
    encoding: "utf8",
    windowsHide: true
  });
  return !result.error && result.status === 0;
});

if (!python) {
  const tried = candidates.map((candidate) => [candidate.command, ...candidate.argsPrefix].join(" ")).join(", ");
  console.error(`Python interpreter was not found. Set AIOS_PYTHON or install one of: ${tried}`);
  process.exit(1);
}

const result = spawnSync(
  python.command,
  [...python.argsPrefix, "-m", "unittest", "discover", "-s", "tests", "-p", "*_test.py"],
  {
    stdio: "inherit",
    windowsHide: true
  }
);

process.exit(result.status ?? 1);
