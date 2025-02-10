import { registerAction } from "../core/actions.js";
import { Backend } from "../core/backend-api.js";
import { ChangeCollector, applyChange, consolidateChanges } from "../core/changes.js";
import { EditBehaviorFactory } from "./edit-behavior.js";
import Panel from "./panel.js";
import * as html from "/core/html-utils.js";
import { translate } from "/core/localization.js";
import {
  filterPathByPointIndices,
  getSelectionByContour,
} from "/core/path-functions.js";
import { rectCenter, rectSize } from "/core/rectangle.js";
import { Transform } from "/core/transform.js";
import {
  enumerate,
  mapObjectValuesAsync,
  parseSelection,
  range,
  reversed,
  zip,
} from "/core/utils.js";
import { copyBackgroundImage, copyComponent } from "/core/var-glyph.js";
import { VarPackedPath } from "/core/var-path.js";
import { Form } from "/web-components/ui-form.js";

export default class TransformationPanel extends Panel {
  identifier = "selection-transformation";
  iconPath = "/tabler-icons/shape.svg";

  static styles = `
    .selection-transformation {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      height: 100%;
      width: 100%;
    }

    .selection-transformation-section {
      flex: 1;
      padding: 1em;
      overflow: hidden auto;
    }
  `;

  static stylesForm = `
  .ui-form-label {
    overflow-x: unset;
  }

  .origin-radio-buttons {
    display: grid;
    grid-template-columns: auto auto auto;
  }

  .origin-radio-buttons > input[type="radio"] {
    appearance: none;
    background-color: var(--editor-mini-console-background-color-light);
    margin: 2px;
    color: var(--editor-mini-console-background-color-light);
    width: 0.9em;
    height: 0.9em;
    border: 0.15em solid var(--editor-mini-console-background-color-light);
    border-radius: 50%;
    cursor: pointer;
  }

  .origin-radio-buttons > input[type="radio"]:hover {
    background-color: var(--text-input-background-color-dark);
    border: 0.15em solid var(--text-input-background-color-dark);
  }

  .origin-radio-buttons > input[type="radio"]:checked {
    background-color: var(--text-input-background-color-dark);
    border: 0.15em solid var(--text-input-background-color-dark);
  }
`;

  constructor(editorController) {
    super(editorController);
    this.infoForm = new Form();
    this.infoForm.appendStyle(TransformationPanel.stylesForm);
    this.contentElement.appendChild(
      html.div(
        { class: "panel-section panel-section--flex panel-section--scrollable" },
        [this.infoForm]
      )
    );
    this.fontController = this.editorController.fontController;
    this.sceneController = this.editorController.sceneController;

    this.pathOperations = Object.fromEntries(
      [
        Backend.unionPath,
        Backend.subtractPath,
        Backend.intersectPath,
        Backend.excludePath,
      ].map((func) => [func.name, func.bind(Backend)])
    );

    this.transformParameters = {
      scaleX: 100,
      scaleY: undefined,
      rotation: 0,
      moveX: 0,
      moveY: 0,
      originX: "center",
      originY: "middle",
      originXButton: undefined,
      originYButton: undefined,
      skewX: 0,
      skewY: 0,
      customDistributionSpacing: null,
    };
    this.registerActions();
  }

  registerActions() {
    const topic = "0070-action-topics.selection-transformations";

    const moveActions = [
      ["align.left", alignLeft],
      ["align.center", alignCenter],
      ["align.right", alignRight],
      ["align.top", alignTop],
      ["align.middle", alignMiddle],
      ["align.bottom", alignBottom],
      ["distribute.horizontally", distributeHorizontally],
      ["distribute.vertically", distributeVertically],
    ];
    for (const [keyPart, moveDescriptor] of moveActions) {
      registerAction(
        `action.selection-transformation.${keyPart}`,
        { topic, titleKey: `sidebar.selection-transformation.${keyPart}` },
        () => this.moveObjects(moveDescriptor)
      );
    }

    const pathActions = [
      ["union", this.pathOperations.unionPath],
      ["subtract", this.pathOperations.subtractPath],
      ["intersect", this.pathOperations.intersectPath],
      ["exclude", this.pathOperations.excludePath],
    ];
    for (const [keyPart, pathOperationFunc] of pathActions) {
      registerAction(
        `action.selection-transformation.path-operations.${keyPart}`,
        {
          topic,
          titleKey: `sidebar.selection-transformation.path-operations.${keyPart}`,
        },
        () => this.doPathOperations(pathOperationFunc, keyPart)
      );
    }
  }

