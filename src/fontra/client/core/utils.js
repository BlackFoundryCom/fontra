import { strFromU8, strToU8, unzlibSync, zlibSync } from "../third-party/fflate.js";
import { getCodePointFromGlyphName } from "./glyph-data.js";
import { Transform } from "./transform.js";

export function objectsEqual(obj1, obj2) {
  // Shallow object compare. Arguments may be null or undefined
  if (!obj1 || !obj2) {
    return obj1 === obj2;
  }
  const keys = Object.keys(obj1);
  if (keys.length !== Object.keys(obj2).length) {
    return false;
  }
  for (const key of keys) {
    if (obj1[key] !== obj2[key]) {
      return false;
    }
  }
  return true;
}

export function withSavedState(context, func) {
  context.save();
  try {
    func();
  } finally {
    context.restore();
  }
}

export function consolidateCalls(func) {
  // Return a function that will request `func` to be called in the next
  // iteration of the event loop. If it gets called again before `func` was
  // actually called, ignore the call.
  // This ensures that multiple calls within the same event loop cycle get
  // consolidated into a single call.
  // Useful for things like "request update".
  let didSchedule = false;

  return (...args) => {
    if (!didSchedule) {
      didSchedule = true;
      setTimeout(() => {
        didSchedule = false;
        func(...args);
      }, 0);
    } else {
    }
  };
}

export function scheduleCalls(func, timeout = 0) {
  // Schedule calls to func with a timer. If a previously scheduled call
  // has not yet run, cancel it and let the new one override it.
  // Returns a wrapped function that should be called instead of func.
  // This is useful for calls triggered by events that can supersede
  // previous calls; it avoids scheduling many redundant tasks.
  let timeoutID = null;
  return (...args) => {
    if (timeoutID !== null) {
      clearTimeout(timeoutID);
    }
    timeoutID = setTimeout(() => {
      timeoutID = null;
      func(...args);
    }, timeout);
    return timeoutID;
  };
}

export function throttleCalls(func, minTime) {
  // Return a wrapped function. If the function gets called before
  // minTime (in ms) has elapsed since the last call, don't call
  // the function.
  let lastTime = 0;
  let timeoutID = null;
  return (...args) => {
    if (timeoutID !== null) {
      clearTimeout(timeoutID);
      timeoutID = null;
    }
    const now = Date.now();
    if (now - lastTime > minTime) {
      func(...args);
      lastTime = now;
    } else {
      // Ensure that the wrapped function gets called eventually,
      // in the case that no superceding calls come soon enough.
      timeoutID = setTimeout(() => {
        timeoutID = null;
        func(...args);
      }, minTime);
    }
    return timeoutID;
  };
}

export function parseCookies(str) {
  // https://www.geekstrick.com/snippets/how-to-parse-cookies-in-javascript/
  if (!str.trim()) {
    return {};
  }
  return str
    .split(";")
    .filter((s) => s)
    .map((v) => v.split("="))
    .reduce((acc, v) => {
      acc[decodeURIComponent(v[0].trim())] = decodeURIComponent(v[1].trim());
      return acc;
    }, {});
}

