const WebSocket = require("ws");
const http = require("http");
const fs = require("fs");
const path = require("path");

const COMMON_DIR = path.join(__dirname, "..", "common");

class CDP {
  constructor() {
    this.debuggingPort = null;
    this.connections = new Map();
    this.messageId = 0;
    this.pendingMessages = new Map();
  }

  getRemoteDebuggingPort(capabilities) {
    const chromeOptions = capabilities["goog:chromeOptions"];
    if (chromeOptions?.debuggerAddress) {
      const parts = chromeOptions.debuggerAddress.split(":");
      return parseInt(parts[1], 10);
    }

    if (chromeOptions?.args) {
      for (const arg of chromeOptions.args) {
        if (arg.startsWith("--remote-debugging-port=")) {
          return parseInt(arg.split("=")[1], 10);
        }
      }
    }

    return null;
  }

  async getTargets() {
    return new Promise((resolve, reject) => {
      const url = `http://localhost:${this.debuggingPort}/json/list`;
      http.get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error("Failed to parse targets JSON"));
          }
        });
      }).on("error", reject);
    });
  }

  async getTargetsByType(...types) {
    const targets = await this.getTargets();
    return targets.filter((t) => types.includes(t.type));
  }

  async getPages() {
    return this.getTargetsByType("page");
  }

  async getIframes() {
    return this.getTargetsByType("iframe");
  }

  async getPagesAndIframes() {
    return this.getTargetsByType("page", "iframe");
  }

  async connect(target) {
    const wsUrl = target.webSocketDebuggerUrl;
    if (this.connections.has(target.id)) {
      return this.connections.get(target.id);
    }

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);

      ws.on("open", () => {
        this.connections.set(target.id, ws);
        resolve(ws);
      });

      ws.on("message", (data) => {
        const message = JSON.parse(data.toString());
        const key = `${target.id}-${message.id}`;
        if (message.id !== undefined && this.pendingMessages.has(key)) {
          const { resolve, reject } = this.pendingMessages.get(key);
          this.pendingMessages.delete(key);
          if (message.error) {
            reject(new Error(message.error.message));
          } else {
            resolve(message.result);
          }
        }
      });

      ws.on("error", reject);
    });
  }

  async sendCommand(targetId, method, params = {}) {
    const ws = this.connections.get(targetId);
    if (!ws) {
      throw new Error(`No connection for target ${targetId}`);
    }

    return new Promise((resolve, reject) => {
      const id = ++this.messageId;
      const key = `${targetId}-${id}`;
      this.pendingMessages.set(key, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  disconnect(targetId) {
    const ws = this.connections.get(targetId);
    if (ws) {
      ws.close();
      this.connections.delete(targetId);
    }
  }

  disconnectAll() {
    for (const ws of this.connections.values()) {
      ws.close();
    }
    this.connections.clear();
  }

  loadScriptsFromCommon() {
    const initPath = path.join(COMMON_DIR, "init.js");
    if (!fs.existsSync(initPath)) {
      throw new Error("common/init.js is required but not found");
    }

    const helperPath = path.join(COMMON_DIR, "helper.js");
    if (!fs.existsSync(helperPath)) {
      throw new Error("common/helper.js is required but not found");
    }

    const files = fs.readdirSync(COMMON_DIR).filter((f) => f.endsWith(".js") && f !== "init.js" && f !== "helper.js");
    const allFiles = ["init.js", "helper.js", ...files];

    return allFiles.map((file) => ({
      name: file,
      content: fs.readFileSync(path.join(COMMON_DIR, file), "utf8"),
    }));
  }

  async isAlreadyInjected(targetId) {
    const result = await this.sendCommand(targetId, "Runtime.evaluate", {
      expression: "window.selenium_debugger_injected",
      returnByValue: true,
    });
    return result.result?.value === true;
  }

  async injectIntoAllTargets(force = false) {
    const scripts = this.loadScriptsFromCommon();
    if (scripts.length === 0) {
      console.log("[CDP] No scripts found in common folder");
      return;
    }

    const targets = await this.getPagesAndIframes();
    console.log(`[CDP] Found ${targets.length} target(s) to inject`);

    for (const target of targets) {
      try {
        await this.connect(target);

        if (!force && (await this.isAlreadyInjected(target.id))) {
          console.log(`[CDP] Skipping ${target.type}: ${target.title} (already injected)`);
          continue;
        }

        // Set target ID before init.js so it can access it
        await this.sendCommand(target.id, "Runtime.evaluate", {
          expression: `window.selenium_debugger_target_id = "${target.id}"; localStorage.setItem("selenium_debugger_target_id", "${target.id}")`,
        });

        for (const script of scripts) {
          await this.sendCommand(target.id, "Runtime.evaluate", {
            expression: script.content,
          });
          console.log(`[CDP] Injected "${script.name}" into ${target.type}: ${target.title}`);
        }
      } catch (err) {
        console.error(`[CDP] Failed to inject into ${target.id}: ${err.message}`);
      }
    }
  }
}

module.exports = { CDP };