  getContentElement() {
    return html.div(
      {
        class: "panel",
      },
      []
    );
  }

  async update(senderInfo) {
    if (!this.infoForm.contentElement.offsetParent) {
      // If the info form is not visible, do nothing
      return;
    }

    await this.fontController.ensureInitialized;

    const formContents = [];

    formContents.push({
      type: "header",
      label: translate("sidebar.selection-transformation.title"),
    });

    let radioButtonOrigin = html.createDomElement("div", {
      class: "origin-radio-buttons ui-form-center",
    });

    for (const keyY of ["top", "middle", "bottom"]) {
      for (const keyX of ["left", "center", "right"]) {
        const key = `${keyX}-${keyY}`;
        let radioButton = html.createDomElement("input", {
          "type": "radio",
          "value": key,
          "name": "origin",
          "v-model": "role",
          "class": "ui-form-radio-button",
          "checked":
            keyX === this.transformParameters.originX &&
            keyY === this.transformParameters.originY
              ? "checked"
              : "",
          "onclick": (event) => this._changeOrigin(keyX, keyY),
          "data-tooltip": translate(
            `sidebar.selection-transformation.origin.${keyY}.${keyX}`
          ),
          "data-tooltipposition": "bottom",
        });
        radioButtonOrigin.appendChild(radioButton);
      }
    }

    formContents.push({
      type: "single-icon",
      element: radioButtonOrigin,
    });

    formContents.push({ type: "divider" });

    formContents.push({
      type: "edit-number-x-y",
      label: translate("sidebar.selection-transformation.origin"),
      fieldX: {
        key: "originXButton",
        value: this.transformParameters.originXButton,
      },
      fieldY: {
        key: "originYButton",
        value: this.transformParameters.originYButton,
      },
    });

    formContents.push({ type: "divider" });

    let buttonMove = html.createDomElement("icon-button", {
      "src": "/tabler-icons/arrow-move-right.svg",
      "onclick": (event) =>
        this.transformSelection(
          new Transform().translate(
            this.transformParameters.moveX,
            this.transformParameters.moveY
          ),
          "move"
        ),
      "class": "ui-form-icon ui-form-icon-button",
      "data-tooltip": translate("sidebar.selection-transformation.move"),
      "data-tooltipposition": "top",
    });

    formContents.push({
      type: "edit-number-x-y",
      label: buttonMove,
      fieldX: {
        key: "moveX",
        value: this.transformParameters.moveX,
      },
      fieldY: {
        key: "moveY",
        value: this.transformParameters.moveY,
      },
    });

    let buttonScale = html.createDomElement("icon-button", {
      "src": "/tabler-icons/resize.svg",
      "onclick": (event) =>
        this.transformSelection(
          new Transform().scale(
            this.transformParameters.scaleX / 100,
            (this.transformParameters.scaleY
              ? this.transformParameters.scaleY
              : this.transformParameters.scaleX) / 100
          ),
          "scale"
        ),
      "class": "ui-form-icon ui-form-icon-button",
      "data-tooltip": translate("sidebar.selection-transformation.scale"),
      "data-tooltipposition": "top",
    });

    formContents.push({
      type: "edit-number-x-y",
      label: buttonScale,
      fieldX: {
        key: "scaleX",
        id: "selection-transformation-scaleX",
        value: this.transformParameters.scaleX,
      },
      fieldY: {
        key: "scaleY",
        id: "selection-transformation-scaleY",
        value: this.transformParameters.scaleY,
      },
    });

    let buttonRotate = html.createDomElement("icon-button", {
      "src": "/tabler-icons/rotate.svg",
      "onclick": (event) =>
        this.transformSelection(
          new Transform().rotate((this.transformParameters.rotation * Math.PI) / 180),
          "rotate"
        ),
      "class": "ui-form-icon ui-form-icon-button",
      "data-tooltip": translate("sidebar.selection-transformation.rotate"),
      "data-tooltipposition": "top",
    });

    formContents.push({
      type: "edit-number",
      key: "rotation",
      label: buttonRotate,
      value: this.transformParameters.rotation,
    });

    let buttonSkew = html.createDomElement("icon-button", {
      "src": "/images/skew.svg",
      "onclick": (event) =>
        this.transformSelection(
          new Transform().skew(
            (this.transformParameters.skewX * Math.PI) / 180,
            (this.transformParameters.skewY * Math.PI) / 180
          ),
          "skew"
        ),
      "class": "ui-form-icon ui-form-icon-button",
      "data-tooltip": translate("sidebar.selection-transformation.skew"),
      "data-tooltipposition": "top",
    });

    formContents.push({
      type: "edit-number-x-y",
      key: '["selectionTransformationSkew"]',
      label: buttonSkew,
      fieldX: {
        key: "skewX",
        id: "selection-transformation-skewX",
        value: this.transformParameters.skewX,
      },
      fieldY: {
        key: "skewY",
        id: "selection-transformation-skewY",
        value: this.transformParameters.skewY,
      },
    });

    formContents.push({ type: "divider" });

    formContents.push({
      type: "universal-row",
      field1: {
        type: "text",
        key: "LabelFlip",
        value: translate("sidebar.selection-transformation.flip"),
      },
      field2: {
        type: "auxiliaryElement",
        key: "FlipVertically",
        auxiliaryElement: html.createDomElement("icon-button", {
          "class": "ui-form-icon",
          "src": "/tabler-icons/flip-vertical.svg",
          "data-tooltip": translate("sidebar.selection-transformation.flip.vertically"),
          "data-tooltipposition": "top",
          "onclick": (event) =>
            this.transformSelection(new Transform().scale(-1, 1), "flip vertically"),
        }),
      },
      field3: {
        type: "auxiliaryElement",
        key: "FlipHorizontally",
        auxiliaryElement: html.createDomElement("icon-button", {
          "class": "ui-form-icon",
          "src": "/tabler-icons/flip-horizontal.svg",
          "data-tooltip": translate(
            "sidebar.selection-transformation.flip.horizontally"
          ),
          "data-tooltipposition": "top-right",
          "onclick": (event) =>
            this.transformSelection(new Transform().scale(1, -1), "flip horizontally"),
        }),
      },
    });

    formContents.push({ type: "spacer" });
    formContents.push({
      type: "header",
      label: translate("sidebar.selection-transformation.align"),
    });

    formContents.push({
      type: "universal-row",
      field1: {
        type: "auxiliaryElement",
        key: "AlignLeft",
        auxiliaryElement: html.createDomElement("icon-button", {
          "src": "/tabler-icons/vertical-align-left.svg",
          "onclick": (event) => this.moveObjects(alignLeft),
          "class": "ui-form-icon ui-form-icon-button",
          "data-tooltip": translate("sidebar.selection-transformation.align.left"),
          "data-tooltipposition": "bottom-left",
        }),
      },
      field2: {
        type: "auxiliaryElement",
        key: "AlignCenter",
        auxiliaryElement: html.createDomElement("icon-button", {
          "src": "/tabler-icons/vertical-align-center.svg",
          "onclick": (event) => this.moveObjects(alignCenter),
          "data-tooltip": translate("sidebar.selection-transformation.align.center"),
          "data-tooltipposition": "bottom",
          "class": "ui-form-icon",
        }),
      },
      field3: {
        type: "auxiliaryElement",
        key: "AlignRight",
        auxiliaryElement: html.createDomElement("icon-button", {
          "src": "/tabler-icons/vertical-align-right.svg",
          "onclick": (event) => this.moveObjects(alignRight),
          "data-tooltip": translate("sidebar.selection-transformation.align.right"),
          "data-tooltipposition": "bottom-right",
          "class": "ui-form-icon",
        }),
      },
    });

    formContents.push({
      type: "universal-row",
      field1: {
        type: "auxiliaryElement",
        key: "AlignTop",
        auxiliaryElement: html.createDomElement("icon-button", {
          "src": "/tabler-icons/horizontal-align-top.svg",
          "onclick": (event) => this.moveObjects(alignTop),
          "class": "ui-form-icon ui-form-icon-button",
          "data-tooltip": translate("sidebar.selection-transformation.align.top"),
          "data-tooltipposition": "bottom-left",
        }),
      },
      field2: {
        type: "auxiliaryElement",
        key: "AlignMiddle",
        auxiliaryElement: html.createDomElement("icon-button", {
          "src": "/tabler-icons/horizontal-align-center.svg",
          "onclick": (event) => this.moveObjects(alignMiddle),
          "data-tooltip": translate("sidebar.selection-transformation.align.middle"),
          "data-tooltipposition": "bottom",
          "class": "ui-form-icon",
        }),
      },
      field3: {
        type: "auxiliaryElement",
        key: "AlignMiddle",
        auxiliaryElement: html.createDomElement("icon-button", {
          "src": "/tabler-icons/horizontal-align-bottom.svg",
          "onclick": (event) => this.moveObjects(alignBottom),
          "data-tooltip": translate("sidebar.selection-transformation.align.bottom"),
          "data-tooltipposition": "bottom-right",
          "class": "ui-form-icon",
        }),
      },
    });

    formContents.push({ type: "spacer" });
    formContents.push({
      type: "header",
      label: translate("sidebar.selection-transformation.distribute"),
    });

    formContents.push({
      type: "universal-row",
      field1: {
        type: "auxiliaryElement",
        key: "distributeHorizontally",
        auxiliaryElement: html.createDomElement("icon-button", {
          "src": "/tabler-icons/layout-distribute-vertical.svg",
          "onclick": (event) => this.moveObjects(distributeHorizontally),
          "data-tooltip": translate(
            "sidebar.selection-transformation.distribute.horizontally"
          ),
          "data-tooltipposition": "top-left",
          "class": "ui-form-icon ui-form-icon-button",
        }),
      },
      field2: {
        type: "auxiliaryElement",
        key: "distributeVertically",
        auxiliaryElement: html.createDomElement("icon-button", {
          "src": "/tabler-icons/layout-distribute-horizontal.svg",
          "onclick": (event) => this.moveObjects(distributeVertically),
          "data-tooltip": translate(
            "sidebar.selection-transformation.distribute.vertically"
          ),
          "data-tooltipposition": "top",
          "class": "ui-form-icon",
        }),
      },
      field3: {
        "type": "edit-number",
        "key": "customDistributionSpacing",
        "value": this.transformParameters.customDistributionSpacing,
        "allowEmptyField": true,
        "data-tooltip": translate(
          "sidebar.selection-transformation.distribute.distance-in-units"
        ),
        "data-tooltipposition": "top-right",
      },
    });

    formContents.push({ type: "spacer" });

    const labelKeyPathOperations = "sidebar.selection-transformation.path-operations";

    formContents.push({
      type: "header",
      label: translate(labelKeyPathOperations),
    });

    formContents.push({
      type: "universal-row",
      field1: {
        type: "auxiliaryElement",
        key: "removeOverlaps",
        auxiliaryElement: html.createDomElement("icon-button", {
          "src": "/tabler-icons/layers-union.svg",
          "onclick": (event) =>
            this.doPathOperations(this.pathOperations.unionPath, "union"),
          "data-tooltip": translate(`${labelKeyPathOperations}.union`),
          "data-tooltipposition": "top-left",
          "class": "ui-form-icon ui-form-icon-button",
        }),
      },
      field2: {
        type: "auxiliaryElement",
        key: "subtractContours",
        auxiliaryElement: html.createDomElement("icon-button", {
          "src": "/tabler-icons/layers-subtract.svg",
          "onclick": (event) =>
            this.doPathOperations(this.pathOperations.subtractPath, "subtract"),
          "data-tooltip": translate(`${labelKeyPathOperations}.subtract`),
          "data-tooltipposition": "top",
          "class": "ui-form-icon",
        }),
      },
      field3: {
        type: "auxiliaryElement",
        key: "intersectContours",
        auxiliaryElement: html.createDomElement("icon-button", {
          "src": "/tabler-icons/layers-intersect-2.svg",
          "onclick": (event) =>
            this.doPathOperations(this.pathOperations.intersectPath, "intersect"),
          "data-tooltip": translate(`${labelKeyPathOperations}.intersect`),
          "data-tooltipposition": "top-right",
          "class": "ui-form-icon",
        }),
      },
    });

    formContents.push({
      type: "universal-row",
      field1: {
        type: "auxiliaryElement",
        key: "excludeContours",
        auxiliaryElement: html.createDomElement("icon-button", {
          "src": "/tabler-icons/layers-difference.svg",
          "onclick": (event) =>
            this.doPathOperations(this.pathOperations.excludePath, "exclude"),
          "data-tooltip": translate(`${labelKeyPathOperations}.exclude`),
          "data-tooltipposition": "top-left",
          "class": "ui-form-icon ui-form-icon-button",
        }),
      },
      field2: {},
      field3: {},
    });

    this.infoForm.setFieldDescriptions(formContents);

    this.infoForm.onFieldChange = async (fieldItem, value, valueStream) => {
      this.transformParameters[fieldItem.key] = value;
      if (fieldItem.key === "originXButton" || fieldItem.key === "originYButton") {
        this.transformParameters[fieldItem.key.replace("Button", "")] = value;

        const iconRadioButtons = this.infoForm.shadowRoot.querySelectorAll(
          ".ui-form-radio-button"
        );
        iconRadioButtons.forEach((radioButton) => {
          radioButton.checked = false;
        });
      }
    };
  }

