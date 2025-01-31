import Panel from "./panel.js";
import * as html from "/core/html-utils.js";
import { findNestedActiveElement } from "/core/utils.js";

export default class TextEntryPanel extends Panel {
  identifier = "text-entry";
  iconPath = "/images/texttool.svg";

  static styles = `
    .text-entry-section {
      display: flex;
      flex-direction: column;
      gap: 0.5em;
    }

    #text-align-menu {
      display: grid;
      grid-template-columns: auto auto auto;
      justify-content: start;
      gap: 0.5em;
    }

    #text-align-menu > inline-svg {
      width: 1.5rem;
      height: 1.5rem;
      position: relative;
      padding: 0.3em 0.45em 0.3em 0.45em;
      border-radius: 0.75em;
      cursor: pointer;
      user-select: none;
      transition: 120ms;
      box-sizing: content-box; /* FIXME: use border-box */
    }

    #text-align-menu > inline-svg:hover {
      background-color: #c0c0c050;
    }

    #text-align-menu > inline-svg:active {
      background-color: #c0c0c080;
    }

    #text-align-menu > inline-svg.selected {
      background-color: #c0c0c060;
    }

    #text-entry-textarea {
      background-color: var(--text-input-background-color);
      color: var(--text-input-foreground-color);
      border-radius: 0.25em;
      border: 0.5px solid lightgray;
      outline: none;
      padding: 0.2em 0.5em;
      font-family: fontra-ui-regular, sans-serif;
      font-size: 1.1rem;
      resize: none;
      overflow-x: auto;
      box-sizing: content-box;
    }
  `;

  constructor(editorController) {
    super(editorController);

    this.textSettingsController = this.editorController.sceneSettingsController;
    this.sceneController = this.editorController.sceneController;
    this.textSettings = this.editorController.sceneSettingsController.model;

    this.setupTextEntryElement();
    this.setupTextAlignElement();
    this.setupIntersectionObserver();
  }

  getContentElement() {
    return html.div(
      {
        class: "panel",
      },
      [
        html.div(
          {
            class: "panel-section text-entry-section",
          },
          [
            html.createDomElement("textarea", {
              rows: 1,
              wrap: "off",
              id: "text-entry-textarea",
            }),
            html.div(
              {
                id: "text-align-menu",
              },
              [
                html.createDomElement("inline-svg", {
                  "data-align": "left",
                  "src": "/images/alignleft.svg",
                }),
                html.createDomElement("inline-svg", {
                  "class": "selected",
                  "data-align": "center",
                  "src": "/images/aligncenter.svg",
                }),
                html.createDomElement("inline-svg", {
                  "data-align": "right",
                  "src": "/images/alignright.svg",
                }),
              ]
            ),
          ]
        ),
      ]
    );
  }

  updateAlignElement(align) {
    for (const el of this.textAlignElement.children) {
      el.classList.toggle("selected", align === el.dataset.align);
    }
  }

  setupTextAlignElement() {
    this.textAlignElement = this.contentElement.querySelector("#text-align-menu");
    this.updateAlignElement(this.textSettings.align);

    this.textSettingsController.addKeyListener("align", (event) => {
      this.updateAlignElement(this.textSettings.align);
    });

    for (const el of this.textAlignElement.children) {
      el.onclick = (event) => {
        if (event.target.classList.contains("selected")) {
          return;
        }
        this.textSettings.align = el.dataset.align;
      };
    }
  }

  setupTextEntryElement() {
    this.textEntryElement = this.contentElement.querySelector("#text-entry-textarea");
    this.textEntryElement.value = this.textSettings.text;

    const updateTextEntryElementFromModel = (event) => {
      if (event.senderInfo === this) {
        return;
      }
      this.textEntryElement.value = event.newValue;

      // https://github.com/googlefonts/fontra/issues/754
      // In Safari, setSelectionRange() changes the focus. We don't want that,
      // so we make sure to restore the focus to whatever it was.
      const savedActiveElement = findNestedActiveElement();
      this.textEntryElement.setSelectionRange(0, 0);
      savedActiveElement?.focus();
    };

    this.textSettingsController.addKeyListener(
      "text",
      updateTextEntryElementFromModel,
      true
    );

    this.textEntryElement.addEventListener(
      "input",
      () => {
        this.textSettingsController.setItem("text", this.textEntryElement.value, this);
        this.textSettings.selectedGlyph = null;
      },
      false
    );

    this.textSettingsController.addKeyListener(
      "text",
      (event) => this.fixTextEntryHeight(),
      false
    );
  }

  fixTextEntryHeight() {
    // This adapts the text entry height to its content
    this.textEntryElement.style.height = "auto";
    this.textEntryElement.style.height = this.textEntryElement.scrollHeight + 14 + "px";
  }

  setupIntersectionObserver() {
    const observer = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (entry.intersectionRatio > 0) {
            this.fixTextEntryHeight();
          }
        });
      },
      {
        root: document.documentElement,
      }
    );
    observer.observe(this.textEntryElement);
  }

  focusTextEntry() {
    this.textEntryElement.focus();
  }

  async toggle(on, focus) {
    if (focus) {
      this.focusTextEntry();
    }
  }
}

customElements.define("panel-text-entry", TextEntryPanel);
