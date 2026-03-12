# SeleniumDebugger

## What SeleniumDebugger Is and Why this tool is useful

This tool allows launching a browser and sending Selenium-level events from the running browser console to test Selenium event behavior on various elements in the running browser. It helps debug anomalies or weird behavior caused by web app element design or app design without having to retrigger the entire execution. You can test various Selenium events on a given page, helping you debug a certain situation and devise a way to handle it using built-in Selenium methods.

SeleniumDebugger is an interactive Selenium sandbox for a live browser session. It lets you trigger real WebDriver actions from the browser console (`window.aj__webdriver`) against the current page state, instead of re-running full test scripts each time.

## How It Works

1. Starts a Selenium-controlled browser (Chrome/Edge/Firefox).
2. Runs a local Express API that maps calls to Selenium WebDriver commands.
3. Injects helper scripts into page/iframe targets.
4. Exposes browser-side APIs like:
   Navigation/window/frame/element methods
   Keyboard and mouse actions
   `interaction_chain()` for multi-step action sequences

When you call methods from DevTools console, those calls are executed through Selenium on the same live page.

## Why It Is Useful for Selenium Developers

- Debug flaky actions faster: test click, move, drag, and key combos immediately.
- Avoid full test reruns: reproduce issues in-place on the exact current UI state.
- Validate edge cases: overlays, animations, hidden/intercepted elements, iframe context, and focus issues.
- Tune interaction strategy: compare approaches (normal click vs move+click, combo keys, pause timing).
- Understand event behavior: verify how a specific component reacts to Selenium-level input before updating framework code.

## Typical Workflow

1. Open app page with SeleniumDebugger running.
2. Inspect/select elements in browser DevTools.
3. Execute `aj__webdriver` calls or build an `interaction_chain()`.
4. Observe page and console behavior.
5. Convert the working sequence into stable test code in your automation suite.

## Installation

```bash
npm install
```

### ChromeDriver setup (manual)

- You must manually download ChromeDriver that matches your installed Chrome browser version.
- Place the downloaded driver in the project `web_driver` folder for your OS:
  - Windows: `web_driver/windows/chromedriver.exe`
  - macOS: `web_driver/macos/chromedriver`
  - Linux: `web_driver/linux/chromedriver`
- Download helper: https://ajoealex.github.io/chromedriver-download-helper/

## Usage

```bash
npm start
```

Server host/interface and port are configurable from `config.js`.

## Configuration

Edit `config.js` to set the browser and capabilities.

### API server settings

```js
module.exports = {
  apiHost: "127.0.0.1", // bind interface (use "0.0.0.0" for all interfaces)
  apiPort: 3000, // server port
  // apiBaseUrl: "http://127.0.0.1:3000", // optional base URL used by injected scripts
  consoleLogClearInterval: 2000, // clear terminal every N console.log calls (0 disables)
};
```

Notes:
- `apiHost` controls which network interface Node binds to.
- `apiPort` controls the listening port.
- `apiBaseUrl` is optional and used by injected browser scripts for API calls.
- If `apiBaseUrl` is omitted and `apiHost` is `0.0.0.0`, injected scripts use `http://127.0.0.1:<apiPort>`.
- `consoleLogClearInterval` controls periodic terminal clear based on `console.log` count.

### Chrome

```js
module.exports = {
  browser: "chrome",
  capabilities: {
    "goog:chromeOptions": {
      args: ["--start-maximized"]
    }
  }
};
```

#### Chrome Headless

```js
module.exports = {
  browser: "chrome",
  capabilities: {
    "goog:chromeOptions": {
      args: ["--headless=new", "--window-size=1920,1080"]
    }
  }
};
```

#### Chrome with Multiple Options

```js
module.exports = {
  browser: "chrome",
  capabilities: {
    "goog:chromeOptions": {
      args: [
        "--start-maximized",
        "--disable-notifications",
        "--disable-popup-blocking",
        "--incognito"
      ]
    }
  }
};
```

### Edge

```js
module.exports = {
  browser: "edge",
  capabilities: {
    "ms:edgeOptions": {
      args: ["--start-maximized"]
    }
  }
};
```

#### Edge Headless

```js
module.exports = {
  browser: "edge",
  capabilities: {
    "ms:edgeOptions": {
      args: ["--headless=new", "--window-size=1920,1080"]
    }
  }
};
```

#### Edge InPrivate Mode

```js
module.exports = {
  browser: "edge",
  capabilities: {
    "ms:edgeOptions": {
      args: ["--start-maximized", "--inprivate"]
    }
  }
};
```

### Firefox

```js
module.exports = {
  browser: "firefox",
  capabilities: {
    "moz:firefoxOptions": {
      args: ["-width=1920", "-height=1080"]
    }
  }
};
```

#### Firefox Headless

```js
module.exports = {
  browser: "firefox",
  capabilities: {
    "moz:firefoxOptions": {
      args: ["-headless", "-width=1920", "-height=1080"]
    }
  }
};
```

#### Firefox Private Browsing

```js
module.exports = {
  browser: "firefox",
  capabilities: {
    "moz:firefoxOptions": {
      args: ["-private"]
    }
  }
};
```

### Empty Capabilities

```js
module.exports = {
  browser: "chrome",
  capabilities: {}
};
```

## Injected Browser API (`window.aj__webdriver`)

Scripts from the `common/` folder are injected into page/iframe targets. After injection, helper methods are available in the browser context via `window.aj__webdriver`.

All API methods return a Promise unless noted.

### Session

```js
await aj__webdriver.status();
await aj__webdriver.close_session(); // closes browser + tool process
await aj__webdriver.reinject(); // reinject all common/*.js scripts
```

### Timeouts