  async doPathOperations(pathOperationFunc, key) {
    if (!this.sceneController.sceneSettings.selectedGlyph?.isEditing) {
      return;
    }

    const positionedGlyph =
      this.sceneController.sceneModel.getSelectedPositionedGlyph();

    if (!positionedGlyph) {
      return;
    }

    const undoLabel = translate(
      `sidebar.selection-transformation.path-operations.${key}`
    );
    const doUnion = pathOperationFunc === this.pathOperations.unionPath;
    let { point: pointIndices } = parseSelection(this.sceneController.selection);
    pointIndices = pointIndices || [];

    if (!pointIndices.length && !doUnion) {
      return;
    }

    const selectedContourIndicesMap = getSelectionByContour(
      positionedGlyph.glyph.path,
      pointIndices
    );
    const selectedContourIndices = [...selectedContourIndicesMap.keys()];

    if (
      !doUnion &&
      selectedContourIndices.length === positionedGlyph.glyph.path.numContours
    ) {
      // All contours are selected and we're not doing remove overlap: this will
      // result in an empty path or in the same path depending on the operator.
      return;
    }

    const isContourSelected =
      pointIndices.length || !doUnion
        ? (i) => selectedContourIndicesMap.has(i)
        : (i) => true;

    const editLayerGlyphs = this.sceneController.getEditingLayerFromGlyphLayers(
      positionedGlyph.varGlyph.glyph.layers
    );

    const layerPaths = await mapObjectValuesAsync(
      editLayerGlyphs,
      async (layerGlyph) => {
        const path = layerGlyph.path;
        const selectedContoursPath = new VarPackedPath();
        const unselectedContoursPath = new VarPackedPath();

        for (const contourIndex of range(path.numContours)) {
          if (isContourSelected(contourIndex)) {
            selectedContoursPath.appendContour(path.getContour(contourIndex));
          } else {
            unselectedContoursPath.appendContour(path.getContour(contourIndex));
          }
        }
        if (doUnion) {
          return await pathOperationFunc(selectedContoursPath);
        } else {
          return await pathOperationFunc(unselectedContoursPath, selectedContoursPath);
        }
      }
    );

    await this.sceneController.editGlyphAndRecordChanges(
      (glyph) => {
        for (const [layerName, layerPath] of Object.entries(layerPaths)) {
          if (doUnion && pointIndices.length) {
            const path = glyph.layers[layerName].glyph.path;
            for (const contourIndex of reversed(selectedContourIndices)) {
              path.deleteContour(contourIndex);
            }
            path.appendPath(layerPath);
          } else {
            glyph.layers[layerName].glyph.path = layerPath;
          }
        }
        return undoLabel.toLowerCase();
      },
      undefined,
      true
    );

    this.sceneController.selection = new Set(); // Clear selection
  }

