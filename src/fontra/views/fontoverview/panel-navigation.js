import { groupByKeys, groupByProperties } from "/core/glyph-organizer.js";
import * as html from "/core/html-utils.js";
import { translate } from "/core/localization.js";
import { ObservableController } from "/core/observable-object.js";
import { glyphSetDataFormats } from "/core/parse-glyphset.js";
import { difference, symmetricDifference, union } from "/core/set-ops.js";
import {
  labeledCheckbox,
  labeledPopupSelect,
  labeledTextInput,
  popupSelect,
} from "/core/ui-utils.js";
import { fetchJSON, scheduleCalls } from "/core/utils.js";
import { DesignspaceLocation } from "/web-components/designspace-location.js";
import { GlyphSearchField } from "/web-components/glyph-search-field.js";
import { IconButton } from "/web-components/icon-button.js"; // required for the icon buttons
import { showMenu } from "/web-components/menu-panel.js";
import { dialogSetup, message } from "/web-components/modal-dialog.js";
import { PopupMenu } from "/web-components/popup-menu.js";
import { Accordion } from "/web-components/ui-accordion.js";

export class FontOverviewNavigation extends HTMLElement {
  constructor(fontOverviewController) {
    super();

    this.fontController = fontOverviewController.fontController;
    this.fontOverviewSettingsController =
      fontOverviewController.fontOverviewSettingsController;
    this.fontOverviewSettings = this.fontOverviewSettingsController.model;

    this._checkboxControllers = {};
    this._glyphSetErrorButtons = {};

    this._setupUI();
  }

  async _setupUI() {
    this.searchField = new GlyphSearchField({
      settingsController: this.fontOverviewSettingsController,
      searchStringKey: "searchString",
    });

    this.appendChild(this.searchField);

    const accordion = new Accordion();
    this.accordion = accordion;

    accordion.appendStyle(`
      .glyph-set-container {
        display: grid;
        justify-items: left;
        gap: 0.5em;
      }

      .checkbox-group {
        width: 100%;
        display: grid;
        grid-template-columns: auto auto;
        justify-content: space-between;
      }

      .glyphset-button-group {
        justify-self: end;
        display: grid;
        grid-template-columns: auto auto;
        gap: 0.2em;
      }

      icon-button {
        width: 1.2em;
        height: 1.2em;
      }

      .glyphset-error-button {
        color: var(--fontra-light-red-color);
        opacity: 0;
      }

      .glyphset-error-button.glyphset-error {
        opacity: 1;
      }

      .glyphset-error-button.loading {
        opacity: 1;
        color: #8888;
        animation: loading-spinner 0.8s linear infinite;
      }

      @keyframes loading-spinner {
        to {
          transform: rotate(360deg);
        }
      }

      .font-source-location-container {
        display: grid;
        gap: 0.5em;
      }
    `);

    accordion.onItemOpenClose = (item, openClose) => {
      const setOp = openClose ? difference : union;
      this.fontOverviewSettingsController.setItem(
        "closedNavigationSections",
        setOp(this.fontOverviewSettings.closedNavigationSections, [item.id]),
        { sentFromUserClick: true }
      );
    };

    this.fontOverviewSettingsController.addKeyListener(
      "closedNavigationSections",
      (event) => {
        if (!event.senderInfo?.sentFromUserClick) {
          const diff = symmetricDifference(event.newValue, event.oldValue);
          for (const id of diff) {
            const item = accordion.items.find((item) => item.id == id);
            accordion.openCloseAccordionItem(item, !event.newValue.has(id));
          }
        }
      }
    );

    this._projectGlyphSetsItem = {
      label: "Project glyph sets", // TODO: translate
      id: "project-glyph-sets",
      content: html.div(),
      auxiliaryHeaderElement: this._makeAddGlyphSetButton(
        true,
        "Add a glyph set to the project"
      ),
    };

    this._myGlyphSetsItem = {
      label: "My glyph sets", // TODO: translate
      id: "my-glyph-sets",
      content: html.div(),
      auxiliaryHeaderElement: this._makeAddGlyphSetButton(
        false,
        "Add a glyph set to my sets"
      ),
    };

    const accordionItems = [
      {
        label: translate("sources.labels.location"),
        id: "location",
        content: html.div({ class: "font-source-location-container" }, [
          await this._makeFontSourcePopup(),
          this._makeFontSourceSliders(),
        ]),
      },
      {
        label: "Group by", // TODO: translate
        id: "group-by",
        content: this._makeGroupByUI(),
      },
      this._projectGlyphSetsItem,
      this._myGlyphSetsItem,
    ];

    accordionItems.forEach(
      (item) =>
        (item.open = !this.fontOverviewSettings.closedNavigationSections.has(item.id))
    );

    accordion.items = accordionItems;

    this.appendChild(
      html.div({ class: "font-overview-navigation-section" }, [accordion])
    );

    this.fontOverviewSettingsController.addKeyListener("projectGlyphSets", (event) =>
      this._updateProjectGlyphSets()
    );
    this.fontOverviewSettingsController.addKeyListener("myGlyphSets", (event) =>
      this._updateMyGlyphSets()
    );
    this._updateProjectGlyphSets();
    this._updateMyGlyphSets();

    this.fontOverviewSettingsController.addKeyListener(
      "glyphSetErrors",
      (event) => {
        const allKeys = union(
          new Set(Object.keys(event.oldValue)),
          Object.keys(event.newValue)
        );
        for (const key of allKeys) {
          if (event.oldValue[key] === event.newValue[key]) {
            continue;
          }

          const isLoading = event.newValue[key] === "...";

          const errorButton = this._glyphSetErrorButtons[key];

          errorButton.src = isLoading
            ? "/tabler-icons/loader-2.svg"
            : "/tabler-icons/alert-triangle.svg";

          errorButton.classList.toggle(
            "glyphset-error",
            !!(event.newValue[key] && event.newValue[key] !== "...")
          );

          errorButton.classList.toggle("loading", event.newValue[key] === "...");
        }
      },
      true
    );
  }

