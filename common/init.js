window.selenium_debugger_injected = true;
console.log(`selenium_debugger_injected: true, target_id: ${window.selenium_debugger_target_id}`);

const AJ_API_BASE = (function() {
  if (window.selenium_debugger_api_base) {
    return window.selenium_debugger_api_base;
  }
  try {
    const storedBase = localStorage.getItem("selenium_debugger_api_base");
    if (storedBase) {
      return storedBase;
    }
  } catch (e) {
    // Ignore localStorage access failures in restricted contexts.
  }
  return "http://localhost:3000";
})();

// Helper function to call API
async function aj__api(endpoint, method = "GET", body = null) {
  const options = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(`${AJ_API_BASE}${endpoint}`, options);
  return res.json();
}

function aj__generate_elem_id() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

// Helper function to set aj-target on an element and save it in elem_repo
function aj__set_target(element) {
  if (!element) {
    return null;
  }

  const repo = window.aj__webdriver?.elem_repo;
  if (!repo) {
    return null;
  }

  let elemId = null;
  for (const [existingId, existingElement] of Object.entries(repo)) {
    if (existingElement === element) {
      elemId = existingId;
      break;
    }
  }

  if (!elemId) {
    elemId = aj__generate_elem_id();
  }

  repo[elemId] = element;
  element.setAttribute("aj-target", elemId);
  return elemId;
}

function aj__clear_target(elemId) {
  if (!elemId || !window.aj__webdriver?.elem_repo) {
    return;
  }

  const element = window.aj__webdriver.elem_repo[elemId];
  if (element && typeof element.removeAttribute === "function") {
    element.removeAttribute("aj-target");
  }
  delete window.aj__webdriver.elem_repo[elemId];
}

function aj__with_target(element, requestFactory) {
  const elemId = aj__set_target(element);
  const request = requestFactory(elemId);
  return Promise.resolve(request).finally(function() {
    aj__clear_target(elemId);
  });
}

// WebDriver API helper functions (https://www.w3.org/TR/webdriver2/#endpoints)
window.aj__webdriver = {
  elem_repo: {},

  // Session
  status: function() {
    return aj__api("/status");
  },
  close_session: function() {
    return aj__api("/close_session", "POST");
  },
  reinject: function() {
    return aj__api("/reinject", "POST");
  },

  // Timeouts
  get_timeouts: function() {
    return aj__api("/get_timeouts");
  },
  set_timeouts: function(timeouts) {
    return aj__api("/set_timeouts", "POST", timeouts);
  },

  // Navigation
  navigate_to: function(url) {
    return aj__api("/navigate_to", "POST", { url });
  },
  get_current_url: function() {
    return aj__api("/get_current_url");
  },
  back: function() {
    return aj__api("/back", "POST");
  },
  forward: function() {
    return aj__api("/forward", "POST");
  },
  refresh: function() {
    return aj__api("/refresh", "POST");
  },
  get_title: function() {
    return aj__api("/get_title");
  },

  // Window
  get_window_handle: function() {
    return aj__api("/get_window_handle");
  },
  close_window: function() {
    return aj__api("/close_window", "DELETE");
  },
  switch_to_window: function(handle) {
    return aj__api("/switch_to_window", "POST", { handle });
  },
  get_window_handles: function() {
    return aj__api("/get_window_handles");
  },
  new_window: function(type = "tab") {
    return aj__api("/new_window", "POST", { type });
  },
  get_window_rect: function() {
    return aj__api("/get_window_rect");
  },
  set_window_rect: function(rect) {
    return aj__api("/set_window_rect", "POST", rect);
  },
  maximize_window: function() {
    return aj__api("/maximize_window", "POST");
  },
  minimize_window: function() {
    return aj__api("/minimize_window", "POST");
  },
  fullscreen_window: function() {
    return aj__api("/fullscreen_window", "POST");
  },

  // Frame
  switch_to_frame: function(element) {
    return aj__with_target(element, function(elemId) {
      return aj__api("/switch_to_frame", "POST", { targetId: window.selenium_debugger_target_id, elemId });
    });
  },
  switch_to_parent_frame: function() {
    return aj__api("/switch_to_parent_frame", "POST");
  },

  // Element
  get_active_element: function() {
    return document.activeElement;
  },
  is_element_selected: function(element) {
    return aj__with_target(element, function(elemId) {
      return aj__api("/is_element_selected", "POST", { targetId: window.selenium_debugger_target_id, elemId });
    });
  },
  get_element_attribute: function(element, name) {
    return aj__with_target(element, function(elemId) {
      return aj__api("/get_element_attribute", "POST", { targetId: window.selenium_debugger_target_id, elemId, name });
    });
  },
  get_element_property: function(element, name) {
    return aj__with_target(element, function(elemId) {
      return aj__api("/get_element_property", "POST", { targetId: window.selenium_debugger_target_id, elemId, name });
    });
  },
  get_element_css_value: function(element, propertyName) {
    return aj__with_target(element, function(elemId) {
      return aj__api("/get_element_css_value", "POST", { targetId: window.selenium_debugger_target_id, elemId, propertyName });
    });
  },
  get_element_text: function(element) {
    return aj__with_target(element, function(elemId) {
      return aj__api("/get_element_text", "POST", { targetId: window.selenium_debugger_target_id, elemId });
    });
  },
  get_element_tag_name: function(element) {
    return aj__with_target(element, function(elemId) {
      return aj__api("/get_element_tag_name", "POST", { targetId: window.selenium_debugger_target_id, elemId });
    });
  },
  get_element_rect: function(element) {
    return aj__with_target(element, function(elemId) {
      return aj__api("/get_element_rect", "POST", { targetId: window.selenium_debugger_target_id, elemId });
    });
  },
  is_element_enabled: function(element) {
    return aj__with_target(element, function(elemId) {
      return aj__api("/is_element_enabled", "POST", { targetId: window.selenium_debugger_target_id, elemId });
    });
  },
  element_click: function(element) {
    return aj__with_target(element, function(elemId) {
      return aj__api("/element_click", "POST", { targetId: window.selenium_debugger_target_id, elemId });
    });
  },
  element_clear: function(element) {
    return aj__with_target(element, function(elemId) {
      return aj__api("/element_clear", "POST", { targetId: window.selenium_debugger_target_id, elemId });
    });
  },
  element_send_keys: function(element, value) {
    return aj__with_target(element, function(elemId) {
      return aj__api("/element_send_keys", "POST", { targetId: window.selenium_debugger_target_id, elemId, value });
    });
  },
  element_send_combo_keys: function(element, keys) {
    return aj__with_target(element, function(elemId) {
      return aj__api("/element_send_combo_keys", "POST", { targetId: window.selenium_debugger_target_id, elemId, keys });
    });
  },

  // Document
  get_page_source: function() {
    return aj__api("/get_page_source");
  },


  // Cookies
  get_all_cookies: function() {
    return aj__api("/get_all_cookies");
  },
  get_named_cookie: function(name) {
    return aj__api(`/get_named_cookie/${encodeURIComponent(name)}`);
  },
  add_cookie: function(cookie) {
    return aj__api("/add_cookie", "POST", { cookie });
  },
  delete_cookie: function(name) {
    return aj__api(`/delete_cookie/${encodeURIComponent(name)}`, "DELETE");
  },
  delete_all_cookies: function() {
    return aj__api("/delete_all_cookies", "DELETE");
  },

  // Actions TBD
  perform_actions: function() {},
  release_actions: function() {},

  // Alerts
  dismiss_alert: function() {
    return aj__api("/dismiss_alert", "POST");
  },
  accept_alert: function() {
    return aj__api("/accept_alert", "POST");
  },
  get_alert_text: function() {
    return aj__api("/get_alert_text");
  },
  send_alert_text: function(text) {
    return aj__api("/send_alert_text", "POST", { text });
  },

  // Screenshot
  take_screenshot: function() {
    return aj__api("/take_screenshot");
  }
};


