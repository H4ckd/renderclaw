const fs = require("node:fs");

function ensureRuntimeDirectories(paths) {
  for (const dir of [paths.cacheDir, paths.logDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

module.exports = { ensureRuntimeDirectories };