  async _makeFontSourcePopup() {
    const fontSources = await this.fontController.getSources();
    const popupItems = [];

    const selectedSourceIdentifier = () =>
      this.fontController.fontSourcesInstancer.getLocationIdentifierForLocation(
        this.fontOverviewSettings.fontLocationSource
      );

    const updatePopupItems = () => {
      popupItems.splice(
        0,
        popupItems.length,
        ...this.fontController
          .getSortedSourceIdentifiers()
          .map((fontSourceIdentifier) => ({
            value: fontSourceIdentifier,
            label: fontSources[fontSourceIdentifier].name,
          }))
      );
    };

    updatePopupItems();

    const controller = new ObservableController({
      value: selectedSourceIdentifier(),
    });

    this.fontOverviewSettingsController.addKeyListener(
      "fontLocationSource",
      (event) => {
        if (!event.senderInfo?.sentFromInput) {
          controller.setItem("value", selectedSourceIdentifier(), {
            sentFromSourceLocationListener: true,
          });
        }
      }
    );

    controller.addKeyListener("value", (event) => {
      const fontSourceIdentifier = event.newValue;
      const sourceLocation = fontSources[fontSourceIdentifier]?.location;
      if (sourceLocation && !event.senderInfo?.sentFromSourceLocationListener) {
        this.fontOverviewSettingsController.setItem(
          "fontLocationSource",
          { ...sourceLocation },
          { sentFromInput: true }
        );
      }
    });

    this.fontController.addChangeListener(
      { sources: null },
      (change, isExternalChange) => {
        updatePopupItems();
        // Trigger *label* refresh. The *value* may not have changed, so we'll
        // briefly set it to null to ensure the listeners get triggered
        controller.model.value = null;
        controller.model.value = selectedSourceIdentifier();
      }
    );

    return popupSelect(controller, "value", popupItems);
  }

  _makeFontSourceSliders() {
    const locationElement = new DesignspaceLocation();
    locationElement.axes = this.fontController.axes.axes;
    locationElement.values = { ...this.fontOverviewSettings.fontLocationUser };

    this.fontOverviewSettingsController.addKeyListener("fontLocationUser", (event) => {
      if (!event.senderInfo?.sentFromSliders) {
        locationElement.values = { ...event.newValue };
      }
    });

    locationElement.addEventListener(
      "locationChanged",
      scheduleCalls((event) => {
        this.fontOverviewSettingsController.setItem(
          "fontLocationUser",
          { ...locationElement.values },
          { sentFromSliders: true }
        );
      })
    );

    this.fontController.addChangeListener(
      { axes: null },
      (change, isExternalChange) => {
        locationElement.axes = this.fontController.axes.axes;
        locationElement.values = { ...this.fontOverviewSettings.fontLocationUser };
      }
    );

    return locationElement;
  }