function getNativeFunctions() {
    return new Promise((resolve, reject) => {
        try {
            const existingFrame = document.getElementById('aj__helper_frame');

            if (existingFrame && existingFrame.contentWindow) {
                return resolve(extractNative(existingFrame.contentWindow));
            }

            const iframe = document.createElement('iframe');
            iframe.id = 'aj__helper_frame';
            iframe.style.display = 'none';
            iframe.style.visibility = 'hidden';

            const timeout = setTimeout(() => {
                reject(new Error('Iframe load timed out'));
            }, 10000);

            iframe.onload = () => {
                clearTimeout(timeout);
                resolve(extractNative(iframe.contentWindow));
            };

            document.documentElement.appendChild(iframe);
        } catch (e) {
            reject(e);
        }
    });
}

function extractNative(pristine) {
    return {
        // Core utilities
        fetch: pristine.fetch.bind(window),
        JSON_stringify: pristine.JSON.stringify.bind(pristine.JSON),
        JSON_parse: pristine.JSON.parse.bind(pristine.JSON),
        addEventListener: pristine.EventTarget.prototype.addEventListener.bind(pristine),
        removeEventListener: pristine.EventTarget.prototype.removeEventListener.bind(pristine),
        setTimeout: pristine.setTimeout.bind(pristine),
        clearTimeout: pristine.clearTimeout.bind(pristine),
        Object_defineProperty: pristine.Object.defineProperty.bind(pristine.Object),
        Object_getPrototypeOf: pristine.Object.getPrototypeOf.bind(pristine.Object),
        Math_random: pristine.Math.random.bind(pristine.Math),
        String_trim: pristine.String.prototype.trim.call.bind(pristine.String.prototype),

        // DOM accessors (UNBOUND — use with .call())
        querySelector: pristine.Element.prototype.querySelector,
        querySelectorAll: pristine.Element.prototype.querySelectorAll,
        document_querySelector: pristine.Document.prototype.querySelector,
        document_querySelectorAll: pristine.Document.prototype.querySelectorAll,
        getComputedStyle: pristine.getComputedStyle.bind(pristine),
        createElement: pristine.document.createElement.bind(pristine.document),
        Element_prototype_matches: pristine.Element.prototype.matches,
        Element_prototype_getBoundingClientRect: pristine.Element.prototype.getBoundingClientRect,
        Element_prototype_children: Object.getOwnPropertyDescriptor(pristine.Element.prototype, 'children')?.get,
        Node_prototype_childNodes: Object.getOwnPropertyDescriptor(pristine.Node.prototype, 'childNodes')?.get,

        // Object/Array helpers
        Array_from: pristine.Array.from.bind(pristine.Array),
        Object_keys: pristine.Object.keys.bind(pristine.Object),
        Object_entries: pristine.Object.entries.bind(pristine.Object),

        // Constants
        DOCUMENT_FRAGMENT_NODE: pristine.Node.DOCUMENT_FRAGMENT_NODE
    };
}
