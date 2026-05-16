const fs = require("node:fs");

// Creates directories required at runtime. This runs before the logger,
// database, and HTML cache are initialized. Add new mutable directories here
// when a component writes files under dataDir.
function ensureRuntimeDirectories(paths) {
  for (const dir of [paths.cacheDir, paths.logDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

module.exports = { ensureRuntimeDirectories };
