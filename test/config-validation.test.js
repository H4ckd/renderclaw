const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

test("production mode requires allowed domains", () => {
  const result = spawnSync(process.execPath, ["-e", "require('./src/config')"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      ALLOWED_DOMAINS: "",
      ADMIN_TOKEN: "secret",
    },
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ALLOWED_DOMAINS is required/);
});

test("production mode requires admin token", () => {
  const result = spawnSync(process.execPath, ["-e", "require('./src/config')"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      ALLOWED_DOMAINS: "example.com",
      ADMIN_TOKEN: "",
    },
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ADMIN_TOKEN is required/);
});

test("cache path rules must use valid regular expressions", () => {
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      `
        const fs = require('node:fs');
        const os = require('node:os');
        const path = require('node:path');
        const source = JSON.parse(fs.readFileSync('config/renderclaw.config.json', 'utf8'));
        source.cache.rules = [{ pathPattern: '[', ttlSeconds: 60 }];
        const file = path.join(os.tmpdir(), 'renderclaw-invalid-cache-rule.json');
        fs.writeFileSync(file, JSON.stringify(source), 'utf8');
        process.env.CONFIG_FILE = file;
        require('./src/config');
      `,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "development",
      },
      encoding: "utf8",
    }
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /pathPattern must be a valid regular expression/);
});