  async transformSelection(transformation, undoLabel) {
    let {
      point: pointIndices,
      component: componentIndices,
      anchor: anchorIndices,
      backgroundImage: backgroundImageIndices,
    } = parseSelection(this.sceneController.selection);

    pointIndices = pointIndices || [];
    componentIndices = componentIndices || [];
    anchorIndices = anchorIndices || [];
    backgroundImageIndices = backgroundImageIndices || [];
    if (
      !pointIndices.length &&
      !componentIndices.length &&
      !anchorIndices.length &&
      !backgroundImageIndices.length
    ) {
      return;
    }

    const staticGlyphControllers =
      await this.sceneController.getStaticGlyphControllers();

    await this.sceneController.editGlyph((sendIncrementalChange, glyph) => {
      const layerInfo = Object.entries(
        this.sceneController.getEditingLayerFromGlyphLayers(glyph.layers)
      ).map(([layerName, layerGlyph]) => {
        const behaviorFactory = new EditBehaviorFactory(
          layerGlyph,
          this.sceneController.selection,
          this.sceneController.selectedTool.scalingEditBehavior
        );
        return {
          layerName,
          changePath: ["layers", layerName, "glyph"],
          layerGlyphController: staticGlyphControllers[layerName],
          editBehavior: behaviorFactory.getTransformBehavior("default"),
        };
      });

      const editChanges = [];
      const rollbackChanges = [];
      for (const { changePath, editBehavior, layerGlyphController } of layerInfo) {
        const layerGlyph = layerGlyphController.instance;
        const pinPoint = getPinPoint(
          layerGlyphController.getSelectionBounds(
            this.sceneController.selection,
            this.fontController.getBackgroundImageBoundsFunc
          ),
          this.transformParameters.originX,
          this.transformParameters.originY
        );

        const pinnedTransformation = new Transform()
          .translate(pinPoint.x, pinPoint.y)
          .transform(transformation)
          .translate(-pinPoint.x, -pinPoint.y);

        const editChange =
          editBehavior.makeChangeForTransformation(pinnedTransformation);

        applyChange(layerGlyph, editChange);
        editChanges.push(consolidateChanges(editChange, changePath));
        rollbackChanges.push(
          consolidateChanges(editBehavior.rollbackChange, changePath)
        );
      }

      let changes = ChangeCollector.fromChanges(
        consolidateChanges(editChanges),
        consolidateChanges(rollbackChanges)
      );

      return {
        changes: changes,
        undoLabel: undoLabel,
        broadcast: true,
      };
    });
  }

