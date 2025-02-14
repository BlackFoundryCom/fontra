import { registerAction } from "../core/actions.js";
import Panel from "./panel.js";

import { getSelectedGlyphInfo } from "./scene-model.js";
import {
  createDomElement,
  div,
  form,
  input,
  label,
  option,
  select,
  span,
} from "/core/html-utils.js";
import { ObservableController } from "/core/observable-object.js";
import { getOPFS } from "/core/opfs.js";
import { fetchJSON, fileNameExtension, modulo, withTimeout } from "/core/utils.js";
import { dialog, message } from "/web-components/modal-dialog.js";
import "/web-components/range-slider.js";
import { UIList } from "/web-components/ui-list.js";

import "/third-party/lib-font/inflate.js";
import "/third-party/lib-font/unbrotli.js";

// lib-font expects its dependencies to be imported first. Prettier moves the imports.
// prettier-ignore: organizeImportsSkipDestructiveCodeActions
import { Font } from "/third-party/lib-font.js";

import { registerVisualizationLayerDefinition } from "./visualization-layer-definitions.js";
import { translate, translatePlural } from "/core/localization.js";

let referenceFontModel;

const fontFileExtensions = new Set(["ttf", "otf", "woff", "woff2"]);
const DEFAULT_FONT_SIZE = 100;

registerVisualizationLayerDefinition({
  identifier: "fontra.reference.font",
  name: "sidebar.user-settings.glyph.referencefont",
  selectionMode: "editing",
  userSwitchable: true,
  defaultOn: true,
  zIndex: 100,
  screenParameters: { strokeWidth: 1 },
  colors: { fillColor: "#AAA6" },
  // colorsDarkMode: { strokeColor: "red" },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    if (!referenceFontModel?.referenceFontName) {
      return;
    }
    let text = referenceFontModel?.charOverride || positionedGlyph.character;
    if (!text && positionedGlyph.glyphName.includes(".")) {
      const baseGlyphName = positionedGlyph.glyphName.split(".")[0];
      const codePoint = (editorController.fontController.glyphMap[baseGlyphName] ||
        [])[0];
      if (codePoint) {
        text = String.fromCodePoint(codePoint);
      }
    }
    if (!text) {
      return;
    }
    context.lineWidth = parameters.strokeWidth;
    context.font = `${model.fontController.unitsPerEm}px ${referenceFontModel.referenceFontName}, AdobeBlank`;
    context.scale(1, -1);
    if (parameters.fillColor) {
      context.fillStyle = parameters.fillColor;
      context.fillText(text, 0, 0);
    }
    if (parameters.strokeColor) {
      context.strokeStyle = parameters.strokeColor;
      context.strokeText(text, 0, 0);
    }
  },
});

function cleanFontItems(fontItems) {
  return fontItems.map((fontItem) => {
    return {
      uplodadedFileName: fontItem.uplodadedFileName,
      fontIdentifier: fontItem.fontIdentifier,
    };
  });
}

function readSupportedLanguages(fontItem, languageMapping) {
  return new Promise((resolve, reject) => {
    const font = new Font(fontItem.fontIdentifier, {
      skipStyleSheet: true,
    });
    font.onerror = (event) => {
      console.error("Error when creating Font instance (lib-font).", event);
      resolve([]);
    };
    font.onload = (event) => {
      const font = event.detail.font;
      const getLangs = (table) => {
        if (table) {
          return table
            .getSupportedScripts()
            .reduce((acc, script) => {
              const scriptTable = table.getScriptTable(script);
              return acc.concat(table.getSupportedLangSys(scriptTable));
            }, [])
            .map((lang) => lang.trim());
        } else {
          return [];
        }
      };
      const gsubLangs = getLangs(font.opentype.tables.GSUB);
      const gposLangs = getLangs(font.opentype.tables.GPOS);
      const allLangs = new Set([...gsubLangs, ...gposLangs]);

      const supportedLanguages = [...allLangs]
        .filter((lang) => languageMapping[lang])
        .map((lang) => languageMapping[lang]);
      supportedLanguages.sort((a, b) => a[0].localeCompare(b[0]));
      resolve(supportedLanguages);
    };
    font.src = fontItem.objectURL;
  });
}

const referenceFontsFolderName = "reference-fonts";

let _opfs;

async function _getOPFS() {
  if (!_opfs) {
    _opfs = await getOPFS();
  }
  return _opfs;
}

