const { By, Button, Key, Origin } = require("selenium-webdriver");
const { jsonError, getRequiredDriver, getRequiredCdp } = require("../server");
const { switchToTargetFrame, getTargetSelector } = require("../helpers/targets");

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

function normalizeInteractionKey(key) {
  if (
    typeof key === "string" &&
    Object.prototype.hasOwnProperty.call(Key, key) &&
    typeof Key[key] === "string"
  ) {
    return Key[key];
  }

  return key;
}

function normalizeInteractionKeys(keys) {
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new Error("keys must be a non-empty array");
  }

  const normalizedInput = keys.length === 1 && Array.isArray(keys[0]) ? keys[0] : keys;
  return normalizeSendKeysValue(normalizedInput).map((key) => normalizeInteractionKey(key));
}

function toFiniteNumber(value, fieldName) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`${fieldName} must be a finite number`);
  }
  return num;
}

async function findTargetElement(context, targetId, elemId) {
  const driver = getRequiredDriver(context.getDriver);
  await switchToTargetFrame(context.getDriver, targetId);
  const repoElement = await driver.executeScript(`
    const repo = window.aj__webdriver && window.aj__webdriver.elem_repo;
    return repo ? (repo[arguments[0]] || null) : null;
  `, elemId);

  if (repoElement) {
    return repoElement;
  }

  return driver.findElement(By.css(getTargetSelector(elemId)));
}

