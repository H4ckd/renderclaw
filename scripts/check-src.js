const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function collectJavaScriptFiles(dir) {
  const output = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      output.push(...collectJavaScriptFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".js")) {
      output.push(fullPath);
    }
  }

  return output;
}

const files = [path.resolve("app.js"), ...collectJavaScriptFiles(path.resolve("src"))];

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status);
}