async function garbageCollectUnusedFiles(fontItems) {
  const usedFontIdentifiers = new Set(
    fontItems.map((fontItem) => fontItem.fontIdentifier)
  );
  const fileNames = await listFontFileNamesInOPFS();
  for (const fileName of fileNames) {
    if (!usedFontIdentifiers.has(fileName)) {
      // Unused font file
      deleteFontFileFromOPFS(fileName);
    }
  }
}

function garbageCollectFontItem(fontItem) {
  if (fontItem.fontFace) {
    document.fonts.delete(fontItem.fontFace);
  }
  if (fontItem.objectURL) {
    URL.revokeObjectURL(fontItem.objectURL);
  }
}

async function listFontFileNamesInOPFS() {
  const opfs = await _getOPFS();
  const fileNames = [];
  if (await opfs.exists([referenceFontsFolderName])) {
    for await (const name of opfs.iterDirectory([referenceFontsFolderName])) {
      fileNames.push(name);
    }
  }
  return fileNames;
}

async function readFontFileFromOPFS(fileName) {
  const opfs = await _getOPFS();
  return await opfs.readFile([referenceFontsFolderName, fileName]);
}

async function deleteFontFileFromOPFS(fileName) {
  const opfs = await _getOPFS();
  await opfs.deleteFile([referenceFontsFolderName, fileName]);
}

async function writeFontFileToOPFS(fileName, file) {
  const opfs = await _getOPFS();
  await opfs.createDirectory([referenceFontsFolderName]);
  await opfs.writeFile([referenceFontsFolderName, fileName], file);
}

export default class ReferenceFontPanel extends Panel {
  identifier = "reference-font";
  iconPath = "/images/reference.svg";

  static styles = `
    .reference-font-section {
      display: grid;
      gap: 1em;
      white-space: normal;
      align-content: start;
    }

    .reference-font-items {
      display: flex;
      flex-direction: column;
      gap: 0.5em;
    }

    .reference-font-list {
      gap: 0;
    }

    .title {
      font-weight: bold;
    }

    input[type="text"] {
      border-radius: 5px;
      min-width: 4em;
      outline: none;
      border: none;
      background-color: var(--text-input-background-color);
      color: var(--text-input-foreground-color);
      padding: 0.4em;
      font-family: fontra-ui-regular;
      font-feature-settings: "tnum" 1;
    }

    .current-character {
      overflow: auto;
    }

    .current-character-font-size {
      width: 100%;
    }

    .reference-font-preview {
      display: grid;
      overflow: auto;
    }
  `;

  constructor(editorController) {
    super(editorController);

    fetchJSON("/data/language-mapping.json").then((languageMapping) => {
      this.languageMapping = languageMapping;
    });

    this.controller.addKeyListener("referenceFontName", (event) => {
      if (event.newValue) {
        this.editorController.visualizationLayersSettings.model[
          "fontra.reference.font"
        ] = true;
      }
      this.editorController.canvasController.requestUpdate();
    });

    this.controller.addKeyListener("charOverride", (event) => {
      this.editorController.canvasController.requestUpdate();
      this.requestReferenceFontsPreview();
    });

    this.controller.addKeyListener("languageCode", (event) => {
      this.editorController.canvasController.setLangAttribute(this.model.languageCode);
      this.requestReferenceFontsPreview();
    });

    this.editorController.canvasController.setLangAttribute(this.model.languageCode);

    referenceFontModel = this.model;

    this.editorController.sceneSettingsController.addKeyListener(
      "selectedGlyphName",
      (event) => {
        this.requestReferenceFontsPreview();
      }
    );

    editorController.sceneSettingsController.addKeyListener("fontLocationUser", () => {
      const fontVariationSettings = [];
      for (const axis of this.editorController.fontController.fontAxes) {
        const axisValue =
          this.editorController.sceneSettings.fontLocationUser[axis.name];
        fontVariationSettings.push(
          `'${axis.tag}' ${axisValue != undefined ? axisValue : axis.defaultValue}`
        );
      }
      const cssString = fontVariationSettings.join(",");
      this.contentElement.style.fontVariationSettings = cssString;
      this.editorController.canvasController.canvas.style.fontVariationSettings =
        cssString;
      this.editorController.canvasController.requestUpdate();
    });

    this.initActions();
  }