  _changeOrigin(keyX, keyY) {
    this.transformParameters.originX = keyX;
    this.transformParameters.originY = keyY;
    this.transformParameters.originXButton = undefined;
    this.transformParameters.originYButton = undefined;
    this.update();
  }

  _splitSelection(layerGlyphController, selection) {
    let {
      point: pointIndices,
      component: componentIndices,
      anchor: anchorIndices,
      backgroundImage: backgroundImageIndices,
    } = parseSelection(selection);
    pointIndices = pointIndices || [];

    const points = [];
    const contours = [];
    const components = componentIndices || [];
    const anchors = anchorIndices || [];
    const backgroundImages = backgroundImageIndices || [];

    if (!pointIndices.length) {
      return { points, contours, components, anchors, backgroundImages };
    }

    const path = layerGlyphController.instance.path;
    const pathSelection = filterPathByPointIndices(
      layerGlyphController.instance.path,
      pointIndices
    );
    const selectionByContour = getSelectionByContour(path, pointIndices);

    let contourIndex = 0;
    for (const pointIndex of pointIndices) {
      while (path.contourInfo[contourIndex].endPoint < pointIndex) {
        contourIndex++;
      }

      let pathSelectionContourIndex;
      for (const [j, [cIndex, contourSelection]] of enumerate(selectionByContour)) {
        if (contourIndex === cIndex) {
          pathSelectionContourIndex = j;
          break;
        }
      }

      if (pathSelection.contourInfo[pathSelectionContourIndex].isClosed) {
        const contourStartIndex = !contourIndex
          ? 0
          : layerGlyphController.instance.path.contourInfo[contourIndex - 1].endPoint +
            1;
        const contourEndIndex = path.contourInfo[contourIndex].endPoint + 1;

        const contourPoints = Array.from(range(contourStartIndex, contourEndIndex));

        if (contourStartIndex === pointIndex) {
          // only add list of contours
          // if the point is the start of the contour
          contours.push(contourPoints);
        }
      } else {
        points.push(pointIndex);
      }
    }

    return { points, contours, components, anchors, backgroundImages };
  }