export function capitalizeFirstLetter(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function hyphenatedToCamelCase(s) {
  return s.replace(/-([a-z])/g, (m) => m[1].toUpperCase());
}

export function hyphenatedToLabel(s) {
  return capitalizeFirstLetter(s).replaceAll("-", " ");
}

// platform is deprecated, please see:
// https://developer.mozilla.org/en-US/docs/Web/API/Navigator/platform
// export const isMac = typeof navigator !== "undefined" && navigator.platform.toLowerCase().indexOf("mac") >= 0

// Therefore use window.navigator https://developer.mozilla.org/en-US/docs/Web/API/Window/navigator
export const isMac =
  typeof navigator !== "undefined" && navigator.userAgent.indexOf("Mac") != -1;

// For several functions, we use the command key ("metaKey") on macOS,
// and the control key ("ctrlKey") on non-macOS. For example short cuts
// and selection behavior.
export const commandKeyProperty = isMac ? "metaKey" : "ctrlKey";

export const arrowKeyDeltas = {
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

export function modulo(v, n) {
  // Modulo with Python behavior for negative values of `v`
  // Assumes `n` to be positive
  return v >= 0 ? v % n : ((v % n) + n) % n;
}

export function boolInt(v) {
  // Return 1 if `v` is true-y, 0 if `v` is false-y
  return v ? 1 : 0;
}

export function* reversed(seq) {
  // Like Python's reversed(seq) builtin
  for (let i = seq.length - 1; i >= 0; i--) {
    yield seq[i];
  }
}

export function* enumerate(iterable, start = 0) {
  let i = start;
  for (const item of iterable) {
    yield [i, item];
    i++;
  }
}

export function* reversedEnumerate(seq) {
  for (let i = seq.length - 1; i >= 0; i--) {
    yield [i, seq[i]];
  }
}

export function* range(start, stop, step = 1) {
  if (stop === undefined) {
    stop = start;
    start = 0;
  }
  if (step > 0) {
    for (let i = start; i < stop; i += step) {
      yield i;
    }
  } else if (step < 0) {
    for (let i = start; i > stop; i += step) {
      yield i;
    }
  }
}

export function* chain(...iterables) {
  // After Python's itertools.chain()
  for (const iterable of iterables) {
    for (const item of iterable) {
      yield item;
    }
  }
}

export function* product(...args) {
  // Cartesian product of input iterables.  Equivalent to nested for-loops.
  // After Python's itertools.product()
  if (!args.length) {
    yield [];
    return;
  }
  const first = args[0];
  args = args.slice(1);
  if (args.length) {
    for (const v of first) {
      const prod = [...product(...args)];
      for (const w of prod) {
        yield [v, ...w];
      }
    }
  } else {
    for (const v of first) {
      yield [v];
    }
  }
}

export function parseSelection(selection) {
  const result = {};
  for (const item of selection) {
    const [tp, index] = item.split("/");
    if (result[tp] === undefined) {
      result[tp] = [];
    }
    result[tp].push(parseInt(index));
  }
  for (const indices of Object.values(result)) {
    // Ensure indices are sorted
    indices.sort((a, b) => a - b);
  }
  return result;
}

export function makeUPlusStringFromCodePoint(codePoint) {
  if (codePoint && typeof codePoint != "number") {
    throw new Error(
      `codePoint argument must be a number or falsey; ${typeof codePoint} found`
    );
  }
  return typeof codePoint == "number"
    ? "U+" + codePoint.toString(16).toUpperCase().padStart(4, "0")
    : "";
}

export async function writeToClipboard(clipboardObject) {
  if (!clipboardObject) return;

  const clipboardItemObject = {};
  for (const [key, value] of Object.entries(clipboardObject)) {
    if (value instanceof Blob) {
      assert(key === value.type);
      clipboardItemObject[key] = value;
    } else {
      clipboardItemObject[key] = new Blob([value], { type: key });
    }
  }

  try {
    await navigator.clipboard.write([new ClipboardItem(clipboardItemObject)]);
  } catch (error) {
    // Write at least the plain/text MIME type to the clipboard
    if (clipboardObject["text/plain"]) {
      await navigator.clipboard.writeText(clipboardObject["text/plain"]);
    }
  }
}

export async function readClipboardTypes() {
  const clipboardContents = await navigator.clipboard.read();
  const clipboardTypes = [];
  for (const item of clipboardContents) {
    clipboardTypes.push(...item.types);
  }
  return clipboardTypes;
}

export async function readFromClipboard(type, plainText = true) {
  const clipboardContents = await navigator.clipboard.read();
  for (const item of clipboardContents) {
    if (item.types.includes(type)) {
      const blob = await item.getType(type);
      return plainText ? await blob.text() : blob;
    }
  }
  return undefined;
}

export function getCharFromCodePoint(codePoint) {
  return codePoint != undefined ? String.fromCodePoint(codePoint) : "";
}

export function guessCharFromGlyphName(glyphName) {
  // Search for a 4-5 char hex string in the glyph name.
  // Interpret the hex string as a unicode code point and convert to a
  // character. Else, return an empty string.
  const match = glyphName.match(/(^|[^0-9A-F])([0-9A-F]{4,5})($|[^0-9A-F])/);
  return match ? String.fromCodePoint(parseInt(match[2], 16)) : "";
}

export async function fetchJSON(url, options) {
  const response = await fetch(url, options);
  return await response.json();
}

export function isActiveElementTypeable() {
  const element = findNestedActiveElement(document.activeElement);

  if (element.contentEditable === "true") {
    return true;
  }
  if (element.tagName.toLowerCase() === "textarea") {
    return true;
  }
  if (element.tagName.toLowerCase() === "input" && element.type !== "range") {
    return true;
  }
  return false;
}

export function findNestedActiveElement(element) {
  // If the element element is part of a Web Component's Shadow DOM, take
  // *its* active element, recursively.
  if (!element) {
    element = document.activeElement;
  }
  return element.shadowRoot && element.shadowRoot.activeElement
    ? findNestedActiveElement(element.shadowRoot.activeElement)
    : element;
}

export function fileNameExtension(name) {
  return name.split(".").pop();
}

const ARRAY_EXTEND_CHUNK_SIZE = 1024;

export function arrayExtend(thisArray, itemsArray) {
  // arrayExtend() is meant as a JS version of Python's list.extend().
  // array.push(...items) has an implementation-defined upper limit
  // in terms of numbers of items (the call stack will overflow).
  // Yet, array.push(...items) is presumably more efficient than pushing
  // items one by one, therefore we try to compromise: push the items in
  // chunks of a safe size.
  for (const i of range(0, itemsArray.length, ARRAY_EXTEND_CHUNK_SIZE)) {
    thisArray.push(...itemsArray.slice(i, i + ARRAY_EXTEND_CHUNK_SIZE));
  }
}

export function rgbaToCSS(rgba) {
  const channels = rgba.slice(0, 3).map((channel) => Math.round(channel * 255));
  const alpha = rgba[3];
  if (alpha !== undefined && 0 <= alpha && alpha < 1) {
    channels.push(alpha);
  }
  return `rgb(${channels.join(",")})`;
}

export function hexToRgba(hexColor) {
  let c = hexColor.substring(1).split("");
  let r = [];
  if (/^#[A-Fa-f0-9]{8}$/.test(hexColor) || /^#[A-Fa-f0-9]{6}$/.test(hexColor)) {
    for (const i of range(0, c.length, 2)) {
      r.push(round(parseInt(c[i] + c[i + 1], 16) / 255, 4));
    }
  } else if (/^#[A-Fa-f0-9]{4}$/.test(hexColor) || /^#[A-Fa-f0-9]{3}$/.test(hexColor)) {
    for (const i of range(c.length)) {
      r.push(round(parseInt(c[i] + c[i], 16) / 255, 4));
    }
  } else {
    throw new Error(
      "Bad hex color format. Should be #RRGGBB or #RRGGBBAA or #RGB or #RGBA"
    );
  }
  if (r.length === 3) {
    r.push(1);
  }
  return r;
}

export function rgbaToHex(rgba) {
  if (rgba.length != 3 && rgba.length != 4) {
    throw new Error("rgba argument has to have 3 or 4 items in array");
  }
  const channels = rgba.map((channel) =>
    Math.round(channel * 255)
      .toString(16)
      .padStart(2, "0")
  );
  if (channels[3] === "ff") {
    channels.pop();
  }
  return `#${channels.join("")}`;
}

export function clamp(number, min, max) {
  return Math.max(Math.min(number, max), min);
}

const _digitFactors = [1, 10, 100, 1000, 10000];

export function round(number, nDigits = 0) {
  if (nDigits === 0) {
    return Math.round(number);
  }
  const factor = _digitFactors[nDigits];
  if (!factor) {
    throw new RangeError("nDigits out of range");
  }
  return Math.round(number * factor) / factor;
}

export function unionIndexSets(...indexSets) {
  indexSets = indexSets.filter((item) => !!item);
  return [...new Set(indexSets.flat())].sort((a, b) => a - b);
}

export function withTimeout(thenable, timeout) {
  // Return a promise that resolves when `thenable` resolves before
  // `timeout` ms have passed, or else gets rejected with an error.
  // Example:
  // try {
  //   await withTimeout(somePromise, 1000);
  // catch (error) {
  //   // the promise timed out
  // }
  return new Promise((resolve, reject) => {
    const timerID = setTimeout(() => reject(new Error("timeout")), timeout);
    thenable.then(() => {
      clearTimeout(timerID);
      resolve();
    });
  });
}

export function memoize(func) {
  const cache = new Map();
  return (...args) => {
    const cacheKey = JSON.stringify(args);
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }
    const result = func(...args);
    cache.set(cacheKey, result);
    return result;
  };
}

export function escapeHTMLCharacters(dangerousString) {
  const encodedSymbolMap = {
    // '"': '&quot;',
    // '\'': '&#39;',
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
  };
  const dangerousCharacters = dangerousString.split("");
  const safeCharacters = dangerousCharacters.map(
    (character) => encodedSymbolMap[character] || character
  );
  return safeCharacters.join("");
}

export function* zip(...args) {
  const iterators = args.map((arg) => iter(arg));
  while (true) {
    const results = iterators.map((it) => it.next());
    if (results.some((r) => r.done)) {
      if (!results.every((r) => r.done)) {
        throw new Error("zip: input arguments have different lengths");
      }
      break;
    }
    yield results.map((r) => r.value);
  }
}

export function* iter(iterable) {
  for (const item of iterable) {
    yield item;
  }
}

export function splitGlyphNameExtension(glyphName, separator = ".") {
  const periodIndex = glyphName.indexOf(separator);
  const baseGlyphName = periodIndex >= 1 ? glyphName.slice(0, periodIndex) : glyphName;
  const extension = periodIndex >= 1 ? glyphName.slice(periodIndex) : "";
  return [baseGlyphName, extension];
}

export function getBaseGlyphName(glyphName) {
  const i = glyphName.indexOf(".");
  return i >= 1 ? glyphName.slice(0, i) : glyphName;
}

export function getGlyphNameExtension(glyphName) {
  const i = glyphName.lastIndexOf(".");
  return i >= 1 ? glyphName.slice(i) : "";
}

export function isObjectEmpty(obj) {
  // Return true if `obj` has no properties
  for (const _ in obj) {
    return false;
  }
  return true;
}

export async function timeIt(func, label) {
  const t = performance.now();
  const returnValue = await func();
  const elapsed = round(performance.now() - t, 1);
  console.log(`time elapsed for ${label}: ${elapsed} ms`);
  return returnValue;
}

export function base64ToBytes(base64) {
  const binString = atob(base64);
  return Uint8Array.from(binString, (m) => m.codePointAt(0));
}

export function bytesToBase64(bytes) {
  const binString = String.fromCodePoint(...bytes);
  return btoa(binString);
}

export function loadURLFragment(fragment) {
  if (fragment[0] != "#") {
    throw new Error("assert -- invalid fragment");
  }
  try {
    return JSON.parse(strFromU8(unzlibSync(base64ToBytes(fragment.slice(1)))));
  } catch {
    return null;
  }
}

export function dumpURLFragment(obj) {
  return "#" + bytesToBase64(zlibSync(strToU8(JSON.stringify(obj))));
}

export function readObjectFromURLFragment() {
  const url = new URL(window.location);
  return url.hash ? loadURLFragment(url.hash) : {};
}

export function writeObjectToURLFragment(obj, replace = false) {
  const newFragment = dumpURLFragment(obj);
  const url = new URL(window.location);
  if (url.hash === newFragment) {
    return;
  }
  url.hash = newFragment;
  if (replace) {
    window.history.replaceState({}, "", url);
  } else {
    window.history.pushState({}, "", url);
  }
}

export function areGuidelinesCompatible(parents) {
  const referenceGuidelines = parents[0].guidelines;
  if (!referenceGuidelines) {
    return false;
  }

  for (const parent of parents.slice(1)) {
    if (parent.guidelines?.length !== referenceGuidelines.length) {
      return false;
    }
    for (const guidelineIndex in referenceGuidelines) {
      if (
        parent.guidelines[guidelineIndex].name !==
        referenceGuidelines[guidelineIndex].name
      ) {
        return false;
      }
    }
  }
  return true;
}

export function areCustomDatasCompatible(parents) {
  const referenceCustomData = parents[0].customData;
  if (!referenceCustomData) {
    return false;
  }
  const referenceKeys = Object.keys(referenceCustomData).sort();

  for (const parent of parents.slice(1)) {
    const keys = Object.keys(parent.customData).sort();
    if (keys.length !== referenceKeys.length) {
      return false;
    }
    for (const [kA, kB] of zip(keys, referenceKeys)) {
      if (kA != kB) {
        return false;
      }
    }
  }
  return true;
}

const identityGuideline = { x: 0, y: 0, angle: 0 };

export function normalizeGuidelines(guidelines, resetLocked = false) {
  return guidelines.map((guideline) => {
    return {
      ...identityGuideline,
      ...guideline,
      locked: resetLocked ? false : !!guideline.locked,
    };
  });
}

export function mapObjectValues(obj, func) {
  // Return a copy of the object, with each value passed through `func`
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [key, func(value)])
  );
}

