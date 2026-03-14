const fs = require("fs");
const path = require("path");
const { Builder } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const edge = require("selenium-webdriver/edge");
const firefox = require("selenium-webdriver/firefox");

const DRIVER_DIR = path.join(__dirname, "..", "web_driver");
const REQUIRED_DRIVER_FOLDERS = ["linux", "windows", "mac"];

function getOsFolder() {
  switch (process.platform) {
    case "win32":
      return "windows";
    case "darwin":
      return "mac";
    case "linux":
      return "linux";
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

function ensureDriverDirectories() {
  for (const folderName of REQUIRED_DRIVER_FOLDERS) {
    fs.mkdirSync(path.join(DRIVER_DIR, folderName), { recursive: true });
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
      if (options) {
        builder.setChromeOptions(options);
      }
      return builder.build();
    }
    case "edge": {
      const service = new edge.ServiceBuilder(driverPath);
      const builder = new Builder()
        .forBrowser("MicrosoftEdge")
        .setEdgeService(service);
      if (options) {
        builder.setEdgeOptions(options);
      }
      return builder.build();
    }
    case "firefox": {
      const service = new firefox.ServiceBuilder(driverPath);
      const builder = new Builder()
        .forBrowser("firefox")
        .setFirefoxService(service);
      if (options) {
        builder.setFirefoxOptions(options);
      }
      return builder.build();
    }
    default:
      throw new Error(`Unsupported browser: ${browserName}`);
  }
}

module.exports = {
  ensureDriverDirectories,
  createDriver
};
