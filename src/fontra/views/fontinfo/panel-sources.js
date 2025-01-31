import { recordChanges } from "../core/change-recorder.js";
import * as html from "../core/html-utils.js";
import { addStyleSheet } from "../core/html-utils.js";
import { translate } from "../core/localization.js";
import { ObservableController } from "../core/observable-object.js";
import {
  OptionalNumberFormatter,
  labelForElement,
  labeledCheckbox,
  labeledTextInput,
  textInput,
} from "../core/ui-utils.js";
import { enumerate, round } from "../core/utils.js";
import { BaseInfoPanel } from "./panel-base.js";
import {
  locationToString,
  makeSparseLocation,
  mapAxesFromUserSpaceToSourceSpace,
} from "/core/var-model.js";
import "/web-components/add-remove-buttons.js";
import "/web-components/designspace-location.js";
import { dialogSetup, message } from "/web-components/modal-dialog.js";

addStyleSheet(`
.font-sources-container {
  display: flex;
  height: calc(100vh - 7em);
}

#font-sources-container-names {
  display: grid;
  align-content: start;
  gap: 0.5em;
}

#font-sources-container-source-content {
  display: grid;
  gap: 0.5em;
  width: 100%;
  overflow: auto;
}
`);

export class SourcesPanel extends BaseInfoPanel {
  static title = "sources.title";
  static id = "sources-panel";
  static fontAttributes = ["axes", "sources"];

  initializePanel() {
    super.initializePanel();
    this.fontController.addChangeListener(
      { axes: null },
      (change, isExternalChange) => {
        this.setupUI();
        this.undoStack.clear();
      },
      false
    );
  }

  async setupUI() {
    const sources = await this.fontController.getSources();
    this.fontAxesSourceSpace = mapAxesFromUserSpaceToSourceSpace(
      this.fontController.axes.axes
    );

    this.panelElement.innerHTML = "";

    const container = html.div({
      class: "font-sources-container",
    });

    const containerSourcesNames = html.div({
      id: "font-sources-container-names",
    });

    const containerSourceContent = html.div({
      id: "font-sources-container-source-content",
    });

    for (const [i, identifier] of enumerate(
      this.fontController.getSortedSourceIdentifiers()
    )) {
      const sourceBoxNameElement = new SourceNameBox(
        this.fontAxesSourceSpace,
        sources,
        identifier,
        this.postChange.bind(this),
        this.setupUI.bind(this)
      );
      if (i == 0) {
        // be default the first source is selected.
        sourceBoxNameElement.classList.add("selected");
      }
      containerSourcesNames.appendChild(sourceBoxNameElement);
    }

    containerSourcesNames.appendChild(
      html.input({
        type: "button",
        class: "fontra-button",
        style: `justify-self: start;`,
        value: "+", //translate("sources.button.new-font-source") // TODO: do we want to remove not used tanslation keys in the google sheet, or do we keep them just in case we may need them again one day?
        onclick: (event) => this.newSource(),
      })
    );

    // first source
    containerSourceContent.appendChild(
      new SourceBox(
        this.fontAxesSourceSpace,
        sources,
        this.fontController.getSortedSourceIdentifiers()[0],
        this.postChange.bind(this),
        this.setupUI.bind(this)
      )
    );

    container.appendChild(containerSourcesNames);
    container.appendChild(containerSourceContent);
    this.panelElement.appendChild(container);
    this.panelElement.focus();
  }

  async newSource() {
    const newSource = await this._sourcePropertiesRunDialog();
    if (!newSource) {
      return;
    }

    const undoLabel = `add source '${newSource.name}'`;

    let sourceIdentifier;
    do {
      sourceIdentifier = crypto.randomUUID().slice(0, 8);
    } while (sourceIdentifier in this.fontController.sources);

    const root = { sources: this.fontController.sources };
    const changes = recordChanges(root, (root) => {
      root.sources[sourceIdentifier] = newSource;
    });
    if (changes.hasChange) {
      this.postChange(changes.change, changes.rollbackChange, undoLabel);
      this.setupUI();
    }
  }

