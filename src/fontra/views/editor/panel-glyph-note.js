import Panel from "./panel.js";
import * as html from "/core/html-utils.js";
import { translate } from "/core/localization.js";
import { throttleCalls } from "/core/utils.js";

export default class GlyphNotePanel extends Panel {
  identifier = "glyph-note";
  iconPath = "/tabler-icons/notes.svg";

  static styles = `
    #glyph-note-textarea {
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
      text-wrap: wrap;
      box-sizing: content-box; /* FIXME: use border-box */
    }

    #glyph-note-textarea:disabled {
      opacity: 40%;
    }

    .glyph-note-section {
      display: flex;
      flex-direction: column;
    }

    .glyph-note-header {
      margin-bottom: 0.5em;
    }
  `;

  constructor(editorController) {
    super(editorController);
    this.throttledUpdate = throttleCalls((senderID) => this.update(senderID), 100);
    this.fontController = this.editorController.fontController;
    this.sceneController = this.editorController.sceneController;

    this.setupGlyphNoteElement();

    this.sceneController.sceneSettingsController.addKeyListener(
      ["selectedGlyphName", "selection"],
      (event) => this.throttledUpdate()
    );

    this.sceneController.addCurrentGlyphChangeListener((event) => {
      this.throttledUpdate(event.senderID);
    });
  }

  getContentElement() {
    return html.div(
      {
        class: "panel",
      },
      [
        html.div(
          {
            class: "panel-section panel-section--flex glyph-note-section",
          },
          [
            html.div({ class: "glyph-note-header", id: "glyph-note-header" }, [
              translate("sidebar.glyph-note"),
            ]),
            html.createDomElement("textarea", {
              rows: 1,
              wrap: "off",
              id: "glyph-note-textarea",
            }),
          ]
        ),
      ]
    );
  }

  setupGlyphNoteElement() {
    this.glyphNoteElement = this.contentElement.querySelector("#glyph-note-textarea");
    this.glyphNoteHeaderElement =
      this.contentElement.querySelector("#glyph-note-header");

    this.glyphNoteElement.addEventListener("change", () => {
      if (!this._selectedGlyphName) {
        return;
      }
      saveGlyphNote(
        this._selectedGlyphName,
        this.sceneController,
        this.glyphNoteElement.value
      );
    });

    this.glyphNoteElement.addEventListener("input", async () => {
      this.fixGlyphNoteHeight();
    });
  }

  async update() {
    // This method is called when the panel is opened or when the selected glyph changes.
    // Therefore we need to update the glyph note text area with the current glyph note
    const varGlyphController =
      await this.sceneController.sceneModel.getSelectedVariableGlyphController();
    const varGlyph = varGlyphController?.glyph;

    this._selectedGlyphName = varGlyph?.name;

    this.glyphNoteHeaderElement.innerHTML = varGlyph
      ? `<b>${translate("sidebar.glyph-note.glyph-note-for-glyph", varGlyph.name)}</b>`
      : `<b>${translate("sidebar.glyph-note")}</b> ${translate(
          "sidebar.glyph-note.no-glyph-selected"
        )}`;
    const glyphNote = varGlyph?.customData["fontra.glyph.note"] ?? "";
    this.glyphNoteElement.value = glyphNote;
    this.glyphNoteElement.disabled = !varGlyph;
    this.fixGlyphNoteHeight();
  }

  fixGlyphNoteHeight() {
    // This adapts the text entry height to its content
    this.glyphNoteElement.style.height = "auto";
    this.glyphNoteElement.style.height = this.glyphNoteElement.scrollHeight + 14 + "px";
  }

  async toggle(on, focus) {
    if (on) {
      this.update();
      // Delay focusing until after the panel slide in animation,
      // or else the sliding animation will look glitchy
      setTimeout(() => this.glyphNoteElement.focus(), 200);
    }
  }
}

async function saveGlyphNote(glyphName, sceneController, newNote) {
  await sceneController.editNamedGlyphAndRecordChanges(glyphName, (glyph) => {
    const oldNote = glyph.customData["fontra.glyph.note"];
    glyph.customData["fontra.glyph.note"] = newNote;
    return translate(
      oldNote
        ? newNote
          ? "sidebar.glyph-note.undo.edit"
          : "sidebar.glyph-note.undo.delete"
        : "sidebar.glyph-note.undo.add"
    );
  });
}

customElements.define("panel-glyph-note", GlyphNotePanel);
