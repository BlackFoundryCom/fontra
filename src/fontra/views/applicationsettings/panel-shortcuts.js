import * as html from "../core/html-utils.js";
import { addStyleSheet } from "../core/html-utils.js";
import { BaseInfoPanel } from "./panel-base.js";
import {
  getActionIdentifiers,
  getActionInfo,
  getActionTitle,
  getBaseKeyFromKeyEvent,
  getShortCut,
  getShortCutRepresentation,
  getShortCuts,
  setCustomShortCuts,
  shortCutModifierMap,
} from "/core/actions.js";
import { translate } from "/core/localization.js";
import { commandKeyProperty, isMac } from "/core/utils.js";
import { IconButton } from "/web-components/icon-button.js"; // required for the icon buttons
import { dialog, message } from "/web-components/modal-dialog.js";

function getShortCutsGrouped() {
  const shortCutsGrouped = {};
  for (const actionIdentifier of getActionIdentifiers()) {
    const actionInfo = getActionInfo(actionIdentifier);
    const topic = actionInfo.topic || "9999-shortcuts.other";
    if (!shortCutsGrouped[topic]) {
      shortCutsGrouped[topic] = [];
    }
    shortCutsGrouped[topic].push(actionIdentifier);
  }

  // sort the actions by sortIndex
  for (const topic in shortCutsGrouped) {
    shortCutsGrouped[topic].sort((a, b) => {
      const actionInfoA = getActionInfo(a);
      const actionInfoB = getActionInfo(b);
      return actionInfoA.sortIndex - actionInfoB.sortIndex;
    });
  }

  return shortCutsGrouped;
}

addStyleSheet(`
.fontra-ui-shortcuts-panel {
  background-color: var(--ui-element-background-color);
  border-radius: 0.5em;
  padding: 1em;
}
.fontra-ui-shortcuts-panel-header {
  font-weight: bold;
}
.fontra-ui-shortcuts-panel-buttons {
  display: grid;
  grid-template-columns: max-content max-content max-content;
  gap: 1em;
}
`);

export class ShortCutsPanel extends BaseInfoPanel {
  static title = "application-settings.shortcuts.title";
  static id = "shortcuts-panel";

  async setupUI() {
    this.panelElement.innerHTML = "";

    this.panelElement.style = "gap: 1em;";

    const containerButtons = html.div(
      { class: "fontra-ui-shortcuts-panel-buttons" },
      []
    );
    containerButtons.appendChild(
      html.input({
        type: "button",
        class: "fontra-button",
        style: `justify-self: start;`,
        value: translate("shortcuts.reset-all"),
        onclick: (event) => this.resetToDefault(),
      })
    );

    containerButtons.appendChild(
      html.input({
        type: "button",
        class: "fontra-button",
        style: `justify-self: start;`,
        value: translate("shortcuts.export"),
        onclick: (event) => this.exportShortCuts(),
      })
    );

    containerButtons.appendChild(
      html.input({
        type: "button",
        class: "fontra-button",
        style: `justify-self: start;`,
        value: translate("shortcuts.import"),
        onclick: (event) => this.importShortCuts(),
      })
    );

    this.panelElement.appendChild(containerButtons);
    const shortCutsGrouped = getShortCutsGrouped();
    for (const topic of Object.keys(shortCutsGrouped).sort()) {
      const container = html.div({ class: "fontra-ui-shortcuts-panel" }, []);
      container.appendChild(
        html.createDomElement("div", {
          class: "fontra-ui-shortcuts-panel-header",
          innerHTML: translate(topic.slice(5)),
        })
      );
      for (const actionIdentifier of shortCutsGrouped[topic]) {
        container.appendChild(new ShortCutElement(actionIdentifier));
      }
      this.panelElement.appendChild(container);
    }
  }

  async resetToDefault() {
    const result = await dialog(
      translate("shortcuts.dialog.reset-all.title"),
      translate("shortcuts.dialog.reset-all.content"),
      [
        { title: translate("dialog.cancel"), isCancelButton: true },
        { title: translate("dialog.okay"), isDefaultButton: true },
      ]
    );
    if (!result) {
      return;
    }
    for (const actionIdentifier of getActionIdentifiers()) {
      setCustomShortCuts(actionIdentifier, null);
    }
    location.reload();
  }