  async _sourcePropertiesRunDialog() {
    const sources = await this.fontController.getSources();
    const locationAxes = this.fontAxesSourceSpace;
    const validateInput = () => {
      const warnings = [];
      const editedSourceName = nameController.model.sourceName;
      if (!editedSourceName.length || !editedSourceName.trim()) {
        warnings.push(`⚠️ ${translate("sources.warning.empty-source-name")}`);
      }
      if (
        Object.keys(sources)
          .map((sourceIdentifier) => {
            if (sources[sourceIdentifier].name === editedSourceName.trim()) {
              return true;
            }
          })
          .includes(true)
      ) {
        warnings.push(`⚠️ ${translate("sources.warning.unique-source-name")}`);
      }
      const locStr = locationToString(
        makeSparseLocation(locationController.model, locationAxes)
      );
      if (sourceLocations.has(locStr)) {
        warnings.push(`⚠️ ${translate("sources.warning.unique-location")}`);
      }
      warningElement.innerText = warnings.length ? warnings.join("\n") : "";
      dialog.defaultButton.classList.toggle("disabled", warnings.length);
    };

    const nameController = new ObservableController({
      sourceName: this.getSourceName(sources),
    });

    nameController.addKeyListener("sourceName", (event) => {
      validateInput();
    });

    const sourceLocations = new Set(
      Object.keys(sources).map((sourceIdentifier) => {
        return locationToString(
          makeSparseLocation(sources[sourceIdentifier].location, locationAxes)
        );
      })
    );

    const locationController = new ObservableController({});
    locationController.addListener((event) => {
      validateInput();
    });

    const { contentElement, warningElement } = this._sourcePropertiesContentElement(
      locationAxes,
      nameController,
      locationController
    );

    const disable = nameController.model.sourceName ? false : true;

    const dialog = await dialogSetup(
      translate("sources.dialog.add-source.title"),
      null,
      [
        { title: translate("dialog.cancel"), isCancelButton: true },
        { title: translate("dialog.add"), isDefaultButton: true, disabled: disable },
      ]
    );
    dialog.setContent(contentElement);

    setTimeout(
      () => contentElement.querySelector("#font-source-name-text-input")?.focus(),
      0
    );

    validateInput();

    if (!(await dialog.run())) {
      // User cancelled
      return;
    }

    let newLocation = makeSparseLocation(locationController.model, locationAxes);
    for (const axis of locationAxes) {
      if (!(axis.name in newLocation)) {
        newLocation[axis.name] = axis.defaultValue;
      }
    }

    const interpolatedSource = getInterpolatedSourceData(
      this.fontController,
      newLocation
    );

    const newSource = {
      name: nameController.model.sourceName.trim(),
      location: newLocation,
    };

    if (interpolatedSource.lineMetricsHorizontalLayout) {
      newSource.lineMetricsHorizontalLayout = getLineMetricsHorRounded(
        interpolatedSource.lineMetricsHorizontalLayout
      );
    }

    return {
      lineMetricsHorizontalLayout: getDefaultLineMetricsHor(
        this.fontController.unitsPerEm
      ),
      ...interpolatedSource,
      ...newSource,
    };
  }

  getSourceName(sources) {
    const sourceNames = Object.keys(sources).map((sourceIdentifier) => {
      return sources[sourceIdentifier].name;
    });
    let sourceName = translate("sources.untitled-source");
    let i = 1;
    while (sourceNames.includes(sourceName)) {
      sourceName = `${translate("sources.untitled-source")} ${i}`;
      i++;
    }
    return sourceName;
  }

  _sourcePropertiesContentElement(locationAxes, nameController, locationController) {
    const locationElement = html.createDomElement("designspace-location", {
      style: `grid-column: 1 / -1;
        min-height: 0;
        overflow: auto;
        height: 100%;
      `,
    });
    locationElement.axes = locationAxes;
    locationElement.controller = locationController;

    const containerContent = [
      ...labeledTextInput(
        translate("sources.dialog.add-source.label.source-name"),
        nameController,
        "sourceName",
        {}
      ),
      html.br(),
      locationElement,
    ];

    const warningElement = html.div({
      id: "warning-text",
      style: `grid-column: 1 / -1; min-height: 1.5em;`,
    });
    containerContent.push(warningElement);

    const contentElement = html.div(
      {
        style: `overflow: hidden;
          white-space: nowrap;
          display: grid;
          gap: 0.5em;
          grid-template-columns: max-content auto;
          align-items: center;
          height: 100%;
          min-height: 0;
        `,
      },
      containerContent
    );

    return { contentElement, warningElement };
  }
}

addStyleSheet(`
  .fontra-ui-font-info-sources-panel-source-name-box {
    background-color: var(--ui-element-background-color);
    border-radius: 0.5em;
    padding: 1em;
    cursor: pointer;
    display: grid;
    grid-template-columns: max-content auto;
    grid-column-gap: 1em;
  }

  .fontra-ui-font-info-sources-panel-source-name-box.selected {
    background-color: var(--horizontal-rule-color);
  }

  .fontra-ui-font-info-sources-panel-icon {
    justify-self: end;
    align-self: start;
  }

`);