```js
await aj__webdriver.get_timeouts();
await aj__webdriver.set_timeouts({ script: 30000, pageLoad: 60000, implicit: 5000 });
```

### Navigation

```js
await aj__webdriver.navigate_to("https://example.com");
await aj__webdriver.get_current_url();
await aj__webdriver.back();
await aj__webdriver.forward();
await aj__webdriver.refresh();
await aj__webdriver.get_title();
```

### Window

```js
await aj__webdriver.get_window_handle();
await aj__webdriver.get_window_handles();
await aj__webdriver.switch_to_window("window-handle-id");
await aj__webdriver.new_window("tab"); // or "window"
await aj__webdriver.get_window_rect();
await aj__webdriver.set_window_rect({ x: 0, y: 0, width: 1280, height: 720 });
await aj__webdriver.maximize_window();
await aj__webdriver.minimize_window();
await aj__webdriver.fullscreen_window();
await aj__webdriver.close_window();
```

### Frame

```js
const frameEl = document.querySelector("iframe");
await aj__webdriver.switch_to_frame(frameEl);
await aj__webdriver.switch_to_parent_frame();
```

### Element

```js
const el = document.querySelector("#username");
const activeEl = aj__webdriver.get_active_element(); // sync return (DOM element)

await aj__webdriver.is_element_selected(el);
await aj__webdriver.get_element_attribute(el, "placeholder");
await aj__webdriver.get_element_property(el, "value");
await aj__webdriver.get_element_css_value(el, "color");
await aj__webdriver.get_element_text(el);
await aj__webdriver.get_element_tag_name(el);
await aj__webdriver.get_element_rect(el);
await aj__webdriver.is_element_enabled(el);
await aj__webdriver.element_click(el);
await aj__webdriver.element_clear(el);
```

`element_send_keys` usage:

```js
await aj__webdriver.element_send_keys(el, "Hello world");
await aj__webdriver.element_send_keys(el, ["Hello", "SPACE", "ENTER"]);
```

Rules for `element_send_keys`:
- String input sends normal text.
- Array input checks each item.
- Exact Selenium `Key` enum name (`ENTER`, `SPACE`, `TAB`, etc.) sends a special key.
- Non-matching item is sent as text.

`element_send_combo_keys` usage:

```js
await aj__webdriver.element_send_combo_keys(el, ["CONTROL", "a", "DELETE"]);
```

Rules for `element_send_combo_keys`:
- Accepts a non-empty array.
- Each item must be a Selenium `Key` enum name or a single character.
- Sends `keyDown` left-to-right, then `keyUp` right-to-left.

### Document

```js
await aj__webdriver.get_page_source();
```

### Cookies

```js
await aj__webdriver.get_all_cookies();
await aj__webdriver.get_named_cookie("session_id");
await aj__webdriver.add_cookie({
  name: "test_cookie",
  value: "123",
  domain: "example.com",
  path: "/"
});
await aj__webdriver.delete_cookie("test_cookie");
await aj__webdriver.delete_all_cookies();
```

### Alerts

```js
await aj__webdriver.dismiss_alert();
await aj__webdriver.accept_alert();
await aj__webdriver.get_alert_text();
await aj__webdriver.send_alert_text("hello");
```

### Screenshot

```js
await aj__webdriver.take_screenshot();
```

### Interaction Chain

Create a chain:

```js
const chain = aj__webdriver.interaction_chain();
// or
const chain2 = new aj__webdriver.InteractionChain();
```

Rules:
- Element-based methods only accept DOM element objects (not selector strings or element ids).
- `toString()` returns the current steps as a JSON string.
- `perform()` executes current steps but does not clear them.
- Use `clearChain()` to clear steps and release temporary element mappings.

Supported methods:

```js
// Mouse click
chain.click();
chain.clickElement(element);
chain.clickElementOffset(element, x, y);

// Double click
chain.doubleClick();
chain.doubleClickElement(element);

// Context click
chain.contextClick();
chain.contextClickElement(element);

// Move
chain.moveToElement(element);
chain.moveToElementOffset(element, x, y);
chain.moveByOffset(x, y);

// Hold / release
chain.clickAndHold();
chain.clickAndHoldElement(element);
chain.release();
chain.releaseElement(element);

// Drag
chain.dragAndDrop(sourceElement, targetElement);
chain.dragAndDropBy(sourceElement, x, y);

// Keyboard / timing
chain.keyDown(key);
chain.keyUp(key);
chain.sendKeys(...keys);
chain.pause(ms);

// Chain lifecycle
chain.toString();
await chain.perform();
chain.clearChain();
```

Examples:

```js
// Example 1: fill and submit
const username = document.querySelector("#username");
const submit = document.querySelector("button[type='submit']");

const chain = aj__webdriver.interaction_chain()
  .clickElement(username)
  .sendKeys("john.doe")
  .pause(150)
  .clickElement(submit);

console.log(chain.toString());
await chain.perform();
chain.clearChain();
```

```js
// Example 2: drag source to target
const source = document.querySelector(".drag-item");
const target = document.querySelector(".drop-zone");

const chain = aj__webdriver.interaction_chain()
  .dragAndDrop(source, target);

await chain.perform();
chain.clearChain();
```

```js
// Example 3: Ctrl+A then Delete
const editor = document.querySelector("#editor");

const chain = aj__webdriver.interaction_chain()
  .clickElement(editor)
  .keyDown("CONTROL")
  .sendKeys("a")
  .keyUp("CONTROL")
  .sendKeys("DELETE");

await chain.perform();
chain.clearChain();
```

### Notes

- `aj__webdriver.elem_repo` is internal state used for temporary element tracking.
- `aj__webdriver.interaction_chain()` is the recommended way to build and execute multi-step interactions.