  _makeGroupByUI() {
    return this._makeCheckboxUI("groupByKeys", groupByProperties);
  }

  _makeAddGlyphSetButton(isProjectGlyphSet, toolTip) {
    return html.createDomElement("icon-button", {
      "src": "/images/plus.svg",
      "onclick": (event) => this._addGlyphSet(event, isProjectGlyphSet),
      "data-tooltip": toolTip,
      "data-tooltipposition": "left",
    });
  }

  _updateProjectGlyphSets() {
    this._projectGlyphSetsItem.content.innerHTML = "";
    this._projectGlyphSetsItem.content.appendChild(this._makeProjectGlyphSetsUI());
  }

  _updateMyGlyphSets() {
    this._myGlyphSetsItem.content.innerHTML = "";
    this._myGlyphSetsItem.content.appendChild(this._makeMyGlyphSetsUI());
  }

  _makeProjectGlyphSetsUI() {
    const projectGlyphSets = this._prepareGlyphSets(
      this.fontOverviewSettings.projectGlyphSets,
      true
    );

    return html.div({ class: "glyph-set-container" }, [
      this._makeCheckboxUI("projectGlyphSetSelection", projectGlyphSets),
    ]);
  }

  _makeMyGlyphSetsUI() {
    const myGlyphSets = this._prepareGlyphSets(
      this.fontOverviewSettings.myGlyphSets,
      false
    );

    return html.div({ class: "glyph-set-container" }, [
      this._makeCheckboxUI("myGlyphSetSelection", myGlyphSets),
    ]);
  }

  _prepareGlyphSets(glyphSets, isProjectGlyphSet) {
    return Object.entries(glyphSets)
      .map(([key, glyphSet]) => ({
        key,
        label: glyphSet.name,
        extraItem: glyphSet.url
          ? html.div({ class: "glyphset-button-group" }, [
              this._makeGlyphSetErrorButton(glyphSet, isProjectGlyphSet),
              this._makeGlyphSetMenuButton(glyphSet, isProjectGlyphSet),
            ])
          : null,
      }))
      .sort((a, b) => {
        if (a.label == b.label) {
          return 0;
        }
        if (!a.key) {
          return -1;
        } else if (!b.key) {
          return 1;
        }
        return a.label < b.label ? -1 : 1;
      });
  }

  _makeGlyphSetMenuButton(glyphSet, isProjectGlyphSet) {
    return html.createDomElement("icon-button", {
      src: "/tabler-icons/pencil.svg",
      onclick: (event) => {
        const buttonRect = event.target.getBoundingClientRect();
        showMenu(
          [
            {
              title: "Edit",
              callback: (event) => {
                this._editGlyphSet(event, isProjectGlyphSet, glyphSet);
              },
            },
            {
              title: "Delete",
              callback: (event) => {
                this._deleteGlyphSet(event, isProjectGlyphSet, glyphSet);
              },
            },
            {
              title: "Reload",
              callback: (event) => {
                this._reloadGlyphSet(event, isProjectGlyphSet, glyphSet);
              },
            },
            {
              title: `Copy to ${
                isProjectGlyphSet ? "my glyph sets" : "project glyph sets"
              }`,
              callback: (event) => {
                this._copyGlyphSet(event, isProjectGlyphSet, glyphSet);
              },
            },
          ],
          {
            x: buttonRect.left,
            y: buttonRect.bottom,
          }
        );
      },
      // "data-tooltip": "------",
      // "data-tooltipposition": "left",
    });
  }

  _makeGlyphSetErrorButton(glyphSet, isProjectGlyphSet) {
    const errorButton = html.createDomElement("icon-button", {
      class: "glyphset-error-button",
      src: "/tabler-icons/alert-triangle.svg",
      onclick: (event) => {
        const errorMessage = this.fontOverviewSettings.glyphSetErrors[glyphSet.url];
        if (errorMessage) {
          message(`The glyph set “${glyphSet.name}” could not be loaded`, errorMessage);
        }
      },
    });

    this._glyphSetErrorButtons[glyphSet.url] = errorButton;

    return errorButton;
  }