class SourceNameBox extends HTMLElement {
  constructor(fontAxesSourceSpace, sources, sourceIdentifier, postChange, setupUI) {
    super();
    this.classList.add("fontra-ui-font-info-sources-panel-source-name-box");
    this.id = `source-name-box-${sourceIdentifier}`;
    this.fontAxesSourceSpace = fontAxesSourceSpace;
    this.sources = sources;
    this.sourceIdentifier = sourceIdentifier;
    this.postChange = postChange;
    this.setupUI = setupUI;
    this.controllers = {};
    this._updateContents();
  }

  get source() {
    return this.sources[this.sourceIdentifier];
  }

  deleteSource() {
    const undoLabel = translate("sources.undo.delete", this.source.name);
    const root = { sources: this.sources };
    const changes = recordChanges(root, (root) => {
      delete root.sources[this.sourceIdentifier];
    });
    if (changes.hasChange) {
      this.postChange(changes.change, changes.rollbackChange, undoLabel);
      this.setupUI();
    }
  }

  onclickFunc() {
    const sourceNameBoxes = document.querySelectorAll(
      ".fontra-ui-font-info-sources-panel-source-name-box"
    );
    for (const sourceBox of sourceNameBoxes) {
      if (sourceBox != this) {
        sourceBox.classList.remove("selected");
      }
    }
    this.classList.add("selected");
    // update content card

    const containerSourceContent = document.getElementById(
      "font-sources-container-source-content"
    );
    containerSourceContent.innerHTML = "";
    containerSourceContent.appendChild(
      new SourceBox(
        this.fontAxesSourceSpace,
        this.sources,
        this.sourceIdentifier,
        this.postChange.bind(this),
        this.setupUI.bind(this)
      )
    );
  }

  _updateContents() {
    (this.onclick = (event) => this.onclickFunc()),
      // this.innerHTML = `${this.source.name}`;

      this.append(
        html.div({ id: `source-name-box-name-${this.sourceIdentifier}` }, [
          this.source.name,
        ])
      );

    this.append(
      html.createDomElement("icon-button", {
        "class": "fontra-ui-font-info-sources-panel-icon",
        "src": "/tabler-icons/trash.svg",
        "onclick": (event) => this.deleteSource(),
        "data-tooltip": translate("sources.tooltip.delete-source"),
        "data-tooltipposition": "right",
      })
    );
  }
}

customElements.define("source-name-box", SourceNameBox);

addStyleSheet(`
.fontra-ui-font-info-sources-panel-source-box {
  background-color: var(--ui-element-background-color);
  border-radius: 0.5em;
  padding: 1em;
  margin-left: 1em;
  height: fit-content;
}

.fontra-ui-font-info-sources-panel-column {
  display: grid;
  grid-template-columns: minmax(4.5em, max-content) minmax(40%, max-content);
  gap: 0.5em;
  align-items: start;
  align-content: start;
  padding-bottom: 2em;
  justify-content: center;
}

.fontra-ui-font-info-sources-panel-line-metrics-hor {
  grid-template-columns: minmax(4.5em, max-content) 4em 4em;
}

.fontra-ui-font-info-sources-panel-header {
  font-weight: bold;
  padding-bottom: 1em;
}

`);

class SourceBox extends HTMLElement {
  constructor(fontAxesSourceSpace, sources, sourceIdentifier, postChange, setupUI) {
    super();
    this.classList.add("fontra-ui-font-info-sources-panel-source-box");
    this.fontAxesSourceSpace = fontAxesSourceSpace;
    this.sources = sources;
    this.sourceIdentifier = sourceIdentifier;
    this.postChange = postChange;
    this.setupUI = setupUI;
    this.controllers = {};
    this.models = this._getModels();
    this._updateContents();
  }

  get source() {
    return this.sources[this.sourceIdentifier];
  }

  _getModels() {
    const source = this.source;
    return {
      general: {
        name: source.name,
        italicAngle: source.italicAngle ? source.italicAngle : 0,
        //isSparse: source.isSparse ? source.isSparse : false,
      },
      location: { ...source.location },
      lineMetricsHorizontalLayout: prepareLineMetricsHorForController(
        source.lineMetricsHorizontalLayout
      ),
      // TODO: hhea, OS/2 line metrics, etc
      // customData: { ...source.customData },
    };
    // NOTE: Font guidelines could be read/write here,
    // but makes more sense directly in the glyph editing window.
  }

