const fs = require("node:fs");
const path = require("node:path");

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
