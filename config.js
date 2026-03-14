module.exports = {
  // Supported browsers: "chrome", "edge", "firefox"
  browser: "chrome",

  // API server bind interface and port
  // Use "0.0.0.0" to bind on all network interfaces
  apiHost: "127.0.0.1",
  apiPort: 3000,

  // Base URL used by injected browser scripts to call this API server
  // If omitted, defaults to http://<apiHost>:<apiPort> (or 127.0.0.1 when apiHost is 0.0.0.0)
  // apiBaseUrl: "http://127.0.0.1:3000",

  // Clear terminal after this many console.log calls (set to 0 to disable)
  consoleLogClearInterval: 2000,

  // URL to load on startup (optional, defaults to https://example.com/)
  url: "https://iframetester.com/?url=https://www.wikipedia.org/",

  // Raw browser capabilities - pass valid Selenium capabilities JSON
  capabilities: {
    "goog:chromeOptions": {
      args: [
        "--start-maximized",
        "--disable-web-security",
        "--disable-features=BlockInsecurePrivateNetworkRequests",
        "--disable-site-isolation-trials",
        "--disable-web-security",
        "--allow-running-insecure-content",
        "--ignore-certificate-errors",
        "--allow-insecure-localhost",
      ],
    }
  }
};