  checkSourceLocation(axisName, value) {
    const newLocation = { ...this.source.location, [axisName]: value };
    return this.checkSourceEntry("location", undefined, newLocation);
  }

  checkSourceEntry(key, valueKey = undefined, value) {
    let errorMessage = "";
    for (const sourceIdentifier in this.sources) {
      if (sourceIdentifier == this.sourceIdentifier) {
        // skip the current source
        continue;
      }
      const source = this.sources[sourceIdentifier];

      let existsAlready = false;
      let sourceValue;
      let thisSourceValue = value;

      if (valueKey == undefined) {
        if (key == "location") {
          sourceValue = locationToString(source[key]);
          thisSourceValue = locationToString(value);
        } else {
          sourceValue = source[key];
        }
      } else {
        sourceValue = source[key][valueKey];
      }

      if (sourceValue == thisSourceValue) {
        existsAlready = true;
      }

      if (existsAlready) {
        const valueString = `${key}${
          valueKey ? " " + valueKey : ""
        }: “${thisSourceValue}”`;
        errorMessage = translate("warning.entry-exists", valueString);
        break;
      }
    }

    if (errorMessage) {
      message(translate("sources.dialog.cannot-edit-source.title"), errorMessage);
      return false;
    }
    return true;
  }

  editSource(editFunc, undoLabel) {
    const root = { sources: this.sources };
    const changes = recordChanges(root, (root) => {
      editFunc(root.sources[this.sourceIdentifier]);
    });
    if (changes.hasChange) {
      this.postChange(changes.change, changes.rollbackChange, undoLabel);
    }
  }

  _updateContents() {
    const models = this.models;

    // create controllers
    for (const key in models) {
      this.controllers[key] = new ObservableController(models[key]);
    }

    // create listeners
    this.controllers.general.addListener((event) => {
      if (event.key == "name") {
        if (!this.checkSourceEntry("name", undefined, event.newValue.trim())) {
          this.controllers.general.model.name = this.source.name;
          return;
        }
      }
      this.editSource((source) => {
        if (typeof event.newValue == "string") {
          source[event.key] = event.newValue.trim();
        } else {
          source[event.key] = event.newValue;
        }

        if (event.key == "name") {
          // in case of name change, update source name card.
          const element = document.getElementById(
            `source-name-box-name-${this.sourceIdentifier}`
          );
          element.innerHTML = source[event.key];
        }
      }, `edit source general ${event.key}`);
    });

    this.controllers.location.addListener((event) => {
      if (!this.checkSourceLocation(event.key, event.newValue)) {
        this.controllers.location.model[event.key] = this.source.location[event.key];
        return;
      }
      this.editSource((source) => {
        source.location[event.key] = event.newValue;
      }, `edit source location ${event.key}`);
    });

    this.controllers.lineMetricsHorizontalLayout.addListener((event) => {
      this.editSource((source) => {
        if (event.key.startsWith("value-")) {
          source.lineMetricsHorizontalLayout[event.key.slice(6)].value = event.newValue;
        } else {
          source.lineMetricsHorizontalLayout[event.key.slice(5)].zone = event.newValue;
        }
      }, `edit source line metrics ${event.key}`);
    });

    this.innerHTML = "";
    this.append(
      html.div({ class: "fontra-ui-font-info-sources-panel-header" }, [
        getLabelFromKey("general"),
      ])
    );
    this.append(buildElement(this.controllers.general));

    this.append(
      html.div({ class: "fontra-ui-font-info-sources-panel-header" }, [
        getLabelFromKey("location"),
      ])
    );
    this.append(
      buildElementLocations(this.controllers.location, this.fontAxesSourceSpace)
    );

    this.append(
      html.div({ class: "fontra-ui-font-info-sources-panel-header" }, [
        getLabelFromKey("lineMetricsHorizontalLayout"),
      ])
    );
    this.append(
      buildElementLineMetricsHor(this.controllers.lineMetricsHorizontalLayout)
    );
  }
}

customElements.define("source-box", SourceBox);

function buildElement(controller) {
  let items = [];
  for (const key in controller.model) {
    items.push([getLabelFromKey(key), key, controller.model[key]]);
  }

  return html.div(
    { class: "fontra-ui-font-info-sources-panel-column" },
    items
      .map(([labelName, keyName, value]) => {
        if (typeof value === "boolean") {
          return [html.div(), labeledCheckbox(labelName, controller, keyName, {})];
        } else {
          return labeledTextInput(labelName, controller, keyName, {
            continuous: false,
          });
        }
      })
      .flat()
  );
}

