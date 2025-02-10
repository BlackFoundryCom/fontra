import * as html from "../core/html-utils.js";
import { SimpleElement } from "../core/html-utils.js";
import { QueueIterator } from "../core/queue-iterator.js";
import {
  enumerate,
  hyphenatedToCamelCase,
  round,
  scheduleCalls,
} from "../core/utils.js";
import { RangeSlider } from "/web-components/range-slider.js";
import "/web-components/rotary-control.js";

export class Form extends SimpleElement {
  static styles = `
    :host {
      --label-column-width: 32%;
    }

    .ui-form {
      display: grid;
      align-items: center;
      grid-template-columns: var(--label-column-width) auto;
      gap: 0.35rem 0.35rem;
      margin: 0em;
      padding: 0em;
    }

    .ui-form-label {
      text-align: right;
      align-self: center;
      overflow-x: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .ui-form-full-width {
      grid-column: 1 / span 2;
    }

    hr {
      border: none;
      border-top: 1px solid var(--horizontal-rule-color);
      width: 100%;
      height: 1px;
      margin-block-start: 0.2em;
      margin-block-end: 0.1em;
      grid-column: 1 / span 2;
    }

    .ui-form-line-spacer {
      grid-column: 1 / span 2;
      height: 0.2em;
    }

    .ui-form-label.header {
      overflow-x: unset;
      font-weight: bold;
      grid-column: 1 / span 2;
      text-align: left;
      display: grid;
      grid-template-columns: auto auto;
      justify-content: space-between;
    }

    input {
      background-color: var(--text-input-background-color);
      color: var(--text-input-foreground-color);
      border-radius: 0.25em;
      border: none;
      outline: none;
      padding: 0.1em 0.3em;
      font-family: "fontra-ui-regular";
      font-size: 100%;
    }

    .ui-form-value input {
      width: min(100%, 9.5em);
      height: 1.6em;
    }

    .ui-form-value input[type="checkbox"] {
      width: initial;
      height: initial;
    }

    .ui-form-value input[type="color"] {
      height: 2em;
      width: 4em;
    }

    .ui-form-value input[type="text"] {
      width: 100%;
    }

    .ui-form-value input[type="number"] {
      width: 4em;
    }

    .ui-form-value.edit-number-x-y,
    .ui-form-value.universal-row {
      display: flex;
      gap: 0.3rem;
    }

    .ui-form-icon {
      overflow-x: unset;
      width: 1.5em;
      white-space: nowrap;
      margin-left: 1.3em;
      margin-right: 1.3em;
    }

    .ui-form-icon.ui-form-icon-button {
      display: inline-block;
    }

    .ui-form-center {
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 0.35rem 0.35rem;
    }
  `;

  constructor() {
    super();
    this.shadowRoot.appendChild(
      html.link({ href: "/css/tooltip.css", rel: "stylesheet" })
    );
    this.contentElement = this.shadowRoot.appendChild(document.createElement("div"));
    this.contentElement.classList.add("ui-form");
  }

  set labelWidth(width) {
    this.appendStyle(`:host {
      --label-column-width: ${width};
    }`);
  }

  setFieldDescriptions(fieldDescriptions) {
    this.contentElement.innerHTML = "";
    this._fieldGetters = {};
    this._fieldSetters = {};
    this._lastValidFieldValues = {};
    if (!fieldDescriptions) {
      return;
    }
    for (const fieldItem of fieldDescriptions) {
      if (fieldItem.type === "divider") {
        this.contentElement.appendChild(html.hr());
        continue;
      }
      if (fieldItem.type === "line-spacer") {
        this.contentElement.appendChild(html.div({ class: "ui-form-line-spacer" }));
        continue;
      }
      if (fieldItem.type === "spacer") {
        this.contentElement.appendChild(html.br());
        continue;
      }
      if (fieldItem.type === "single-icon") {
        if (fieldItem.element) {
          const valueElement = document.createElement("div");
          valueElement.classList.add("ui-form-full-width");
          valueElement.appendChild(fieldItem.element);
          this.contentElement.appendChild(valueElement);
        }
        continue;
      }

      const labelElement = document.createElement("div");
      labelElement.classList.add("ui-form-label", fieldItem.type);
      const valueElement = document.createElement("div");
      valueElement.classList.add("ui-form-value", fieldItem.type);
      if (fieldItem.width) {
        valueElement.style.width = fieldItem.width;
      }

      let label = fieldItem.label || fieldItem.key || "";
      /* if (label.length && fieldItem.type !== "header") {
        label += ":";
      } */ // Conflicts with colons within localization values
      labelElement.append(label);
      this.contentElement.appendChild(labelElement);
      if (fieldItem.type === "header") {
        if (fieldItem.auxiliaryElement) {
          labelElement.appendChild(fieldItem.auxiliaryElement);
        }
        continue;
      }

      this.contentElement.appendChild(valueElement);

      const methodName = hyphenatedToCamelCase("_add-" + fieldItem.type);
      if (this[methodName] === undefined) {
        throw new Error(`Unknown field type: ${fieldItem.type}`);
      }
      this[methodName](valueElement, fieldItem, labelElement);
    }
  }