export async function mapObjectValuesAsync(obj, func) {
  // Return a copy of the object, with each value passed through `func`
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = await func(value);
  }
  return result;
}

let _uniqueID = 1;
export function uniqueID() {
  return _uniqueID++;
}

export function assert(condition, message) {
  if (!condition) {
    throw new Error(`assert failed${message ? ` -- ${message}` : ""}`);
  }
}

export function pointCompareFunc(pointA, pointB) {
  let d = pointA.x - pointB.x;
  if (Math.abs(d) < 0.00000001) {
    d = pointA.y - pointB.y;
  }
  return d;
}

export function sleepAsync(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function readFileOrBlobAsDataURL(fileOrBlob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(fileOrBlob);
  });
}

export function colorizeImage(inputImage, color) {
  const w = inputImage.naturalWidth;
  const h = inputImage.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext("2d");

  // First step, draw the image
  context.drawImage(inputImage, 0, 0, w, h);
  // Second step, reduce saturation to zero (making the image grayscale)
  context.fillStyle = "black";
  context.globalCompositeOperation = "saturation";
  context.fillRect(0, 0, w, h);
  // Last step, colorize the image, using screen (inverse multiply)
  context.fillStyle = color;
  context.globalCompositeOperation = "screen";
  context.fillRect(0, 0, w, h);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      const outputImage = new Image();
      outputImage.width = inputImage.width;
      outputImage.height = inputImage.height;
      const url = URL.createObjectURL(blob);
      outputImage.onload = () => {
        URL.revokeObjectURL(url);
        resolve(outputImage);
      };
      outputImage.src = url;
    });
  });
}