  _makeCheckboxUI(settingsKey, glyphSets) {
    let checkboxController = this._checkboxControllers[settingsKey];
    if (!checkboxController) {
      checkboxController = makeCheckboxController(
        this.fontOverviewSettingsController,
        settingsKey
      );
      this._checkboxControllers[settingsKey] = checkboxController;
    }

    return html.div({ class: "checkbox-group" }, [
      ...glyphSets
        .map(({ key, label, extraItem }) => [
          labeledCheckbox(label, checkboxController, key),
          extraItem ? extraItem : html.div(),
        ])
        .flat(),
    ]);
  }

  async _addGlyphSet(event, isProjectGlyphSet) {
    const { glyphSets, custom } = await runAddGlyphSetDialog(
      isProjectGlyphSet
        ? this.fontOverviewSettings.projectGlyphSets
        : this.fontOverviewSettings.myGlyphSets
    );

    if (custom) {
      await this._editGlyphSet(event, isProjectGlyphSet);
    } else if (glyphSets) {
      const key = isProjectGlyphSet ? "projectGlyphSets" : "myGlyphSets";
      this.fontOverviewSettings[key] = glyphSets;
    }

    this._openGlyphSetsItem(isProjectGlyphSet);
  }

  async _editGlyphSet(event, isProjectGlyphSet, glyphSetInfo = null) {
    const glyphSet = await runEditGlyphSetDialog(glyphSetInfo);
    if (!glyphSet) {
      return;
    }

    const key = isProjectGlyphSet ? "projectGlyphSets" : "myGlyphSets";
    const glyphSets = {
      ...this.fontOverviewSettings[key],
    };
    if (glyphSetInfo?.url) {
      delete glyphSets[glyphSetInfo.url];
    }
    glyphSets[glyphSet.url] = glyphSet;
    this.fontOverviewSettings[key] = glyphSets;
  }

  _openGlyphSetsItem(isProjectGlyphSet) {
    if (isProjectGlyphSet) {
      this.accordion.openCloseAccordionItem(this._projectGlyphSetsItem, true);
    } else {
      this.accordion.openCloseAccordionItem(this._myGlyphSetsItem, true);
    }
  }

  _deleteGlyphSet(event, isProjectGlyphSet, glyphSetInfo) {
    const key = isProjectGlyphSet ? "projectGlyphSets" : "myGlyphSets";
    const glyphSets = {
      ...this.fontOverviewSettings[key],
    };
    delete glyphSets[glyphSetInfo.url];
    this.fontOverviewSettings[key] = glyphSets;
  }

  _reloadGlyphSet(event, isProjectGlyphSet, glyphSet) {
    const key = isProjectGlyphSet ? "projectGlyphSets" : "myGlyphSets";

    this.fontOverviewSettings[key] = {
      ...this.fontOverviewSettings[key],
      [glyphSet.url]: { ...glyphSet },
    };
  }

  _copyGlyphSet(event, isProjectGlyphSet, glyphSet) {
    const fromKey = isProjectGlyphSet ? "projectGlyphSets" : "myGlyphSets";
    const toKey = isProjectGlyphSet ? "myGlyphSets" : "projectGlyphSets";
    this.fontOverviewSettings[toKey] = {
      ...this.fontOverviewSettings[toKey],
      [glyphSet.url]: glyphSet,
    };
  }
}

customElements.define("font-overview-navigation", FontOverviewNavigation);

function makeCheckboxController(settingsController, settingsKey) {
  const settings = settingsController.model;

  const checkboxController = new ObservableController(
    Object.fromEntries(settings[settingsKey].map((key) => [key, true]))
  );

  checkboxController.addListener((event) => {
    if (!event.senderInfo?.sentFromSettings) {
      settings[settingsKey] = Object.entries(checkboxController.model)
        .filter(([key, value]) => value)
        .map(([key, value]) => key);
    }
  });

  settingsController.addKeyListener(settingsKey, (event) => {
    checkboxController.withSenderInfo({ sentFromSettings: true }, () => {
      Object.entries(checkboxController.model).forEach(([key, value]) => {
        checkboxController.model[key] = event.newValue.includes(key);
      });
    });
  });

  return checkboxController;
}