  initActions() {
    const topic = "0200-action-topics.reference-font";
    registerAction(
      "action.select-previous-reference-font",
      {
        topic,
        titleKey: "reference-font.select-previous-reference-font",
        defaultShortCuts: [],
      },
      () => this.doSelectPreviousNextReferenceFont(true)
    );

    registerAction(
      "action.select-next-reference-font",
      {
        topic,
        titleKey: "reference-font.select-next-reference-font",
        defaultShortCuts: [],
      },
      () => this.doSelectPreviousNextReferenceFont(false)
    );
  }

  async doSelectPreviousNextReferenceFont(selectPrevious) {
    const listLength = this.filesUIList.items.length;
    if (listLength < 2) {
      return;
    }

    const index = this.filesUIList.getSelectedItemIndex() || 0;
    const newIndex = modulo(index + (selectPrevious ? -1 : 1), listLength);

    this.filesUIList.setSelectedItemIndex(newIndex, true);
  }

  async requestReferenceFontsPreview() {
    if (this.referenceFontsPreviewPromise) {
      return this.referenceFontsPreviewPromise;
    }
    this.referenceFontsPreviewPromise = this.displayCurrentGlyphInReferenceFonts();
    await this.referenceFontsPreviewPromise;
    delete this.referenceFontsPreviewPromise;
  }

  async displayCurrentGlyphInReferenceFonts() {
    const container = this.contentElement.querySelector(".reference-font-preview");
    container.innerHTML = "";

    const selectedGlyphInfo = getSelectedGlyphInfo(
      this.editorController.sceneSettings.selectedGlyph,
      this.editorController.sceneSettings.glyphLines
    );

    let textToDisplay;

    if (this.model.charOverride) {
      textToDisplay = this.model.charOverride.charAt(0);
    } else {
      if (selectedGlyphInfo) {
        if (selectedGlyphInfo.glyphName.includes(".")) {
          const baseGlyphName = selectedGlyphInfo.glyphName.split(".")[0];
          const codePoint = (this.editorController.fontController.glyphMap[
            baseGlyphName
          ] || [])[0];
          if (codePoint) {
            textToDisplay = String.fromCodePoint(codePoint);
          }
        } else {
          textToDisplay = selectedGlyphInfo.character;
        }
      }
    }

    if (!textToDisplay) {
      return;
    }

    const currentCharacter = div(
      {
        class: "current-character",
        style: `font-size: ${this.model.fontSize}px`,
        lang: this.model.languageCode,
      },
      []
    );
    const rangeSlider = createDomElement("range-slider", {
      type: "range",
      value: this.model.fontSize,
      minValue: 10,
      defaultValue: DEFAULT_FONT_SIZE,
      maxValue: 300,
      step: 0.1,
      onChangeCallback: (event) => {
        currentCharacter.style.fontSize = `${event.value}px`;
        this.model.fontSize = event.value;
      },
    });

    for (const font of this.model.fontList) {
      await this.ensureFontLoaded(font);
      currentCharacter.appendChild(
        span({ style: `font-family: ${font.fontIdentifier};` }, [` ${textToDisplay}`])
      );
    }
    container.appendChild(rangeSlider);
    container.appendChild(currentCharacter);
  }

  _fontListChangedHandler(event) {
    if (event.senderInfo?.senderID === this) {
      return;
    }
    this.model.selectedFontIndex = -1;

    const itemsByFontID = Object.fromEntries(
      this.filesUIList.items.map((item) => [item.fontIdentifier, item])
    );

    const newItems = event.newValue.map((item) => {
      const existingItem = itemsByFontID[item.fontIdentifier];
      if (existingItem) {
        item = existingItem;
        delete itemsByFontID[item.fontIdentifier];
      }
      return item;
    });

    for (const leftoverItem of Object.values(itemsByFontID)) {
      garbageCollectFontItem(leftoverItem);
    }

    this.filesUIList.setItems(newItems, true);
    if (this.filesUIList.getSelectedItemIndex() === undefined) {
      this.model.referenceFontName = "";
    }
  }

  get model() {
    return this.controller.model;
  }

