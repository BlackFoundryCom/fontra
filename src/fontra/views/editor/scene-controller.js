import { registerAction } from "../core/actions.js";
import { recordChanges } from "../core/change-recorder.js";
import {
  ChangeCollector,
  applyChange,
  consolidateChanges,
  hasChange,
} from "../core/changes.js";
import { decomposeComponents } from "../core/glyph-controller.js";
import { glyphLinesFromText, textFromGlyphLines } from "../core/glyph-lines.js";
import { MouseTracker } from "../core/mouse-tracker.js";
import { ObservableController } from "../core/observable-object.js";
import {
  connectContours,
  scalePoint,
  splitPathAtPointIndices,
} from "../core/path-functions.js";
import { equalRect, offsetRect, rectAddMargin, rectRound } from "../core/rectangle.js";
import { difference, isSuperset, lenientIsEqualSet, union } from "../core/set-ops.js";
import {
  arrowKeyDeltas,
  assert,
  commandKeyProperty,
  enumerate,
  objectsEqual,
  parseSelection,
  reversed,
  withTimeout,
  zip,
} from "../core/utils.js";
import { VarPackedPath, packContour } from "../core/var-path.js";
import * as vector from "../core/vector.js";
import { EditBehaviorFactory } from "./edit-behavior.js";
import { SceneModel, getSelectedGlyphName } from "./scene-model.js";
import { translate, translatePlural } from "/core/localization.js";
import { dialog, message } from "/web-components/modal-dialog.js";

export class SceneController {
  constructor(
    fontController,
    canvasController,
    applicationSettingsController,
    visualizationLayersSettings
  ) {
    this.canvasController = canvasController;
    this.applicationSettings = applicationSettingsController.model;
    this.fontController = fontController;
    this.autoViewBox = true;

    this.setupSceneSettings();
    this.sceneSettings = this.sceneSettingsController.model;
    this.visualizationLayersSettings = visualizationLayersSettings;

    // We need to do isPointInPath without having a context, we'll pass a bound method
    const isPointInPath = canvasController.context.isPointInPath.bind(
      canvasController.context
    );

    this.sceneModel = new SceneModel(
      fontController,
      this.sceneSettingsController,
      isPointInPath,
      visualizationLayersSettings
    );

    this.selectedTool = undefined;
    this._currentGlyphChangeListeners = [];

    this.setupChangeListeners();
    this.setupSettingsListeners();
    this.setupEventHandling();
    this.setupContextMenuActions();
  }

  setupSceneSettings() {
    this.sceneSettingsController = new ObservableController({
      text: "",
      align: "center",
      editLayerName: null,
      glyphLines: [],
      fontLocationUser: {},
      fontLocationSource: {},
      fontLocationSourceMapped: {},
      fontAxesUseSourceCoordinates: false,
      fontAxesShowEffectiveLocation: false,
      fontAxesShowHidden: false,
      fontAxesSkipMapping: false,
      glyphLocation: {},
      selectedGlyph: null,
      selectedGlyphName: null,
      selectedSourceIndex: null,
      selection: new Set(),
      hoverSelection: new Set(),
      combinedSelection: new Set(), // dynamic: selection | hoverSelection
      viewBox: this.canvasController.getViewBox(),
      positionedLines: [],
      backgroundImagesAreLocked: true,
      backgroundLayers: {},
      editingLayers: {},
    });
    this.sceneSettings = this.sceneSettingsController.model;

    // Set up the mutual relationship between text and glyphLines
    this.sceneSettingsController.addKeyListener("text", async (event) => {
      if (event.senderInfo?.senderID === this) {
        return;
      }
      await this.fontController.ensureInitialized;
      const glyphLines = glyphLinesFromText(
        event.newValue,
        this.fontController.characterMap,
        this.fontController.glyphMap
      );
      this.sceneSettingsController.setItem("glyphLines", glyphLines, {
        senderID: this,
      });
    });

    this.sceneSettingsController.addKeyListener(
      "glyphLines",
      (event) => {
        if (event.senderInfo?.senderID === this) {
          return;
        }
        const text = textFromGlyphLines(event.newValue);
        this.sceneSettingsController.setItem("text", text, { senderID: this });
      },
      true
    );

    // auto view box
    this.sceneSettingsController.addKeyListener("selectedGlyph", (event) => {
      if (event.newValue?.isEditing) {
        this.autoViewBox = false;
      }
      this.canvasController.requestUpdate();
    });

    this.sceneSettingsController.addKeyListener(
      "positionedLines",
      (event) => {
        this.setAutoViewBox();
        this.canvasController.requestUpdate();
      },
      true
    );

    // Set up the dependencies between fontLocationUser, fontLocationSource and
    // fontLocationSourceMapped
    const locationDependencies = [
      [
        "fontLocationUser",
        "fontLocationSource",
        "mapUserLocationToSourceLocation",
        false,
      ],
      [
        "fontLocationSource",
        "fontLocationUser",
        "mapSourceLocationToUserLocation",
        false,
      ],
      [
        "fontLocationSource",
        "fontLocationSourceMapped",
        "mapSourceLocationToMappedSourceLocation",
        true,
      ],
      [
        "fontLocationSourceMapped",
        "fontLocationSource",
        "mapMappedSourceLocationToSourceLocation",
        true,
      ],
    ];

    for (const [
      sourceKey,
      destinationKey,
      mapMethodName,
      maySkip,
    ] of locationDependencies) {
      const mapMethod = this.fontController[mapMethodName].bind(this.fontController);

      this.sceneSettingsController.addKeyListener(
        sourceKey,
        (event) => {
          if (event.senderInfo?.senderStack?.includes(destinationKey)) {
            return;
          }

          const mapFunc =
            maySkip && this.sceneSettings.fontAxesSkipMapping
              ? (loc) => loc
              : mapMethod;

          this.sceneSettingsController.setItem(
            destinationKey,
            mapFunc(event.newValue),
            {
              senderStack: (event.senderInfo?.senderStack || []).concat([
                sourceKey,
                destinationKey,
              ]),
            }
          );
        },
        true
      );
    }

    // Trigger recalculating the mapped location
    this.sceneSettingsController.addKeyListener("fontAxesSkipMapping", (event) => {
      this.sceneSettings.fontLocationSource = {
        ...this.sceneSettings.fontLocationSource,
      };
    });

    // Set up the mutual dependencies between location and selectedSourceIndex
    const locationSelectedSourceToken = Symbol("location-selectedSourceIndex");

    this.sceneSettingsController.addKeyListener(
      ["fontLocationSourceMapped", "glyphLocation"],
      async (event) => {
        if (event.senderInfo?.senderID === locationSelectedSourceToken) {
          return;
        }
        const varGlyphController =
          await this.sceneModel.getSelectedVariableGlyphController();
        const sourceIndex = varGlyphController?.getSourceIndex({
          ...this.sceneSettings.fontLocationSourceMapped,
          ...this.sceneSettings.glyphLocation,
        });
        this.sceneSettingsController.setItem("selectedSourceIndex", sourceIndex, {
          senderID: locationSelectedSourceToken,
        });
      }
    );

    this.sceneSettingsController.addKeyListener(
      "selectedSourceIndex",
      async (event) => {
        if (event.senderInfo?.senderID === locationSelectedSourceToken) {
          return;
        }
        const sourceIndex = event.newValue;
        if (sourceIndex == undefined) {
          return;
        }
        const varGlyphController =
          await this.sceneModel.getSelectedVariableGlyphController();

        const location =
          varGlyphController.getDenseSourceLocationForSourceIndex(sourceIndex);
        const { fontLocation, glyphLocation } = splitLocation(
          location,
          varGlyphController.axes
        );

        this.sceneSettingsController.setItem("fontLocationSourceMapped", fontLocation, {
          senderID: locationSelectedSourceToken,
        });
        this.sceneSettingsController.setItem(
          "glyphLocation",
          varGlyphController.foldNLIAxes(glyphLocation),
          {
            senderID: locationSelectedSourceToken,
          }
        );
      },
      true
    );

    this.fontController.addChangeListener(
      { axes: null },
      (change, isExternalChange) => {
        // the CrossAxisMapping may have changed, force to re-sync the location
        this.sceneSettings.fontLocationSource = {
          ...this.sceneSettings.fontLocationSource,
        };
      }
    );

    // Set up convenience property "selectedGlyphName"
    this.sceneSettingsController.addKeyListener(
      ["selectedGlyph", "glyphLines"],
      (event) => {
        this.sceneSettings.selectedGlyphName = getSelectedGlyphName(
          this.sceneSettings.selectedGlyph,
          this.sceneSettings.glyphLines
        );
      },
      true
    );

    // Set up convenience property "combinedSelection", which is the union of
    // selection and hoverSelection
    this.sceneSettingsController.addKeyListener(
      ["selection", "hoverSelection"],
      (event) => {
        if (event.key === "selection") {
          this._checkSelectionForLockedItems();
        }
        this.sceneSettings.combinedSelection = union(
          this.sceneSettings.selection,
          this.sceneSettings.hoverSelection
        );
        this.canvasController.requestUpdate();
      },
      true
    );

    // Set up the viewBox relationships
    this.sceneSettingsController.addKeyListener(
      "viewBox",
      (event) => {
        if (event.senderInfo?.senderID === this) {
          return;
        }
        this.canvasController.setViewBox(event.newValue);
        const actualViewBox = this.canvasController.getViewBox();
        if (!equalRect(rectRound(event.newValue), rectRound(actualViewBox))) {
          this.sceneSettingsController.setItem("viewBox", actualViewBox, {
            senderID: this,
            adjustViewBox: true,
          });
        }
      },
      true
    );

    this.canvasController.canvas.addEventListener("viewBoxChanged", (event) => {
      if (event.detail === "canvas-size") {
        this.setAutoViewBox();
      } else {
        this.autoViewBox = false;
      }
      this.sceneSettingsController.setItem(
        "viewBox",
        this.canvasController.getViewBox(),
        { senderID: this }
      );
    });

    // Update background layer glyphs
    this.sceneSettingsController.addKeyListener(
      ["backgroundLayers", "editingLayers"],
      (event) => {
        this.sceneModel.updateBackgroundGlyphs();
        this.canvasController.requestUpdate();
      }
    );
  }

