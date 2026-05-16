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