let glyphSetPresets;

fetchJSON("/data/glyphset-presets.json").then((result) => {
  glyphSetPresets = result;
});

async function runAddGlyphSetDialog(initialGlyphSets) {
  const dialog = new AddPresetGlyphSetDialog(initialGlyphSets);
  return await dialog.run();
}

const CHECKBOX_PREFIX = "checkbox-";
const SELECTED_GLYPHSET_LOCAL_STORAGE_KEY = "fontra-selected-glyphset-collection";

class AddPresetGlyphSetDialog {
  static styles = `
    .content-container {
      display: grid;
      grid-template-columns: max-content auto;
      align-items: center;
      align-content: start;
      gap: 0.5em;
      height: calc(80vh - 10em); /* Nasty: the 10em value depends on the rest of the contents */
    }

    .checkbox-container {
      height: 100%;
      overflow: scroll;
    }

    .checkbox-group {
      display: grid;
    }

    a {
      color: var(--foreground-color);
      text-decoration: underline;
    }

    a.suggest-link {
      font-style: italic;
    }

    .collection-popup {
      width: 18em;
    }
  `;

  constructor(initialGlyphSets) {
    this.initialGlyphSets = initialGlyphSets;
    this.dialogController = new ObservableController({
      ...Object.fromEntries(
        Object.values(initialGlyphSets).map((glyphSet) => [
          CHECKBOX_PREFIX + glyphSet.url,
          true,
        ])
      ),
    });

    this.sourceURLElement = html.a(
      {
        id: "info-link",
        target: "_blank",
      },
      [this.dialogController.model.sourceURL || ""]
    );
    this.checkboxContainer = html.div({ class: "checkbox-container" });

    const collectionNames = glyphSetPresets.map((collection) => collection.name);
    collectionNames.sort();

    this.dialogContent = html.div({ class: "content-container" }, [
      ...labeledPopupSelect(
        "Collection",
        this.dialogController,
        "collectionName",
        collectionNames.map((name) => ({ value: name, label: name })),
        { class: "collection-popup" }
      ),
      html.div(),
      html.a(
        {
          href: "https://github.com/googlefonts/fontra/discussions/1943",
          target: "_blank",
          class: "suggest-link",
        },
        ["Suggest more glyph set collections"]
      ),
      html.label({ for: "info-link", style: "text-align: right;" }, ["Source"]),
      this.sourceURLElement,
      html.div(), // grid cell filler
      this.checkboxContainer,
    ]);

    this.dialogController.addKeyListener("collectionName", (event) => {
      this.setSelectedGlyphsetCollection(event.newValue);
      localStorage.setItem(SELECTED_GLYPHSET_LOCAL_STORAGE_KEY, event.newValue);
    });

    this.dialogController.model.collectionName =
      localStorage.getItem(SELECTED_GLYPHSET_LOCAL_STORAGE_KEY) || "Google Fonts";
  }

  setSelectedGlyphsetCollection(collectionName) {
    const collection = glyphSetPresets.find(
      (collection) => collection.name === collectionName
    );
    this.sourceURLElement.href = collection.sourceURL;
    this.sourceURLElement.innerText = collection.sourceURL;
    this.checkboxContainer.innerHTML = "";
    this.checkboxContainer.appendChild(this.checkboxesForCollection(collection));
  }

  checkboxesForCollection(collection) {
    const checkboxes = collection.glyphSets.map((glyphSet) => {
      const key = CHECKBOX_PREFIX + glyphSet.url;
      return labeledCheckbox(glyphSet.name, this.dialogController, key);
    });
    return html.div({}, checkboxes);
  }

