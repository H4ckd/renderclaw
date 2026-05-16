const crypto = require("node:crypto");

// Adds a stable request id to every incoming request.
// Operators can pass X-Request-Id from a reverse proxy; otherwise RenderClaw
// creates one. Downstream components should use req.requestId for logs/events.
function requestContext(req, res, next) {
  const requestId = String(req.headers["x-request-id"] || crypto.randomUUID());
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
}

module.exports = { requestContext };