  async exportShortCuts() {
    // Only export custom shortcuts,
    // because default shortcuts are already in the code.
    const shortCutsDataCustom = {};
    for (const actionIdentifier of getActionIdentifiers()) {
      const actionInfo = getActionInfo(actionIdentifier);
      const shortCuts = actionInfo.customShortCuts;
      if (!shortCuts) {
        continue;
      }
      shortCutsDataCustom[actionIdentifier] = shortCuts;
    }
    const data = JSON.stringify(shortCutsDataCustom, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "fontra-shortcuts.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  async importShortCuts() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (event) => {
      const file = event.target.files[0];
      if (!file) {
        return;
      }
      const reader = new FileReader();
      reader.onload = async (event) => {
        const data = JSON.parse(event.target.result);
        for (const actionIdentifier in data) {
          if (getActionInfo(actionIdentifier)) {
            setCustomShortCuts(actionIdentifier, data[actionIdentifier]);
          }
        }
        location.reload();
      };
      reader.readAsText(file);
    };
    input.click();
  }
}

function isShortCutDefinitionEqual(shortCutA, shortCutB) {
  if (!shortCutA || !shortCutB || shortCutA.baseKey !== shortCutB.baseKey) {
    return false;
  }

  const modifierProperties = ["commandKey", "ctrlKey", "altKey", "shiftKey", "metaKey"];

  for (const prop of modifierProperties) {
    if (!!shortCutA[prop] !== !!shortCutB[prop]) {
      return false;
    }
  }

  return true;
}

function validateShortCutDefinition(key, definition) {
  if (definition === null) {
    return [];
  }
  const warnings = [];
  for (const otherKey of getActionIdentifiers()) {
    if (key === otherKey) {
      // skip self
      continue;
    }
    for (const otherDefinition of getShortCuts(otherKey)) {
      if (isShortCutDefinitionEqual(otherDefinition, definition)) {
        warnings.push(
          `⚠️ ${translate(
            "application-settings.shortcuts.warning.exists",
            getActionTitle(otherKey)
          )}`
        );
        break;
      }
    }
  }

  return warnings;
}

const shortcutsPanelInputWidth = isMac ? "8em" : "12em"; // longer on windows because no icons are shown.
addStyleSheet(`
  .fontra-ui-shortcuts-panel-element {
    background-color: var(--ui-element-background-color);
    border-radius: 0.5em;
    padding: 0.35rem 0 0 0;
    display: grid;
    grid-template-rows: auto auto;
    grid-template-columns: max-content max-content max-content;
    grid-column-gap: 1em;
  }

  .fontra-ui-shortcuts-panel-icon-wrapper {
    display: grid;
    grid-template-columns: max-content max-content;
    grid-column-gap: 0.2em;
  }

  .fontra-ui-shortcuts-panel-input {
    min-width: ${shortcutsPanelInputWidth};
    text-align: center;
    background-color: var(--text-input-background-color);
    color: var(--text-input-foreground-color);
    border-radius: 0.25em;
    border: none;
    outline: none;
    padding: 0.1em 0.3em;
    font-family: "fontra-ui-regular";
    font-size: 100%;
    min-height: 18px;
    align-self: center;
  }

  .fontra-ui-shortcuts-panel-input:focus {
    box-shadow: inset 0px 0px 0px 1px var(--background-color-dark);
    outline: unset;
    color: #999;
  }

  .fontra-ui-shortcuts-panel-label {
    width: 18em;
    text-align: right;
  }

  .fontra-ui-shortcuts-panel-icon {
    cursor: pointer;
    opacity: 0;
    pointer-events: none;
  }

  .fontra-ui-shortcuts-panel-input:focus + .fontra-ui-shortcuts-panel-icon-wrapper .fontra-ui-shortcuts-panel-icon {
    pointer-events: unset;
    opacity: unset;
  }

  .fontra-ui-shortcuts-panel-icon:active {
    pointer-events: unset;
    opacity: unset;
  }

`);

class ShortCutElement extends HTMLElement {
  constructor(actionIdentifier) {
    super();
    this.classList.add("fontra-ui-shortcuts-panel-element");
    this.actionIdentifier = actionIdentifier;
    this.shortCutDefinition = getShortCut(this.actionIdentifier);
    this.shortCutLabel = getActionTitle(this.actionIdentifier);
    this.pressedKeys = new Set();
    this._updateContents();
  }

  saveShortCuts(newShortCutDefinitions) {
    if (!newShortCutDefinitions) {
      return false;
    }
    const warnings = [];
    for (const newShortCutDefinition of newShortCutDefinitions) {
      const warns = validateShortCutDefinition(
        this.actionIdentifier,
        newShortCutDefinition
      );
      for (const warn of warns) {
        warnings.push(warn);
      }
    }
    if (warnings.length > 0) {
      message(translate("shortcuts.dialog.warning.title"), warnings.join("\n"));
      return false;
    }
    setCustomShortCuts(this.actionIdentifier, newShortCutDefinitions);
    this.shortCutDefinition = getShortCut(this.actionIdentifier);
    return true;
  }