  async _filesHandler(files) {
    if (files.length === 0) return;

    const fontItemsInvalid = [];
    const fontItems = [...files]
      .filter((file) => {
        const fileExtension = fileNameExtension(file.name).toLowerCase();
        const fileTypeSupported = fontFileExtensions.has(fileExtension);
        if (!fileTypeSupported) {
          fontItemsInvalid.push(file);
        }
        return fileTypeSupported;
      })
      .map((file) => {
        return {
          uplodadedFileName: file.name,
          droppedFile: file,
          objectURL: URL.createObjectURL(file),
          fontIdentifier: `ReferenceFont-${crypto.randomUUID()}`,
        };
      });

    if (fontItemsInvalid.length) {
      const dialogTitle = translatePlural(
        "sidebar.reference-font.dialog.title",
        fontItemsInvalid.length
      );
      const dialogMessage = fontItemsInvalid
        .map((file) => {
          return `- ${file.name}`;
        })
        .join("\n");
      dialog(dialogTitle, dialogMessage, [{ title: translate("dialog.okay") }], 5000);
    }

    const newItems = [...this.filesUIList.items, ...fontItems];
    this.filesUIList.setItems(newItems);
    this.filesUIList.setSelectedItemIndex(this.filesUIList.items.length - 1, true);

    const writtenFontItems = [...this.model.fontList];
    try {
      for (const fontItem of fontItems) {
        await writeFontFileToOPFS(fontItem.fontIdentifier, fontItem.droppedFile);
        delete fontItem.droppedFile;
        writtenFontItems.push(fontItem);
      }
    } catch (error) {
      message(
        translate("sidebar.reference-font.warning.could-not-store"),
        error.toString()
      );
    }

    // Only notify the list controller *after* the files have been written,
    // or else other tabs will try to read the font data too soon and will
    // fail
    this.controller.setItem("fontList", cleanFontItems(writtenFontItems), {
      senderID: this,
    });
  }

  async ensureFontLoaded(fontItem) {
    if (!fontItem.fontFace) {
      if (!fontItem.objectURL) {
        fontItem.objectURL = URL.createObjectURL(
          await readFontFileFromOPFS(fontItem.fontIdentifier)
        );
      }
      fontItem.fontFace = new FontFace(
        fontItem.fontIdentifier,
        `url(${fontItem.objectURL})`,
        {}
      );
      document.fonts.add(fontItem.fontFace);
      await fontItem.fontFace.load();
    }
  }

  async _listSelectionChangedHandler() {
    const fontItem = this.filesUIList.getSelectedItem();
    if (!fontItem) {
      this.model.referenceFontName = "";
      this.model.selectedFontIndex = -1;
      return;
    }

    const selectedFontIndex = this.filesUIList.getSelectedItemIndex();
    this.model.selectedFontIndex =
      selectedFontIndex !== undefined ? selectedFontIndex : -1;

    await this.ensureFontLoaded(fontItem);
    this.model.referenceFontName = fontItem.fontIdentifier;

    if (fontItem.fontIdentifier in this.supportedLanguagesMemoized) {
      this.setSupportedLanguages(
        this.supportedLanguagesMemoized[fontItem.fontIdentifier],
        this.model.languageCode
      );
    } else {
      setTimeout(async () => {
        // file is not resolved when it's read consecutively after creating object url
        // I do not know the reason. I will investigate later, leaving it with a timeout
        const supportedLanguages = await readSupportedLanguages(
          fontItem,
          this.languageMapping
        );
        this.setSupportedLanguages(supportedLanguages, this.model.languageCode);
        this.supportedLanguagesMemoized[fontItem.fontIdentifier] = supportedLanguages;
      }, 100);
    }
  }

  async _deleteSelectedItemHandler() {
    await this._deleteItemOrAll(this.filesUIList.getSelectedItemIndex());
  }

  async _deleteAllHandler() {
    await this._deleteItemOrAll(undefined);
  }

  async _deleteItemOrAll(index) {
    const fontItems = [...this.filesUIList.items];

    let itemsToDelete, newItems;
    if (index !== undefined) {
      itemsToDelete = [fontItems[index]];
      fontItems.splice(index, 1);
      newItems = fontItems;
    } else {
      itemsToDelete = fontItems;
      newItems = [];
    }

    this.model.selectedFontIndex = -1;
    this.model.referenceFontName = "";

    this.filesUIList.setItems(newItems);

    // Only share those fonts that we successfully stored before
    const storedFontIDs = new Set(
      this.model.fontList.map((item) => item.fontIdentifier)
    );
    this.controller.setItem(
      "fontList",
      cleanFontItems(newItems.filter((item) => storedFontIDs.has(item.fontIdentifier))),
      {
        senderID: this,
      }
    );

    for (const fontItem of itemsToDelete) {
      garbageCollectFontItem(fontItem);
      await deleteFontFileFromOPFS(fontItem.fontIdentifier);
    }
  }

