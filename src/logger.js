const fs = require("node:fs");
const path = require("node:path");

// Minimal structured logger used by every component.
// It writes JSON lines to stdout and data/logs/app.log. If you add log
// rotation or external log shipping, keep the log(level, message, meta)
// interface stable so existing components do not need to change.
function createLogger(logDir) {
  const logStream = fs.createWriteStream(path.join(logDir, "app.log"), { flags: "a" });

  function log(level, message, meta = {}) {
    const entry = JSON.stringify({
      time: new Date().toISOString(),
      level,
      message,
      ...meta,
    });

    console.log(entry);
    logStream.write(`${entry}\n`);
  }

  return {
    log,
    close: () => logStream.end(),
  };
}

module.exports = { createLogger };