  _collectMovableObjects(moveDescriptor, controller) {
    const { points, contours, components, anchors, backgroundImages } =
      this._splitSelection(controller, this.sceneController.selection);

    const movableObjects = [];
    for (const pointIndex of points) {
      const individualSelection = new Set([`point/${pointIndex}`]);
      movableObjects.push(new MovableObject(individualSelection));
    }
    for (const [contourIndex, pointIndices] of enumerate(contours)) {
      const individualSelection = new Set(
        pointIndices.map((pointIndex) => `point/${pointIndex}`)
      );
      movableObjects.push(new MovableObject(individualSelection));
    }
    for (const componentIndex of components) {
      const individualSelection = new Set([`component/${componentIndex}`]);
      movableObjects.push(new MovableObject(individualSelection));
    }
    for (const anchorIndex of anchors) {
      const individualSelection = new Set([`anchor/${anchorIndex}`]);
      movableObjects.push(new MovableObject(individualSelection));
    }
    for (const backgroundImageIndex of backgroundImages) {
      const individualSelection = new Set([`backgroundImage/${backgroundImageIndex}`]);
      movableObjects.push(new MovableObject(individualSelection));
    }

    if (moveDescriptor.compareObjects) {
      movableObjects.sort((a, b) =>
        moveDescriptor.compareObjects(
          a,
          b,
          controller,
          this.fontController.getBackgroundImageBoundsFunc
        )
      );
    }

    return movableObjects;
  }