export class FocusKeeper {
  get save() {
    // Return a bound method that can be used as an event handler
    return (event) => {
      this._focusedElement = findNestedActiveElement();
    };
  }

  restore() {
    this._focusedElement?.focus();
  }
}

export function glyphMapToItemList(glyphMap) {
  return Object.entries(glyphMap).map(([glyphName, codePoints]) => ({
    glyphName,
    codePoints,
    associatedCodePoints: getAssociatedCodePoints(glyphName, glyphMap),
  }));
}

export function getAssociatedCodePoints(glyphName, glyphMap) {
  return getBaseGlyphName(glyphName)
    .split("_")
    .filter((baseGlyphName) => baseGlyphName !== glyphName)
    .map((baseGlyphName) => glyphMap[baseGlyphName]?.[0])
    .filter((codePoint) => codePoint);
}

export function getCodePointFromGlyphItem(glyphItem) {
  return glyphItem.codePoints[0] || glyphItem.associatedCodePoints[0];
}

export function bisect_right(a, x) {
  // Return the index where to insert item x in list a, assuming a is sorted.
  //
  // The return value i is such that all e in a[:i] have e <= x, and all e in
  // a[i:] have e > x.  So if x already appears in the list, a.insert(i, x) will
  // insert just after the rightmost x already there.
  //
  // Optional args lo (default 0) and hi (default len(a)) bound the
  // slice of a to be searched.
  //
  // A custom key function can be supplied to customize the sort order.

  // This is adapted from the Python implementation

  let lo = 0;
  let hi = a.length;

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (x < a[mid]) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }

  return lo;
}

export const friendlyHttpStatus = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  203: "Non-Authoritative Information",
  204: "No Content",
  205: "Reset Content",
  206: "Partial Content",
  300: "Multiple Choices",
  301: "Moved Permanently",
  302: "Found",
  303: "See Other",
  304: "Not Modified",
  305: "Use Proxy",
  306: "Unused",
  307: "Temporary Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  407: "Proxy Authentication Required",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  411: "Length Required",
  412: "Precondition Required",
  413: "Request Entry Too Large",
  414: "Request-URI Too Long",
  415: "Unsupported Media Type",
  416: "Requested Range Not Satisfiable",
  417: "Expectation Failed",
  418: "I'm a teapot",
  429: "Too Many Requests",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
  505: "HTTP Version Not Supported",
};