  _checkSelectionForLockedItems() {
    if (
      this.sceneSettings.backgroundImagesAreLocked ||
      !this.visualizationLayersSettings.model["fontra.background-image"]
    ) {
      this._deselectBackroundImage();
    }
  }

  _deselectBackroundImage() {
    if (this.sceneSettings.selection.has("backgroundImage/0")) {
      this.sceneSettings.selection = difference(this.sceneSettings.selection, [
        "backgroundImage/0",
      ]);
    }
  }

  setupChangeListeners() {
    this.fontController.addChangeListener({ glyphMap: null }, () => {
      this.sceneModel.updateGlyphLinesCharacterMapping();

      const selectedGlyph = this.sceneSettings.selectedGlyph;
      if (
        selectedGlyph?.isEditing &&
        !this.fontController.hasGlyph(this.sceneSettings.selectedGlyphName)
      ) {
        // The glyph being edited got deleted, change state to selected
        this.sceneSettings.selectedGlyph = {
          ...selectedGlyph,
          isEditing: false,
        };
      }
    });
  }

  setupSettingsListeners() {
    this.sceneSettingsController.addKeyListener("selectedGlyph", (event) => {
      this._resetStoredGlyphPosition();
    });

    this.sceneSettingsController.addKeyListener(
      "align",
      (event) => {
        this.scrollAdjustBehavior = "text-align";
      },
      true
    );

    this.sceneSettingsController.addKeyListener("selectedGlyphName", (event) => {
      this._updateCurrentGlyphChangeListeners();
    });

    this.sceneSettingsController.addKeyListener(
      "positionedLines",
      (event) => {
        this._adjustScrollPosition();
      },
      true
    );

    this.sceneSettingsController.addKeyListener(
      "backgroundImagesAreLocked",
      (event) => {
        if (event.newValue) {
          this._deselectBackroundImage();
        }
      },
      true
    );

    this.visualizationLayersSettings.addKeyListener(
      "fontra.background-image",
      (event) => {
        if (!event.newValue) {
          this._deselectBackroundImage();
        }
      }
    );
  }

  setupEventHandling() {
    this.mouseTracker = new MouseTracker({
      drag: async (eventStream, initialEvent) =>
        await this.handleDrag(eventStream, initialEvent),
      hover: (event) => this.handleHover(event),
      element: this.canvasController.canvas,
    });
    this._eventElement = document.createElement("div");

    this.fontController.addEditListener(
      async (...args) => await this.editListenerCallback(...args)
    );
    this.canvasController.canvas.addEventListener("keydown", (event) =>
      this.handleKeyDown(event)
    );
  }