  async moveObjects(moveDescriptor) {
    const glyphController =
      await this.sceneController.sceneModel.getSelectedStaticGlyphController();
    const movableObjects = this._collectMovableObjects(moveDescriptor, glyphController);
    if (movableObjects.length <= 1) {
      return;
    }

    const staticGlyphControllers =
      await this.sceneController.getStaticGlyphControllers();
    await this.sceneController.editGlyph((sendIncrementalChange, glyph) => {
      const editLayerGlyphs = this.sceneController.getEditingLayerFromGlyphLayers(
        glyph.layers
      );

      const editChanges = [];
      const rollbackChanges = [];
      for (const [layerName, layerGlyph] of Object.entries(editLayerGlyphs)) {
        const changePath = ["layers", layerName, "glyph"];
        const controller = staticGlyphControllers[layerName];

        const boundingBoxes = movableObjects.map((obj) =>
          obj.computeBounds(
            controller,
            this.fontController.getBackgroundImageBoundsFunc
          )
        );
        const deltas = moveDescriptor.computeDeltasFromBoundingBoxes(
          boundingBoxes,
          this.transformParameters.customDistributionSpacing
        );
        for (const [delta, movableObject] of zip(deltas, movableObjects)) {
          const [editChange, rollbackChange] = movableObject.makeChangesForDelta(
            delta,
            layerGlyph,
            this.sceneController
          );
          applyChange(layerGlyph, editChange);
          editChanges.push(consolidateChanges(editChange, changePath));
          rollbackChanges.push(consolidateChanges(rollbackChange, changePath));
        }
      }

      let changes = ChangeCollector.fromChanges(
        consolidateChanges(editChanges),
        consolidateChanges(rollbackChanges)
      );

      return {
        changes: changes,
        undoLabel: moveDescriptor.undoLabel,
        broadcast: true,
      };
    });
  }

  async toggle(on, focus) {
    if (on) {
      this.update();
    }
  }
}

export function getPinPoint(bounds, originX, originY) {
  const { width, height } = rectSize(bounds);

  // default from center
  let pinPointX = bounds.xMin + width / 2;
  let pinPointY = bounds.yMin + height / 2;

  if (typeof originX === "number") {
    pinPointX = originX;
  } else if (originX === "left") {
    pinPointX = bounds.xMin;
  } else if (originX === "right") {
    pinPointX = bounds.xMax;
  }

  if (typeof originY === "number") {
    pinPointY = originY;
  } else if (originY === "top") {
    pinPointY = bounds.yMax;
  } else if (originY === "bottom") {
    pinPointY = bounds.yMin;
  }

  return { x: pinPointX, y: pinPointY };
}

// Define MovableObject classes
class MovableObject {
  constructor(selection) {
    this.selection = selection;
  }

  computeBounds(staticGlyphController, getBackgroundImageBoundsFunc) {
    return staticGlyphController.getSelectionBounds(
      this.selection,
      getBackgroundImageBoundsFunc
    );
  }

  makeChangesForDelta(delta, layerGlyph, sceneController) {
    const behaviorFactory = new EditBehaviorFactory(
      layerGlyph,
      this.selection,
      sceneController.selectedTool.scalingEditBehavior
    );

    const editBehavior = behaviorFactory.getBehavior("default");
    const editChange = editBehavior.makeChangeForDelta(delta);
    return [editChange, editBehavior.rollbackChange];
  }
}

// Define moveDescriptor objects
const alignLeft = {
  undoLabel: "align left", // TODO: maybe use translate("sidebar.selection-transformation.align.left")
  computeDeltasFromBoundingBoxes: (boundingBoxes) => {
    const xMins = boundingBoxes.map((bounds) => bounds.xMin);
    const left = Math.min(...xMins);
    return xMins.map((xMin) => ({
      x: left - xMin,
      y: 0,
    }));
  },
};

