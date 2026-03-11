# SeleniumDebugger

A Node.js app that launches Chrome, Edge, or Firefox using Selenium WebDriver based on configuration.

## Installation

```bash
npm install
```

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

### Notes

- `aj__webdriver.elem_repo` is internal state used for temporary element tracking.
- `perform_actions` and `release_actions` are placeholders and not implemented yet.