  setupContextMenuActions() {
    const topic = "0030-action-topics.menu.edit";

    registerAction(
      "action.join-contours",
      {
        topic,
        sortIndex: 100,
        defaultShortCuts: [{ baseKey: "j", commandKey: true }],
      },
      () => {
        if (this.contextMenuState.joinContourSelection?.length === 2) {
          this.doJoinSelectedOpenContours();
        } else {
          this.doCloseSelectedOpenContours();
        }
      },
      () =>
        this.contextMenuState.joinContourSelection?.length ||
        this.contextMenuState.openContourSelection?.length
    );

    registerAction(
      "action.break-contour",
      { topic },
      () => this.doBreakSelectedContours(),
      () => this.contextMenuState.pointSelection?.length
    );

    registerAction(
      "action.reverse-contour",
      { topic },
      () => this.doReverseSelectedContours(),
      () => this.contextMenuState.pointSelection?.length
    );

    registerAction(
      "action.set-contour-start",
      { topic },
      () => this.doSetStartPoint(),
      () => this.contextMenuState.pointSelection?.length
    );

    registerAction(
      "action.decompose-component",
      {
        topic,
        defaultShortCuts: [{ baseKey: "d", commandKey: true, shiftKey: true }],
      },
      () => this.doDecomposeSelectedComponents(),
      () => !!this.contextMenuState?.componentSelection?.length
    );

    registerAction("action.lock-background-images", { topic }, () => {
      this.sceneSettings.backgroundImagesAreLocked =
        !this.sceneSettings.backgroundImagesAreLocked;
      if (!this.sceneSettings.backgroundImagesAreLocked) {
        // If background images are hidden, show them
        this.visualizationLayersSettings.model["fontra.background-image"] = true;
      }
    });
  }

  setAutoViewBox() {
    if (!this.autoViewBox) {
      return;
    }
    let bounds = this.getSceneBounds();
    if (!bounds) {
      return;
    }
    bounds = rectAddMargin(bounds, 0.1);
    this.sceneSettings.viewBox = bounds;
  }

  _resetStoredGlyphPosition() {
    this._previousGlyphPosition = positionedGlyphPosition(
      this.sceneModel.getSelectedPositionedGlyph()
    );
  }

  _adjustScrollPosition() {
    let originXDelta = 0;

    const glyphPosition = positionedGlyphPosition(
      this.sceneModel.getSelectedPositionedGlyph()
    );

    const [minX, maxX] = this.sceneModel.getTextHorizontalExtents();

    if (this.scrollAdjustBehavior === "text-align" && this._previousTextExtents) {
      const [minXPre, maxXPre] = this._previousTextExtents;
      originXDelta = minX - minXPre;
    } else if (
      this.scrollAdjustBehavior === "pin-glyph-center" &&
      this._previousGlyphPosition &&
      glyphPosition
    ) {
      const previousGlyphCenter =
        this._previousGlyphPosition.x + this._previousGlyphPosition.xAdvance / 2;
      const glyphCenter = glyphPosition.x + glyphPosition.xAdvance / 2;
      originXDelta = glyphCenter - previousGlyphCenter;
    }

    if (originXDelta) {
      this.sceneSettings.viewBox = offsetRect(
        this.sceneSettings.viewBox,
        originXDelta,
        0
      );
    }

    this.scrollAdjustBehavior = null;
    this._previousTextExtents = [minX, maxX];
    this._previousGlyphPosition = glyphPosition;
  }

  async editListenerCallback(editMethodName, senderID, ...args) {
    // console.log(editMethodName, senderID, ...args);
    switch (editMethodName) {
      case "editBegin":
        {
          const glyphController = this.sceneModel.getSelectedPositionedGlyph()?.glyph;
          this.sceneModel.ghostPath = glyphController?.flattenedPath2d;
        }
        break;
      case "editEnd":
        delete this.sceneModel.ghostPath;
        break;
      case "editIncremental":
      case "editFinal":
        await this.sceneModel.updateScene();
        this.canvasController.requestUpdate();
        break;
    }
  }

  _updateCurrentGlyphChangeListeners() {
    const glyphName = this.sceneSettings.selectedGlyphName;
    if (glyphName === this._currentSelectedGlyphName) {
      return;
    }
    for (const listener of this._currentGlyphChangeListeners) {
      this.fontController.removeGlyphChangeListener(
        this._currentSelectedGlyphName,
        listener
      );
      this.fontController.addGlyphChangeListener(glyphName, listener);
    }
    this._currentSelectedGlyphName = glyphName;
  }

  addCurrentGlyphChangeListener(listener) {
    this._currentGlyphChangeListeners.push(listener);
    if (this._currentSelectedGlyphName) {
      this.fontController.addGlyphChangeListener(
        this._currentSelectedGlyphName,
        listener
      );
    }
  }

  removeCurrentGlyphChangeListener(listener) {
    if (this._currentSelectedGlyphName) {
      this.fontController.removeGlyphChangeListener(
        this._currentSelectedGlyphName,
        listener
      );
    }
    this._currentGlyphChangeListeners = this._currentGlyphChangeListeners.filter(
      (item) => item !== listener
    );
  }

  setSelectedTool(tool) {
    this.selectedTool?.deactivate();
    this.selectedTool = tool;
    this.selectedTool?.activate();
    this.hoverSelection = new Set();
    this.updateHoverState();
  }

  updateHoverState() {
    // Do this too soon and we'll risk stale hover info
    setTimeout(() => this.selectedTool.handleHover({}), 0);
  }

  handleKeyDown(event) {
    if ((!event[commandKeyProperty] || event.shiftKey) && event.key in arrowKeyDeltas) {
      this.handleArrowKeys(event);
      event.preventDefault();
      return;
    } else {
      this.selectedTool?.handleKeyDown(event);
    }
  }

