import { spawnSync } from "node:child_process";
import { constants, copyFileSync } from "node:fs";
import { createRequire } from "node:module";

const startupPackages = [
  ["../package.json", "prisma"],
  ["../package.json", "@prisma/client"],
  ["../apps/server/package.json", "tsx"],
  ["../apps/web/package.json", "vite"]
];

const dependenciesInstalled = startupPackages.every(([manifest, packageName]) => {
  const require = createRequire(new URL(manifest, import.meta.url));
  try {
    require.resolve(`${packageName}/package.json`);
    return true;
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
    return false;
  }
});

if (!dependenciesInstalled) {
  runPnpm(["install", "--frozen-lockfile"]);
}

try {
  copyFileSync(
    new URL("../.env.example", import.meta.url),
    new URL("../.env", import.meta.url),
    constants.COPYFILE_EXCL
  );
  console.log("Created .env from .env.example");
} catch (error) {
  if (error.code !== "EEXIST") throw error;
}

runPnpm(["prisma:generate"]);
// Prisma 5's migration CLI reads info-level output from the SQLite schema engine.
runPnpm(["exec", "prisma", "migrate", "deploy"], { ...process.env, RUST_LOG: "info" });

function runPnpm(args, env = process.env) {
  const result = spawnSync("pnpm", args, {
    cwd: new URL("../", import.meta.url),
    env,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