function registerRoutes(app, context) {
  app.get("/ping", (req, res) => {
    res.json({ success: true, value: "pong" });
  });

  app.get("/status", (req, res) => {
    res.json({ ready: !!context.getDriver(), status: "running" });
  });

  app.post("/close_session", async (req, res) => {
    try {
      if (context.isShutdownInProgress()) {
        res.json({ success: true, shuttingDown: true, alreadyShuttingDown: true });
        return;
      }

      res.once("finish", () => {
        context.shutdownTool()
          .then(() => process.exit(0))
          .catch((error) => {
            console.error("Failed to shutdown cleanly:", error.message);
            process.exit(1);
          });
      });

      res.json({ success: true, shuttingDown: true });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.post("/reinject", async (req, res) => {
    try {
      const cdp = getRequiredCdp(context.getCdp);
      await cdp.injectIntoAllTargets(true);
      res.json({ success: true });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.get("/get_timeouts", async (req, res) => {
    try {
      const driver = getRequiredDriver(context.getDriver);
      const timeouts = await driver.manage().getTimeouts();
      res.json({ value: timeouts });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.post("/set_timeouts", async (req, res) => {
    try {
      const driver = getRequiredDriver(context.getDriver);
      const { script, pageLoad, implicit } = req.body;
      if (script !== undefined) {
        await driver.manage().setTimeouts({ script });
      }
      if (pageLoad !== undefined) {
        await driver.manage().setTimeouts({ pageLoad });
      }
      if (implicit !== undefined) {
        await driver.manage().setTimeouts({ implicit });
      }
      res.json({ success: true });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.post("/navigate_to", async (req, res) => {
    try {
      const driver = getRequiredDriver(context.getDriver);
      const { url } = req.body;
      await driver.get(url);
      res.json({ success: true });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.get("/get_current_url", async (req, res) => {
    try {
      const driver = getRequiredDriver(context.getDriver);
      const url = await driver.getCurrentUrl();
      res.json({ value: url });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.post("/back", async (req, res) => {
    try {
      const driver = getRequiredDriver(context.getDriver);
      await driver.navigate().back();
      res.json({ success: true });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.post("/forward", async (req, res) => {
    try {
      const driver = getRequiredDriver(context.getDriver);
      await driver.navigate().forward();
      res.json({ success: true });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.post("/refresh", async (req, res) => {
    try {
      const driver = getRequiredDriver(context.getDriver);
      await driver.navigate().refresh();
      res.json({ success: true });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.get("/get_title", async (req, res) => {
    try {
      const driver = getRequiredDriver(context.getDriver);
      const title = await driver.getTitle();
      res.json({ value: title });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.get("/get_window_handle", async (req, res) => {
    try {
      const driver = getRequiredDriver(context.getDriver);
      const handle = await driver.getWindowHandle();
      res.json({ value: handle });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.get("/get_window_handles", async (req, res) => {
    try {
      const driver = getRequiredDriver(context.getDriver);
      const handles = await driver.getAllWindowHandles();
      res.json({ value: handles });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.delete("/close_window", async (req, res) => {
    try {
      const driver = getRequiredDriver(context.getDriver);
      await driver.close();
      res.json({ success: true });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.post("/switch_to_window", async (req, res) => {
    try {
      const driver = getRequiredDriver(context.getDriver);
      const { handle } = req.body;
      await driver.switchTo().window(handle);
      res.json({ success: true });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.post("/new_window", async (req, res) => {
    try {
      const driver = getRequiredDriver(context.getDriver);
      const { type } = req.body;
      await driver.switchTo().newWindow(type || "tab");
      const handle = await driver.getWindowHandle();
      res.json({ value: { handle, type: type || "tab" } });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.get("/get_window_rect", async (req, res) => {
    try {
      const driver = getRequiredDriver(context.getDriver);
      const rect = await driver.manage().window().getRect();
      res.json({ value: rect });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.post("/set_window_rect", async (req, res) => {
    try {
      const driver = getRequiredDriver(context.getDriver);
      const { x, y, width, height } = req.body;
      await driver.manage().window().setRect({ x, y, width, height });
      const rect = await driver.manage().window().getRect();
      res.json({ value: rect });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.post("/maximize_window", async (req, res) => {
    try {
      const driver = getRequiredDriver(context.getDriver);
      await driver.manage().window().maximize();
      res.json({ success: true });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.post("/minimize_window", async (req, res) => {
    try {
      const driver = getRequiredDriver(context.getDriver);
      await driver.manage().window().minimize();
      res.json({ success: true });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.post("/fullscreen_window", async (req, res) => {
    try {
      const driver = getRequiredDriver(context.getDriver);
      await driver.manage().window().fullscreen();
      res.json({ success: true });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.post("/switch_to_frame", async (req, res) => {
    try {
      const driver = getRequiredDriver(context.getDriver);
      const { targetId, elemId } = req.body;
      await switchToTargetFrame(context.getDriver, targetId);
      const element = await findTargetElement(context, targetId, elemId);
      await driver.switchTo().frame(element);
      res.json({ success: true });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.post("/switch_to_parent_frame", async (req, res) => {
    try {
      const driver = getRequiredDriver(context.getDriver);
      await driver.switchTo().parentFrame();
      res.json({ success: true });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.post("/element_click", async (req, res) => {
    try {
      const { targetId, elemId } = req.body;
      const element = await findTargetElement(context, targetId, elemId);
      await element.click();
      res.json({ success: true });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.post("/element_clear", async (req, res) => {
    try {
      const { targetId, elemId } = req.body;
      const element = await findTargetElement(context, targetId, elemId);
      await element.clear();
      res.json({ success: true });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.post("/element_send_keys", async (req, res) => {
    try {
      const { targetId, elemId, value } = req.body;
      const element = await findTargetElement(context, targetId, elemId);
      const keys = normalizeSendKeysValue(value);
      await element.sendKeys(...keys);
      res.json({ success: true });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.post("/element_send_combo_keys", async (req, res) => {
    try {
      const driver = getRequiredDriver(context.getDriver);
      const { targetId, elemId, keys } = req.body;
      const element = await findTargetElement(context, targetId, elemId);
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
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.post("/interactions", async (req, res) => {
    try {
      const driver = getRequiredDriver(context.getDriver);
      const { targetId, steps } = req.body;
      if (!Array.isArray(steps)) {
        throw new Error("steps must be an array");
      }

      if (steps.length === 0) {
        res.json({ success: true, performed: 0 });
        return;
      }

      const resolveStepElement = async (elemId) => {
        if (typeof elemId !== "string" || !elemId.trim()) {
          throw new Error("Element id must be a non-empty string");
        }
        return findTargetElement(context, targetId, elemId);
      };

      const actions = driver.actions({ async: true });
      for (const step of steps) {
        if (!step || typeof step !== "object") {
          throw new Error("each step must be an object");
        }

        switch (step.action) {
          case "clickCursor":
            actions.click();
            break;
          case "clickElement":
            actions.click(await resolveStepElement(step.element));
            break;
          case "clickElementOffset":
            actions.move({
              origin: await resolveStepElement(step.element),
              x: toFiniteNumber(step.x, "x"),
              y: toFiniteNumber(step.y, "y")
            }).click();
            break;
          case "doubleClickCursor":
            actions.doubleClick();
            break;
          case "doubleClickElement":
            actions.doubleClick(await resolveStepElement(step.element));
            break;
          case "contextClickCursor":
            actions.contextClick();
            break;
          case "contextClickElement":
            actions.contextClick(await resolveStepElement(step.element));
            break;
          case "moveToElement":
            actions.move({ origin: await resolveStepElement(step.element) });
            break;
          case "moveToElementOffset":
            actions.move({
              origin: await resolveStepElement(step.element),
              x: toFiniteNumber(step.x, "x"),
              y: toFiniteNumber(step.y, "y")
            });
            break;
          case "moveByOffset":
            actions.move({
              origin: Origin.POINTER,
              x: toFiniteNumber(step.x, "x"),
              y: toFiniteNumber(step.y, "y")
            });
            break;
          case "clickAndHoldCursor":
            actions.press(Button.LEFT);
            break;
          case "clickAndHoldElement":
            actions.move({ origin: await resolveStepElement(step.element) }).press(Button.LEFT);
            break;
          case "releaseCursor":
            actions.release(Button.LEFT);
            break;
          case "releaseElement":
            actions.move({ origin: await resolveStepElement(step.element) }).release(Button.LEFT);
            break;
          case "dragAndDrop":
            actions.dragAndDrop(
              await resolveStepElement(step.source),
              await resolveStepElement(step.target)
            );
            break;
          case "dragAndDropBy":
            actions.dragAndDrop(await resolveStepElement(step.source), {
              x: toFiniteNumber(step.x, "x"),
              y: toFiniteNumber(step.y, "y")
            });
            break;
          case "keyDown":
            if (step.element) {
              actions.click(await resolveStepElement(step.element));
            }
            actions.keyDown(normalizeInteractionKey(step.key));
            break;
          case "keyUp":
            if (step.element) {
              actions.click(await resolveStepElement(step.element));
            }
            actions.keyUp(normalizeInteractionKey(step.key));
            break;
          case "sendKeys":
            if (step.element) {
              actions.click(await resolveStepElement(step.element));
            }
            actions.sendKeys(...normalizeInteractionKeys(step.keys));
            break;
          case "pause":
            actions.pause(toFiniteNumber(step.ms, "ms"));
            break;
          default:
            throw new Error(`Unsupported interaction action: ${step.action}`);
        }
      }

      await actions.perform();
      res.json({ success: true, performed: steps.length });
    } catch (error) {
      jsonError(res, error, { stack: error.stack });
    }
  });

  app.post("/get_element_text", async (req, res) => {
    try {
      const { targetId, elemId } = req.body;
      const element = await findTargetElement(context, targetId, elemId);
      const text = await element.getText();
      res.json({ value: text });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.post("/get_element_attribute", async (req, res) => {
    try {
      const { targetId, elemId, name } = req.body;
      const element = await findTargetElement(context, targetId, elemId);
      const value = await element.getAttribute(name);
      res.json({ value });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.post("/get_element_property", async (req, res) => {
    try {
      const driver = getRequiredDriver(context.getDriver);
      const { targetId, elemId, name } = req.body;
      const element = await findTargetElement(context, targetId, elemId);
      const value = await driver.executeScript(`return arguments[0]['${name}']`, element);
      res.json({ value });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.post("/get_element_css_value", async (req, res) => {
    try {
      const { targetId, elemId, propertyName } = req.body;
      const element = await findTargetElement(context, targetId, elemId);
      const value = await element.getCssValue(propertyName);
      res.json({ value });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.post("/is_element_enabled", async (req, res) => {
    try {
      const { targetId, elemId } = req.body;
      const element = await findTargetElement(context, targetId, elemId);
      const value = await element.isEnabled();
      res.json({ value });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.post("/is_element_selected", async (req, res) => {
    try {
      const { targetId, elemId } = req.body;
      const element = await findTargetElement(context, targetId, elemId);
      const value = await element.isSelected();
      res.json({ value });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.post("/get_element_tag_name", async (req, res) => {
    try {
      const { targetId, elemId } = req.body;
      const element = await findTargetElement(context, targetId, elemId);
      const value = await element.getTagName();
      res.json({ value });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.post("/get_element_rect", async (req, res) => {
    try {
      const { targetId, elemId } = req.body;
      const element = await findTargetElement(context, targetId, elemId);
      const rect = await element.getRect();
      res.json({ value: rect });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.get("/get_page_source", async (req, res) => {
    try {
      const driver = getRequiredDriver(context.getDriver);
      const source = await driver.getPageSource();
      res.json({ value: source });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.get("/get_all_cookies", async (req, res) => {
    try {
      const driver = getRequiredDriver(context.getDriver);
      const cookies = await driver.manage().getCookies();
      res.json({ value: cookies });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.get("/get_named_cookie/:name", async (req, res) => {
    try {
      const driver = getRequiredDriver(context.getDriver);
      const { name } = req.params;
      const cookie = await driver.manage().getCookie(name);
      res.json({ value: cookie });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.post("/add_cookie", async (req, res) => {
    try {
      const driver = getRequiredDriver(context.getDriver);
      const { cookie } = req.body;
      await driver.manage().addCookie(cookie);
      res.json({ success: true });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.delete("/delete_cookie/:name", async (req, res) => {
    try {
      const driver = getRequiredDriver(context.getDriver);
      const { name } = req.params;
      await driver.manage().deleteCookie(name);
      res.json({ success: true });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.delete("/delete_all_cookies", async (req, res) => {
    try {
      const driver = getRequiredDriver(context.getDriver);
      await driver.manage().deleteAllCookies();
      res.json({ success: true });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.post("/dismiss_alert", async (req, res) => {
    try {
      const driver = getRequiredDriver(context.getDriver);
      await driver.switchTo().alert().dismiss();
      res.json({ success: true });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.post("/accept_alert", async (req, res) => {
    try {
      const driver = getRequiredDriver(context.getDriver);
      await driver.switchTo().alert().accept();
      res.json({ success: true });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.get("/get_alert_text", async (req, res) => {
    try {
      const driver = getRequiredDriver(context.getDriver);
      const text = await driver.switchTo().alert().getText();
      res.json({ value: text });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.post("/send_alert_text", async (req, res) => {
    try {
      const driver = getRequiredDriver(context.getDriver);
      const { text } = req.body;
      await driver.switchTo().alert().sendKeys(text);
      res.json({ success: true });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.get("/take_screenshot", async (req, res) => {
    try {
      const driver = getRequiredDriver(context.getDriver);
      const screenshot = await driver.takeScreenshot();
      res.json({ value: screenshot });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.post("/execute_script", async (req, res) => {
    try {
      const driver = getRequiredDriver(context.getDriver);
      const { script, args } = req.body;
      const result = await driver.executeScript(script, ...(args || []));
      res.json({ value: result });
    } catch (error) {
      jsonError(res, error);
    }
  });
}

module.exports = { registerRoutes };