  async handleArrowKeys(event) {
    if (!this.sceneSettings.selectedGlyph?.isEditing || !this.selection.size) {
      return;
    }
    let [dx, dy] = arrowKeyDeltas[event.key];
    if (event.shiftKey && (event.metaKey || event.ctrlKey)) {
      dx *= 100;
      dy *= 100;
    } else if (event.shiftKey) {
      dx *= 10;
      dy *= 10;
    }
    const delta = { x: dx, y: dy };
    await this.editGlyph((sendIncrementalChange, glyph) => {
      const layerInfo = Object.entries(
        this.getEditingLayerFromGlyphLayers(glyph.layers)
      ).map(([layerName, layerGlyph]) => {
        const behaviorFactory = new EditBehaviorFactory(
          layerGlyph,
          this.selection,
          this.selectedTool.scalingEditBehavior
        );
        return {
          layerName,
          layerGlyph,
          changePath: ["layers", layerName, "glyph"],
          pathPrefix: [],
          editBehavior: behaviorFactory.getBehavior(
            event.altKey ? "alternate" : "default"
          ),
        };
      });

      const editChanges = [];
      const rollbackChanges = [];
      for (const { layerGlyph, changePath, editBehavior } of layerInfo) {
        const editChange = editBehavior.makeChangeForDelta(delta);
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

      let newSelection;
      for (const { layerGlyph, changePath } of layerInfo) {
        const connectDetector = this.getPathConnectDetector(layerGlyph.path);
        if (connectDetector.shouldConnect()) {
          const connectChanges = recordChanges(layerGlyph, (layerGlyph) => {
            const thisSelection = connectContours(
              layerGlyph.path,
              connectDetector.connectSourcePointIndex,
              connectDetector.connectTargetPointIndex
            );
            if (newSelection === undefined) {
              newSelection = thisSelection;
            }
          });
          if (connectChanges.hasChange) {
            changes = changes.concat(connectChanges.prefixed(changePath));
          }
        }
      }
      if (newSelection) {
        this.selection = newSelection;
      }

      return {
        changes: changes,
        undoLabel: translate("action.nudge-selection"),
        broadcast: true,
      };
    });
  }

  addEventListener(eventName, handler, options) {
    this._eventElement.addEventListener(eventName, handler, options);
  }

  _dispatchEvent(eventName, detail) {
    const event = new CustomEvent(eventName, {
      bubbles: false,
      detail: detail || this,
    });
    this._eventElement.dispatchEvent(event);
  }

  updateContextMenuState(event = null) {
    this.contextMenuState = {};
    if (!this.sceneSettings.selectedGlyph?.isEditing) {
      return;
    }
    let relevantSelection;
    if (!event) {
      relevantSelection = this.selection;
    } else {
      const { selection: clickedSelection } = this.sceneModel.selectionAtPoint(
        this.localPoint(event),
        this.mouseClickMargin
      );
      if (!clickedSelection.size) {
        // Clicked on nothing, ignore selection
        relevantSelection = clickedSelection;
      } else {
        if (!isSuperset(this.selection, clickedSelection)) {
          // Clicked on something that wasn't yet selected; select it
          this.selection = clickedSelection;
        } else {
          // Use the existing selection as context
        }
        relevantSelection = this.selection;
      }
    }
    const { point: pointSelection, component: componentSelection } =
      parseSelection(relevantSelection);
    this.contextMenuState.pointSelection = pointSelection;
    this.contextMenuState.componentSelection = componentSelection;

    const glyphController = this.sceneModel.getSelectedPositionedGlyph().glyph;
    this.contextMenuState.openContourSelection = glyphController.canEdit
      ? getSelectedClosableContours(glyphController.instance.path, pointSelection)
      : [];
    this.contextMenuState.joinContourSelection = glyphController.canEdit
      ? getSelectedJoinContoursPointIndices(
          glyphController.instance.path,
          pointSelection
        )
      : [];
  }

  getContextMenuItems(event) {
    const contextMenuItems = [
      {
        title: () =>
          this.contextMenuState.joinContourSelection?.length === 2
            ? translate("action.join-contours")
            : translatePlural(
                "action.close-contour",
                this.contextMenuState.openContourSelection?.length
              ),
        actionIdentifier: "action.join-contours",
      },
      { actionIdentifier: "action.break-contour" },
      { actionIdentifier: "action.reverse-contour" },
      { actionIdentifier: "action.set-contour-start" },
      {
        title: () =>
          translatePlural(
            "action.decompose-component",
            this.contextMenuState.componentSelection?.length
          ),
        actionIdentifier: "action.decompose-component",
      },
      { actionIdentifier: "action.glyph.add-background-image" },
      {
        title: () =>
          translate(
            this.sceneSettings.backgroundImagesAreLocked
              ? "action.unlock-background-images"
              : "action.lock-background-images"
          ),
        actionIdentifier: "action.lock-background-images",
      },
    ];
    return contextMenuItems;
  }

  getSelectedGlyphName() {
    return this.sceneModel.getSelectedGlyphName();
  }

  async handleDrag(eventStream, initialEvent) {
    if (this.selectedTool) {
      await this.selectedTool.handleDrag(eventStream, initialEvent);
    }
  }

  handleHover(event) {
    if (this.selectedTool) {
      this.selectedTool.handleHover(event);
    }
  }

  localPoint(event) {
    if (event && event.x !== undefined) {
      this._currentLocalPoint = this.canvasController.localPoint(event);
    }
    return this._currentLocalPoint || { x: 0, y: 0 };
  }

  selectedGlyphPoint(event) {
    // Return the event location in the selected-glyph coordinate system
    const canvasPoint = this.localPoint(event);
    const positionedGlyph = this.sceneModel.getSelectedPositionedGlyph();
    if (positionedGlyph === undefined) {
      return undefined;
    }
    return {
      x: canvasPoint.x - positionedGlyph.x,
      y: canvasPoint.y - positionedGlyph.y,
    };
  }

  get onePixelUnit() {
    return this.canvasController.onePixelUnit;
  }

  get mouseClickMargin() {
    return this.onePixelUnit * 12;
  }

  get selection() {
    return this.sceneModel.selection;
  }

  set selection(selection) {
    if (!lenientIsEqualSet(selection, this.selection)) {
      this.sceneModel.selection = selection || new Set();
      this.sceneModel.hoverSelection = new Set();
    }
  }

  get hoverSelection() {
    return this.sceneModel.hoverSelection;
  }

  set hoverSelection(selection) {
    if (!lenientIsEqualSet(selection, this.hoverSelection)) {
      this.sceneModel.hoverSelection = selection;
      this.canvasController.requestUpdate();
    }
  }

  get hoveredGlyph() {
    return this.sceneModel.hoveredGlyph;
  }

  set hoveredGlyph(hoveredGlyph) {
    if (!equalGlyphSelection(this.sceneModel.hoveredGlyph, hoveredGlyph)) {
      this.sceneModel.hoveredGlyph = hoveredGlyph;
      this.canvasController.requestUpdate();
    }
  }

  get selectionRect() {
    return this.sceneModel.selectionRect;
  }

  set selectionRect(selRect) {
    this.sceneModel.selectionRect = selRect;
    this.canvasController.requestUpdate();
  }

  get editingLayerNames() {
    const primaryLayerName =
      this.sceneModel.getSelectedPositionedGlyph()?.glyph?.layerName;
    const layerNames = Object.keys(this.sceneSettings.editingLayers);
    if (primaryLayerName) {
      // Ensure the primary editing layer name is first in the list
      const i = layerNames.indexOf(primaryLayerName);
      if (i > 0) {
        layerNames.splice(i, 1);
        layerNames.unshift(primaryLayerName);
      }
    }
    return layerNames;
  }

  getGlyphLocations(filterShownGlyphs = false) {
    return this.sceneModel.getGlyphLocations(filterShownGlyphs);
  }

  updateGlyphLocations(glyphLocations) {
    this.sceneModel.updateGlyphLocations(glyphLocations);
  }

  getSceneBounds() {
    return this.sceneModel.getSceneBounds();
  }

  cancelEditing(reason) {
    if (this._glyphEditingDonePromise) {
      this._cancelGlyphEditing = reason;
    }
    return this._glyphEditingDonePromise;
  }

  async editGlyphAndRecordChanges(
    editFunc,
    senderID,
    requireSelectedLayer,
    ignoreGlyphLock = false
  ) {
    return await this._editGlyphOrInstanceAndRecordChanges(
      null,
      editFunc,
      senderID,
      false,
      requireSelectedLayer,
      ignoreGlyphLock
    );
  }

  async editNamedGlyphAndRecordChanges(
    glyphName,
    editFunc,
    senderID,
    requireSelectedLayer,
    ignoreGlyphLock = false
  ) {
    return await this._editGlyphOrInstanceAndRecordChanges(
      glyphName,
      editFunc,
      senderID,
      false,
      requireSelectedLayer,
      ignoreGlyphLock
    );
  }

  async editLayersAndRecordChanges(editFunc, senderID) {
    return await this._editGlyphOrInstanceAndRecordChanges(
      null,
      (glyph) => {
        const layerGlyphs = this.getEditingLayerFromGlyphLayers(glyph.layers);
        return editFunc(layerGlyphs);
      },
      senderID,
      false,
      true
    );
  }

  getEditingLayerFromGlyphLayers(layers) {
    const layerArray = this.editingLayerNames
      .map((layerName) => [layerName, layers[layerName]?.glyph])
      .filter((layer) => layer[1]);
    if (!layerArray.length) {
      // While this shouldn't really happen, it is mostly harmless:
      // if the layers list is empty but we are in fact at an editable position,
      // populate the list with the editing instance.
      const glyphController = this.sceneModel.getSelectedPositionedGlyph().glyph;
      if (glyphController?.canEdit) {
        layerArray.push([glyphController.layerName, glyphController.instance]);
      }
    }
    return Object.fromEntries(layerArray);
  }

  async _editGlyphOrInstanceAndRecordChanges(
    glyphName,
    editFunc,
    senderID,
    doInstance,
    requireSelectedLayer,
    ignoreGlyphLock = false
  ) {
    await this._editGlyphOrInstance(
      glyphName,
      (sendIncrementalChange, subject) => {
        let undoLabel;
        const changes = recordChanges(subject, (subject) => {
          undoLabel = editFunc(subject);
        });
        return {
          changes: changes,
          undoLabel: undoLabel,
          broadcast: true,
        };
      },
      senderID,
      doInstance,
      requireSelectedLayer,
      ignoreGlyphLock
    );
  }

  async editGlyph(editFunc, senderID) {
    return await this._editGlyphOrInstance(null, editFunc, senderID, false, true);
  }

  async _editGlyphOrInstance(
    glyphName,
    editFunc,
    senderID,
    doInstance,
    requireSelectedLayer,
    ignoreGlyphLock = false
  ) {
    if (this._glyphEditingDonePromise) {
      try {
        // A previous call to _editGlyphOrInstance is still ongoing.
        // Let's wait a bit, but not forever.
        await withTimeout(this._glyphEditingDonePromise, 5000);
      } catch (error) {
        throw new Error("can't call _editGlyphOrInstance() while it's still running");
      }
    }
    let editingDone;
    this._glyphEditingDonePromise = new Promise((resolve) => {
      editingDone = resolve;
    });
    try {
      return await this._editGlyphOrInstanceUnchecked(
        glyphName,
        editFunc,
        senderID,
        doInstance,
        requireSelectedLayer,
        ignoreGlyphLock
      );
    } finally {
      // // Simulate slow response
      // console.log("...delay");
      // await new Promise((resolve) => setTimeout(resolve, 1000));
      // console.log("...done");
      editingDone();
      delete this._glyphEditingDonePromise;
      delete this._cancelGlyphEditing;
    }
  }

  async _editGlyphOrInstanceUnchecked(
    glyphName,
    editFunc,
    senderID,
    doInstance,
    requireSelectedLayer,
    ignoreGlyphLock = false
  ) {
    if (this.fontController.readOnly) {
      this._dispatchEvent("glyphEditCannotEditReadOnly");
      return;
    }
    if (!glyphName) {
      glyphName = this.sceneModel.getSelectedGlyphName();
    }
    const varGlyph = await this.fontController.getGlyph(glyphName);
    const baseChangePath = ["glyphs", glyphName];

    if (!!varGlyph?.glyph.customData["fontra.glyph.locked"] && !ignoreGlyphLock) {
      this._dispatchEvent("glyphEditCannotEditLocked");
      return;
    }

    let glyphController;
    if (doInstance || requireSelectedLayer) {
      glyphController = this.sceneModel.getSelectedPositionedGlyph().glyph;
      if (!glyphController.canEdit) {
        this._dispatchEvent("glyphEditLocationNotAtSource");
        return;
      }
    }

    let editSubject;
    if (doInstance) {
      editSubject = glyphController.instance;
      baseChangePath.push("layers", glyphController.layerName, "glyph");
    } else {
      editSubject = varGlyph.glyph;
    }

    const editContext = await this.fontController.getGlyphEditContext(
      glyphName,
      baseChangePath,
      senderID || this
    );
    const sendIncrementalChange = async (change, mayDrop = false) => {
      if (change && hasChange(change)) {
        await editContext.editIncremental(change, mayDrop);
      }
    };
    const initialSelection = this.selection;
    // editContext.editBegin();
    let result;
    try {
      result = await editFunc(sendIncrementalChange, editSubject);
    } catch (error) {
      this.selection = initialSelection;
      editContext.editCancel();
      throw error;
    }

    const {
      changes: changes,
      undoLabel: undoLabel,
      broadcast: broadcast,
    } = result || {};

    if (changes && changes.hasChange) {
      const undoInfo = {
        label: undoLabel,
        undoSelection: initialSelection,
        redoSelection: this.selection,
        fontLocation: this.sceneSettings.fontLocationSourceMapped,
        glyphLocation: this.sceneSettings.glyphLocation,
        editingLayers: this.sceneSettings.editingLayers,
        editLayerName: this.sceneSettings.editLayerName,
      };
      if (!this._cancelGlyphEditing) {
        editContext.editFinal(
          changes.change,
          changes.rollbackChange,
          undoInfo,
          broadcast
        );
      } else {
        applyChange(editSubject, changes.rollbackChange);
        await editContext.editIncremental(changes.rollbackChange, false);
        editContext.editCancel();
        message(
          translate("message.glyph-could-not-be-saved"),
          `${translate("message.edit-has-been-reverted")}\n\n${
            this._cancelGlyphEditing
          }`
        );
      }
    } else {
      this.selection = initialSelection;
      editContext.editCancel();
    }
  }

  getSelectionBounds() {
    return this.sceneModel.getSelectionBounds();
  }

  getUndoRedoInfo(isRedo) {
    const glyphName = this.getSelectedGlyphName();
    if (glyphName === undefined) {
      return;
    }
    return this.fontController.getUndoRedoInfo(glyphName, isRedo);
  }

  async doUndoRedo(isRedo) {
    const glyphName = this.getSelectedGlyphName();
    if (glyphName === undefined) {
      return;
    }
    const undoInfo = await this.fontController.undoRedoGlyph(glyphName, isRedo);
    if (undoInfo !== undefined) {
      this.selection = undoInfo.undoSelection;
      if (undoInfo.fontLocation) {
        this.scrollAdjustBehavior = "pin-glyph-center";
        // Pass a copy of the location to ensure the listeners are called even
        // if the location didn't change: its dependents may vary depending on
        // the glyph data (eg. a source being there or not)
        this.sceneSettings.fontLocationSourceMapped = { ...undoInfo.fontLocation };
        this.sceneSettings.glyphLocation = { ...undoInfo.glyphLocation };
        this.sceneSettings.editingLayers = undoInfo.editingLayers;
        this.sceneSettings.editLayerName = undoInfo.editLayerName;
      }
      await this.sceneModel.updateScene();
      this.canvasController.requestUpdate();
    }
    return undoInfo !== undefined;
  }

  async doReverseSelectedContours() {
    const { point: pointSelection } = parseSelection(this.selection);
    await this.editLayersAndRecordChanges((layerGlyphs) => {
      let selection;
      for (const layerGlyph of Object.values(layerGlyphs)) {
        const path = layerGlyph.path;
        const selectedContours = getSelectedContours(path, pointSelection);
        selection = reversePointSelection(path, pointSelection);

        for (const contourIndex of selectedContours) {
          const contour = path.getUnpackedContour(contourIndex);
          contour.points.reverse();
          if (contour.isClosed) {
            const [lastPoint] = contour.points.splice(-1, 1);
            contour.points.splice(0, 0, lastPoint);
          }
          const packedContour = packContour(contour);
          layerGlyph.path.deleteContour(contourIndex);
          layerGlyph.path.insertContour(contourIndex, packedContour);
        }
      }
      this.selection = selection;
      return translate("action.reverse-contour");
    });
  }

  async doSetStartPoint() {
    await this.editLayersAndRecordChanges((layerGlyphs) => {
      let newSelection;
      for (const layerGlyph of Object.values(layerGlyphs)) {
        const path = layerGlyph.path;
        const { point: pointSelection } = parseSelection(this.selection);
        const contourToPointMap = new Map();
        for (const pointIndex of pointSelection) {
          const contourIndex = path.getContourIndex(pointIndex);
          const contourStartPoint = path.getAbsolutePointIndex(contourIndex, 0);
          if (contourToPointMap.has(contourIndex)) {
            continue;
          }
          contourToPointMap.set(contourIndex, pointIndex - contourStartPoint);
        }
        newSelection = new Set();

        contourToPointMap.forEach((contourPointIndex, contourIndex) => {
          if (contourPointIndex === 0) {
            // Already start point
            newSelection.add(`point/${path.getAbsolutePointIndex(contourIndex, 0)}`);
            return;
          }
          if (!path.contourInfo[contourIndex].isClosed) {
            // Open path, ignore
            return;
          }
          const contour = path.getUnpackedContour(contourIndex);
          const head = contour.points.splice(0, contourPointIndex);
          contour.points.push(...head);
          layerGlyph.path.deleteContour(contourIndex);
          layerGlyph.path.insertContour(contourIndex, packContour(contour));
          newSelection.add(`point/${path.getAbsolutePointIndex(contourIndex, 0)}`);
        });
      }

      this.selection = newSelection;
      return translate("action.set-contour-start");
    });
  }

  async doJoinSelectedOpenContours() {
    const newSelection = new Set();
    const [pointIndex1, pointIndex2] = this.contextMenuState.joinContourSelection;
    await this.editLayersAndRecordChanges((layerGlyphs) => {
      for (const layerGlyph of Object.values(layerGlyphs)) {
        const selectionPointIndices = joinContours(
          layerGlyph.path,
          pointIndex1,
          pointIndex2
        );

        for (const pointIndex of selectionPointIndices) {
          newSelection.add(`point/${pointIndex}`);
        }
      }
      this.selection = newSelection;
      return translate("action.join-contours");
    });
  }

  async doCloseSelectedOpenContours() {
    const openContours = this.contextMenuState.openContourSelection;
    await this.editLayersAndRecordChanges((layerGlyphs) => {
      for (const layerGlyph of Object.values(layerGlyphs)) {
        const path = layerGlyph.path;
        for (const contourIndex of openContours) {
          // close open contour
          path.contourInfo[contourIndex].isClosed = true;
          closeContourEnsureCubicOffCurves(path, contourIndex);
        }
      }
      return translatePlural("action.close-contour", openContours.length);
    });
  }

  async doBreakSelectedContours() {
    const { point: pointIndices } = parseSelection(this.selection);
    await this.editLayersAndRecordChanges((layerGlyphs) => {
      let numSplits;
      for (const layerGlyph of Object.values(layerGlyphs)) {
        numSplits = splitPathAtPointIndices(layerGlyph.path, pointIndices);
      }
      this.selection = new Set();
      return translatePlural("action.break-contour", numSplits);
    });
  }

  async doDecomposeSelectedComponents() {
    const varGlyph = await this.sceneModel.getSelectedVariableGlyphController();

    // Retrieve the global location for each editing layer
    const layerLocations = {};
    for (const [sourceIndex, source] of enumerate(varGlyph.sources)) {
      if (
        this.editingLayerNames.indexOf(source.layerName) >= 0 &&
        !(source.layerName in layerLocations)
      ) {
        layerLocations[source.layerName] =
          varGlyph.getDenseSourceLocationForSourceIndex(sourceIndex);
      }
    }

    // Get the decomposed path/components for each editing layer
    const { component: componentSelection } = parseSelection(this.selection);
    componentSelection.sort((a, b) => (a > b) - (a < b));
    const getGlyphFunc = (glyphName) => this.fontController.getGlyph(glyphName);
    const decomposed = {};
    for (const layerName of this.editingLayerNames) {
      const layerGlyph = varGlyph.layers[layerName]?.glyph;
      if (!layerGlyph) {
        continue;
      }
      decomposed[layerName] = await decomposeComponents(
        layerGlyph.components,
        componentSelection,
        layerLocations[layerName],
        getGlyphFunc
      );
    }

    await this.editLayersAndRecordChanges((layerGlyphs) => {
      for (const [layerName, layerGlyph] of Object.entries(layerGlyphs)) {
        const decomposeInfo = decomposed[layerName];
        const path = layerGlyph.path;
        const components = layerGlyph.components;
        const anchors = layerGlyph.anchors;

        for (const contour of decomposeInfo.path.iterContours()) {
          // Hm, rounding should be optional
          // contour.coordinates = contour.coordinates.map(c => Math.round(c));
          path.appendContour(contour);
        }
        components.push(...decomposeInfo.components);
        for (const anchor of decomposeInfo.anchors) {
          // preserve existing anchors
          const exists = anchors.some((a) => a.name === anchor.name);
          if (!exists) {
            anchors.push(anchor);
          }
        }

        // Next, delete the components we decomposed
        for (const componentIndex of reversed(componentSelection)) {
          components.splice(componentIndex, 1);
        }
      }
      this.selection = new Set();
      return translatePlural("action.decompose-component", componentSelection?.length);
    });
  }

  getPathConnectDetector(path) {
    if (!path) {
      const positionedGlyph = this.sceneModel.getSelectedPositionedGlyph();
      path = positionedGlyph.glyph.path;
    }
    return new PathConnectDetector(this, path);
  }

  async getStaticGlyphControllers() {
    const varGlyph = await this.sceneModel.getSelectedVariableGlyphController();

    const layerGlyphs = this.getEditingLayerFromGlyphLayers(varGlyph.layers);
    const staticGlyphControllers = {};

    for (const [i, source] of enumerate(varGlyph.sources)) {
      for (const layerInfo of varGlyph.getSourceLayerNamesForSourceIndex(i)) {
        const layerName = layerInfo.fullName;
        if (layerName in layerGlyphs) {
          staticGlyphControllers[layerName] =
            await this.fontController.getLayerGlyphController(
              varGlyph.name,
              layerName,
              i
            );
        }
      }
    }
    return staticGlyphControllers;
  }
}

class PathConnectDetector {
  constructor(sceneController, path) {
    this.sceneController = sceneController;
    this.path = path;
    const selection = sceneController.selection;
    if (selection.size !== 1) {
      return;
    }
    const { point: pointSelection } = parseSelection(selection);
    if (
      pointSelection?.length !== 1 ||
      !this.path.isStartOrEndPoint(pointSelection[0])
    ) {
      return;
    }
    this.connectSourcePointIndex = pointSelection[0];
  }

