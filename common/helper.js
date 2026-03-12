// Helper utilities using native functions from getNativeFunctions()
// These are safe from page tampering

const aj__ignoreTags = ['script', 'style', 'option'];

getNativeFunctions().then(function(native) {

  function querySelectorAll(selector, root = document, isVisible = false, visibilityBasedOnChildElems = false) {
    const resultSet = new Set();

    function traverse(node) {
      const children = getChildrenUnderRoot(node);

      for (const child of children) {
        if (native.Element_prototype_matches.call(child, selector)) {
          if (!isVisible || isVisibleFn(child, visibilityBasedOnChildElems)) {
            resultSet.add(child);
          }
        }

        traverse(child); // DFS
      }

      if (node !== root && node.matches && native.Element_prototype_matches.call(node, selector)) {
        if (!isVisible || isVisibleFn(node, visibilityBasedOnChildElems)) {
          resultSet.add(node);
        }
      }
    }

    traverse(root);
    return native.Array_from(resultSet);
  }

  function isVisibleFn(elem, visibilityBasedOnChildElems = false) {
    if (!(elem instanceof Element))
      return false;

    const style = native.getComputedStyle(elem);

    const isSelfVisible = (style.display !== 'none' && elem.offsetWidth > 0 && elem.offsetHeight > 0);

    if (isSelfVisible) {
      return true;
    }

    if (visibilityBasedOnChildElems) {
      const children = getChildrenUnderRoot(elem, true);
      for (const child of children) {
        if (isVisibleFn(child, visibilityBasedOnChildElems)) {
          return true;
        }
      }
    }
    return false;
  }

  function getEffectiveParent(elem) {
    if (elem.assignedSlot) {
      return elem.assignedSlot;
    }

    const parentNode = elem.parentNode;

    if (parentNode?.nodeType === Node.DOCUMENT_FRAGMENT_NODE && parentNode.host) {
      return parentNode.host;
    }

    return parentNode;
  }

  function getChildrenUnderRoot(elem, includeIgnoredTags = false) {
    let allElems = [];

    if (elem.shadowRoot) {
      const shadowChildren = native.Array_from(elem.shadowRoot.children);
      allElems = allElems.concat(shadowChildren);
    } else if (elem.tagName?.toLowerCase() === 'slot') {
      try {
        const slottedChildren = elem.assignedNodes();
        allElems = allElems.concat(slottedChildren);
      } catch (e) {
        // ignore
      }
    }

    const children = native.Array_from(elem.children);
    allElems = allElems.concat(children);

    if (!includeIgnoredTags) {
      allElems = removeIgnoredTags(allElems);
    }

    allElems = allElems.filter(child => getEffectiveParent(child) === elem);

    return allElems;
  }

  function removeIgnoredTags(elemArray) {
    return elemArray.filter(elem => {
      return !aj__ignoreTags.includes(elem.tagName?.toLowerCase());
    });
  }

  function getBoundingRect(element) {
    return native.Element_prototype_getBoundingClientRect.call(element);
  }

  function fetch(url, options) {
    return native.fetch(url, options);
  }

  function jsonStringify(obj, replacer = null, space = null) {
    return native.JSON_stringify(obj, replacer, space);
  }

  function jsonParse(str) {
    return native.JSON_parse(str);
  }

  function setTimeoutFn(callback, delay) {
    return native.setTimeout(callback, delay);
  }

  function clearTimeoutFn(id) {
    return native.clearTimeout(id);
  }

  function createElement(tagName) {
    return native.createElement(tagName);
  }

  // Set all functions to window.aj__dom
  window.aj__dom = {
    querySelectorAll: querySelectorAll,
    isVisible: isVisibleFn,
    getEffectiveParent: getEffectiveParent,
    getChildrenUnderRoot: getChildrenUnderRoot,
    removeIgnoredTags: removeIgnoredTags,
    getBoundingRect: getBoundingRect,
    fetch: fetch,
    jsonStringify: jsonStringify,
    jsonParse: jsonParse,
    setTimeout: setTimeoutFn,
    clearTimeout: clearTimeoutFn,
    createElement: createElement,
    native: native,
  };

  console.debug("[HELPER] aj__dom initialized with native functions in target_id:", window.selenium_debugger_target_id);
});
