module.exports = {
  // Supported browsers: "chrome", "edge", "firefox"
  browser: "chrome",

  // URL to load on startup (optional, defaults to https://example.com/)
  url: "https://iframetester.com/?url=https://www.wikipedia.org/",

  // Raw browser capabilities - pass valid Selenium capabilities JSON
  capabilities: {
    "goog:chromeOptions": {
      args: [
        "--start-maximized",
        "--disable-web-security",
        "--disable-features=BlockInsecurePrivateNetworkRequests"]
    }
  }
};
