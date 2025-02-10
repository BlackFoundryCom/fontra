import * as html from "/core/html-utils.js";
import { SimpleElement } from "/core/html-utils.js";
import { translate } from "/core/localization.js";
import { enumerate } from "/core/utils.js";

export async function dialog(headline, message, buttonDefs, autoDismissTimeout) {
  const dialogContentElement = await dialogSetup(
    headline,
    message,
    buttonDefs,
    autoDismissTimeout
  );
  return await dialogContentElement.run();
}

export async function dialogSetup(headline, message, buttonDefs, autoDismissTimeout) {
  const dialogContentElement = document.querySelector("modal-dialog");
  await dialogContentElement.setupDialog(
    headline,
    message,
    buttonDefs,
    autoDismissTimeout
  );
  return dialogContentElement;
}

export function message(headline, message) {
  return dialog(headline, message, [
    { title: translate("dialog.okay"), isDefaultButton: true },
  ]);
}

export class ModalDialog extends SimpleElement {
  static styles = `

    dialog {
      background-color: transparent;
      border: none;
    }

    dialog[open] {
      display: grid;
      align-items: center;
      justify-items: center;
      width: 100%;
      height: 100%;
      max-width: 100%;
      max-height: 100%;
    }

    dialog::backdrop {
      background-color: #8888;
    }

    dialog .dialog-box {
      position: relative;
      display: grid;
      grid-template-rows: auto 1fr auto;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 1em;

      outline: none; /* to catch key events we need to focus, but we don't want a focus border */
      max-width: 44em;
      max-height: 80vh;
      overflow-wrap: normal;
      font-size: 1.15em;
      background-color: var(--ui-element-background-color);
      color: var(--ui-element-foreground-color);
      padding: 1em;
      border-radius: 0.5em;
      box-shadow: 1px 3px 8px #0006;
    }

    dialog .headline {
      font-weight: bold;
      grid-column: 1 / -1;
    }

    dialog .message {
      grid-column: 1 / -1;
      overflow: hidden;
    }

    dialog .button {
      color: white;
      cursor: pointer;
      background-color: gray;

      border-radius: 1em;
      padding: 0.35em 2em 0.35em 2em;

      border: none;
      font-family: fontra-ui-regular, sans-serif;
      font-size: 1em;
      text-align: center;
      transition: 100ms;
    }

    dialog .button.button-1 {
      grid-column: 1;
    }

    dialog .button.button-2 {
      grid-column: 2;
    }

    dialog .button.button-3 {
      grid-column: 3;
    }

    dialog .button.default {
      background-color: var(--fontra-red-color);
    }

    dialog .button.disabled {
      background-color: #8885;
      pointer-events: none;
    }

    dialog .button:hover {
      filter: brightness(1.15);
    }

    dialog .button:active {
      filter: brightness(0.9);
    }

    dialog input[type="text"] {
      background-color: var(--text-input-background-color);
      color: var(--text-input-foreground-color);
      border-radius: 0.25em;
      border: none;
      outline: none;
      padding: 0.2em 0.5em;
      font-family: fontra-ui-regular, sans-serif;
      font-size: 1.1rem;
      resize: none;
    }
  `;

  constructor() {
    super();
    this.dialogBox = html.div({
      class: "dialog-box",
      tabindex: 0,
      onkeydown: (event) => this._handleKeyDown(event),
    });
    this.dialogElement = document.createElement("dialog");
    let downInBackdrop;
    this.dialogElement.addEventListener("pointerdown", (event) => {
      downInBackdrop = event.target.nodeName == "DIALOG";
    });
    this.dialogElement.addEventListener("pointerup", (event) => {
      const upInBackdrop = event.target.nodeName == "DIALOG";
      if (upInBackdrop && downInBackdrop) {
        this._dialogDone(null);
      }
      downInBackdrop = false;
    });
    this.dialogElement.appendChild(this.dialogBox);
    this.shadowRoot.append(this.dialogElement);
  }