  _addUniversalRow(valueElement, fieldItem, labelElement) {
    for (const [i, field] of enumerate([
      fieldItem.field1,
      fieldItem.field2,
      fieldItem.field3,
    ])) {
      const element = i === 0 ? labelElement : valueElement;
      const methodName = hyphenatedToCamelCase("_add-" + field.type);
      if (this[methodName]) {
        this[methodName](element, field, field.allowEmptyField);
      }
      if (field.auxiliaryElement) {
        element.appendChild(field.auxiliaryElement, field);
      }
    }
  }

  _addHeader(valueElement, fieldItem) {
    this._addText(valueElement, fieldItem);
  }

  _addNumber(valueElement, fieldItem) {
    this._addText(valueElement, fieldItem);
  }

  _addText(valueElement, fieldItem) {
    if (fieldItem.value !== undefined) {
      valueElement.innerText = fieldItem.value;
      this._fieldGetters[fieldItem.key] = () => valueElement.innerText;
      this._fieldSetters[fieldItem.key] = (value) => (valueElement.innerText = value);
    }
  }

  _addEditText(valueElement, fieldItem) {
    const inputElement = document.createElement("input");
    inputElement.type = "text";
    inputElement.value = fieldItem.value || "";
    inputElement.disabled = fieldItem.disabled;
    inputElement.onchange = (event) => {
      this._fieldChanging(fieldItem, inputElement.value, undefined);
    };
    this._fieldGetters[fieldItem.key] = () => inputElement.value;
    this._fieldSetters[fieldItem.key] = (value) => (inputElement.value = value);
    valueElement.appendChild(inputElement);
  }

  _addEditNumberXY(valueElement, fieldItem) {
    this._addEditNumber(valueElement, fieldItem.fieldX);
    this._addEditNumber(valueElement, fieldItem.fieldY);
  }

  _addEditNumber(valueElement, fieldItem, allowEmptyField = false) {
    this._lastValidFieldValues[fieldItem.key] = fieldItem.value;
    const inputElement = document.createElement("input");
    inputElement.type = "number";
    inputElement.value = maybeRound(fieldItem.value, fieldItem.numDigits);

    if (fieldItem["data-tooltip"]) {
      // data-tooltip doesn't work for input number,
      // default title is used
      inputElement.setAttribute("title", fieldItem["data-tooltip"]);
    }

    if ("minValue" in fieldItem) {
      inputElement.min = fieldItem.minValue;
    }
    if ("maxValue" in fieldItem) {
      inputElement.max = fieldItem.maxValue;
    }
    inputElement.step = "any";
    if (fieldItem.integer) {
      inputElement.pattern = "\\d*";
      inputElement.step = 1;
    }

    inputElement.disabled = fieldItem.disabled;
    inputElement.onkeydown = (event) => {
      if (event.shiftKey) {
        switch (event.key) {
          case "ArrowUp":
            // We add to the "regular" +1 increment
            event.target.value = event.target.valueAsNumber + 9;
            break;

          case "ArrowDown":
            // We add to the "regular" -1 increment
            event.target.value = event.target.valueAsNumber - 9;
            break;
        }
      }
    };
    inputElement.onchange = (event) => {
      let value;
      if (allowEmptyField && inputElement.value === "") {
        value = null;
      } else {
        value = parseFloat(inputElement.value);
        if (isNaN(value)) {
          value = this._lastValidFieldValues[fieldItem.key];
          inputElement.value = value;
        }
      }

      if (!inputElement.reportValidity()) {
        if (inputElement.min != undefined) {
          value = Math.max(value, inputElement.min);
        }
        if (inputElement.max != undefined) {
          value = Math.min(value, inputElement.max);
        }
        inputElement.value = value;
      }
      this._lastValidFieldValues[fieldItem.key] = value;
      this._fieldChanging(fieldItem, value, undefined);
    };
    this._fieldGetters[fieldItem.key] = () => inputElement.value;
    this._fieldSetters[fieldItem.key] = (value) =>
      (inputElement.value = maybeRound(value, fieldItem.numDigits));
    valueElement.appendChild(inputElement);
  }

  _addEditAngle(valueElement, fieldItem) {
    this._lastValidFieldValues[fieldItem.key] = fieldItem.value;
    const inputElement = html.input({
      type: "number",
      value: fieldItem.value,
      step: "any",
      disabled: fieldItem.disabled,
      onchange: () => {
        let value = parseFloat(inputElement.value);
        if (isNaN(value)) {
          value = this._lastValidFieldValues[fieldItem.key];
          inputElement.value = value;
        }
        this._lastValidFieldValues[fieldItem.key] = value;
        this._fieldChanging(fieldItem, value);
        rotaryControl.value = -value;
      },
    });
    const rotaryControl = html.createDomElement("rotary-control", {
      value: -fieldItem.value,
    });
    {
      // Rotary change closure
      let valueStream;

      rotaryControl.onChangeCallback = (event) => {
        const value = -event.value;
        inputElement.value = value;
        if (event.dragBegin) {
          valueStream = new QueueIterator(5, true);
          this._fieldChanging(fieldItem, value, valueStream);
        }

        if (valueStream) {
          valueStream.put(value);
          this._dispatchEvent("doChange", { key: fieldItem.key, value: value });
          if (event.dragEnd) {
            valueStream.done();
            valueStream = undefined;
            this._dispatchEvent("endChange", { key: fieldItem.key });
          }
        } else {
          this._fieldChanging(fieldItem, value, undefined);
        }
      };
    }

    this._fieldGetters[fieldItem.key] = () => inputElement.value;
    this._fieldSetters[fieldItem.key] = (value) => (inputElement.value = value);
    valueElement.appendChild(
      html.div({ style: "display: flex; gap: 0.15rem;" }, [inputElement, rotaryControl])
    );
  }