  setSupportedLanguages(languages, currentLanguage = "") {
    this.languageCodeInput.innerHTML = "";
    this.languageCodeInput.appendChild(option({ value: "" }, ["None"]));
    for (const [name, code] of languages) {
      this.languageCodeInput.appendChild(
        option(
          {
            value: code,
            selected: currentLanguage === code,
          },
          [`${name} (${code})`]
        )
      );
    }
  }

  getContentElement() {
    this.languageMapping = {};
    this.supportedLanguagesMemoized = {};

    this.controller = new ObservableController({
      languageCode: "",
      fontSize: DEFAULT_FONT_SIZE,
      selectedFontIndex: -1,
      fontList: [],
      charOverride: "",
      referenceFontName: "",
    });
    this.controller.synchronizeWithLocalStorage("fontra.reference-font.");
    this.controller.addKeyListener("fontList", (event) => {
      this._fontListChangedHandler(event);
      this.requestReferenceFontsPreview();
    });
    garbageCollectUnusedFiles(this.model.fontList);

    const columnDescriptions = [
      {
        key: "uplodadedFileName",
        title: translate("sidebar.reference-font.file-name"),
      },
    ];
    this.filesUIList = new UIList();

    this.filesUIList.columnDescriptions = columnDescriptions;
    this.filesUIList.itemEqualFunc = (a, b) => a.fontIdentifier == b.fontIdentifier;

    this.filesUIList.minHeight = "6em";
    this.filesUIList.classList.add("reference-font-list");

    this.filesUIList.onFilesDrop = (files) => this._filesHandler(files);

    this.filesUIList.addEventListener("listSelectionChanged", () =>
      this._listSelectionChangedHandler()
    );

    this.filesUIList.addEventListener("deleteKey", () =>
      this._deleteSelectedItemHandler()
    );
    this.filesUIList.addEventListener("deleteKeyAlt", () => this._deleteAllHandler());

    this.filesUIList.setItems([...this.model.fontList]);
    if (this.model.selectedFontIndex != -1) {
      this.filesUIList.setSelectedItemIndex(this.model.selectedFontIndex, true);
    }

    this.languageCodeInput = select(
      {
        id: "language-code",
        style: "width: 100%;",
        onchange: (event) => {
          this.model.languageCode = event.target.value;
        },
      },
      []
    );

    const fileInput = input(
      {
        type: "file",
        accept: ".ttf,.otf,.woff,.woff2",
        multiple: true,
      },
      []
    );
    fileInput.addEventListener("change", async () => {
      await this._filesHandler(fileInput.files);
      fileInput.value = null;
    });
    const addRemoveButtons = createDomElement("add-remove-buttons");
    addRemoveButtons.addButtonCallback = () => fileInput.click();
    addRemoveButtons.removeButtonCallback = async () => {
      const index = this.filesUIList.getSelectedItemIndex();
      const maxIndex = () => this.filesUIList.items.length - 1;
      if (!isNaN(index) && index <= maxIndex()) {
        await this._deleteItemOrAll(index);
        this.filesUIList.setSelectedItemIndex(maxIndex(), true);
      }
    };

    const disableRemoveButtonIfNeeded = () => {
      addRemoveButtons.disableRemoveButton = this.filesUIList.items.length === 0;
    };
    this.filesUIList.addEventListener("itemsSet", () => disableRemoveButtonIfNeeded());
    disableRemoveButtonIfNeeded(); // On load

    return div(
      {
        class: "panel",
      },
      [
        div(
          {
            class:
              "panel-section panel-section--flex panel-section--noscroll reference-font-section",
          },
          [
            div({ class: "title" }, [translate("sidebar.reference-font")]),
            div({}, [translate("sidebar.reference-font.info")]),
            div({ class: "reference-font-items" }, [
              this.filesUIList,
              form({ enctype: "multipart/form-data", hidden: true }, [fileInput]),
              addRemoveButtons,
            ]),
            div(
              {
                style: `
                display: grid;
                grid-template-columns: max-content auto;
                align-items: center;
                gap: 0.666em;
                `,
              },
              [
                label(
                  { for: "char-override" },
                  translate("sidebar.reference-font.custom-character")
                ),
                input({
                  type: "text",
                  id: "char-override",
                  value: this.model.charOverride,
                  oninput: (event) => (this.model.charOverride = event.target.value),
                }),
                label(
                  { for: "language-code" },
                  translate("sidebar.reference-font.language")
                ),
                this.languageCodeInput,
              ]
            ),
            div({ class: "reference-font-preview" }, []),
          ]
        ),
      ]
    );
  }
}

customElements.define("panel-reference-font", ReferenceFontPanel);