  getPressedKey(event) {
    const baseKey = getBaseKeyFromKeyEvent(event);
    if (baseKey.startsWith("Meta")) {
      return "metaKey";
    } else if (baseKey.startsWith("Shift")) {
      return "shiftKey";
    } else if (baseKey.startsWith("Alt")) {
      return "altKey";
    } else if (baseKey.startsWith("Control")) {
      return "ctrlKey";
    }

    return baseKey;
  }

  getShortCutDefinition() {
    const shortCutDefinition = {};
    Array.from(this.pressedKeys).forEach((item) => {
      if (shortCutModifierMap.hasOwnProperty(item)) {
        if (commandKeyProperty === item) {
          shortCutDefinition.commandKey = true;
        } else {
          shortCutDefinition[item] = true;
        }
      } else {
        shortCutDefinition.baseKey = item;
      }
    });
    return shortCutDefinition;
  }

  recordShortCut(id, event) {
    event.preventDefault();

    const pressedKey = this.getPressedKey(event);
    this.pressedKeys.add(pressedKey);

    const shortCutDefinition = this.getShortCutDefinition();

    // show the current shortcut immediately, no delay:
    const element = document.getElementById(id);
    element.innerHTML = getShortCutRepresentation(shortCutDefinition);

    //if not alt, shift, ctrl or meta, end of recording -> save shortcut
    if (!event[pressedKey]) {
      if (!this.saveShortCuts([shortCutDefinition])) {
        // if the shortcut is invalid, reset the input field
        element.innerHTML = getShortCutRepresentation(this.shortCutDefinition);
      }
      element.blur(); // remove focus
      this.pressedKeys = new Set();
    }
  }

  recordShortCutKeyUp(id, event) {
    // This removes the unpressed key
    this.pressedKeys.delete(this.getPressedKey(event));

    const element = document.getElementById(id);
    const shortCutRepresentation = getShortCutRepresentation(
      this.getShortCutDefinition()
    );
    element.innerHTML =
      shortCutRepresentation != ""
        ? shortCutRepresentation
        : getShortCutRepresentation(this.shortCutDefinition);
  }

  resetShortCut(id) {
    setCustomShortCuts(this.actionIdentifier, undefined);
    const element = document.getElementById(id);
    element.innerHTML = getShortCutRepresentation(getShortCut(this.actionIdentifier));
    element.focus();
    this.shortCutDefinition = getShortCut(this.actionIdentifier);
  }

  deleteShortCut(id) {
    this.saveShortCuts([]);
    const element = document.getElementById(id);
    element.innerHTML = "";
    element.focus();
  }

  handleOnBlur(id) {
    // This fixes the issue: pressed modifier key but clicked outside the input field
    const element = document.getElementById(id);
    element.innerHTML = getShortCutRepresentation(getShortCut(this.actionIdentifier));
  }

  _updateContents() {
    this.innerHTML = "";
    this.append(
      html.label(
        {
          class: "fontra-ui-shortcuts-panel-label",
        },
        [this.shortCutLabel]
      )
    );

    const id = `shortcut-input-${this.actionIdentifier}`;
    this.append(
      html.div({
        "id": id,
        "tabindex": "0", // required for focus
        "class": "fontra-ui-shortcuts-panel-input",
        "innerHTML": getShortCutRepresentation(this.shortCutDefinition),
        "onkeydown": (event) => this.recordShortCut(id, event),
        "onkeyup": (event) => this.recordShortCutKeyUp(id, event),
        "onblur": (event) => this.handleOnBlur(id),
        "data-tooltip": translate(
          "application-settings.shortcuts.tooltip.click-and-record"
        ),
        "data-tooltipposition": "top",
      })
    );

    const iconWrapper = html.div({
      class: "fontra-ui-shortcuts-panel-icon-wrapper",
    });

    iconWrapper.append(
      html.createDomElement("icon-button", {
        "class": "fontra-ui-shortcuts-panel-icon",
        "src": "/tabler-icons/refresh.svg",
        "onclick": (event) => this.resetShortCut(id),
        "data-tooltip": translate(
          "application-settings.shortcuts.tooltip.reset-to-default"
        ),
        "data-tooltipposition": "top",
      })
    );

    iconWrapper.append(
      html.createDomElement("icon-button", {
        "class": "fontra-ui-shortcuts-panel-icon",
        "src": "/tabler-icons/x.svg",
        "onclick": (event) => this.deleteShortCut(id),
        "data-tooltip": translate("shortcuts.tooltip.clear"),
        "data-tooltipposition": "top",
      })
    );

    this.append(iconWrapper);
  }
}

customElements.define("shortcut-element", ShortCutElement);