  async run() {
    const dialog = await dialogSetup("Add/remove preset glyph sets", "", [
      { title: "Add custom glyph set...", resultValue: "custom" }, // TODO: translate
      { title: translate("dialog.cancel"), isCancelButton: true },
      { title: "Save", isDefaultButton: true, resultValue: "add" }, // TODO: translate
    ]);

    dialog.appendStyle(this.constructor.styles);
    dialog.setContent(this.dialogContent);

    const result = await dialog.run();
    if (result === "custom") {
      return { custom: true };
    } else if (result !== "add") {
      return {};
    }

    const allGlyphSetsByURL = {};
    for (const collection of glyphSetPresets) {
      for (const glyphSet of collection.glyphSets) {
        allGlyphSetsByURL[glyphSet.url] = { glyphSet, collection };
      }
    }
    const glyphSets = { ...this.initialGlyphSets };
    for (const [key, value] of Object.entries(this.dialogController.model)) {
      if (!key.startsWith(CHECKBOX_PREFIX)) {
        continue;
      }
      const url = key.slice(CHECKBOX_PREFIX.length);
      if (!url) {
        continue;
      }
      if (value) {
        if (allGlyphSetsByURL[url]) {
          const { glyphSet, collection } = allGlyphSetsByURL[url];
          glyphSets[url] = { ...collection.dataOptions, ...glyphSet };
        }
      } else {
        delete glyphSets[url];
      }
    }
    return { glyphSets };
  }
}

async function runEditGlyphSetDialog(glyphSetInfo) {
  const isEditing = !!glyphSetInfo;
  glyphSetInfo = {
    dataFormat: "glyph-names",
    codePointIsDecimal: false,
    ...glyphSetInfo,
  };
  const dialogController = new ObservableController(glyphSetInfo);

  const validateInput = () => {
    let valid = true;
    let url;
    try {
      url = new URL(dialogController.model.url);
    } catch (e) {
      valid = false;
    }
    if (url?.pathname.length <= 1 || !url?.hostname.includes(".")) {
      valid = false;
    }
    if (!dialogController.model.name) {
      valid;
    }
    // TODO: warningsElement: say what/why it's invalid
    dialog.defaultButton.classList.toggle("disabled", !valid);
  };

  const updateDataFormat = () => {
    dialog.style.setProperty(
      "--glyphset-data-format-tsv-csv-display",
      dialogController.model.dataFormat === "tsv/csv" ? "initial" : "none"
    );
  };

  dialogController.addListener((event) => validateInput());
  dialogController.addKeyListener("dataFormat", (event) => updateDataFormat());

  const dialog = await dialogSetup(
    isEditing ? "Edit glyph set" : "Add custom glyph set",
    "",
    [
      { title: translate("dialog.cancel"), isCancelButton: true },
      {
        title: translate(isEditing ? "Save" : "dialog.add"), // TODO: translate dialog.save
        isDefaultButton: true,
        disabled: true,
      },
    ]
  );

  validateInput();
  updateDataFormat();

  const contentStyle = `
  .glyph-set-dialog-content {
    display: grid;
    gap: 0.5em;
    grid-template-columns: max-content auto;
    align-items: center;
    width: 38em;
  }

  .code-point-popup {
    width: 8em;
  }

  .tsv-csv-only {
    display: var(--glyphset-data-format-tsv-csv-display, initial);
  }
  `;

  dialog.appendStyle(contentStyle);

  const codePointIsDecimal = [
    { value: false, label: "Hexadecimal" },
    { value: true, label: "Decimal" },
  ];

  dialog.setContent(
    html.div({ class: "glyph-set-dialog-content" }, [
      ...labeledTextInput("Name", dialogController, "name"),
      ...labeledTextInput("URL", dialogController, "url"),
      ...labeledTextInput("Note", dialogController, "note"),
      ...labeledPopupSelect(
        "Data format",
        dialogController,
        "dataFormat",
        glyphSetDataFormats
      ),
      ...labeledTextInput("Comment characters", dialogController, "commentChars"),
      html.div({ class: "tsv-csv-only" }), // grid cell filler
      labeledCheckbox("Has header", dialogController, "hasHeader", {
        class: "tsv-csv-only",
      }),
      ...labeledTextInput("Glyph name column", dialogController, "glyphNameColumn", {
        class: "tsv-csv-only",
        labelClass: "tsv-csv-only",
      }),
      ...labeledTextInput("Code point column", dialogController, "codePointColumn", {
        class: "tsv-csv-only",
        labelClass: "tsv-csv-only",
      }),
      ...labeledPopupSelect(
        "Code point",
        dialogController,
        "codePointIsDecimal",
        codePointIsDecimal,
        { class: "code-point-popup tsv-csv-only", labelClass: "tsv-csv-only" }
      ),
    ])
  );
  const result = await dialog.run();
  return !!(result && glyphSetInfo.name && glyphSetInfo.url) ? glyphSetInfo : null;
}
