const config = require("./config");
const { CDP } = require("./core/cdp");
const { createDriver, ensureDriverDirectories } = require("./core/driver");
const { createApiServer } = require("./api/server");

const rawConsoleLogClearInterval = Number(config.consoleLogClearInterval);
const CONSOLE_LOG_CLEAR_INTERVAL = Number.isFinite(rawConsoleLogClearInterval) && rawConsoleLogClearInterval >= 0
  ? Math.floor(rawConsoleLogClearInterval)
  : 2000;
const API_HOST = config.apiHost || "127.0.0.1";
const API_PORT = config.apiPort || 3000;
const API_BASE_URL = config.apiBaseUrl || `http://${API_HOST === "0.0.0.0" ? "127.0.0.1" : API_HOST}:${API_PORT}`;

let consoleLogCount = 0;
const originalConsoleLog = console.log.bind(console);
console.log = (...args) => {
  consoleLogCount += 1;
  if (
    CONSOLE_LOG_CLEAR_INTERVAL > 0 &&
    consoleLogCount % CONSOLE_LOG_CLEAR_INTERVAL === 0 &&
    typeof console.clear === "function"
  ) {
    console.clear();
  }
  originalConsoleLog(...args);
};

const state = {
  driver: null,
  cdp: null,
  apiServer: null,
  stopInjectionLoop: null,
  shutdownInProgress: false
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safelyCloseCurrentSession() {
  const sessionWasActive = !!state.driver;
  if (!sessionWasActive) {
    if (state.cdp) {
      state.cdp.disconnectAll();
    }
    return { success: true, alreadyClosed: true };
  }

  try {
    await state.driver.quit();
  } catch (error) {
    const message = error?.message || "";
    if (!/invalid session id|no such session|session not found/i.test(message)) {
      throw error;
    }
  } finally {
    state.driver = null;
    if (state.cdp) {
      state.cdp.disconnectAll();
    }
  }

  return { success: true, alreadyClosed: false };
}

async function closeApiServer() {
  if (!state.apiServer) {
    return;
  }

  await new Promise((resolve, reject) => {
    state.apiServer.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  state.apiServer = null;
}

async function shutdownTool() {
  if (state.shutdownInProgress) {
    return;
  }
  state.shutdownInProgress = true;

  if (typeof state.stopInjectionLoop === "function") {
    state.stopInjectionLoop();
    state.stopInjectionLoop = null;
  }

  const result = await safelyCloseCurrentSession();
  if (!result.alreadyClosed) {
    console.log("Browser closed cleanly.");
  }

  await closeApiServer();
}

async function startInjectionLoop(cdpInstance, intervalMs = 10000) {
  let running = true;

  const loop = async () => {
    while (running) {
      try {
        await cdpInstance.injectIntoAllTargets();
      } catch (error) {
        // Silently ignore errors while the browser is navigating.
      }
      await sleep(intervalMs);
    }
  };

  loop();

  return () => {
    running = false;
  };
}

function createServerContext() {
  return {
    getDriver: () => state.driver,
    getCdp: () => state.cdp,
    isShutdownInProgress: () => state.shutdownInProgress,
    shutdownTool
  };
}

async function main() {
  const browserName = config.browser;
  const capabilities = config.capabilities || {};

  ensureDriverDirectories();

  state.cdp = new CDP();
  state.cdp.apiBaseUrl = API_BASE_URL;

  console.log(`Launching ${browserName}...`);
  console.log(`Platform: ${process.platform}`);

  try {
    console.log("Creating driver...");
    state.driver = await createDriver(browserName, capabilities);
    console.log(`${browserName} launched successfully.`);

    const driverCaps = await state.driver.getCapabilities();
    const chromeOptions = driverCaps.get("goog:chromeOptions") || driverCaps.get("ms:edgeOptions") || {};
    if (!chromeOptions?.debuggerAddress) {
      console.error("Error: Could not get remote debugging port from driver capabilities");
      process.exit(1);
    }

    const debuggingPort = parseInt(chromeOptions.debuggerAddress.split(":")[1], 10);
    state.cdp.debuggingPort = debuggingPort;
    console.log(`Remote debugging port: ${debuggingPort}`);

    const app = createApiServer(createServerContext());
    state.apiServer = app.listen(API_PORT, API_HOST, () => {
      console.log(`[API] Server listening on ${API_BASE_URL} (bind: ${API_HOST}:${API_PORT})`);
    });

    const url = config.url || "https://example.com/";
    console.log(`Navigating to: ${url}`);
    state.driver.navigate().to(url);

    console.log("[Main] Starting injection loop...");
    state.stopInjectionLoop = await startInjectionLoop(state.cdp);

    console.log("[Main] Press Ctrl+C to stop...");
    await new Promise(() => {});
  } catch (error) {
    console.error("Error:", error.message);
  } finally {
    await shutdownTool();
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