  shouldConnect(showConnectIndicator = false) {
    if (this.connectSourcePointIndex === undefined) {
      return false;
    }

    const sceneController = this.sceneController;
    const connectSourcePoint = this.path.getPoint(this.connectSourcePointIndex);
    const connectTargetPointIndex = this.path.pointIndexNearPoint(
      connectSourcePoint,
      sceneController.mouseClickMargin,
      this.connectSourcePointIndex
    );
    const shouldConnect =
      connectTargetPointIndex !== undefined &&
      connectTargetPointIndex !== this.connectSourcePointIndex &&
      !!this.path.isStartOrEndPoint(connectTargetPointIndex);
    if (showConnectIndicator) {
      if (shouldConnect) {
        sceneController.sceneModel.pathConnectTargetPoint = this.path.getPoint(
          connectTargetPointIndex
        );
      } else {
        delete sceneController.sceneModel.pathConnectTargetPoint;
      }
    }
    this.connectTargetPointIndex = connectTargetPointIndex;
    return shouldConnect;
  }

  clearConnectIndicator() {
    delete this.sceneController.sceneModel.pathConnectTargetPoint;
  }
}

function reversePointSelection(path, pointSelection) {
  const newSelection = [];
  for (const pointIndex of pointSelection) {
    const contourIndex = path.getContourIndex(pointIndex);
    const contourStartPoint = path.getAbsolutePointIndex(contourIndex, 0);
    const numPoints = path.getNumPointsOfContour(contourIndex);
    let newPointIndex = pointIndex;
    if (path.contourInfo[contourIndex].isClosed) {
      if (newPointIndex != contourStartPoint) {
        newPointIndex =
          contourStartPoint + numPoints - (newPointIndex - contourStartPoint);
      }
    } else {
      newPointIndex =
        contourStartPoint + numPoints - 1 - (newPointIndex - contourStartPoint);
    }
    newSelection.push(`point/${newPointIndex}`);
  }
  newSelection.sort((a, b) => (a > b) - (a < b));
  return new Set(newSelection);
}

function getSelectedJoinContoursPointIndices(path, pointSelection) {
  if (pointSelection?.length !== 2) {
    return [];
  }
  const contourIndices = [];
  for (const pointIndex of pointSelection) {
    if (!path.isStartOrEndPoint(pointIndex)) {
      // must be start or end point
      return [];
    }
    const contourIndex = path.getContourIndex(pointIndex);
    contourIndices.push(contourIndex);
    if (path.contourInfo[contourIndex].isClosed) {
      // return, because at least one of the selected points is a closed contour
      return [];
    }
  }

  const contourIndicesSet = new Set(contourIndices);
  if (contourIndicesSet.size !== 2) {
    // must be two distinct contours, if same use 'close contour'
    return [];
  }

  return pointSelection;
}

function getSelectedContours(path, pointSelection) {
  const selectedContours = new Set();
  for (const pointIndex of pointSelection) {
    const contourIndex = path.getContourIndex(pointIndex);
    if (contourIndex != undefined) {
      selectedContours.add(contourIndex);
    }
  }
  return [...selectedContours];
}

function getSelectedClosableContours(path, pointSelection) {
  if (!path || !pointSelection) {
    return [];
  }
  const selectedContours = new Set();
  for (const contourIndex of getSelectedContours(path, pointSelection)) {
    if (path.contourInfo[contourIndex].isClosed) {
      // skip if contour is closed already
      continue;
    }
    if (path.getNumPointsOfContour(contourIndex) <= 2) {
      // skip if contour has two (or less) points only
      // (two on-curve or one off-curve and one on-curve)
      continue;
    }
    const contour = path.getContour(contourIndex);
    const numOnCurvePoints = contour.pointTypes.reduce(
      (acc, pointType) =>
        acc +
        ((pointType & VarPackedPath.POINT_TYPE_MASK) === VarPackedPath.ON_CURVE
          ? 1
          : 0),
      0
    );
    if (numOnCurvePoints <= 1) {
      // skip single point contour
      // could have one on-curve, but two off-curve points
      continue;
    }
    selectedContours.add(contourIndex);
  }

  return [...selectedContours];
}

function closeContourEnsureCubicOffCurves(path, contourIndex) {
  const startPoint = path.getContourPoint(contourIndex, 0);
  const secondPoint = path.getContourPoint(contourIndex, 1);
  const prevEndPoint = path.getContourPoint(contourIndex, -2);
  const endPoint = path.getContourPoint(contourIndex, -1);

  const offCurveAtStart = !secondPoint.type && startPoint.type && !endPoint.type;
  const firstPoint = offCurveAtStart ? secondPoint : prevEndPoint;
  const middlePoint = offCurveAtStart ? startPoint : endPoint;
  const lastPoint = offCurveAtStart ? endPoint : startPoint;

  if (firstPoint.type || middlePoint.type != "cubic" || lastPoint.type) {
    // Sanity check: we expect on-curve/cubic-off-curve/on-curve
    return;
  }

  // Compute handles for a cubic segment that will look the same as the
  // one-off-curve quad segment we have.
  const [handle1, handle2] = [firstPoint, lastPoint].map((point) => {
    return {
      ...vector.roundVector(scalePoint(point, middlePoint, 2 / 3)),
      type: "cubic",
    };
  });

  path.setContourPoint(contourIndex, offCurveAtStart ? 0 : -1, handle1);
  path.appendPoint(contourIndex, handle2);
}

function positionedGlyphPosition(positionedGlyph) {
  if (!positionedGlyph) {
    return undefined;
  }
  return { x: positionedGlyph.x, xAdvance: positionedGlyph.glyph.xAdvance };
}

export function equalGlyphSelection(glyphSelectionA, glyphSelectionB) {
  return (
    glyphSelectionA?.lineIndex === glyphSelectionB?.lineIndex &&
    glyphSelectionA?.glyphIndex === glyphSelectionB?.glyphIndex
  );
}

function splitLocation(location, glyphAxes) {
  const glyphAxisNames = new Set(glyphAxes.map((axis) => axis.name));

  const fontLocation = {};
  const glyphLocation = {};

  for (const [axisName, axisValue] of Object.entries(location)) {
    if (glyphAxisNames.has(axisName)) {
      glyphLocation[axisName] = axisValue;
    } else {
      fontLocation[axisName] = axisValue;
    }
  }

  return { fontLocation, glyphLocation };
}

export function joinContours(path, firstPointIndex, secondPointIndex) {
  let selectedPointIndices = [];
  assert(
    path.isStartOrEndPoint(firstPointIndex) && path.isStartOrEndPoint(secondPointIndex),
    "firstPointIndex and secondPointIndex must be start or end points"
  );
  assert(
    firstPointIndex < secondPointIndex,
    "firstPointIndex must be less than secondPointIndex"
  );

  const [firstContourIndex, firstContourPointIndex] =
    path.getContourAndPointIndex(firstPointIndex);
  const [secondContourIndex, secondContourPointIndex] =
    path.getContourAndPointIndex(secondPointIndex);

  assert(
    firstContourIndex != secondContourIndex,
    "firstContourIndex and secondContourIndex must be different"
  );

  let firstContour = path.getUnpackedContour(firstContourIndex);
  let secondContour = path.getUnpackedContour(secondContourIndex);

  if (!!firstContourPointIndex == !!secondContourPointIndex) {
    secondContour.points.reverse();
  }

  if (!firstContourPointIndex) {
    [firstContour, secondContour] = [secondContour, firstContour];
  }
  let selectedContourPointIndex1 = firstContour.points.length - 1;
  let selectedContourPointIndex2 = selectedContourPointIndex1 + 1;
  let loneCubicHandle;
  const lastPointFirstContour = firstContour.points.at(-1);
  const firstPointSecondContour = secondContour.points.at(0);
  if (lastPointFirstContour.type && !firstPointSecondContour.type) {
    loneCubicHandle = firstContour.points.pop();
  } else if (firstPointSecondContour.type && !lastPointFirstContour.type) {
    loneCubicHandle = secondContour.points.shift();
  }

  if (loneCubicHandle) {
    const [handle1, handle2] = [
      firstContour.points.at(-1),
      secondContour.points.at(0),
    ].map((point) => {
      return {
        ...vector.roundVector(scalePoint(point, loneCubicHandle, 2 / 3)),
        type: "cubic",
      };
    });
    firstContour.points.push(handle1);
    firstContour.points.push(handle2);
    selectedContourPointIndex2 += 1;
  }

  const newContour = {
    points: firstContour.points.concat(secondContour.points),
    isClosed: false,
  };

  path.deleteContour(firstContourIndex);
  path.insertUnpackedContour(firstContourIndex, newContour);
  path.deleteContour(secondContourIndex);

  selectedPointIndices.push(
    path.getAbsolutePointIndex(firstContourIndex, selectedContourPointIndex1)
  );
  selectedPointIndices.push(
    path.getAbsolutePointIndex(firstContourIndex, selectedContourPointIndex2)
  );

  return selectedPointIndices;
}