const alignCenter = {
  undoLabel: "align center", // TODO: maybe use translate("sidebar.selection-transformation.align.center")
  computeDeltasFromBoundingBoxes: (boundingBoxes) => {
    const xMaxes = boundingBoxes.map((bounds) => bounds.xMax);
    const xMins = boundingBoxes.map((bounds) => bounds.xMin);
    const left = Math.min(...xMins);
    const right = Math.max(...xMaxes);
    return boundingBoxes.map((bounds) => ({
      x: left - bounds.xMin + (right - left) / 2 - (bounds.xMax - bounds.xMin) / 2,
      y: 0,
    }));
  },
};

const alignRight = {
  undoLabel: "align right", // TODO: maybe use translate("sidebar.selection-transformation.align.right")
  computeDeltasFromBoundingBoxes: (boundingBoxes) => {
    const xMaxes = boundingBoxes.map((bounds) => bounds.xMax);
    const right = Math.max(...xMaxes);
    return xMaxes.map((xMax) => ({
      x: right - xMax,
      y: 0,
    }));
  },
};

const alignTop = {
  undoLabel: "align top", // TODO: maybe use translate("sidebar.selection-transformation.align.top")
  computeDeltasFromBoundingBoxes: (boundingBoxes) => {
    const yMaxes = boundingBoxes.map((bounds) => bounds.yMax);
    const top = Math.max(...yMaxes);
    return yMaxes.map((yMax) => ({
      x: 0,
      y: top - yMax,
    }));
  },
};

const alignMiddle = {
  undoLabel: "align middle", // TODO: maybe use translate("sidebar.selection-transformation.align.middle")
  computeDeltasFromBoundingBoxes: (boundingBoxes) => {
    const yMaxes = boundingBoxes.map((bounds) => bounds.yMax);
    const yMins = boundingBoxes.map((bounds) => bounds.yMin);
    const bottom = Math.min(...yMins);
    const top = Math.max(...yMaxes);
    return boundingBoxes.map((bounds) => ({
      x: 0,
      y: top - bounds.yMax + (bounds.yMax - bounds.yMin) / 2 - (top - bottom) / 2,
    }));
  },
};

const alignBottom = {
  undoLabel: "align bottom", // TODO: maybe use translate("sidebar.selection-transformation.align.bottom")
  computeDeltasFromBoundingBoxes: (boundingBoxes) => {
    const yMins = boundingBoxes.map((bounds) => bounds.yMin);
    const bottom = Math.min(...yMins);
    return yMins.map((yMin) => ({
      x: 0,
      y: bottom - yMin,
    }));
  },
};

class DistributeObjectsDescriptor {
  constructor(direction, directionVar) {
    this.undoLabel = `distribute ${direction}`;
    this.minProperty = `${directionVar}Min`;
    this.maxProperty = `${directionVar}Max`;
    this.deltaProperty = directionVar;
  }

  computeDeltasFromBoundingBoxes(boundingBoxes, customDistributionSpacing) {
    let effectiveExtent = 0;
    for (const bounds of boundingBoxes) {
      effectiveExtent += bounds[this.maxProperty] - bounds[this.minProperty];
    }
    const mins = boundingBoxes.map((bounds) => bounds[this.minProperty]);
    const maxes = boundingBoxes.map((bounds) => bounds[this.maxProperty]);
    const minimum = Math.min(...mins);
    const maximum = Math.max(...maxes);

    const distributionSpacing =
      customDistributionSpacing === null
        ? (maximum - minimum - effectiveExtent) / (boundingBoxes.length - 1)
        : customDistributionSpacing;

    let next = minimum;
    let deltas = [];
    for (const bounds of boundingBoxes) {
      const extent = bounds[this.maxProperty] - bounds[this.minProperty];
      const delta = { x: 0, y: 0 };
      delta[this.deltaProperty] = next - bounds[this.minProperty];
      deltas.push(delta);
      next += extent + distributionSpacing;
    }
    return deltas;
  }

  compareObjects(a, b, glyphController, getBackgroundImageBoundsFunc) {
    return (
      rectCenter(a.computeBounds(glyphController, getBackgroundImageBoundsFunc))[
        this.deltaProperty
      ] -
      rectCenter(b.computeBounds(glyphController, getBackgroundImageBoundsFunc))[
        this.deltaProperty
      ]
    );
  }
}

const distributeHorizontally = new DistributeObjectsDescriptor("horizontally", "x");
const distributeVertically = new DistributeObjectsDescriptor("vertically", "y");

customElements.define("panel-transformation", TransformationPanel);
