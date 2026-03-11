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

## Configuration

Edit `config.js` to set the browser and capabilities.

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
