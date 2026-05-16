// RenderClaw process entrypoint.
// Keep this file intentionally small: application wiring lives in src/server.js.
// This makes the server easy to import from tests or future CLI wrappers.
const { createServer } = require("./src/server");

const server = createServer();

server.start();
