const WebSocket = require("ws");
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const COMMON_DIR = path.join(__dirname, "..", "common");
const COMMAND_QUEUE_NAME = "aj__commands_to_execte";
const COMMAND_RESULT_QUEUE_NAME = "aj__command_results";
const AJ_HELPER_FRAME_ID = "aj__helper_frame";
const AJ_HELPER_FRAME_URL_FRAGMENT = "#aj__helper_frame";

class CDP {
  constructor() {
    this.debuggingPort = null;
    this.apiBaseUrl = "http://localhost:3000";
    this.connections = new Map();
    this.connectionPromises = new Map();
    this.messageId = 0;
    this.pendingMessages = new Map();
    this.knownTargets = new Map();
    this.rootFrameIds = new Map();
    this.frameExecutionContexts = new Map();
    this.frameSessions = new Map();
    this.sessionTargets = new Map();
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

  async fetchJson(url) {
    return new Promise((resolve, reject) => {
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

  getPendingMessageKey(connectionId, sessionId, id) {
    return `${connectionId}:${sessionId || "root"}:${id}`;
  }

  getSessionKey(connectionId, sessionId) {
    return `${connectionId}:${sessionId}`;
  }

  normalizeTarget(targetOrId) {
    if (targetOrId && typeof targetOrId === "object") {
      return targetOrId;
    }

    return this.knownTargets.get(targetOrId) || { id: targetOrId };
  }

  getConnectionId(target) {
    return target.connectionTargetId || target.parentTargetId || target.id;
  }

  resolveConnectionTarget(target) {
    const connectionId = this.getConnectionId(target);
    if (connectionId === target.id) {
      return target;
    }

    const connectionTarget = this.knownTargets.get(connectionId);
    if (!connectionTarget) {
      throw new Error(`No connection target found for ${target.id}`);
    }

    return connectionTarget;
  }

  flattenFrameTree(frameTree, frames = []) {
    if (!frameTree?.frame) {
      return frames;
    }

    frames.push(frameTree.frame);
    for (const childFrame of frameTree.childFrames || []) {
      this.flattenFrameTree(childFrame, frames);
    }
    return frames;
  }

  async getFrameTree(target) {
    await this.connect(target);
    const result = await this.sendCommand(target, "Page.getFrameTree");
    return result?.frameTree || null;
  }

  async getRootFrameId(target) {
    if (this.rootFrameIds.has(target.id)) {
      return this.rootFrameIds.get(target.id);
    }

    try {
      const frameTree = await this.getFrameTree(target);
      const rootFrameId = frameTree?.frame?.id || null;
      if (rootFrameId) {
        this.rootFrameIds.set(target.id, rootFrameId);
      }
      return rootFrameId;
    } catch (error) {
      return null;
    }
  }

  createSyntheticFrameTarget(pageTarget, frame) {
    const frameSession = this.frameSessions.get(frame.id);
    return {
      id: `frame:${frame.id}`,
      type: "iframe",
      title: frame.name || frame.url || `Frame ${frame.id}`,
      url: frame.url || "",
      frameName: frame.name || "",
      frameId: frame.id,
      parentFrameId: frame.parentId || null,
      parentTargetId: pageTarget.id,
      connectionTargetId: pageTarget.id,
      webSocketDebuggerUrl: pageTarget.webSocketDebuggerUrl,
      sessionId: frameSession?.sessionId || null,
      synthetic: true
    };
  }

  getAttributesMap(attributes = []) {
    const map = {};
    for (let i = 0; i < attributes.length; i += 2) {
      map[attributes[i]] = attributes[i + 1];
    }
    return map;
  }

  isHelperFrameTarget(target) {
    return (
      target?.frameName === AJ_HELPER_FRAME_ID ||
      target?.name === AJ_HELPER_FRAME_ID ||
      typeof target?.url === "string" && target.url.includes(AJ_HELPER_FRAME_URL_FRAGMENT) ||
      target?.title === AJ_HELPER_FRAME_ID
    );
  }

  shouldInspectFrameOwner(frame) {
    return (
      frame?.name === AJ_HELPER_FRAME_ID ||
      typeof frame?.url === "string" && (
        frame.url.includes(AJ_HELPER_FRAME_URL_FRAGMENT) ||
        frame.url === "about:blank" ||
        frame.url === ""
      )
    );
  }

  async getFrameOwnerAttributes(pageTarget, frameId) {
    try {
      const owner = await this.sendCommand(pageTarget, "DOM.getFrameOwner", { frameId });
      if (owner?.backendNodeId) {
        const described = await this.sendCommand(pageTarget, "DOM.describeNode", {
          backendNodeId: owner.backendNodeId
        });
        return described?.node?.attributes || [];
      }

      if (owner?.nodeId) {
        const described = await this.sendCommand(pageTarget, "DOM.describeNode", {
          nodeId: owner.nodeId
        });
        return described?.node?.attributes || [];
      }
    } catch (error) {
      return [];
    }

    return [];
  }

  async collectHelperFrameIds(pageTargetsById, pageFrameTrees) {
    const helperFrameIds = new Set();

    for (const [pageTargetId, frameTree] of pageFrameTrees.entries()) {
      const pageTarget = pageTargetsById.get(pageTargetId);
      if (!pageTarget) {
        continue;
      }

      const frames = this.flattenFrameTree(frameTree).filter((frame) => frame.parentId);
      const helperChecks = await Promise.allSettled(frames.map(async (frame) => {
        if (frame.name === AJ_HELPER_FRAME_ID || frame.url?.includes(AJ_HELPER_FRAME_URL_FRAGMENT)) {
          return frame.id;
        }

        if (!this.shouldInspectFrameOwner(frame)) {
          return null;
        }

        const attributes = await this.getFrameOwnerAttributes(pageTarget, frame.id);
        const attributeMap = this.getAttributesMap(attributes);
        if (
          attributeMap.id === AJ_HELPER_FRAME_ID ||
          attributeMap.name === AJ_HELPER_FRAME_ID ||
          attributeMap["data-aj-helper-frame"] === "true"
        ) {
          return frame.id;
        }

        return null;
      }));

      for (const result of helperChecks) {
        if (result.status === "fulfilled" && result.value) {
          helperFrameIds.add(result.value);
        }
      }
    }

    return helperFrameIds;
  }

  async getTargets() {
    const rawTargets = await this.fetchJson(`http://localhost:${this.debuggingPort}/json/list`);
    const pageTargets = rawTargets.filter((target) => target.type === "page");
    const iframeTargets = rawTargets.filter((target) => target.type === "iframe");
    const pageTargetsById = new Map(pageTargets.map((target) => [target.id, target]));

    const pageFrameTrees = new Map();
    const pageFrameTreeResults = await Promise.allSettled(pageTargets.map(async (pageTarget) => {
      const frameTree = await this.getFrameTree(pageTarget);
      const rootFrameId = frameTree?.frame?.id || null;
      if (rootFrameId) {
        this.rootFrameIds.set(pageTarget.id, rootFrameId);
      }
      return [pageTarget.id, frameTree];
    }));

    for (const result of pageFrameTreeResults) {
      if (result.status !== "fulfilled") {
        continue;
      }

      const [targetId, frameTree] = result.value;
      pageFrameTrees.set(targetId, frameTree);
    }

    const iframeRootFrameResults = await Promise.allSettled(iframeTargets.map((target) => this.getRootFrameId(target)));
    const iframeRootFrameIdsByTargetId = new Map();
    iframeTargets.forEach((target, index) => {
      const result = iframeRootFrameResults[index];
      if (result?.status === "fulfilled" && result.value) {
        iframeRootFrameIdsByTargetId.set(target.id, result.value);
      }
    });
    const iframeRootFrameIds = iframeRootFrameResults
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);
    const existingFrameIds = new Set(iframeRootFrameIds.filter(Boolean));
    for (const frameTree of pageFrameTrees.values()) {
      const rootFrameId = frameTree?.frame?.id;
      if (rootFrameId) {
        existingFrameIds.add(rootFrameId);
      }
    }

    const helperFrameIds = await this.collectHelperFrameIds(pageTargetsById, pageFrameTrees);
    const syntheticTargets = [];
    const seenSyntheticFrameIds = new Set();
    for (const pageTarget of pageTargets) {
      const frameTree = pageFrameTrees.get(pageTarget.id);
      if (!frameTree) {
        continue;
      }

      const frames = this.flattenFrameTree(frameTree);
      for (const frame of frames) {
        if (
          !frame.parentId ||
          helperFrameIds.has(frame.id) ||
          existingFrameIds.has(frame.id) ||
          seenSyntheticFrameIds.has(frame.id)
        ) {
          continue;
        }

        seenSyntheticFrameIds.add(frame.id);
        syntheticTargets.push(this.createSyntheticFrameTarget(pageTarget, frame));
      }
    }

    const filteredRawTargets = rawTargets.filter((target) => {
      if (this.isHelperFrameTarget(target)) {
        return false;
      }

      if (target.type !== "iframe") {
        return true;
      }

      const rootFrameId = iframeRootFrameIdsByTargetId.get(target.id);
      return !rootFrameId || !helperFrameIds.has(rootFrameId);
    });
    const allTargets = [...filteredRawTargets, ...syntheticTargets];
    this.knownTargets = new Map(allTargets.map((target) => [target.id, target]));
    return allTargets;
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

  async sendOnConnection(connectionId, ws, method, params = {}, sessionId = null) {
    return new Promise((resolve, reject) => {
      const id = ++this.messageId;
      const key = this.getPendingMessageKey(connectionId, sessionId, id);
      this.pendingMessages.set(key, { resolve, reject });

      try {
        ws.send(JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {})
        }));
      } catch (error) {
        this.pendingMessages.delete(key);
        reject(error);
      }
    });
  }

  handleExecutionContextCreated(connectionId, sessionId, params) {
    const context = params?.context;
    const frameId = context?.auxData?.frameId;
    if (!frameId || context?.auxData?.isDefault !== true) {
      return;
    }

    this.frameExecutionContexts.set(frameId, {
      connectionId,
      sessionId: sessionId || null,
      id: context.id,
      uniqueId: context.uniqueId || context.uniqueContextId || null
    });

    if (sessionId) {
      const sessionInfo = this.sessionTargets.get(this.getSessionKey(connectionId, sessionId));
      if (sessionInfo && !sessionInfo.rootFrameId) {
        sessionInfo.rootFrameId = frameId;
        this.rootFrameIds.set(sessionInfo.targetId, frameId);
        this.frameSessions.set(frameId, {
          connectionId,
          sessionId,
          targetId: sessionInfo.targetId
        });
      }
    }
  }

  handleExecutionContextDestroyed(connectionId, sessionId, executionContextId) {
    for (const [frameId, contextInfo] of this.frameExecutionContexts.entries()) {
      if (
        contextInfo.connectionId === connectionId &&
        contextInfo.sessionId === (sessionId || null) &&
        contextInfo.id === executionContextId
      ) {
        this.frameExecutionContexts.delete(frameId);
      }
    }
  }

  handleExecutionContextsCleared(connectionId, sessionId) {
    for (const [frameId, contextInfo] of this.frameExecutionContexts.entries()) {
      if (contextInfo.connectionId === connectionId && contextInfo.sessionId === (sessionId || null)) {
        this.frameExecutionContexts.delete(frameId);
      }
    }
  }

  async handleAttachedTarget(connectionId, params) {
    const { sessionId, targetInfo } = params || {};
    if (!sessionId || !targetInfo?.targetId) {
      return;
    }

    const sessionKey = this.getSessionKey(connectionId, sessionId);
    this.sessionTargets.set(sessionKey, {
      connectionId,
      sessionId,
      targetId: targetInfo.targetId,
      type: targetInfo.type,
      title: targetInfo.title || "",
      url: targetInfo.url || "",
      rootFrameId: null
    });

    if (!["page", "iframe"].includes(targetInfo.type)) {
      return;
    }

    const sessionTarget = {
      id: targetInfo.targetId,
      connectionTargetId: connectionId,
      sessionId
    };

    try {
      await this.sendCommand(sessionTarget, "Target.setAutoAttach", {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true
      });
    } catch (error) {
      // Ignore child-session auto-attach failures on targets that do not support nested targets.
    }

    try {
      await this.sendCommand(sessionTarget, "Runtime.enable");
    } catch (error) {
      // Ignore Runtime.enable failures; same-target frame fallback can still work.
    }

    try {
      const frameTree = await this.sendCommand(sessionTarget, "Page.getFrameTree");
      const rootFrameId = frameTree?.frameTree?.frame?.id || null;
      if (!rootFrameId) {
        return;
      }

      const sessionInfo = this.sessionTargets.get(sessionKey);
      if (sessionInfo) {
        sessionInfo.rootFrameId = rootFrameId;
      }

      this.rootFrameIds.set(targetInfo.targetId, rootFrameId);
      this.frameSessions.set(rootFrameId, {
        connectionId,
        sessionId,
        targetId: targetInfo.targetId
      });
    } catch (error) {
      // Ignore targets that do not expose Page.getFrameTree.
    }
  }

  handleDetachedTarget(connectionId, params) {
    const sessionId = params?.sessionId;
    if (!sessionId) {
      return;
    }

    const sessionKey = this.getSessionKey(connectionId, sessionId);
    const sessionInfo = this.sessionTargets.get(sessionKey);
    if (sessionInfo?.rootFrameId) {
      this.frameSessions.delete(sessionInfo.rootFrameId);
    }
    this.sessionTargets.delete(sessionKey);
    this.handleExecutionContextsCleared(connectionId, sessionId);
  }

  clearConnectionState(connectionId) {
    for (const [frameId, contextInfo] of this.frameExecutionContexts.entries()) {
      if (contextInfo.connectionId === connectionId) {
        this.frameExecutionContexts.delete(frameId);
      }
    }

    for (const [frameId, sessionInfo] of this.frameSessions.entries()) {
      if (sessionInfo.connectionId === connectionId) {
        this.frameSessions.delete(frameId);
      }
    }

    for (const [sessionKey, sessionInfo] of this.sessionTargets.entries()) {
      if (sessionInfo.connectionId === connectionId) {
        this.sessionTargets.delete(sessionKey);
      }
    }

    for (const [key] of this.pendingMessages.entries()) {
      if (key.startsWith(`${connectionId}:`)) {
        const pending = this.pendingMessages.get(key);
        this.pendingMessages.delete(key);
        pending?.reject?.(new Error(`Connection closed for target ${connectionId}`));
      }
    }
  }

  async initializeConnection(connectionId, ws) {
    await this.sendOnConnection(connectionId, ws, "Runtime.enable");

    try {
      await this.sendOnConnection(connectionId, ws, "Target.setAutoAttach", {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true
      });
    } catch (error) {
      // Ignore auto-attach failures on browsers/targets that do not support flattened child sessions.
    }
  }

  async connect(targetOrId) {
    const target = this.normalizeTarget(targetOrId);
    const connectionTarget = this.resolveConnectionTarget(target);
    const connectionId = connectionTarget.id;

    if (this.connections.has(connectionId)) {
      return this.connections.get(connectionId);
    }

    if (this.connectionPromises.has(connectionId)) {
      return this.connectionPromises.get(connectionId);
    }

    const connectPromise = new Promise((resolve, reject) => {
      const ws = new WebSocket(connectionTarget.webSocketDebuggerUrl);
      let settled = false;

      const fail = (error) => {
        if (settled) {
          return;
        }

        settled = true;
        this.connections.delete(connectionId);
        this.connectionPromises.delete(connectionId);
        reject(error);
      };

      ws.on("open", async () => {
        this.connections.set(connectionId, ws);

        try {
          await this.initializeConnection(connectionId, ws);
          settled = true;
          this.connectionPromises.delete(connectionId);
          resolve(ws);
        } catch (error) {
          ws.close();
          fail(error);
        }
      });

      ws.on("message", (data) => {
        const message = JSON.parse(data.toString());

        if (message.method === "Runtime.executionContextCreated") {
          this.handleExecutionContextCreated(connectionId, message.sessionId, message.params);
        } else if (message.method === "Runtime.executionContextDestroyed") {
          this.handleExecutionContextDestroyed(connectionId, message.sessionId, message.params?.executionContextId);
        } else if (message.method === "Runtime.executionContextsCleared") {
          this.handleExecutionContextsCleared(connectionId, message.sessionId);
        } else if (message.method === "Target.attachedToTarget") {
          this.handleAttachedTarget(connectionId, message.params).catch(() => {});
        } else if (message.method === "Target.detachedFromTarget") {
          this.handleDetachedTarget(connectionId, message.params);
        }

        if (message.id === undefined) {
          return;
        }

        const key = this.getPendingMessageKey(connectionId, message.sessionId, message.id);
        if (!this.pendingMessages.has(key)) {
          return;
        }

        const pending = this.pendingMessages.get(key);
        this.pendingMessages.delete(key);
        if (message.error) {
          pending.reject(new Error(message.error.message));
          return;
        }

        pending.resolve(message.result);
      });

      ws.on("close", () => {
        this.connections.delete(connectionId);
        this.connectionPromises.delete(connectionId);
        this.clearConnectionState(connectionId);
      });

      ws.on("error", fail);
    });

    this.connectionPromises.set(connectionId, connectPromise);
    return connectPromise;
  }

  async waitForFrameRoute(frameId, timeoutMs = 1500) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const frameSession = this.frameSessions.get(frameId);
      if (frameSession) {
        return {
          connectionId: frameSession.connectionId,
          sessionId: frameSession.sessionId
        };
      }

      const frameContext = this.frameExecutionContexts.get(frameId);
      if (frameContext) {
        return {
          connectionId: frameContext.connectionId,
          sessionId: frameContext.sessionId,
          uniqueContextId: frameContext.uniqueId || undefined,
          contextId: frameContext.id
        };
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    return null;
  }

  async resolveFrameRuntimeRoute(target) {
    const currentFrameSession = this.frameSessions.get(target.frameId);
    if (currentFrameSession) {
      return {
        connectionId: currentFrameSession.connectionId,
        sessionId: currentFrameSession.sessionId
      };
    }

    const currentFrameContext = this.frameExecutionContexts.get(target.frameId);
    if (currentFrameContext) {
      return {
        connectionId: currentFrameContext.connectionId,
        sessionId: currentFrameContext.sessionId,
        uniqueContextId: currentFrameContext.uniqueId || undefined,
        contextId: currentFrameContext.id
      };
    }

    const route = await this.waitForFrameRoute(target.frameId);
    if (route) {
      return route;
    }

    throw new Error(`No execution route found for frame ${target.frameId}`);
  }

  async sendCommand(targetOrId, method, params = {}) {
    const target = this.normalizeTarget(targetOrId);
    const connectionId = this.getConnectionId(target);
    const ws = this.connections.get(connectionId);
    if (!ws) {
      throw new Error(`No connection for target ${connectionId}`);
    }

    let sessionId = target.sessionId || null;
    let finalParams = params;

    if (target.frameId && method === "Runtime.evaluate") {
      const frameRoute = await this.resolveFrameRuntimeRoute(target);
      sessionId = frameRoute.sessionId || sessionId;
      finalParams = { ...params };

      if (frameRoute.uniqueContextId) {
        finalParams.uniqueContextId = frameRoute.uniqueContextId;
      } else if (frameRoute.contextId) {
        finalParams.contextId = frameRoute.contextId;
      }
    }

    return this.sendOnConnection(connectionId, ws, method, finalParams, sessionId);
  }

  disconnect(targetOrId) {
    const target = this.normalizeTarget(targetOrId);
    const connectionId = this.getConnectionId(target);
    const ws = this.connections.get(connectionId);
    if (ws) {
      ws.close();
      this.connections.delete(connectionId);
      this.clearConnectionState(connectionId);
    }
  }

  disconnectAll() {
    for (const [connectionId, ws] of this.connections.entries()) {
      ws.close();
      this.clearConnectionState(connectionId);
    }
    this.connections.clear();
    this.connectionPromises.clear();
    this.knownTargets.clear();
    this.rootFrameIds.clear();
    this.frameExecutionContexts.clear();
    this.frameSessions.clear();
    this.sessionTargets.clear();
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
