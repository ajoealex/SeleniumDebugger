const path = require("path");
const express = require("express");
const { Builder, By, Key } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const edge = require("selenium-webdriver/edge");
const firefox = require("selenium-webdriver/firefox");
const config = require("./config");
const { CDP } = require("./core/cdp");

const DRIVER_DIR = path.join(__dirname, "web_driver");
const API_PORT = config.apiPort || 3000;

let driver = null;
let cdp = null;
let apiServer = null;
let stopInjectionLoop = null;
let shutdownInProgress = false;

function getOsFolder() {
  switch (process.platform) {
    case "win32":
      return "windows";
    case "darwin":
      return "macos";
    case "linux":
      return "linux";
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

function getDriverPath(browserName) {
  const osFolder = getOsFolder();
  const ext = process.platform === "win32" ? ".exe" : "";

  switch (browserName.toLowerCase()) {
    case "chrome":
      return path.join(DRIVER_DIR, osFolder, `chromedriver${ext}`);
    case "edge":
      return path.join(DRIVER_DIR, osFolder, `msedgedriver${ext}`);
    case "firefox":
      return path.join(DRIVER_DIR, osFolder, `geckodriver${ext}`);
    default:
      throw new Error(`Unsupported browser: ${browserName}`);
  }
}

function buildOptions(browserName, capabilities) {
  const browserKey = browserName.toLowerCase();

  if (browserKey === "chrome") {
    const options = new chrome.Options();
    const chromeOpts = capabilities["goog:chromeOptions"];
    if (chromeOpts?.args) {
      options.addArguments(...chromeOpts.args);
    }
    return options;
  }

  if (browserKey === "edge") {
    const options = new edge.Options();
    const edgeOpts = capabilities["ms:edgeOptions"];
    if (edgeOpts?.args) {
      options.addArguments(...edgeOpts.args);
    }
    return options;
  }

  if (browserKey === "firefox") {
    const options = new firefox.Options();
    const firefoxOpts = capabilities["moz:firefoxOptions"];
    if (firefoxOpts?.args) {
      options.addArguments(...firefoxOpts.args);
    }
    return options;
  }

  return null;
}

async function createDriver(browserName, capabilities) {
  const driverPath = getDriverPath(browserName);
  const options = buildOptions(browserName, capabilities);

  console.log(`Using driver: ${driverPath}`);

  switch (browserName.toLowerCase()) {
    case "chrome": {
      const service = new chrome.ServiceBuilder(driverPath);
      const builder = new Builder()
        .forBrowser("chrome")
        .setChromeService(service);
      if (options) builder.setChromeOptions(options);
      return builder.build();
    }
    case "edge": {
      const service = new edge.ServiceBuilder(driverPath);
      const builder = new Builder()
        .forBrowser("MicrosoftEdge")
        .setEdgeService(service);
      if (options) builder.setEdgeOptions(options);
      return builder.build();
    }
    case "firefox": {
      const service = new firefox.ServiceBuilder(driverPath);
      const builder = new Builder()
        .forBrowser("firefox")
        .setFirefoxService(service);
      if (options) builder.setFirefoxOptions(options);
      return builder.build();
    }
    default:
      throw new Error(`Unsupported browser: ${browserName}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeSendKeysValue(value) {
  if (!Array.isArray(value)) {
    return [value];
  }

  return value.map((item) => {
    if (
      typeof item === "string" &&
      Object.prototype.hasOwnProperty.call(Key, item) &&
      typeof Key[item] === "string"
    ) {
      return Key[item];
    }

    return item;
  });
}

function normalizeComboKeys(keys) {
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new Error("keys must be a non-empty array");
  }

  return keys.map((item) => {
    if (typeof item !== "string") {
      throw new Error("each combo key must be a string");
    }

    if (
      Object.prototype.hasOwnProperty.call(Key, item) &&
      typeof Key[item] === "string"
    ) {
      return Key[item];
    }

    if (item.length === 1) {
      return item;
    }

    throw new Error(`Invalid combo key: ${item}. Use Selenium Key enum name or single character.`);
  });
}

async function safelyCloseCurrentSession() {
  const sessionWasActive = !!driver;
  if (!sessionWasActive) {
    if (cdp) {
      cdp.disconnectAll();
    }
    return { success: true, alreadyClosed: true };
  }

  try {
    await driver.quit();
  } catch (e) {
    const msg = (e && e.message) ? e.message : "";
    if (!/invalid session id|no such session|session not found/i.test(msg)) {
      throw e;
    }
  } finally {
    driver = null;
    if (cdp) {
      cdp.disconnectAll();
    }
  }

  return { success: true, alreadyClosed: false };
}

async function closeApiServer() {
  if (!apiServer) {
    return;
  }

  await new Promise((resolve, reject) => {
    apiServer.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
  apiServer = null;
}

async function shutdownTool() {
  if (shutdownInProgress) {
    return;
  }
  shutdownInProgress = true;

  if (typeof stopInjectionLoop === "function") {
    stopInjectionLoop();
    stopInjectionLoop = null;
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
      } catch (err) {
        // Silently ignore errors (browser may be navigating)
      }
      await sleep(intervalMs);
    }
  };

  loop();

  return () => {
    running = false;
  };
}

// Switch to the frame with the given targetId using DFS
async function switchToTargetFrame(targetId) {
  // Check if already in the correct frame
  const currentTargetId = await driver.executeScript("return window.selenium_debugger_target_id");
  if (currentTargetId === targetId) {
    return true;
  }

  // Switch to top-level page
  await driver.switchTo().defaultContent();

  // Check if top-level is the target
  const topTargetId = await driver.executeScript("return window.selenium_debugger_target_id");
  if (topTargetId === targetId) {
    return true;
  }

  // DFS to find the target frame
  async function searchFrames() {
    const iframes = await driver.executeScript("return window.aj__dom ? window.aj__dom.querySelectorAll('iframe') : []");

    for (let i = 0; i < iframes.length; i++) {
      try {
        await driver.switchTo().frame(iframes[i]);

        const frameTargetId = await driver.executeScript("return window.selenium_debugger_target_id");
        if (frameTargetId === targetId) {
          return true;
        }

        // Recursively search nested frames
        if (await searchFrames()) {
          return true;
        }

        // Not found in this branch, go back to parent
        await driver.switchTo().parentFrame();
      } catch (e) {
        // Frame might be inaccessible, continue to next
        try {
          await driver.switchTo().parentFrame();
        } catch (e2) {
          // Ignore
        }
      }
    }
    return false;
  }

  return await searchFrames();
}

// Express API Server
function createApiServer() {
  const app = express();
  app.use(express.json());

  // CORS for browser requests
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

  // Request logging
  app.use((req, res, next) => {
    const body = Object.keys(req.body || {}).length > 0 ? JSON.stringify(req.body) : "";
    console.log(`[API] ${req.method} ${req.path}${body ? " " + body : ""}`);
    next();
  });

  // Status
  app.get("/status", (req, res) => {
    res.json({ ready: !!driver, status: "running" });
  });

  app.post("/close_session", async (req, res) => {
    try {
      if (shutdownInProgress) {
        res.json({ success: true, shuttingDown: true, alreadyShuttingDown: true });
        return;
      }

      res.once("finish", () => {
        shutdownTool()
          .then(() => process.exit(0))
          .catch((e) => {
            console.error("Failed to shutdown cleanly:", e.message);
            process.exit(1);
          });
      });
      res.json({ success: true, shuttingDown: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/reinject", async (req, res) => {
    try {
      if (!cdp) {
        throw new Error("CDP is not initialized");
      }
      await cdp.injectIntoAllTargets(true);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Timeouts
  app.get("/get_timeouts", async (req, res) => {
    try {
      const timeouts = await driver.manage().getTimeouts();
      res.json({ value: timeouts });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/set_timeouts", async (req, res) => {
    try {
      const { script, pageLoad, implicit } = req.body;
      if (script !== undefined) await driver.manage().setTimeouts({ script });
      if (pageLoad !== undefined) await driver.manage().setTimeouts({ pageLoad });
      if (implicit !== undefined) await driver.manage().setTimeouts({ implicit });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Navigation
  app.post("/navigate_to", async (req, res) => {
    try {
      const { url } = req.body;
      await driver.get(url);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/get_current_url", async (req, res) => {
    try {
      const url = await driver.getCurrentUrl();
      res.json({ value: url });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/back", async (req, res) => {
    try {
      await driver.navigate().back();
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/forward", async (req, res) => {
    try {
      await driver.navigate().forward();
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/refresh", async (req, res) => {
    try {
      await driver.navigate().refresh();
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/get_title", async (req, res) => {
    try {
      const title = await driver.getTitle();
      res.json({ value: title });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Window
  app.get("/get_window_handle", async (req, res) => {
    try {
      const handle = await driver.getWindowHandle();
      res.json({ value: handle });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/get_window_handles", async (req, res) => {
    try {
      const handles = await driver.getAllWindowHandles();
      res.json({ value: handles });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/close_window", async (req, res) => {
    try {
      await driver.close();
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/switch_to_window", async (req, res) => {
    try {
      const { handle } = req.body;
      await driver.switchTo().window(handle);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/new_window", async (req, res) => {
    try {
      const { type } = req.body;
      await driver.switchTo().newWindow(type || "tab");
      const handle = await driver.getWindowHandle();
      res.json({ value: { handle, type: type || "tab" } });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/get_window_rect", async (req, res) => {
    try {
      const rect = await driver.manage().window().getRect();
      res.json({ value: rect });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/set_window_rect", async (req, res) => {
    try {
      const { x, y, width, height } = req.body;
      await driver.manage().window().setRect({ x, y, width, height });
      const rect = await driver.manage().window().getRect();
      res.json({ value: rect });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/maximize_window", async (req, res) => {
    try {
      await driver.manage().window().maximize();
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/minimize_window", async (req, res) => {
    try {
      await driver.manage().window().minimize();
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/fullscreen_window", async (req, res) => {
    try {
      await driver.manage().window().fullscreen();
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  function getTargetSelector(elemId) {
    if (typeof elemId === "string" && elemId.trim()) {
      return `[aj-target="${elemId}"]`;
    }
    return '[data-aj-target="true"],[aj-target]';
  }

  // Frame
  app.post("/switch_to_frame", async (req, res) => {
    try {
      const { targetId, elemId } = req.body;
      await switchToTargetFrame(targetId);
      const element = await driver.findElement(By.css(getTargetSelector(elemId)));
      await driver.switchTo().frame(element);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/switch_to_parent_frame", async (req, res) => {
    try {
      await driver.switchTo().parentFrame();
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Element actions using Selenium WebDriver (element identified by aj-target attribute)

  app.post("/element_click", async (req, res) => {
    try {
      const { targetId, elemId } = req.body;
      await switchToTargetFrame(targetId);
      const element = await driver.findElement(By.css(getTargetSelector(elemId)));
      await element.click();
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/element_clear", async (req, res) => {
    try {
      const { targetId, elemId } = req.body;
      await switchToTargetFrame(targetId);
      const element = await driver.findElement(By.css(getTargetSelector(elemId)));
      await element.clear();
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/element_send_keys", async (req, res) => {
    try {
      const { targetId, elemId, value } = req.body;
      await switchToTargetFrame(targetId);
      const element = await driver.findElement(By.css(getTargetSelector(elemId)));
      const keys = normalizeSendKeysValue(value);
      await element.sendKeys(...keys);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/element_send_combo_keys", async (req, res) => {
    try {
      const { targetId, elemId, keys } = req.body;
      await switchToTargetFrame(targetId);
      const element = await driver.findElement(By.css(getTargetSelector(elemId)));
      const comboKeys = normalizeComboKeys(keys);

      await element.click();
      const actions = driver.actions({ async: true });
      for (const key of comboKeys) {
        actions.keyDown(key);
      }
      for (const key of [...comboKeys].reverse()) {
        actions.keyUp(key);
      }
      await actions.perform();

      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/get_element_text", async (req, res) => {
    try {
      const { targetId, elemId } = req.body;
      await switchToTargetFrame(targetId);
      const element = await driver.findElement(By.css(getTargetSelector(elemId)));
      const text = await element.getText();
      res.json({ value: text });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/get_element_attribute", async (req, res) => {
    try {
      const { targetId, elemId, name } = req.body;
      await switchToTargetFrame(targetId);
      const element = await driver.findElement(By.css(getTargetSelector(elemId)));
      const value = await element.getAttribute(name);
      res.json({ value });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/get_element_property", async (req, res) => {
    try {
      const { targetId, elemId, name } = req.body;
      await switchToTargetFrame(targetId);
      const element = await driver.findElement(By.css(getTargetSelector(elemId)));
      const value = await driver.executeScript(`return arguments[0]['${name}']`, element);
      res.json({ value });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/get_element_css_value", async (req, res) => {
    try {
      const { targetId, elemId, propertyName } = req.body;
      await switchToTargetFrame(targetId);
      const element = await driver.findElement(By.css(getTargetSelector(elemId)));
      const value = await element.getCssValue(propertyName);
      res.json({ value });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/is_element_enabled", async (req, res) => {
    try {
      const { targetId, elemId } = req.body;
      await switchToTargetFrame(targetId);
      const element = await driver.findElement(By.css(getTargetSelector(elemId)));
      const value = await element.isEnabled();
      res.json({ value });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/is_element_selected", async (req, res) => {
    try {
      const { targetId, elemId } = req.body;
      await switchToTargetFrame(targetId);
      const element = await driver.findElement(By.css(getTargetSelector(elemId)));
      const value = await element.isSelected();
      res.json({ value });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/get_element_tag_name", async (req, res) => {
    try {
      const { targetId, elemId } = req.body;
      await switchToTargetFrame(targetId);
      const element = await driver.findElement(By.css(getTargetSelector(elemId)));
      const value = await element.getTagName();
      res.json({ value });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/get_element_rect", async (req, res) => {
    try {
      const { targetId, elemId } = req.body;
      await switchToTargetFrame(targetId);
      const element = await driver.findElement(By.css(getTargetSelector(elemId)));
      const rect = await element.getRect();
      res.json({ value: rect });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Document
  app.get("/get_page_source", async (req, res) => {
    try {
      const source = await driver.getPageSource();
      res.json({ value: source });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Cookies
  app.get("/get_all_cookies", async (req, res) => {
    try {
      const cookies = await driver.manage().getCookies();
      res.json({ value: cookies });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/get_named_cookie/:name", async (req, res) => {
    try {
      const { name } = req.params;
      const cookie = await driver.manage().getCookie(name);
      res.json({ value: cookie });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/add_cookie", async (req, res) => {
    try {
      const { cookie } = req.body;
      await driver.manage().addCookie(cookie);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/delete_cookie/:name", async (req, res) => {
    try {
      const { name } = req.params;
      await driver.manage().deleteCookie(name);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/delete_all_cookies", async (req, res) => {
    try {
      await driver.manage().deleteAllCookies();
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Alerts
  app.post("/dismiss_alert", async (req, res) => {
    try {
      await driver.switchTo().alert().dismiss();
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/accept_alert", async (req, res) => {
    try {
      await driver.switchTo().alert().accept();
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/get_alert_text", async (req, res) => {
    try {
      const text = await driver.switchTo().alert().getText();
      res.json({ value: text });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/send_alert_text", async (req, res) => {
    try {
      const { text } = req.body;
      await driver.switchTo().alert().sendKeys(text);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Screenshot
  app.get("/take_screenshot", async (req, res) => {
    try {
      const screenshot = await driver.takeScreenshot();
      res.json({ value: screenshot });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Execute script
  app.post("/execute_script", async (req, res) => {
    try {
      const { script, args } = req.body;
      const result = await driver.executeScript(script, ...(args || []));
      res.json({ value: result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return app;
}

async function main() {
  const browserName = config.browser;
  const capabilities = config.capabilities || {};

  cdp = new CDP();

  console.log(`Launching ${browserName}...`);
  console.log(`Platform: ${process.platform}`);

  try {
    console.log("Creating driver...");
    driver = await createDriver(browserName, capabilities);
    console.log(`${browserName} launched successfully.`);

    // Get debugging port from driver capabilities (set automatically by Selenium)
    const driverCaps = await driver.getCapabilities();
    const chromeOptions = driverCaps.get("goog:chromeOptions");
    if (!chromeOptions?.debuggerAddress) {
      console.error("Error: Could not get remote debugging port from driver capabilities");
      process.exit(1);
    }
    const debuggingPort = parseInt(chromeOptions.debuggerAddress.split(":")[1], 10);
    cdp.debuggingPort = debuggingPort;
    console.log(`Remote debugging port: ${debuggingPort}`);

    // Start API server
    const app = createApiServer();
    apiServer = app.listen(API_PORT, () => {
      console.log(`[API] Server listening on http://localhost:${API_PORT}`);
    });

    const url = config.url || "https://example.com/";
    console.log(`Navigating to: ${url}`);
    driver.navigate().to(url);

    // Start continuous injection loop
    console.log("[Main] Starting injection loop...");
    stopInjectionLoop = await startInjectionLoop(cdp);

    // Keep running until user terminates
    console.log("[Main] Press Ctrl+C to stop...");
    await new Promise(() => {}); // Run forever
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
