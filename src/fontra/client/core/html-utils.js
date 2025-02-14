// This is a tiny subset of a few things that Lit does, except it uses
// object notation to construct dom elements instead of HTML.

import { consolidateCalls } from "./utils.js";

export class SimpleElement extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._postInit();
  }

  _postInit() {
    this._attachStyles();
  }

  _attachStyles() {
    this._appendStyleSheetLink("/css/shared.css");
    if (this.constructor.styles) {
      this._appendStyle(this.constructor.styles);
    }
  }

  _appendStyle(cssText) {
    addStyleSheet(cssText, this.shadowRoot);
  }

  _appendStyleSheetLink(href) {
    addStyleSheetLink(href, this.shadowRoot);
  }

  appendStyle(cssText) {
    this._appendStyle(cssText);
  }
}

export class UnlitElement extends SimpleElement {
  _postInit() {
    this._additionalStyles = [];
    this._setupProperties();
    this.requestUpdate = consolidateCalls(() => this._render());
  }

  _attachStyles() {
    super._attachStyles();
    for (const style of this._additionalStyles) {
      this._appendStyle(style);
    }
  }

  appendStyle(cssText) {
    this._additionalStyles.push(cssText);
  }

  connectedCallback() {
    this._render();
  }

  _setupProperties() {
    this._propertyValues = {};
    for (const [prop, description] of Object.entries(
      this.constructor.properties || {}
    )) {
      Object.defineProperty(this, prop, {
        get: () => {
          return this._propertyValues[prop];
        },
        set: (value) => {
          if (
            description.type &&
            !(
              value?.constructor === description.type ||
              value instanceof description.type
            )
          ) {
            throw new TypeError(
              `${prop}: expected instance of ${description.type.name}, got ${value?.constructor.name}`
            );
          }
          this._propertyValues[prop] = value;
          this.requestUpdate();
        },
      });
    }
  }

  render() {
    //
    // Override, but don't call super().
    //
    // It should return a DOM Element, or an array of DOM Elements,
    // or arrays of arrays of DOM Elements, etc.
    //
    // Use createDomElement() to conveniently construct DOM Elements.
    //
  }

  async _render() {
    this.shadowRoot.innerHTML = "";
    this._attachStyles();

    let elements = await this.render();
    if (!elements) {
      return;
    }

    if (!Array.isArray(elements)) {
      elements = [elements];
    }
    elements = elements.flat();
    for (const element of elements) {
      this.shadowRoot.append(element);
    }
  }
}

const attrExceptions = { for: "htmlFor", class: "className", tabindex: "tabIndex" };

export function createDomElement(tagName, attributes, children) {
  const element = document.createElement(tagName);
  for (const [key, value] of Object.entries(attributes || {})) {
    if (key.slice(0, 5) === "data-") {
      element.dataset[key.slice(5)] = value;
    } else {
      element[attrExceptions[key] || key] = value;
    }
  }
  for (const child of children || []) {
    element.append(child);
  }
  return element;
}

export function htmlToElement(html) {
  var template = document.createElement("template");
  html = html.trim();
  template.innerHTML = html;
  if (template.content.childNodes.length !== 1) {
    throw new Error("The html should contain a single node");
  }
  return template.content.firstChild;
}

export function htmlToElements(html) {
  var template = document.createElement("template");
  html = html.trim();
  template.innerHTML = html;
  return template.content.childNodes;
}

export function addStyleSheet(cssText, element = null) {
  if (!element) {
    element = document.head;
  }
  element.appendChild(style({}, [cssText]));
}

export function addStyleSheetLink(href, element = null) {
  if (!element) {
    element = document.head;
  }
  element.appendChild(link({ href, rel: "stylesheet" }));
}

// Convenience shortcuts
export const a = createDomElement.bind(null, "a");
export const br = createDomElement.bind(null, "br");
export const button = createDomElement.bind(null, "button");
export const div = createDomElement.bind(null, "div");
export const form = createDomElement.bind(null, "form");
export const section = createDomElement.bind(null, "section");
export const input = createDomElement.bind(null, "input");
export const label = createDomElement.bind(null, "label");
export const span = createDomElement.bind(null, "span");
export const hr = createDomElement.bind(null, "hr");
export const link = createDomElement.bind(null, "link");
export const select = createDomElement.bind(null, "select");
export const option = createDomElement.bind(null, "option");
export const style = createDomElement.bind(null, "style");
export const details = createDomElement.bind(null, "details");
export const summary = createDomElement.bind(null, "summary");
// Let's add more once needed
