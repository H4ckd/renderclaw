const { spawn } = require("node:child_process");

const port = String(5600 + Math.floor(Math.random() * 1000));
const child = spawn(process.execPath, ["app.js"], {
  env: {
    ...process.env,
    PORT: port,
    AI_ENABLED: "false",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

async function main() {
  try {
    await waitForHealth(port);
  } finally {
    child.kill();
  }
}

async function waitForHealth(port) {
  const deadline = Date.now() + 8000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      const body = await response.json();
      if (response.ok && body.ok === true) return;
      lastError = new Error(`Unexpected health response: ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Smoke test failed: ${lastError?.message || "health timeout"}\n${output}`);
}

main().catch((error) => {
  console.error(error.message);
  child.kill();
  process.exit(1);
});
