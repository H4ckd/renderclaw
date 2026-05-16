// Optional admin authentication middleware.
// In development, /admin/* can remain open when ADMIN_TOKEN is missing.
// In production, config validation requires ADMIN_TOKEN before the server starts.
function createAdminAuth(adminToken) {
  return function adminAuth(req, res, next) {
    if (!adminToken) {
      next();
      return;
    }

    const expected = `Bearer ${adminToken}`;
    if (req.headers.authorization === expected) {
      next();
      return;
    }

    res.status(401).json({ error: "Unauthorized" });
  };
}

module.exports = { createAdminAuth };
