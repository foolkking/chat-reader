import { existsSync } from "node:fs";
import { basename, isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";

const executable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
if (!executable || !isAbsolute(executable)) {
  console.error("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH must be an absolute executable path");
  process.exit(2);
}
if (!existsSync(executable)) {
  console.error("Configured Chromium executable does not exist");
  process.exit(2);
}

const result = spawnSync(executable, ["--version"], {
  encoding: "utf8",
  timeout: 15_000,
  windowsHide: true,
});
let version = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
const processVersionValid = /\b(?:Chrom(?:e|ium)|HeadlessChrome)\//i.test(version);
if (result.error || result.status !== 0 || !version || !processVersionValid) {
  if (process.platform !== "win32") {
    console.error("Configured Chromium executable did not return a version");
    process.exit(2);
  }
  const escaped = executable.replaceAll("'", "''");
  const fileVersion = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", `(Get-Item -LiteralPath '${escaped}').VersionInfo.ProductVersion`],
    { encoding: "utf8", timeout: 15_000, windowsHide: true },
  );
  const reported = `${fileVersion.stdout ?? ""}`.trim();
  if (fileVersion.error || fileVersion.status !== 0 || !/^\d+\.\d+\.\d+\.\d+$/.test(reported)) {
    console.error("Configured Chromium executable did not return a process or file version");
    process.exit(2);
  }
  version = `file-version ${reported} (process --version unavailable)`;
}
console.log(`chromium_executable=${basename(executable)}`);
console.log(`chromium_version=${version}`);