function buildElementLineMetricsHor(controller) {
  let items = [];
  for (const key of Object.keys(lineMetricsHorizontalLayoutDefaults)) {
    if (`value-${key}` in controller.model) {
      items.push([getLabelFromKey(key), key]);
    }
  }
  // TODO: Custom line metrics

  return html.div(
    {
      class:
        "fontra-ui-font-info-sources-panel-column fontra-ui-font-info-sources-panel-line-metrics-hor",
    },
    items
      .map(([labelName, keyName]) => {
        const opts = { continuous: false, formatter: OptionalNumberFormatter };
        const valueInput = textInput(controller, `value-${keyName}`, opts);
        const zoneInput = textInput(controller, `zone-${keyName}`, opts);
        return [labelForElement(labelName, valueInput), valueInput, zoneInput];
      })
      .flat()
  );
}

function buildElementLocations(controller, fontAxes) {
  const locationElement = html.createDomElement("designspace-location", {
    continuous: false,
    class: `fontra-ui-font-info-sources-panel-column`,
  });
  locationElement.axes = fontAxes;
  locationElement.controller = controller;
  return locationElement;
}

function getInterpolatedSourceData(fontController, newLocation) {
  const fontSourceInstance =
    fontController.fontSourcesInstancer.instantiate(newLocation);
  if (!fontSourceInstance) {
    // This happens if there is no source specified, yet.
    return {};
  }
  // TODO: figure out how to handle this case,
  // because it should not happen, but it does.
  // if (!fontSourceInstance.name) {
  //   throw new Error(`assert -- interpolated font source name is NULL.`);
  // }

  // TODO: ensure that instancer returns a copy of the source
  return JSON.parse(JSON.stringify(fontSourceInstance));
}

const lineMetricsHorizontalLayoutDefaults = {
  ascender: { value: 0.8, zone: 0.016 },
  capHeight: { value: 0.75, zone: 0.016 },
  xHeight: { value: 0.5, zone: 0.016 },
  baseline: { value: 0, zone: -0.016 },
  descender: { value: -0.25, zone: -0.016 },
};

function getDefaultLineMetricsHor(unitsPerEm) {
  const lineMetricsHorizontalLayout = {};
  for (const [name, defaultFactor] of Object.entries(
    lineMetricsHorizontalLayoutDefaults
  )) {
    const value = Math.round(defaultFactor.value * unitsPerEm);
    const zone = Math.round(defaultFactor.zone * unitsPerEm);
    lineMetricsHorizontalLayout[name] = { value: value, zone: zone };
  }
  return lineMetricsHorizontalLayout;
}

function prepareLineMetricsHorForController(lineMetricsHorizontalLayout) {
  const newLineMetricsHorizontalLayout = {};
  for (const key in lineMetricsHorizontalLayout) {
    newLineMetricsHorizontalLayout[`value-${key}`] =
      lineMetricsHorizontalLayout[key].value;
    newLineMetricsHorizontalLayout[`zone-${key}`] =
      lineMetricsHorizontalLayout[key].zone | 0;
  }
  return newLineMetricsHorizontalLayout;
}

function getLineMetricsHorRounded(lineMetricsHorizontalLayout) {
  const newLineMetricsHorizontalLayout = {};
  for (const key in lineMetricsHorizontalLayout) {
    newLineMetricsHorizontalLayout[key] = {
      value: round(lineMetricsHorizontalLayout[key].value, 2),
      zone: round(lineMetricsHorizontalLayout[key].zone, 2) | 0,
    };
  }
  return newLineMetricsHorizontalLayout;
}

function getLabelFromKey(key) {
  const keyLabelMap = {
    name: translate("sources.labels.name"),
    italicAngle: translate("sources.labels.italic-angle"),
    isSparse: translate("sources.labels.is-sparse"),
    ascender: translate("sources.labels.ascender"),
    capHeight: translate("sources.labels.cap-height"),
    xHeight: translate("sources.labels.x-height"),
    baseline: translate("sources.labels.baseline"),
    descender: translate("sources.labels.descender"),
    general: translate("sources.labels.general"),
    location: translate("sources.labels.location"),
    lineMetricsHorizontalLayout: translate("sources.labels.line-metrics"),
  };
  return keyLabelMap[key] || key;
}
