const WebSocket = require("ws");
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const COMMON_DIR = path.join(__dirname, "..", "common");
const COMMAND_QUEUE_NAME = "aj__commands_to_execte";
const COMMAND_RESULT_QUEUE_NAME = "aj__command_results";

class CDP {
  constructor() {
    this.debuggingPort = null;
    this.apiBaseUrl = "http://localhost:3000";
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

  async readQueuedCommands(targetId) {
    const result = await this.sendCommand(targetId, "Runtime.evaluate", {
      expression: `(() => {
        return Array.isArray(window.${COMMAND_QUEUE_NAME}) ? window.${COMMAND_QUEUE_NAME}.slice() : [];
      })()`,
      returnByValue: true
    });

    return Array.isArray(result.result?.value) ? result.result.value : [];
  }

  async clearProcessedQueuedCommands(targetId, commandIds) {
    if (!Array.isArray(commandIds) || commandIds.length === 0) {
      return;
    }

    await this.sendCommand(targetId, "Runtime.evaluate", {
      expression: `(() => {
        const processedIds = new Set(${JSON.stringify(commandIds)});
        if (!Array.isArray(window.${COMMAND_QUEUE_NAME})) {
          window.${COMMAND_QUEUE_NAME} = [];
          return;
        }
        window.${COMMAND_QUEUE_NAME} = window.${COMMAND_QUEUE_NAME}.filter((command) => !processedIds.has(command.id));
      })()`
    });
  }

  async appendQueuedCommandResults(targetId, results) {
    if (!Array.isArray(results) || results.length === 0) {
      return;
    }

    await this.sendCommand(targetId, "Runtime.evaluate", {
      expression: `(() => {
        if (!Array.isArray(window.${COMMAND_RESULT_QUEUE_NAME})) {
          window.${COMMAND_RESULT_QUEUE_NAME} = [];
        }
        window.${COMMAND_RESULT_QUEUE_NAME}.push(...${JSON.stringify(results)});
      })()`
    });
  }

  async performApiRequest(endpoint, method = "GET", body = null) {
    const requestUrl = new URL(endpoint, this.apiBaseUrl || "http://localhost:3000");
    const client = requestUrl.protocol === "https:" ? https : http;
    const payload = body === null ? null : JSON.stringify(body);

    return new Promise((resolve, reject) => {
      const req = client.request(requestUrl, {
        method,
        headers: {
          Accept: "application/json",
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload)
              }
            : {})
        }
      }, (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          if (!raw) {
            resolve(null);
            return;
          }

          try {
            resolve(JSON.parse(raw));
          } catch (error) {
            resolve(raw);
          }
        });
      });

      req.on("error", reject);

      if (payload) {
        req.write(payload);
      }

      req.end();
    });
  }

  async processQueuedApiCommands() {
    const targets = await this.getPagesAndIframes();
    let processedCommandCount = 0;

    for (const target of targets) {
      try {
        await this.connect(target);

        if (!(await this.isAlreadyInjected(target.id))) {
          continue;
        }

        const queuedCommands = await this.readQueuedCommands(target.id);
        if (queuedCommands.length === 0) {
          continue;
        }

        const results = [];
        for (const command of queuedCommands) {
          try {
            const value = await this.performApiRequest(command.endpoint, command.method || "GET", command.body ?? null);
            results.push({
              id: command.id,
              ok: true,
              value
            });
          } catch (error) {
            results.push({
              id: command.id,
              ok: false,
              error: error.message
            });
          }
          processedCommandCount += 1;
        }

        await this.appendQueuedCommandResults(target.id, results);
        await this.clearProcessedQueuedCommands(target.id, queuedCommands.map((command) => command.id));
      } catch (error) {
        console.warn(`[CDP] Failed to process queued commands for ${target.id}: ${error.message}`);
      }
    }

    return processedCommandCount;
  }

  async injectIntoAllTargets(force = false) {
    const scripts = this.loadScriptsFromCommon();
    if (scripts.length === 0) {
      console.log("[CDP] No scripts found in common folder");
      return;
    }

    const targets = await this.getPagesAndIframes();
    console.log(`[CDP] Found ${targets.length} target(s) to inject`);
    let injectedTargetCount = 0;
    let skippedTargetCount = 0;
    let failedTargetCount = 0;

    for (const target of targets) {
      try {
        await this.connect(target);

        if (!force && (await this.isAlreadyInjected(target.id))) {
          console.log(`[CDP] Skipping ${target.type}: ${target.title} (already injected)`);
          skippedTargetCount += 1;
          continue;
        }

        // Set target ID before init.js so it can access it
        const targetIdJson = JSON.stringify(target.id);
        const apiBaseUrlJson = JSON.stringify(this.apiBaseUrl || "http://localhost:3000");
        await this.sendCommand(target.id, "Runtime.evaluate", {
          expression: `window.selenium_debugger_target_id = ${targetIdJson}; window.selenium_debugger_api_base = ${apiBaseUrlJson}; try { localStorage.setItem("selenium_debugger_target_id", ${targetIdJson}); localStorage.setItem("selenium_debugger_api_base", ${apiBaseUrlJson}); } catch (e) {}`,
        });

        for (const script of scripts) {
          await this.sendCommand(target.id, "Runtime.evaluate", {
            expression: script.content,
          });
          console.log(`[CDP] Injected "${script.name}" into ${target.type}: ${target.title}`);
          await this.sendCommand(target.id, "Runtime.evaluate", {
            expression: 'console.debug("[SeleniumDebugger] All scripts injected into ' + target.type + ': ' + target.id + ' (' + target.title + ')");',
          });
        }
        injectedTargetCount += 1;
      } catch (err) {
        failedTargetCount += 1;
        console.error(`[CDP] Failed to inject into ${target.id}: ${err.message}`);
      }
    }

    if (injectedTargetCount > 0 && failedTargetCount === 0) {
      const message = "[SeleniumDebugger] Script injected into all pages and iframes. Start debugging!";
      console.log(message);
      for (const target of targets) {
        try {
          await this.sendCommand(target.id, "Runtime.evaluate", {
            expression: `if (window.top === window) console.info(${JSON.stringify(message)});`,
          });
        } catch (err) {
          // Ignore per-target completion log failures
        }
      }
      return;
    }

    if (failedTargetCount > 0) {
      console.warn(
        `[CDP] Injection pass finished with failures (injected: ${injectedTargetCount}, skipped: ${skippedTargetCount}, failed: ${failedTargetCount})`
      );
    }
  }
}

module.exports = { CDP };
