const express = require("express");

function registerCommonMiddleware(app) {
  app.use(express.json());

  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.header("Access-Control-Allow-Private-Network", "true");
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });

  app.use((req, res, next) => {
    const body = Object.keys(req.body || {}).length > 0 ? JSON.stringify(req.body) : "";
    console.log(`[API] ${req.method} ${req.path}${body ? " " + body : ""}`);
    next();
  });
}

function jsonError(res, error, extra = {}) {
  res.status(500).json({
    error: error.message,
    ...extra
  });
}

function getRequiredDriver(getDriver) {
  const driver = getDriver();
  if (!driver) {
    throw new Error("Driver is not initialized");
  }
  return driver;
}

function getRequiredCdp(getCdp) {
  const cdp = getCdp();
  if (!cdp) {
    throw new Error("CDP is not initialized");
  }
  return cdp;
}

function createApiServer(context) {
  const app = express();
  const { registerRoutes } = require("./routes/api_routes");

  registerCommonMiddleware(app);
  registerRoutes(app, context);

  return app;
}

module.exports = {
  createApiServer,
  registerCommonMiddleware,
  jsonError,
  getRequiredDriver,
  getRequiredCdp
};