  _addEditNumberSlider(valueElement, fieldItem) {
    const rangeElement = new RangeSlider();
    rangeElement.value = fieldItem.value;
    rangeElement.minValue = fieldItem.minValue;
    rangeElement.defaultValue = fieldItem.defaultValue;
    rangeElement.maxValue = fieldItem.maxValue;

    {
      // Slider change closure
      let valueStream = undefined;

      rangeElement.onChangeCallback = (event) => {
        const value = event.value;
        if (event.dragBegin) {
          valueStream = new QueueIterator(5, true);
          this._fieldChanging(fieldItem, value, valueStream);
        }

        if (valueStream) {
          valueStream.put(value);
          this._dispatchEvent("doChange", { key: fieldItem.key, value: value });
          if (event.dragEnd) {
            valueStream.done();
            valueStream = undefined;
            this._dispatchEvent("endChange", { key: fieldItem.key });
          }
        } else {
          this._fieldChanging(fieldItem, value, undefined);
        }
      };
    }

    valueElement.appendChild(rangeElement);
  }

  _addColorPicker(valueElement, fieldItem) {
    const parseColor = fieldItem.parseColor || ((v) => v);
    const formatColor = fieldItem.formatColor || ((v) => v);

    let checkboxElement;
    const colorInputElement = html.input({ type: "color" });
    colorInputElement.value = formatColor(fieldItem.value);

    {
      // color picker change closure
      let valueStream = undefined;

      const oninputFunc = scheduleCalls((event) => {
        if (checkboxElement) {
          checkboxElement.checked = true;
        }
        const value = parseColor(colorInputElement.value);
        if (!valueStream) {
          valueStream = new QueueIterator(5, true);
          this._fieldChanging(fieldItem, value, valueStream);
        }

        valueStream.put(value);
        this._dispatchEvent("doChange", { key: fieldItem.key, value: value });
      }, fieldItem.continuousDelay || 0);

      let oninputTimer;

      colorInputElement.oninput = (event) => {
        oninputTimer = oninputFunc(event);
      };

      colorInputElement.onchange = (event) => {
        if (checkboxElement) {
          checkboxElement.checked = true;
        }
        if (oninputTimer) {
          clearTimeout(oninputTimer);
          oninputTimer = undefined;
        }
        if (valueStream) {
          valueStream.done();
          valueStream = undefined;
          this._dispatchEvent("endChange", { key: fieldItem.key });
        } else {
          const value = parseColor(colorInputElement.value);
          this._fieldChanging(fieldItem, value, undefined);
        }
      };
    }

    valueElement.appendChild(colorInputElement);

    if (fieldItem.allowNoColor) {
      checkboxElement = html.input({
        type: "checkbox",
        checked: !!fieldItem.value,
        onchange: (event) => {
          this._fieldChanging(
            fieldItem,
            checkboxElement.checked ? parseColor(colorInputElement.value) : undefined,
            undefined
          );
        },
      });
      valueElement.appendChild(checkboxElement);
    }
  }

  addEventListener(eventName, handler, options) {
    this.contentElement.addEventListener(eventName, handler, options);
  }

  _fieldChanging(fieldItem, value, valueStream) {
    if (valueStream) {
      this._dispatchEvent("beginChange", { key: fieldItem.key });
    } else {
      this._dispatchEvent("doChange", { key: fieldItem.key, value: value });
    }
    const handlerName = "onFieldChange";
    if (this[handlerName] !== undefined) {
      this[handlerName](fieldItem, value, valueStream);
    }
  }

  _dispatchEvent(eventName, detail) {
    const event = new CustomEvent(eventName, {
      bubbles: false,
      detail: detail,
    });
    this.contentElement.dispatchEvent(event);
  }

  getKeys() {
    return Object.keys(this._fieldGetters);
  }

  hasKey(key) {
    return key in this._fieldGetters;
  }

  getValue(key) {
    const getter = this._fieldGetters[key];
    if (getter === undefined) {
      throw new Error(`getting unknown Form key: ${key}`);
    }
    return getter();
  }

  setValue(key, value) {
    const setter = this._fieldSetters[key];
    if (setter === undefined) {
      throw new Error(`setting unknown Form key: ${key}`);
    }
    setter(value);
  }
}

function maybeRound(value, digits) {
  return digits === undefined ? value : round(value, digits);
}

customElements.define("ui-form", Form);
