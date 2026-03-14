async function switchToTargetFrame(getDriver, targetId) {
  const driver = getDriver();

  const currentTargetId = await driver.executeScript("return window.selenium_debugger_target_id");
  if (currentTargetId === targetId) {
    return true;
  }

  await driver.switchTo().defaultContent();

  const topTargetId = await driver.executeScript("return window.selenium_debugger_target_id");
  if (topTargetId === targetId) {
    return true;
  }

  async function searchFrames() {
    const iframes = await driver.executeScript("return window.aj__dom ? window.aj__dom.querySelectorAll('iframe') : []");

    for (let i = 0; i < iframes.length; i += 1) {
      try {
        await driver.switchTo().frame(iframes[i]);

        const frameTargetId = await driver.executeScript("return window.selenium_debugger_target_id");
        if (frameTargetId === targetId) {
          return true;
        }

        if (await searchFrames()) {
          return true;
        }

        await driver.switchTo().parentFrame();
      } catch (error) {
        try {
          await driver.switchTo().parentFrame();
        } catch (parentError) {
          // Ignore inaccessible frames while searching.
        }
      }
    }

    return false;
  }

  return searchFrames();
}

function getTargetSelector(elemId) {
  if (typeof elemId === "string" && elemId.trim()) {
    return `[aj-target="${elemId}"]`;
  }

  return '[data-aj-target="true"],[aj-target]';
}

module.exports = {
  switchToTargetFrame,
  getTargetSelector
};