  focus() {
    this.dialogBox?.focus();
  }

  setupDialog(headline, message, buttonDefs, autoDismissTimeout) {
    buttonDefs = buttonDefs.map((bd) => {
      return { ...bd };
    });
    if (buttonDefs.length === 1) {
      buttonDefs[0].isDefaultButton = true;
    }
    for (const buttonDef of buttonDefs) {
      if (buttonDef.isCancelButton && buttonDef.resultValue === undefined) {
        buttonDef.resultValue = null;
      }
    }
    this._buttonDefs = buttonDefs;

    this._autoDismissTimeout = autoDismissTimeout;

    this._resultPromise = new Promise((resolve) => {
      this._resolveDialogResult = resolve;
    });

    this._populateDialogBox(headline, message);
  }

  setContent(contentElement) {
    contentElement.classList.add("message");
    this.dialogContent.replaceWith(contentElement);
    this.dialogContent = contentElement;
  }

  run() {
    this.show();
    return this._resultPromise;
  }

  async _populateDialogBox(headline, message) {
    this.dialogBox.innerHTML = "";
    this.dialogBox.appendChild(html.div({ class: "headline" }, [headline]));

    this.dialogContent = html.div({ class: "message" });
    if (message) {
      this.dialogContent.innerHTML = message.replaceAll("\n", "\n<br>\n");
    }
    this.dialogBox.appendChild(this.dialogContent);

    for (const button of this._renderButtons()) {
      this.dialogBox.appendChild(button);
    }

    if (this._autoDismissTimeout) {
      this._dismissTimeoutID = setTimeout(
        () => this._dialogDone(null),
        this._autoDismissTimeout
      );
    }
  }

  *_renderButtons() {
    this.defaultButton = undefined;
    this.cancelButton = undefined;
    for (const [buttonIndex, buttonDef] of enumerate(
      this._buttonDefs,
      4 - this._buttonDefs.length
    )) {
      const buttonElement = html.input({
        type: "button",
        class: `button button-${buttonIndex}`,
        tabindex: -1,
        value: buttonDef.title,
        onclick: (event) => {
          this._dialogDone(
            buttonDef.getResult
              ? buttonDef.getResult()
              : buttonDef.resultValue !== undefined
              ? buttonDef.resultValue
              : buttonDef.title
          );
        },
      });
      if (buttonDef.disabled) {
        buttonElement.classList.add("disabled");
      }
      if (buttonDef.isDefaultButton) {
        buttonElement.classList.add("default");
        this.defaultButton = buttonElement;
      } else if (buttonDef.isCancelButton) {
        this.cancelButton = buttonElement;
      }
      yield buttonElement;
    }
  }

  cancel() {
    this._dialogDone(null);
  }

  show() {
    const activeElement = document.activeElement;
    this._savedCanvasElement =
      activeElement?.id === "edit-canvas" ? activeElement : undefined;
    this.dialogElement.showModal();
  }

  hide() {
    this.dialogElement.close();
    this._savedCanvasElement?.focus();
  }

  _handleKeyDown(event) {
    const keyEnter = event.key === "Enter";
    const keyEscape = event.key === "Escape";
    if (!keyEnter && !keyEscape) {
      // handle only enter and escape keys
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    if (keyEnter) {
      if (!this.defaultButton?.classList.contains("disabled")) {
        this.defaultButton?.click();
      }
    } else if (keyEscape) {
      this.cancelButton?.click();
      if (!this.cancelButton) {
        this._dialogDone(null);
      }
    }
  }

  _dialogDone(result) {
    if (this._dismissTimeoutID) {
      clearTimeout(this._dismissTimeoutID);
      this._dismissTimeoutID = undefined;
    }
    this.dialogBox.innerHTML = "";
    delete this.dialogContent;

    this.hide();

    this._resolveDialogResult(result);
  }

  isActive() {
    return !!this.dialogContent;
  }
}

customElements.define("modal-dialog", ModalDialog);
