import {
  canPerformAction,
  doPerformAction,
  getActionIdentifierFromKeyEvent,
  registerAction,
  registerActionCallbacks,
} from "../core/actions.js";
import { Backend } from "../core/backend-api.js";
import { CanvasController } from "../core/canvas-controller.js";
import { recordChanges } from "../core/change-recorder.js";
import { applyChange } from "../core/changes.js";
import { FontController } from "../core/font-controller.js";
import { staticGlyphToGLIF } from "../core/glyph-glif.js";
import { pathToSVG } from "../core/glyph-svg.js";
import { loaderSpinner } from "../core/loader-spinner.js";
import { ObservableController } from "../core/observable-object.js";
import {
  deleteSelectedPoints,
  filterPathByPointIndices,
} from "../core/path-functions.js";
import {
  centeredRect,
  rectAddMargin,
  rectCenter,
  rectFromArray,
  rectRound,
  rectScaleAroundCenter,
  rectSize,
  rectToArray,
} from "../core/rectangle.js";
import { SceneView } from "../core/scene-view.js";
import { isSuperset } from "../core/set-ops.js";
import { labeledCheckbox, labeledTextInput, pickFile } from "../core/ui-utils.js";
import {
  commandKeyProperty,
  enumerate,
  fetchJSON,
  hyphenatedToCamelCase,
  hyphenatedToLabel,
  isActiveElementTypeable,
  isObjectEmpty,
  loadURLFragment,
  makeUPlusStringFromCodePoint,
  modulo,
  parseSelection,
  range,
  readFileOrBlobAsDataURL,
  readFromClipboard,
  reversed,
  scheduleCalls,
  writeObjectToURLFragment,
  writeToClipboard,
} from "../core/utils.js";
import { addItemwise, mulScalar, subItemwise } from "../core/var-funcs.js";
import { StaticGlyph, VariableGlyph, copyComponent } from "../core/var-glyph.js";
import { locationToString, makeSparseLocation } from "../core/var-model.js";
import { VarPackedPath, joinPaths } from "../core/var-path.js";
import { CJKDesignFrame } from "./cjk-design-frame.js";
import { HandTool } from "./edit-tools-hand.js";
import { KnifeTool } from "./edit-tools-knife.js";
import { PenTool } from "./edit-tools-pen.js";
import { PointerTools } from "./edit-tools-pointer.js";
import { PowerRulerTool } from "./edit-tools-power-ruler.js";
import { ShapeTool } from "./edit-tools-shape.js";
import { SceneController } from "./scene-controller.js";
import { MIN_SIDEBAR_WIDTH, Sidebar } from "./sidebar.js";
import {
  allGlyphsCleanVisualizationLayerDefinition,
  visualizationLayerDefinitions,
} from "./visualization-layer-definitions.js";
import { VisualizationLayers } from "./visualization-layers.js";
import { makeFontraMenuBar } from "/core/fontra-menus.js";
import * as html from "/core/html-utils.js";
import { themeController } from "/core/theme-settings.js";
import { getDecomposedIdentity } from "/core/transform.js";
import "/web-components/inline-svg.js";
import { MenuItemDivider, showMenu } from "/web-components/menu-panel.js";
import { dialog, dialogSetup, message } from "/web-components/modal-dialog.js";
import { parsePluginBasePath } from "/web-components/plugin-manager.js";

import DesignspaceNavigationPanel from "./panel-designspace-navigation.js";
import GlyphNotePanel from "./panel-glyph-note.js";
import GlyphSearchPanel from "./panel-glyph-search.js";
import ReferenceFontPanel from "./panel-reference-font.js";
import RelatedGlyphsPanel from "./panel-related-glyphs.js";
import SelectionInfoPanel from "./panel-selection-info.js";
import TextEntryPanel from "./panel-text-entry.js";
import TransformationPanel from "./panel-transformation.js";
import Panel from "./panel.js";
import { applicationSettingsController } from "/core/application-settings.js";
import {
  ensureLanguageHasLoaded,
  translate,
  translatePlural,
} from "/core/localization.js";
import { ViewController } from "/core/view-controller.js";

const MIN_CANVAS_SPACE = 200;

const PASTE_BEHAVIOR_REPLACE = "replace";
const PASTE_BEHAVIOR_ADD = "add";

export class EditorController extends ViewController {
  constructor(font) {
    super(font);
    const canvas = document.querySelector("#edit-canvas");
    canvas.focus();

    canvas.ondragenter = (event) => this._onDragEnter(event);
    canvas.ondragover = (event) => this._onDragOver(event);
    canvas.ondragleave = (event) => this._onDragLeave(event);
    canvas.ondrop = (event) => this._onDrop(event);

    const canvasController = new CanvasController(canvas, (magnification) =>
      this.canvasMagnificationChanged(magnification)
    );
    this.canvasController = canvasController;

    this.fontController = new FontController(font);
    this.fontController.addEditListener(
      async (...args) => await this.editListenerCallback(...args)
    );

    this.visualizationLayers = new VisualizationLayers(
      visualizationLayerDefinitions,
      this.isThemeDark
    );

    this.visualizationLayersSettings = newVisualizationLayersSettings(
      this.visualizationLayers
    );
    this.visualizationLayersSettings.addListener((event) => {
      this.visualizationLayers.toggle(event.key, event.newValue);
      this.canvasController.requestUpdate();
    }, true);

    this.sceneController = new SceneController(
      this.fontController,
      canvasController,
      applicationSettingsController,
      this.visualizationLayersSettings
    );

    this.sceneSettingsController = this.sceneController.sceneSettingsController;
    this.sceneSettings = this.sceneSettingsController.model;
    this.sceneModel = this.sceneController.sceneModel;

    this.sceneSettingsController.addKeyListener(
      [
        "align",
        "editLayerName",
        "editingLayers",
        "fontLocationUser",
        "glyphLocation",
        "fontAxesUseSourceCoordinates",
        "fontAxesShowEffectiveLocation",
        "fontAxesShowHidden",
        "fontAxesSkipMapping",
        "selectedGlyph",
        "selection",
        "text",
        "viewBox",
      ],
      (event) => {
        if (event.senderInfo?.senderID !== this && !event.senderInfo?.adjustViewBox) {
          this.updateWindowLocation(); // scheduled with delay
        }
      }
    );

    this.cjkDesignFrame = new CJKDesignFrame(this);

    const sceneView = new SceneView(this.sceneModel, (model, controller) =>
      this.visualizationLayers.drawVisualizationLayers(model, controller)
    );
    canvasController.sceneView = sceneView;

    this.defaultSceneView = sceneView;

    this.cleanGlyphsLayers = new VisualizationLayers(
      [allGlyphsCleanVisualizationLayerDefinition],
      this.isThemeDark
    );
    this.cleanSceneView = new SceneView(this.sceneModel, (model, controller) => {
      this.cleanGlyphsLayers.drawVisualizationLayers(model, controller);
    });

    // TODO move event stuff out of here
    this.sceneController.addEventListener("doubleClickedComponents", async (event) => {
      this.doubleClickedComponentsCallback(event);
    });

    this.sceneController.addEventListener("doubleClickedAnchors", async (event) => {
      this.doubleClickedAnchorsCallback(event);
    });

    this.sceneController.addEventListener("doubleClickedGuidelines", async (event) => {
      this.doubleClickedGuidelinesCallback(event);
    });

    // TODO: Font Guidelines
    // this.sceneController.addEventListener("doubleClickedFontGuidelines", async (event) => {
    //   this.doubleClickedFontGuidelinesCallback(event);
    // });

    this.sceneController.addEventListener("glyphEditCannotEditReadOnly", async () => {
      this.showDialogGlyphEditCannotEditReadOnly();
    });

    this.sceneController.addEventListener("glyphEditCannotEditLocked", async () => {
      this.showDialogGlyphEditCannotEditLocked();
    });

    this.sceneController.addEventListener("glyphEditLocationNotAtSource", async () => {
      this.showDialogGlyphEditLocationNotAtSource();
    });

    this.sceneController.addEventListener("doubleClickedUndefinedGlyph", () => {
      if (this.fontController.readOnly) {
        this.showDialogGlyphEditCannotEditReadOnly(true);
      } else {
        this.showDialogNewGlyph();
      }
    });

    this.sidebars = [];
    this.contextMenuPosition = { x: 0, y: 0 };

    this.initSidebars();
    this.initTools();
    this.initActions();
    this.initTopBar();
    this.initContextMenuItems();
    this.initMiniConsole();

    // If a stored active panel is not a plug-in, we can restore it before the plug-ins
    // are loaded. Else, it has to wait until after.
    const deferRestoreOpenTabs = [];
    for (const sidebar of this.sidebars) {
      const panelName = localStorage.getItem(
        `fontra-selected-sidebar-${sidebar.identifier}`
      );
      if (sidebar.panelIdentifiers.includes(panelName)) {
        this.restoreOpenTabs(sidebar.identifier);
      } else {
        deferRestoreOpenTabs.push(sidebar.identifier);
      }
    }

    this.initPlugins().then(() => {
      for (const identifier of deferRestoreOpenTabs) {
        this.restoreOpenTabs(identifier);
      }
    });

    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addListener((event) => this.themeChanged());
    themeController.addListener((event) => {
      this.themeChanged();
    });

    this.canvasController.canvas.addEventListener("contextmenu", (event) =>
      this.contextMenuHandler(event)
    );
    window.addEventListener("keydown", (event) => this.keyDownHandler(event));
    window.addEventListener("keyup", (event) => this.keyUpHandler(event));

    this.enteredText = "";
    this.updateWindowLocation = scheduleCalls(
      (event) => this._updateWindowLocation(),
      200
    );

    window.addEventListener("popstate", (event) => {
      this.setupFromWindowLocation();
    });

    this.updateWithDelay();
  }

  initActions() {
    {
      const topic = "0030-action-topics.menu.edit";

      registerActionCallbacks(
        "action.undo",
        () => this.doUndoRedo(false),
        () => this.canUndoRedo(false),
        () => this.getUndoRedoLabel(false)
      );

      registerActionCallbacks(
        "action.redo",
        () => this.doUndoRedo(true),
        () => this.canUndoRedo(true),
        () => this.getUndoRedoLabel(true)
      );

      if (insecureSafariConnection()) {
        // In Safari, the async clipboard API only works in a secure context
        // (HTTPS). We apply a workaround using the clipboard event API, but
        // only in Safari, and when in an HTTP context
        this.initFallbackClipboardEventListeners();
      } else {
        registerActionCallbacks(
          "action.cut",
          () => this.doCut(),
          () => this.canCut()
        );

        registerActionCallbacks(
          "action.copy",
          () => this.doCopy(),
          () => this.canCopy()
        );

        registerActionCallbacks(
          "action.paste",
          () => this.doPaste(),
          () => this.canPaste()
        );
      }

      registerActionCallbacks(
        "action.delete",
        (event) => this.doDelete(event),
        () => this.canDelete(),
        () =>
          this.sceneSettings.selectedGlyph?.isEditing
            ? translate("action.delete-selection")
            : translate("action.delete-glyph")
      );

      registerActionCallbacks(
        "action.select-all",
        () => this.doSelectAllNone(false),
        () => this.sceneSettings.selectedGlyph?.isEditing
      );

      registerActionCallbacks(
        "action.select-none",
        () => this.doSelectAllNone(true),
        () =>
          this.sceneSettings.selectedGlyph?.isEditing &&
          this.sceneSettings.selection.size
      );

      registerAction(
        "action.add-component",
        { topic },
        () => this.doAddComponent(),
        () => this.canEditGlyph()
      );

      registerAction(
        "action.add-anchor",
        { topic },
        () => this.doAddAnchor(),
        () => this.canEditGlyph()
      );

      registerAction(
        "action.add-guideline",
        { topic },
        () => this.doAddGuideline(),
        () => this.canEditGlyph()
      );

      registerAction(
        "action.lock-guideline",
        { topic },
        () => this.doLockGuideline(!this.selectionHasLockedGuidelines()),
        () => this.canLockGuideline(),
        () => this.getLockGuidelineLabel(this.selectionHasLockedGuidelines())
      );
    }

    {
      const topic = "0020-action-topics.menu.view";

      registerActionCallbacks("action.zoom-in", () => this.zoomIn());

      registerActionCallbacks("action.zoom-out", () => this.zoomOut());

      registerActionCallbacks(
        "action.zoom-fit-selection",
        () => this.zoomFit(),
        () => {
          let viewBox = this.sceneController.getSelectionBounds();
          if (!viewBox) {
            return false;
          }

          const size = rectSize(viewBox);
          if (size.width < 4 && size.height < 4) {
            const center = rectCenter(viewBox);
            viewBox = centeredRect(center.x, center.y, 10, 10);
          } else {
            viewBox = rectAddMargin(viewBox, 0.1);
          }
          return !this.canvasController.isActualViewBox(viewBox);
        }
      );

      registerAction(
        "action.select-previous-source",
        {
          topic,
          titleKey: "menubar.view.select-previous-source",
          defaultShortCuts: [{ baseKey: "ArrowUp", commandKey: true }],
        },
        () => this.doSelectPreviousNextSource(true)
      );

      registerAction(
        "action.select-next-source",
        {
          topic,
          titleKey: "menubar.view.select-next-source",
          defaultShortCuts: [{ baseKey: "ArrowDown", commandKey: true }],
        },
        () => this.doSelectPreviousNextSource(false)
      );

      registerAction(
        "action.select-previous-source-layer",
        {
          topic,
          titleKey: "menubar.view.select-previous-source-layer",
          defaultShortCuts: [{ baseKey: "ArrowUp", commandKey: true, altKey: true }],
        },
        () => this.doSelectPreviousNextSourceLayer(true)
      );

      registerAction(
        "action.select-next-source-layer",
        {
          topic,
          titleKey: "menubar.view.select-next-source-layer",
          defaultShortCuts: [{ baseKey: "ArrowDown", commandKey: true, altKey: true }],
        },
        () => this.doSelectPreviousNextSourceLayer(false)
      );

      registerAction(
        "action.select-previous-glyph",
        {
          topic,
          titleKey: "menubar.view.select-previous-glyph",
          defaultShortCuts: [{ baseKey: "ArrowLeft", commandKey: true }],
        },
        () => this.doSelectPreviousNextGlyph(true)
      );

      registerAction(
        "action.select-next-glyph",
        {
          topic,
          titleKey: "menubar.view.select-next-glyph",
          defaultShortCuts: [{ baseKey: "ArrowRight", commandKey: true }],
        },
        () => this.doSelectPreviousNextGlyph(false)
      );

      registerAction(
        "action.replace-selected-glyph-on-canvas",
        {
          topic,
          titleKey: "menubar.view.replace-selected-glyph-on-canvas",
        },
        () =>
          this.doCanvasInsertGlyph(
            translate("menubar.view.replace-selected-glyph-on-canvas"),
            translate("dialog.replace"),
            0
          )
      );

      registerAction(
        "action.remove-selected-glyph-from-canvas",
        {
          topic,
          titleKey: "menubar.view.remove-selected-glyph-from-canvas",
        },
        () => this.insertGlyphInfos([], 0) // empty array removes the selected glyph
      );

      registerAction(
        "action.add-glyph-before-selected-glyph",
        {
          topic,
          titleKey: "menubar.view.add-glyph-before-selected-glyph",
        },
        () =>
          this.doCanvasInsertGlyph(
            translate("menubar.view.add-glyph-before-selected-glyph"),
            translate("dialog.add"),
            -1
          )
      );

      registerAction(
        "action.add-glyph-after-selected-glyph",
        {
          topic,
          titleKey: "menubar.view.add-glyph-after-selected-glyph",
        },
        () =>
          this.doCanvasInsertGlyph(
            translate("menubar.view.add-glyph-after-selected-glyph"),
            translate("dialog.add"),
            1
          )
      );
    }

    {
      const topic = "0035-action-topics.menu.glyph";
      registerAction(
        "action.glyph.add-background-image",
        { topic },
        () => this.addBackgroundImageFromFileSystem(),
        () => this.canPlaceBackgroundImage()
      );
    }

    {
      const topic = "0040-action-topics.sidebars";

      const sideBarShortCuts = {
        "glyph-search": "f",
        "selection-info": "i",
      };

      this.sidebars
        .map((sidebar) => sidebar.panelIdentifiers)
        .flat()
        .forEach((panelIdentifier) => {
          const titleKey = `sidebar.${panelIdentifier}`;
          const shortKey = sideBarShortCuts[panelIdentifier];

          const defaultShortCuts = shortKey
            ? [{ baseKey: shortKey, commandKey: shortKey }]
            : [];

          registerAction(
            `action.sidebars.toggle.${panelIdentifier}`,
            { topic, titleKey, defaultShortCuts, allowGlobalOverride: true },
            () => this.toggleSidebar(panelIdentifier, true)
          );
        });
    }

    {
      const topic = "0010-action-topics.tools";

      const defaultKeys = {};
      for (const [i, toolIdentifier] of enumerate(Object.keys(this.topLevelTools), 1)) {
        if (i <= 9) {
          defaultKeys[toolIdentifier] = `${i}`;
        }
      }

      for (const toolIdentifier of Object.keys(this.tools)) {
        const isSubTool = !this.topLevelTools[toolIdentifier];
        const titleKey = `editor.${toolIdentifier}`;
        const defaultKey = defaultKeys[toolIdentifier];
        const defaultShortCuts = defaultKey ? [{ baseKey: defaultKey }] : [];
        registerAction(
          `actions.tools.${toolIdentifier}`,
          {
            topic,
            titleKey,
            defaultShortCuts: defaultShortCuts,
          },
          () => {
            this.setSelectedTool(toolIdentifier, isSubTool);
          }
        );
      }
    }

    registerAction(
      "action.canvas.clean-view-and-hand-tool",
      {
        topic: "0020-action-topics.menu.view",
        titleKey: "canvas.clean-view-and-hand-tool",
        defaultShortCuts: [{ baseKey: "Space" }],
      },
      (event) => this.enterCleanViewAndHandTool(event)
    );

    {
      const topic = "0060-action-topics.glyph-editor-appearance";

      const layers = this.visualizationLayers.definitions.filter(
        (layer) => layer.userSwitchable
      );

      for (const layerDef of layers) {
        registerAction(
          `actions.glyph-editor-appearance.${layerDef.identifier}`,
          {
            topic,
            titleKey: layerDef.name,
          },
          () => {
            this.visualizationLayersSettings.model[layerDef.identifier] =
              !this.visualizationLayersSettings.model[layerDef.identifier];
          }
        );
      }
    }
  }

  initActionsAfterStart() {
    if (this.fontController.backendInfo.features["find-glyphs-that-use-glyph"]) {
      registerAction(
        "action.find-glyphs-that-use",
        {
          topic: "0030-action-topics.menu.edit",
          titleKey: "menubar.view.find-glyphs-that-use",
          disabled: true,
        },
        () => this.doFindGlyphsThatUseGlyph(),
        null,
        () =>
          translate(
            "menubar.view.find-glyphs-that-use",
            this.sceneSettings.selectedGlyphName
          )
      );
    }
  }

  initTopBar() {
    const myMenuBar = makeFontraMenuBar(
      ["File", "Edit", "View", "Font", "Glyph"],
      this
    );
    document.querySelector(".top-bar-container").appendChild(myMenuBar);
  }

  getEditMenuItems() {
    const menuItems = [...this.basicContextMenuItems];
    if (this.sceneSettings.selectedGlyph?.isEditing) {
      this.sceneController.updateContextMenuState(event);
      menuItems.push(MenuItemDivider);
      menuItems.push(...this.glyphEditContextMenuItems);
    }
    return menuItems;
  }

  getViewMenuItems() {
    const items = [
      { actionIdentifier: "action.zoom-in" },
      { actionIdentifier: "action.zoom-out" },
      { actionIdentifier: "action.zoom-fit-selection" },
    ];

    if (typeof this.sceneModel.selectedGlyph !== "undefined") {
      this.sceneController.updateContextMenuState();
      items.push(MenuItemDivider);
      items.push(...this.glyphSelectedContextMenuItems);
    }

    items.push(MenuItemDivider);
    items.push({
      title: translate("action-topics.glyph-editor-appearance"),
      getItems: () => {
        const layerDefs = this.visualizationLayers.definitions.filter(
          (layer) => layer.userSwitchable
        );

        return layerDefs.map((layerDef) => {
          return {
            actionIdentifier: `actions.glyph-editor-appearance.${layerDef.identifier}`,
            checked: this.visualizationLayersSettings.model[layerDef.identifier],
          };
        });
      },
    });

    return items;
  }

  getGlyphMenuItems() {
    return [
      { actionIdentifier: "action.glyph.add-source" },
      { actionIdentifier: "action.glyph.delete-source" },
      { actionIdentifier: "action.glyph.edit-glyph-axes" },
      MenuItemDivider,
      { actionIdentifier: "action.glyph.add-background-image" },
    ];
  }

  restoreOpenTabs(sidebarName) {
    // Restore the sidebar selection/visible state from localStorage.
    const panelName = localStorage.getItem(`fontra-selected-sidebar-${sidebarName}`);
    if (panelName) {
      this.toggleSidebar(panelName, false);
    }
  }

  async initPlugins() {
    const observablePlugins = new ObservableController({
      plugins: [],
    });
    observablePlugins.synchronizeWithLocalStorage("fontra.plugins");
    for (const { address } of observablePlugins.model.plugins) {
      const pluginPath = parsePluginBasePath(address);
      let meta;
      try {
        meta = await fetchJSON(`${pluginPath}/plugin.json`);
      } catch (e) {
        console.error(`${address} Plugin metadata not found.`);
        continue;
      }
      const initScript = meta.init;
      const functionName = meta.function;
      let module;
      try {
        module = await import(`${pluginPath}/${initScript}`);
      } catch (e) {
        console.error("Module didn't load");
        console.log(e);
        continue;
      }
      try {
        module[functionName](this, pluginPath);
      } catch (e) {
        console.error(`Error occured when running (${meta.name || address}) plugin.`);
        console.log(e);
        continue;
      }
    }
  }

  async updateWithDelay() {
    // The first time ever on the page (or after a deep reload), we draw before
    // all webfonts are fully loaded, and any undefined glyphs show the wrong UI
    // font. Let's just reload after a tiny delay.
    //
    // Doing the following should help, but it doesn't, unless we add the delay.
    // await document.fonts.ready;
    setTimeout(() => this.canvasController.requestUpdate(), 50);
  }

  async start() {
    await loaderSpinner(this._start());
  }

  async _start() {
    await super.start();
    const rootSubscriptionPattern = {};
    for (const rootKey of this.fontController.getRootKeys()) {
      rootSubscriptionPattern[rootKey] = null;
    }
    await this.fontController.subscribeChanges(rootSubscriptionPattern, false);

    const blankFont = new FontFace("AdobeBlank", `url("/fonts/AdobeBlank.woff2")`, {});
    document.fonts.add(blankFont);
    await blankFont.load();

    this.fontController.addChangeListener(
      { axes: null },
      async (change, isExternalChange) => {
        await this.sceneModel.updateScene();
        this.canvasController.requestUpdate();
      }
    );

    this.initActionsAfterStart();

    // Delay a tiny amount to account for a delay in the sidebars being set up,
    // which affects the available viewBox
    setTimeout(() => this.setupFromWindowLocation(), 20);
  }

  async showDialogNewGlyph() {
    const positionedGlyph =
      this.sceneController.sceneModel.getSelectedPositionedGlyph();
    this.sceneSettings.selectedGlyph = {
      ...this.sceneSettings.selectedGlyph,
      isEditing: false,
    };
    const uniString = makeUPlusStringFromCodePoint(
      positionedGlyph.character?.codePointAt(0)
    );
    const charMsg = positionedGlyph.character
      ? translate(
          "dialog.create-new-glyph.body.2",
          positionedGlyph.character,
          uniString
        )
      : "";
    const result = await dialog(
      translate("dialog.create-new-glyph.title", positionedGlyph.glyphName),
      translate("dialog.create-new-glyph.body", positionedGlyph.glyphName, charMsg),
      [
        { title: translate("dialog.cancel"), resultValue: "no", isCancelButton: true },
        { title: translate("dialog.create"), resultValue: "ok", isDefaultButton: true },
      ]
    );
    if (result === "ok") {
      const layerName = "default";
      await this.newGlyph(
        positionedGlyph.glyphName,
        positionedGlyph.character?.codePointAt(0),
        VariableGlyph.fromObject({
          name: positionedGlyph.glyphName,
          sources: [{ name: layerName, location: {}, layerName: layerName }],
          layers: { [layerName]: { glyph: positionedGlyph.glyph.instance } },
        })
      );
      this.sceneSettings.selectedGlyph = {
        ...this.sceneSettings.selectedGlyph,
        isEditing: true,
      };
      this.sceneSettings.selectedSourceIndex = 0;
    }
  }

  async showDialogGlyphEditCannotEditReadOnly(create = false) {
    const glyphName = this.sceneSettings.selectedGlyphName;
    await message(
      translate(
        create ? "dialog.cant-create-glyph.title" : "dialog.cant-edit-glyph.title",
        glyphName
      ),
      translate("dialog.cant-edit-glyph.content")
    );
  }

  async showDialogGlyphEditCannotEditLocked() {
    const glyphName = this.sceneSettings.selectedGlyphName;
    await message(
      translate("dialog.cant-edit-glyph.title", glyphName),
      translate("dialog.cant-edit-glyph.content.locked-glyph")
    );
  }

  async showDialogGlyphEditLocationNotAtSource() {
    const glyphName = this.sceneSettings.selectedGlyphName;
    const result = await dialog(
      translate("dialog.cant-edit-glyph.title", glyphName),
      translate("dialog.cant-edit-glyph.content.location-not-at-source"),
      [
        {
          title: translate("dialog.cancel"),
          resultValue: "cancel",
          isCancelButton: true,
        },
        {
          title: translate("sources.button.new-glyph-source"),
          resultValue: "createNewSource",
        },
        {
          title: translate("sources.button.go-to-nearest-source"),
          resultValue: "goToNearestSource",
          isDefaultButton: true,
        },
      ]
    );
    switch (result) {
      case "createNewSource":
        this.getSidebarPanel("designspace-navigation").addSource();
        break;
      case "goToNearestSource":
        const glyphController =
          await this.sceneModel.getSelectedVariableGlyphController();
        const nearestSourceIndex = glyphController.findNearestSourceForSourceLocation(
          {
            ...this.sceneSettings.fontLocationSourceMapped,
            ...this.sceneSettings.glyphLocation,
          },
          true
        );
        this.sceneSettings.selectedSourceIndex = nearestSourceIndex;
        break;
    }
  }

  initTools() {
    this.tools = {};
    this.topLevelTools = {};
    const editToolClasses = [
      PointerTools,
      PenTool,
      KnifeTool,
      ShapeTool,
      PowerRulerTool,
      HandTool,
    ];

    for (const editToolClass of editToolClasses) {
      this.addEditTool(new editToolClass(this));
    }

    this.setSelectedTool("pointer-tool");

    for (const zoomElement of document.querySelectorAll("#zoom-tools > .tool-button")) {
      const toolIdentifier = zoomElement.dataset.tool;
      zoomElement.dataset.tooltip = translate(toolIdentifier);
      zoomElement.onclick = () => {
        switch (toolIdentifier) {
          case "zoom-in":
            this.zoomIn();
            break;
          case "zoom-out":
            this.zoomOut();
            break;
          case "zoom-fit-selection":
            this.zoomFit();
            break;
          case "toggle-fullscreen":
            this.toggleFullscreen();
            break;
        }
        this.canvasController.canvas.focus();
      };
    }

    // init fullscreen button
    this.updateFullscreenButton();
    document.addEventListener("fullscreenchange", () => {
      this.updateFullscreenButton();
    });
  }

  addEditTool(tool) {
    this.tools[tool.identifier] = tool;
    this.topLevelTools[tool.identifier] = tool;

    let wrapperID = "edit-tools";

    const toolDefs = [];

    if (tool.subTools) {
      for (const subToolClass of tool.subTools) {
        const subTool = new subToolClass(this);
        toolDefs.push(subTool);
        this.tools[subTool.identifier] = subTool;
      }

      wrapperID = `edit-tools-multi-wrapper-${tool.identifier}`;
      const editToolsElement = document.querySelector("#edit-tools");
      editToolsElement.appendChild(
        html.div({
          "id": wrapperID,
          "data-tool": tool.identifier,
          "class": "tool-button multi-tool",
        })
      );
    } else {
      toolDefs.push(tool);
    }

    const editToolsElement = document.querySelector("#" + wrapperID);

    for (const [index, tool] of enumerate(toolDefs)) {
      const toolButton = html.div(
        {
          "class":
            wrapperID === "edit-tools" ? "tool-button selected" : "subtool-button",
          "data-tool": tool.identifier,
          "data-tooltip": translate("editor." + tool.identifier),
          "data-tooltipposition": index ? "right" : "bottom",
        },
        [
          html.createDomElement("inline-svg", {
            class: "tool-icon",
            src: tool.iconPath,
          }),
        ]
      );

      if (wrapperID === "edit-tools") {
        toolButton.onclick = () => {
          this.setSelectedTool(tool.identifier);
          this.canvasController.canvas.focus();
        };
        toolButton.oncontextmenu = (event) => event.preventDefault();
      } else {
        const globalListener = {
          handleEvent: (event) => {
            if (event.type != "keydown" || event.key == "Escape") {
              collapseSubtoolsAndCleanUp(editToolsElement);
            }
          },
        };

        const collapseSubtoolsAndCleanUp = (editToolsElement) => {
          window.removeEventListener("mousedown", globalListener);
          window.removeEventListener("keydown", globalListener);
          collapseSubTools(editToolsElement);
        };

        const showSubTools = (event, withTimeOut) => {
          clearTimeout(this._multiToolMouseDownTimer);
          this._multiToolMouseDownTimer = setTimeout(
            () => {
              // Show sub tools
              for (const child of editToolsElement.children) {
                child.style.visibility = "visible";
              }
              window.addEventListener("mousedown", globalListener);
              window.addEventListener("keydown", globalListener);
            },
            withTimeOut ? 500 : 0
          );
          if (!withTimeOut || toolButton !== editToolsElement.children[0]) {
            // ensure the multi-tool mousedown timer only affects the first child
            event.preventDefault();
            event.stopImmediatePropagation();
          }
        };

        toolButton.oncontextmenu = (event) => showSubTools(event, false);
        toolButton.onmousedown = (event) => showSubTools(event, true);

        toolButton.onmouseup = () => {
          event.stopImmediatePropagation();
          event.preventDefault();
          clearTimeout(this._multiToolMouseDownTimer);

          this.setSelectedTool(tool.identifier);
          this.canvasController.canvas.focus();

          if (toolButton === editToolsElement.children[0]) {
            // do nothing. Still the same tool
            return;
          }

          editToolsElement.prepend(toolButton);
          collapseSubtoolsAndCleanUp(editToolsElement);
        };
      }
      editToolsElement.appendChild(toolButton);
    }
  }

  initSidebars() {
    this.addSidebar(new Sidebar("left"));
    this.addSidebar(new Sidebar("right"));
    this.addSidebarPanel(new TextEntryPanel(this), "left");
    this.addSidebarPanel(new GlyphSearchPanel(this), "left");
    this.addSidebarPanel(new DesignspaceNavigationPanel(this), "left");
    this.addSidebarPanel(new ReferenceFontPanel(this), "left");
    this.addSidebarPanel(new SelectionInfoPanel(this), "right");
    this.addSidebarPanel(new TransformationPanel(this), "right");
    this.addSidebarPanel(new GlyphNotePanel(this), "right");
    this.addSidebarPanel(new RelatedGlyphsPanel(this), "right");

    // Upon reload, the "animating" class may still be set (why?), so remove it
    for (const sidebarContainer of document.querySelectorAll(".sidebar-container")) {
      sidebarContainer.classList.remove("animating");
    }

    // After the initial set up we want clicking the sidebar tabs to animate in and out
    // (Here we can afford a longer delay.)
    setTimeout(() => {
      for (const sidebarContainer of document.querySelectorAll(".sidebar-container")) {
        sidebarContainer.classList.add("animating");
      }
    }, 100);

    const resizeObserver = new ResizeObserver(([element]) => {
      const totalWidth = this.sidebars.reduce(
        (total, sidebar) => total + sidebar.getDOMWidth(),
        0
      );
      if (element.contentRect.width < totalWidth + MIN_CANVAS_SPACE) {
        for (const sidebar of this.sidebars) {
          sidebar.applyWidth(MIN_SIDEBAR_WIDTH, true);
        }
      }
    });
    resizeObserver.observe(document.documentElement);
  }

  addSidebar(sidebar) {
    const editorContainer = document.querySelector(".editor-container");
    sidebar.attach(editorContainer);
    this.sidebars.push(sidebar);
  }

  addSidebarPanel(panelElement, sidebarName) {
    const sidebar = this.sidebars.find((sidebar) => sidebar.identifier === sidebarName);

    if (!sidebar) {
      throw new Error(
        `"${sidebarName}" not a valid sidebar name. Available sidebars: ${this.sidebars
          .map((sidebar) => `"${sidebar.identifier}"`)
          .join(", ")}`
      );
    }

    if (sidebar.panelIdentifiers.includes(panelElement.name)) {
      throw new Error(
        `Panel "${panelElement.identifier}" in "${sidebarName}" sidebar exists.`
      );
    }

    sidebar.addPanel(panelElement);

    const tabElement = document.querySelector(
      `.sidebar-tab[data-sidebar-name="${panelElement.identifier}"]`
    );

    tabElement.addEventListener("click", () => {
      this.toggleSidebar(panelElement.identifier, true);
    });
  }

  getSidebarPanel(panelName) {
    return document.querySelector(`.sidebar-content[data-sidebar-name="${panelName}"]`)
      .children[0];
  }

  toggleSidebar(panelName, doFocus = false) {
    const sidebar = this.sidebars.find((sidebar) =>
      sidebar.panelIdentifiers.includes(panelName)
    );
    if (!sidebar) {
      return;
    }
    const onOff = sidebar.toggle(panelName);
    localStorage.setItem(
      `fontra-selected-sidebar-${sidebar.identifier}`,
      onOff ? panelName : ""
    );
    const panel = this.getSidebarPanel(panelName);
    if (typeof panel.toggle === "function") {
      panel.toggle(onOff, doFocus);
    }
    return onOff;
  }

  initMiniConsole() {
    this.miniConsole = document.querySelector("#mini-console");
    this._console_log = console.log.bind(console);
    const clearMiniConsole = scheduleCalls(() => {
      this.miniConsole.innerText = "";
      this.miniConsole.style.display = "none";
    }, 5000);
    console.log = (...args) => {
      this._console_log(...args);
      this.miniConsole.innerText = args
        .map((item) => {
          try {
            return typeof item == "string" ? item : JSON.stringify(item);
          } catch (error) {
            return item;
          }
        })
        .join(" ");
      this.miniConsole.style.display = "inherit";
      clearMiniConsole();
    };
  }

  setSelectedTool(toolIdentifier, isSubtool = false) {
    let selectedToolIdentifier = toolIdentifier;

    for (const editToolItem of document.querySelectorAll(
      "#edit-tools > .tool-button"
    )) {
      let shouldSelect = editToolItem.dataset.tool === toolIdentifier;

      if (editToolItem.classList.contains("multi-tool")) {
        if (shouldSelect) {
          selectedToolIdentifier = editToolItem.children[0].dataset.tool;
        } else {
          for (const childToolElement of editToolItem.children) {
            if (childToolElement.dataset.tool === toolIdentifier) {
              shouldSelect = true;
              if (isSubtool) {
                editToolItem.prepend(childToolElement);
                collapseSubTools(editToolItem);
              }
            }
          }
        }
      }
      editToolItem.classList.toggle("selected", shouldSelect);
    }
    this.sceneController.setSelectedTool(this.tools[selectedToolIdentifier]);
    this.selectedToolIdentifier = selectedToolIdentifier;
  }

  themeChanged() {
    this.visualizationLayers.darkTheme = this.isThemeDark;
    this.cleanGlyphsLayers.darkTheme = this.isThemeDark;
    this.canvasController.requestUpdate();
  }

  get isThemeDark() {
    const themeValue = themeController.model.theme;
    if (themeValue === "automatic") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    } else {
      return themeValue === "dark";
    }
  }

  canvasMagnificationChanged(magnification) {
    this.visualizationLayers.scaleFactor = 1 / magnification;
    this.cleanGlyphsLayers.scaleFactor = 1 / magnification;
  }

  async doubleClickedComponentsCallback(event) {
    const glyphController = await this.sceneModel.getSelectedStaticGlyphController();
    const instance = glyphController.instance;

    const compoStrings = this.sceneController.doubleClickedComponentIndices.map(
      (componentIndex) =>
        `${instance.components[componentIndex].name} (#${componentIndex})`
    );
    const result = await dialog(
      `Would you like to add the selected component${
        compoStrings.length != 1 ? "s" : ""
      } to the text string?`,
      compoStrings.join("\n"),
      [
        { title: "Cancel", isCancelButton: true },
        { title: "Add", isDefaultButton: true },
      ]
    );
    if (!result) {
      // User cancelled
      return;
    }

    const glyphLocations = {};
    const glyphInfos = [];

    for (const componentIndex of this.sceneController.doubleClickedComponentIndices) {
      const glyphName = instance.components[componentIndex].name;
      const location = instance.components[componentIndex].location;
      if (location) {
        glyphLocations[glyphName] = location;
      }
      glyphInfos.push(this.fontController.glyphInfoFromGlyphName(glyphName));
    }
    this.sceneController.updateGlyphLocations(glyphLocations);
    this.insertGlyphInfos(glyphInfos, 1, true);
  }

  insertGlyphInfos(glyphInfos, where = 0, select = false) {
    // where == 0: replace selected glyph
    // where == 1: insert after selected glyph
    // where == -1: insert before selected glyph
    const selectedGlyphInfo = this.sceneSettings.selectedGlyph;
    const glyphLines = [...this.sceneSettings.glyphLines];

    const insertIndex = selectedGlyphInfo.glyphIndex + (where == 1 ? 1 : 0);
    glyphLines[selectedGlyphInfo.lineIndex].splice(
      insertIndex,
      where ? 0 : 1,
      ...glyphInfos
    );
    this.sceneSettings.glyphLines = glyphLines;

    const glyphIndex =
      selectedGlyphInfo.glyphIndex +
      (select ? (where == 1 ? 1 : 0) : where == -1 ? glyphInfos.length : 0);

    const glyphExists = !!this.fontController.glyphMap[glyphInfos[0]?.glyphName];

    this.sceneSettings.selectedGlyph = {
      lineIndex: selectedGlyphInfo.lineIndex,
      glyphIndex: glyphIndex,
      isEditing:
        glyphExists &&
        (where && select ? false : this.sceneSettings.selectedGlyph.isEditing),
    };
  }

  async doubleClickedAnchorsCallback(event) {
    const glyphController = await this.sceneModel.getSelectedStaticGlyphController();
    if (!glyphController.canEdit) {
      this.sceneController._dispatchEvent("glyphEditLocationNotAtSource");
      return;
    }

    const instance = glyphController.instance;

    const anchorIndex = this.sceneController.doubleClickedAnchorIndices[0];
    let anchor = instance.anchors[anchorIndex];
    const { anchor: newAnchor } = await this.doAddEditAnchorDialog(anchor);
    if (!newAnchor) {
      return;
    }

    await this.sceneController.editLayersAndRecordChanges((layerGlyphs) => {
      for (const layerGlyph of Object.values(layerGlyphs)) {
        const oldAnchor = layerGlyph.anchors[anchorIndex];
        layerGlyph.anchors[anchorIndex] = {
          name: newAnchor.name ? newAnchor.name : oldAnchor.name,
          x: !isNaN(newAnchor.x) ? newAnchor.x : oldAnchor.x,
          y: !isNaN(newAnchor.y) ? newAnchor.y : oldAnchor.y,
        };
      }
      this.sceneController.selection = new Set([`anchor/${anchorIndex}`]);
      return translate("action.edit-anchor");
    });
  }

  async doubleClickedGuidelinesCallback(event) {
    const glyphController = await this.sceneModel.getSelectedStaticGlyphController();
    if (!glyphController.canEdit) {
      this.sceneController._dispatchEvent("glyphEditLocationNotAtSource");
      return;
    }

    const instance = glyphController.instance;

    const guidelineIndex = this.sceneController.doubleClickedGuidelineIndices[0];
    let guideline = instance.guidelines[guidelineIndex];
    const { guideline: newGuideline } = await this.doAddEditGuidelineDialog(guideline);
    if (!newGuideline) {
      return;
    }
    await this.sceneController.editLayersAndRecordChanges((layerGlyphs) => {
      for (const layerGlyph of Object.values(layerGlyphs)) {
        const oldGuideline = layerGlyph.guidelines[guidelineIndex];
        layerGlyph.guidelines[guidelineIndex] = {
          name: newGuideline.name,
          x: !isNaN(newGuideline.x) ? newGuideline.x : oldGuideline.x,
          y: !isNaN(newGuideline.y) ? newGuideline.y : oldGuideline.y,
          angle: !isNaN(newGuideline.angle) ? newGuideline.angle : oldGuideline.angle,
          locked: [true, false].includes(newGuideline.locked)
            ? newGuideline.locked
            : oldGuideline.locked,
        };
      }
      this.sceneController.selection = new Set([`guideline/${guidelineIndex}`]);
      return translate("action.edit-guideline");
    });
  }

  initContextMenuItems() {
    this.basicContextMenuItems = [];
    this.basicContextMenuItems.push({ actionIdentifier: "action.undo" });
    this.basicContextMenuItems.push({ actionIdentifier: "action.redo" });

    this.basicContextMenuItems.push(MenuItemDivider);

    if (!insecureSafariConnection()) {
      // In Safari, the async clipboard API only works in a secure context
      // (HTTPS). We apply a workaround using the clipboard event API, but
      // only in Safari, and when in an HTTP context.
      // So, since the "actions" versions of cut/copy/paste won't work, we
      // do not add their menu items.
      this.basicContextMenuItems.push(
        { actionIdentifier: "action.cut" },
        { actionIdentifier: "action.copy" },
        { actionIdentifier: "action.paste" }
      );
    }

    this.basicContextMenuItems.push({ actionIdentifier: "action.delete" });

    this.basicContextMenuItems.push(MenuItemDivider);

    this.basicContextMenuItems.push({
      actionIdentifier: "action.select-all",
    });

    this.basicContextMenuItems.push({
      actionIdentifier: "action.select-none",
    });

    this.glyphEditContextMenuItems = [];

    this.glyphEditContextMenuItems.push({ actionIdentifier: "action.add-component" });
    this.glyphEditContextMenuItems.push({ actionIdentifier: "action.add-anchor" });
    this.glyphEditContextMenuItems.push({ actionIdentifier: "action.add-guideline" });

    this.glyphEditContextMenuItems.push({ actionIdentifier: "action.lock-guideline" });

    this.glyphEditContextMenuItems.push(...this.sceneController.getContextMenuItems());

    this.glyphSelectedContextMenuItems = [];

    this.glyphSelectedContextMenuItems.push({
      title: translate("menubar.view.select-glyph-source-layer"),
      getItems: () => [
        { actionIdentifier: "action.select-previous-glyph" },
        { actionIdentifier: "action.select-next-glyph" },
        { actionIdentifier: "action.select-previous-source" },
        { actionIdentifier: "action.select-next-source" },
        { actionIdentifier: "action.select-previous-source-layer" },
        { actionIdentifier: "action.select-next-source-layer" },
      ],
    });

    this.glyphSelectedContextMenuItems.push({
      actionIdentifier: "action.find-glyphs-that-use",
    });
    this.glyphSelectedContextMenuItems.push(MenuItemDivider);
    this.glyphSelectedContextMenuItems.push({
      actionIdentifier: "action.replace-selected-glyph-on-canvas",
    });
    this.glyphSelectedContextMenuItems.push({
      actionIdentifier: "action.remove-selected-glyph-from-canvas",
    });
    this.glyphSelectedContextMenuItems.push({
      actionIdentifier: "action.add-glyph-before-selected-glyph",
    });
    this.glyphSelectedContextMenuItems.push({
      actionIdentifier: "action.add-glyph-after-selected-glyph",
    });
  }

  initFallbackClipboardEventListeners() {
    window.addEventListener("paste", async (event) => {
      if (document.activeElement === this.canvasController.canvas) {
        event.preventDefault();
        this.doPaste();
      }
    });

    window.addEventListener("copy", async (event) => {
      if (document.activeElement === this.canvasController.canvas) {
        event.preventDefault();
        await this.doCopy(event);
      }
    });

    window.addEventListener("cut", async (event) => {
      if (document.activeElement === this.canvasController.canvas) {
        event.preventDefault();
        await this.doCut(event);
      }
    });
  }

  async keyDownHandler(event) {
    const actionIdentifier = getActionIdentifierFromKeyEvent(event);
    if (actionIdentifier) {
      this.sceneController.updateContextMenuState(null);
      event.preventDefault();
      event.stopImmediatePropagation();
      doPerformAction(actionIdentifier, event);
    }
  }

  getUndoRedoLabel(isRedo) {
    const info = this.sceneController.getUndoRedoInfo(isRedo);
    return (
      (isRedo ? translate("action.redo") : translate("action.undo")) +
      (info ? " " + info.label : "")
    );
  }

  canUndoRedo(isRedo) {
    return !!this.sceneController.getUndoRedoInfo(isRedo);
  }

  async doUndoRedo(isRedo) {
    await this.sceneController.doUndoRedo(isRedo);
  }

  canCut() {
    if (this.fontController.readOnly || this.sceneModel.isSelectedGlyphLocked()) {
      return false;
    }
    return (
      (this.sceneSettings.selectedGlyph &&
        !this.sceneSettings.selectedGlyph.isEditing) ||
      this.sceneController.selection.size
    );
  }

  async doCut(event = null) {
    if (
      this.sceneSettings.selectedGlyph.isEditing &&
      !this.sceneController.selection.size
    ) {
      return;
    }
    if (!this.sceneSettings.selectedGlyph.isEditing) {
      await this.doCopy(event);
      this.fontController.deleteGlyph(
        this.sceneSettings.selectedGlyphName,
        `cut glyph "${this.sceneSettings.selectedGlyphName}"`
      );
      return;
    }
    if (event) {
      // We *have* to do this first, as it won't work after any
      // await (Safari insists on that). So we have to do a bit
      // of redundant work by calling _prepareCopyOrCut twice.
      const { layerGlyphs, flattenedPath, backgroundImageData } =
        this._prepareCopyOrCutLayers(undefined, false);
      await this._writeLayersToClipboard(
        null,
        layerGlyphs,
        flattenedPath,
        backgroundImageData,
        event
      );
    }
    let copyResult;
    await this.sceneController.editGlyphAndRecordChanges(
      (glyph) => {
        copyResult = this._prepareCopyOrCutLayers(glyph, true);
        this.sceneController.selection = new Set();
        return "Cut Selection"; // TODO: translation translate("action.edit-guideline");
      },
      undefined,
      true
    );
    if (copyResult && !event) {
      const { layerGlyphs, flattenedPath, backgroundImageData } = copyResult;
      await this._writeLayersToClipboard(
        null,
        layerGlyphs,
        flattenedPath,
        backgroundImageData
      );
    }
  }

  canCopy() {
    return this.sceneSettings.selectedGlyph;
  }

  async doCopy(event) {
    if (!this.canCopy()) {
      return;
    }

    if (this.sceneSettings.selectedGlyph.isEditing) {
      const { layerGlyphs, flattenedPath, backgroundImageData } =
        this._prepareCopyOrCutLayers(undefined, false);
      await this._writeLayersToClipboard(
        null,
        layerGlyphs,
        flattenedPath,
        backgroundImageData,
        event
      );
    } else {
      const positionedGlyph = this.sceneModel.getSelectedPositionedGlyph();
      const varGlyph = positionedGlyph.varGlyph.glyph;
      const backgroundImageData = await this._collectBackgroundImageData(varGlyph);
      const glyphController = positionedGlyph.glyph;
      await this._writeLayersToClipboard(
        varGlyph,
        [{ glyph: glyphController.instance }],
        glyphController.flattenedPath,
        backgroundImageData,
        event
      );
    }
  }

  async _collectBackgroundImageData(varGlyph) {
    const backgroundImageData = {};
    for (const layer of Object.values(varGlyph.layers)) {
      if (layer.glyph.backgroundImage) {
        const imageIdentifier = layer.glyph.backgroundImage.identifier;
        const bgImage = await this.fontController.getBackgroundImage(imageIdentifier);
        if (bgImage) {
          backgroundImageData[imageIdentifier] = bgImage.src;
        }
      }
    }
    return backgroundImageData;
  }

  async _writeLayersToClipboard(
    varGlyph,
    layerGlyphs,
    flattenedPath,
    backgroundImageData,
    event
  ) {
    if (!layerGlyphs?.length) {
      // nothing to do
      return;
    }

    let bounds = flattenedPath?.getControlBounds();
    if (!bounds) {
      bounds = { xMin: 0, yMin: 0, xMax: 0, yMax: 0 };
    }

    const svgString = pathToSVG(flattenedPath, bounds);
    const glyphName = this.sceneSettings.selectedGlyphName;
    const codePoints = this.fontController.glyphMap[glyphName] || [];
    const glifString = staticGlyphToGLIF(glyphName, layerGlyphs[0].glyph, codePoints);
    const jsonObject = varGlyph ? { variableGlyph: varGlyph } : { layerGlyphs };
    if (backgroundImageData && !isObjectEmpty(backgroundImageData)) {
      jsonObject.backgroundImageData = backgroundImageData;
    }
    const jsonString = JSON.stringify(jsonObject);

    const mapping = { "svg": svgString, "glif": glifString, "fontra-json": jsonString };
    const plainTextString =
      mapping[applicationSettingsController.model.clipboardFormat] || glifString;

    localStorage.setItem("clipboardSelection.text-plain", plainTextString);
    localStorage.setItem("clipboardSelection.glyph", jsonString);

    if (event) {
      // This *has* to be called before anything is awaited, or
      // Safari won't recognize it as part of the same event handler
      event.clipboardData.setData("text/plain", plainTextString);
    } else {
      const clipboardObject = {
        "text/plain": plainTextString,
        "text/html": svgString,
        "web image/svg+xml": svgString,
        "web fontra/static-glyph": jsonString,
      };

      await this._addBackgroundImageToClipboard(clipboardObject, backgroundImageData);

      await writeToClipboard(clipboardObject);
    }
  }

  async _addBackgroundImageToClipboard(clipboardObject, backgroundImageData) {
    if (
      this.sceneController.selection.size == 1 &&
      this.sceneController.selection.has("backgroundImage/0") &&
      backgroundImageData &&
      Object.keys(backgroundImageData).length == 1
    ) {
      const res = await fetch(Object.values(backgroundImageData)[0]);
      const blob = await res.blob();
      clipboardObject[blob.type] = blob;
    }
  }

  _prepareCopyOrCutLayers(varGlyph, doCut) {
    let varGlyphController;
    if (!varGlyph) {
      varGlyphController = this.sceneModel.getSelectedPositionedGlyph().varGlyph;
      varGlyph = varGlyphController.glyph;
    } else {
      varGlyphController = this.fontController.makeVariableGlyphController(varGlyph);
    }
    if (!varGlyph) {
      return;
    }

    const layerLocations = {};
    for (const source of varGlyph.sources) {
      if (!(source.layerName in layerLocations)) {
        layerLocations[source.layerName] = makeSparseLocation(
          source.location,
          varGlyphController.combinedAxes
        );
      }
    }

    const layerGlyphs = [];
    let flattenedPath;
    const backgroundImageData = {};

    for (const [layerName, layerGlyph] of Object.entries(
      this.sceneController.getEditingLayerFromGlyphLayers(varGlyph.layers)
    )) {
      const copyResult = this._prepareCopyOrCut(layerGlyph, doCut, !flattenedPath);
      if (!copyResult.instance) {
        return;
      }
      if (!flattenedPath) {
        flattenedPath = copyResult.flattenedPath;
      }
      layerGlyphs.push({
        layerName,
        location: layerLocations[layerName],
        glyph: copyResult.instance,
      });
      if (copyResult.instance.backgroundImage) {
        const imageIdentifier = copyResult.instance.backgroundImage.identifier;
        const bgImage = this.fontController.getBackgroundImageCached(imageIdentifier);
        if (bgImage) {
          backgroundImageData[imageIdentifier] = bgImage.src;
        }
      }
    }
    if (!layerGlyphs.length && !doCut) {
      const { instance, flattenedPath: instancePath } = this._prepareCopyOrCut(
        undefined,
        false,
        true
      );
      flattenedPath = instancePath;
      if (!instance) {
        return;
      }
      layerGlyphs.push({ glyph: instance });
    }
    return { layerGlyphs, flattenedPath, backgroundImageData };
  }

  _prepareCopyOrCut(editInstance, doCut = false, wantFlattenedPath = false) {
    const positionedGlyph = this.sceneModel.getSelectedPositionedGlyph();
    const glyphController = positionedGlyph?.glyph;
    if (!glyphController) {
      return {};
    }

    if (!editInstance) {
      editInstance = glyphController.instance;
    }

    if (!this.sceneController.selection.size) {
      // No selection, fall back to "all", unless doCut is true
      return doCut
        ? {}
        : {
            instance: editInstance,
            flattenedPath: wantFlattenedPath
              ? glyphController.flattenedPath
              : undefined,
          };
    }

    const {
      point: pointIndices,
      component: componentIndices,
      anchor: anchorIndices,
      guideline: guidelineIndices,
      backgroundImage: backgroundImageIndices,
    } = parseSelection(this.sceneController.selection);
    let path;
    let components;
    let anchors;
    let guidelines;
    let backgroundImage;
    const flattenedPathList = wantFlattenedPath ? [] : undefined;
    if (pointIndices) {
      path = filterPathByPointIndices(editInstance.path, pointIndices, doCut);
      flattenedPathList?.push(path);
    }
    if (componentIndices) {
      flattenedPathList?.push(
        ...componentIndices.map((i) => glyphController.components[i].path)
      );
      components = componentIndices.map((i) => editInstance.components[i]);
      if (doCut) {
        for (const componentIndex of reversed(componentIndices)) {
          editInstance.components.splice(componentIndex, 1);
        }
      }
    }
    if (anchorIndices) {
      anchors = anchorIndices.map((i) => editInstance.anchors[i]);
      if (doCut) {
        for (const anchorIndex of reversed(anchorIndices)) {
          editInstance.anchors.splice(anchorIndex, 1);
        }
      }
    }
    if (guidelineIndices) {
      guidelines = guidelineIndices.map((i) => editInstance.guidelines[i]);
      if (doCut) {
        for (const guidelineIndex of reversed(guidelineIndices)) {
          editInstance.guidelines.splice(guidelineIndex, 1);
        }
      }
    }
    if (backgroundImageIndices) {
      backgroundImage = editInstance.backgroundImage;
      if (doCut) {
        // TODO: don't delete if bg images are locked
        // (even though we shouldn't be able to select them)
        editInstance.backgroundImage = undefined;
      }
    }
    const instance = StaticGlyph.fromObject({
      ...editInstance,
      path,
      components,
      anchors,
      guidelines,
      backgroundImage,
    });
    return {
      instance: instance,
      flattenedPath: wantFlattenedPath ? joinPaths(flattenedPathList) : undefined,
    };
  }

  canPaste() {
    if (this.fontController.readOnly || this.sceneModel.isSelectedGlyphLocked()) {
      return false;
    }
    return true;
  }

  async doPaste() {
    let { pasteVarGlyph, pasteLayerGlyphs, backgroundImageData } =
      await this._unpackClipboard();
    if (!pasteVarGlyph && !pasteLayerGlyphs?.length) {
      await this._pasteClipboardImage();
      return;
    }

    const backgroundImageIdentifierMapping =
      this._makeBackgroundImageIdentifierMapping(backgroundImageData);

    if (backgroundImageData && !isObjectEmpty(backgroundImageData)) {
      // Ensure background images are visible and not locked
      this.visualizationLayersSettings.model["fontra.background-image"] = true;
      this.sceneSettings.backgroundImagesAreLocked = false;
    }

    if (pasteVarGlyph && this.sceneSettings.selectedGlyph.isEditing) {
      const result = await runDialogWholeGlyphPaste();
      if (!result) {
        return;
      }
      if (result === PASTE_BEHAVIOR_ADD) {
        // We will paste an entire variable glyph onto the existing layers.
        // Build pasteLayerGlyphs from the glyph's sources.
        const varGlyphController =
          this.fontController.makeVariableGlyphController(pasteVarGlyph);
        const combinedAxes = varGlyphController.combinedAxes;
        pasteLayerGlyphs = pasteVarGlyph.sources.map((source) => {
          return {
            layerName: source.layerName,
            location: makeSparseLocation(source.location, combinedAxes),
            glyph: pasteVarGlyph.layers[source.layerName].glyph,
          };
        });
        // Sort so the default source comes first, as it is used as a fallback
        pasteLayerGlyphs.sort((a, b) =>
          !isObjectEmpty(a.location) && isObjectEmpty(b.location) ? 1 : -1
        );
        pasteVarGlyph = null;
      }
    } else if (!pasteVarGlyph && !this.sceneSettings.selectedGlyph.isEditing) {
      // We're pasting layers onto a glyph in select mode. Build a VariableGlyph
      // from the layers as good as we can.
      const layers = {};
      const sources = [];
      if (pasteLayerGlyphs.length === 1) {
        const layerName = "default";
        layers[layerName] = { glyph: pasteLayerGlyphs[0].glyph };
        sources.push({ name: layerName, layerName });
      } else {
        for (const { layerName, location, glyph } of pasteLayerGlyphs) {
          if (layerName) {
            layers[layerName] = { glyph };
            sources.push({ name: layerName, layerName, location: location || {} });
          }
        }
      }
      pasteVarGlyph = VariableGlyph.fromObject({ layers, sources });
      pasteLayerGlyphs = null;
    }

    if (pasteVarGlyph) {
      this._remapBackgroundImageIdentifiers(
        Object.values(pasteVarGlyph.layers).map((layerGlyph) => layerGlyph.glyph),
        backgroundImageIdentifierMapping
      );
      const positionedGlyph = this.sceneModel.getSelectedPositionedGlyph();
      if (positionedGlyph.isUndefined) {
        await this.newGlyph(
          positionedGlyph.glyphName,
          positionedGlyph.character?.codePointAt(0),
          pasteVarGlyph,
          `paste new glyph "${positionedGlyph.glyphName}"`
        );
      } else {
        await this._pasteReplaceGlyph(pasteVarGlyph);
      }
      // Force sync between location and selectedSourceIndex, as the glyph's
      // source list may have changed
      this.sceneSettings.fontLocationSourceMapped = {
        ...this.sceneSettings.fontLocationSourceMapped,
      };
      this.sceneSettings.glyphLocation = { ...this.sceneSettings.glyphLocation };
    } else {
      this._remapBackgroundImageIdentifiers(
        pasteLayerGlyphs.map((layerGlyph) => layerGlyph.glyph),
        backgroundImageIdentifierMapping
      );
      await this._pasteLayerGlyphs(pasteLayerGlyphs);
    }

    if (this.fontController.backendInfo.features["background-image"]) {
      await this._writeBackgroundImageData(
        backgroundImageData,
        backgroundImageIdentifierMapping
      );
    }
  }

  _makeBackgroundImageIdentifierMapping(backgroundImageData) {
    if (!backgroundImageData || isObjectEmpty(backgroundImageData)) {
      return {};
    }
    const mapping = {};
    for (const originalImageIdentifier of Object.keys(backgroundImageData)) {
      const newImageIdentifier = crypto.randomUUID();
      mapping[originalImageIdentifier] = newImageIdentifier;
    }
    return mapping;
  }

  _remapBackgroundImageIdentifiers(glyphs, identifierMapping) {
    for (const glyph of glyphs) {
      if (glyph.backgroundImage) {
        glyph.backgroundImage.identifier =
          identifierMapping[glyph.backgroundImage.identifier] ||
          glyph.backgroundImage.identifier;
      }
    }
  }

  async _writeBackgroundImageData(backgroundImageData, identifierMapping) {
    if (!backgroundImageData) {
      return;
    }
    for (const [imageIdentifier, imageData] of Object.entries(backgroundImageData)) {
      const mappedIdentifier = identifierMapping[imageIdentifier] || imageIdentifier;
      await this.fontController.putBackgroundImageData(mappedIdentifier, imageData);
    }
    // Writing the background image data does not cause a refresh
    this.canvasController.requestUpdate();
  }

  async _unpackClipboard() {
    const plainText = await readFromClipboard("text/plain");
    if (!plainText) {
      return {};
    }

    let customJSON;
    try {
      customJSON = await readFromClipboard("web fontra/static-glyph");
    } catch (error) {
      // fall through, try localStorage clipboard
    }

    if (
      !customJSON &&
      plainText === localStorage.getItem("clipboardSelection.text-plain")
    ) {
      customJSON = localStorage.getItem("clipboardSelection.glyph");
    }
    if (!customJSON && plainText[0] == "{") {
      customJSON = plainText;
    }

    let pasteLayerGlyphs;
    let pasteVarGlyph;
    let backgroundImageData;

    if (customJSON) {
      try {
        const clipboardObject = JSON.parse(customJSON);
        pasteLayerGlyphs = clipboardObject.layerGlyphs?.map((layer) => {
          return {
            layerName: layer.layerName,
            location: layer.location,
            glyph: StaticGlyph.fromObject(layer.glyph),
          };
        });
        if (clipboardObject.variableGlyph) {
          pasteVarGlyph = VariableGlyph.fromObject(clipboardObject.variableGlyph);
        }
        backgroundImageData = clipboardObject.backgroundImageData;
      } catch (error) {
        console.log("couldn't paste from JSON:", error.toString());
      }
    } else {
      const glyph = await Backend.parseClipboard(plainText);
      if (glyph) {
        pasteLayerGlyphs = [{ glyph }];
      }
    }
    return { pasteVarGlyph, pasteLayerGlyphs, backgroundImageData };
  }

  async _pasteClipboardImage() {
    if (!this.canPlaceBackgroundImage()) {
      return;
    }

    const imageBlob =
      (await readFromClipboard("image/png", false)) ||
      (await readFromClipboard("image/jpeg", false));

    if (!imageBlob) {
      return;
    }

    await this._placeBackgroundImage(await readFileOrBlobAsDataURL(imageBlob));
  }

  async _placeBackgroundImage(dataURL) {
    // Ensure background images are visible and not locked
    this.visualizationLayersSettings.model["fontra.background-image"] = true;
    this.sceneSettings.backgroundImagesAreLocked = false;

    const imageIdentifiers = [];

    await this.sceneController.editLayersAndRecordChanges((layerGlyphs) => {
      for (const layerGlyph of Object.values(layerGlyphs)) {
        const imageIdentifier = crypto.randomUUID();
        layerGlyph.backgroundImage = {
          identifier: imageIdentifier,
          transformation: getDecomposedIdentity(),
          opacity: 1.0,
        };
        imageIdentifiers.push(imageIdentifier);
      }
      this.sceneController.selection = new Set(["backgroundImage/0"]);
      return "place background image"; // TODO: translate
    });

    for (const imageIdentifier of imageIdentifiers) {
      await this.fontController.putBackgroundImageData(imageIdentifier, dataURL);
    }
    // Writing the background image data does not cause a refresh
    this.canvasController.requestUpdate();
  }

  async addBackgroundImageFromFileSystem() {
    const file = await pickFile([".png", ".jpeg", ".jpg"]);
    if (!file) {
      // User cancelled
      return;
    }

    await this._placeBackgroundImage(await readFileOrBlobAsDataURL(file));
  }

  async _pasteReplaceGlyph(varGlyph) {
    await this.sceneController.editGlyphAndRecordChanges(
      (glyph) => {
        for (const [property, value] of Object.entries(varGlyph)) {
          if (property !== "name") {
            glyph[property] = value;
          }
        }
        return "Paste";
      },
      undefined,
      false
    );
  }

  async _pasteLayerGlyphs(pasteLayerGlyphs) {
    const defaultPasteGlyph = pasteLayerGlyphs[0].glyph;
    const pasteLayerGlyphsByLayerName = Object.fromEntries(
      pasteLayerGlyphs.map((layer) => [layer.layerName, layer.glyph])
    );

    const pasteLayerGlyphsByLocationString = Object.fromEntries(
      pasteLayerGlyphs
        .filter((layer) => layer.location)
        .map((layer) => [locationToString(layer.location), layer.glyph])
    );

    const varGlyphController =
      await this.sceneModel.getSelectedVariableGlyphController();
    const locationStringsBySourceLayerName = Object.fromEntries(
      varGlyphController.sources.map((source) => [
        source.layerName,
        locationToString(
          makeSparseLocation(source.location, varGlyphController.combinedAxes)
        ),
      ])
    );

    await this.sceneController.editGlyphAndRecordChanges(
      (glyph) => {
        const editLayerGlyphs = this.sceneController.getEditingLayerFromGlyphLayers(
          glyph.layers
        );
        const firstLayerGlyph = Object.values(editLayerGlyphs)[0];

        const selection = new Set();
        for (const pointIndex of range(defaultPasteGlyph.path.numPoints)) {
          const pointType =
            defaultPasteGlyph.path.pointTypes[pointIndex] &
            VarPackedPath.POINT_TYPE_MASK;
          if (pointType === VarPackedPath.ON_CURVE) {
            selection.add(`point/${pointIndex + firstLayerGlyph.path.numPoints}`);
          }
        }
        for (const componentIndex of range(
          firstLayerGlyph.components.length,
          firstLayerGlyph.components.length + defaultPasteGlyph.components.length
        )) {
          selection.add(`component/${componentIndex}`);
        }

        for (const anchorIndex of range(
          firstLayerGlyph.anchors.length,
          firstLayerGlyph.anchors.length + defaultPasteGlyph.anchors.length
        )) {
          selection.add(`anchor/${anchorIndex}`);
        }

        for (const guidelineIndex of range(
          firstLayerGlyph.guidelines.length,
          firstLayerGlyph.guidelines.length + defaultPasteGlyph.guidelines.length
        )) {
          selection.add(`guideline/${guidelineIndex}`);
        }

        for (const [layerName, layerGlyph] of Object.entries(editLayerGlyphs)) {
          const pasteGlyph =
            pasteLayerGlyphsByLayerName[layerName] ||
            pasteLayerGlyphsByLocationString[
              locationStringsBySourceLayerName[layerName]
            ] ||
            defaultPasteGlyph;
          layerGlyph.path.appendPath(pasteGlyph.path);
          layerGlyph.components.push(...pasteGlyph.components.map(copyComponent));
          layerGlyph.anchors.push(...pasteGlyph.anchors);
          layerGlyph.guidelines.push(...pasteGlyph.guidelines);
          if (pasteGlyph.backgroundImage) {
            layerGlyph.backgroundImage = pasteGlyph.backgroundImage;
            if (!this.sceneSettings.backgroundImagesAreLocked) {
              selection.add("backgroundImage/0");
            }
          }
        }
        this.sceneController.selection = selection;
        return "Paste";
      },
      undefined,
      true
    );
  }

  canDelete() {
    if (this.fontController.readOnly || this.sceneModel.isSelectedGlyphLocked()) {
      return false;
    }
    return (
      (this.sceneSettings.selectedGlyph &&
        !this.sceneSettings.selectedGlyph.isEditing) ||
      (this.sceneSettings.selectedGlyph?.isEditing &&
        this.sceneController.selection.size > 0)
    );
  }

  async doDelete(event) {
    if (
      this.sceneSettings.selectedGlyph &&
      !this.sceneSettings.selectedGlyph.isEditing
    ) {
      await this._deleteCurrentGlyph(event);
    } else {
      await this._deleteSelection(event);
    }
  }

  async _deleteCurrentGlyph(event) {
    const glyphName = this.sceneSettings.selectedGlyphName;
    const result = await dialog(
      translate("dialog.delete-current-glyph.title", glyphName),
      "",
      [
        { title: translate("dialog.cancel"), isCancelButton: true },
        {
          title: translate("action.delete-glyph"),
          isDefaultButton: true,
          resultValue: "ok",
        },
      ]
    );
    if (!result) {
      return;
    }
    this.fontController.deleteGlyph(glyphName);
  }

  async _deleteSelection(event) {
    const {
      point: pointSelection,
      component: componentSelection,
      anchor: anchorSelection,
      guideline: guidelineSelection,
      backgroundImage: backgroundImageSelection,
      //fontGuideline: fontGuidelineSelection,
    } = parseSelection(this.sceneController.selection);
    // TODO: Font Guidelines
    // if (fontGuidelineSelection) {
    //   for (const guidelineIndex of reversed(fontGuidelineSelection)) {
    //     XXX
    //   }
    // }
    await this.sceneController.editLayersAndRecordChanges((layerGlyphs) => {
      for (const layerGlyph of Object.values(layerGlyphs)) {
        if (event.altKey) {
          // Behave like "cut", but don't put anything on the clipboard
          this._prepareCopyOrCut(layerGlyph, true, false);
        } else {
          if (pointSelection) {
            deleteSelectedPoints(layerGlyph.path, pointSelection);
          }
          if (componentSelection) {
            for (const componentIndex of reversed(componentSelection)) {
              layerGlyph.components.splice(componentIndex, 1);
            }
          }
          if (anchorSelection) {
            for (const anchorIndex of reversed(anchorSelection)) {
              layerGlyph.anchors.splice(anchorIndex, 1);
            }
          }
          if (guidelineSelection) {
            for (const guidelineIndex of reversed(guidelineSelection)) {
              const guideline = layerGlyph.guidelines[guidelineIndex];
              if (guideline.locked) {
                // don't delete locked guidelines
                continue;
              }
              layerGlyph.guidelines.splice(guidelineIndex, 1);
            }
          }
          if (backgroundImageSelection) {
            // TODO: don't delete if bg images are locked
            // (even though we shouldn't be able to select them)
            layerGlyph.backgroundImage = undefined;
          }
        }
      }
      this.sceneController.selection = new Set();
      return translate("action.delete-selection");
    });
  }

  async doAddComponent() {
    const glyphName = await this.runGlyphSearchDialog(
      translate("action.add-component"),
      translate("dialog.add")
    );
    if (!glyphName) {
      return;
    }

    const baseGlyph = await this.fontController.getGlyph(glyphName);
    const location = Object.fromEntries(
      baseGlyph.glyph.axes.map((axis) => [axis.name, axis.defaultValue])
    );
    const newComponent = {
      name: glyphName,
      transformation: getDecomposedIdentity(),
      location: location,
    };
    await this.sceneController.editLayersAndRecordChanges((layerGlyphs) => {
      for (const layerGlyph of Object.values(layerGlyphs)) {
        layerGlyph.components.push({
          name: newComponent.name,
          transformation: { ...newComponent.transformation },
          location: { ...newComponent.location },
        });
      }
      const instance = this.sceneModel.getSelectedPositionedGlyph().glyph.instance;
      const newComponentIndex = instance.components.length - 1;
      this.sceneController.selection = new Set([`component/${newComponentIndex}`]);
      return translate("action.add-component");
    });
  }

  async doAddAnchor() {
    const point = this.sceneController.selectedGlyphPoint(this.contextMenuPosition);
    const { anchor: tempAnchor } = await this.doAddEditAnchorDialog(undefined, point);
    if (!tempAnchor) {
      return;
    }

    const newAnchor = {
      name: tempAnchor.name ? tempAnchor.name : "anchorName",
      x: !isNaN(tempAnchor.x) ? tempAnchor.x : Math.round(point.x),
      y: !isNaN(tempAnchor.y) ? tempAnchor.y : Math.round(point.y),
    };
    const instance = this.sceneModel.getSelectedPositionedGlyph().glyph.instance;
    const relativeScaleX = instance.xAdvance ? point.x / instance.xAdvance : null;

    await this.sceneController.editLayersAndRecordChanges((layerGlyphs) => {
      for (const layerGlyph of Object.values(layerGlyphs)) {
        if (isNaN(tempAnchor.x) && relativeScaleX != null) {
          newAnchor.x = Math.round(layerGlyph.xAdvance * relativeScaleX);
        }
        layerGlyph.anchors.push({ ...newAnchor });
      }
      const newAnchorIndex = instance.anchors.length - 1;
      this.sceneController.selection = new Set([`anchor/${newAnchorIndex}`]);
      return translate("action.add-anchor");
    });
  }

  async doAddEditAnchorDialog(anchor = undefined, point = undefined) {
    const titleDialog = translate(anchor ? "action.edit-anchor" : "action.add-anchor");
    const defaultButton = translate(anchor ? "dialog.edit" : "dialog.add");
    if (!anchor && !point) {
      // Need at least one of the two
      return {};
    }

    const instance = this.sceneModel.getSelectedPositionedGlyph().glyph.instance;

    const validateInput = () => {
      const warnings = [];
      const editedAnchorName =
        nameController.model.anchorName || nameController.model.suggestedAnchorName;
      if (!editedAnchorName.length) {
        warnings.push(`⚠️ ${translate("warning.name-must-not-be-empty")}`);
      }
      if (
        !(
          nameController.model.anchorName ||
          nameController.model.anchorX ||
          nameController.model.anchorY
        )
      ) {
        warnings.push("");
      }
      for (const n of ["X", "Y"]) {
        const value = nameController.model[`anchor${n}`];
        if (isNaN(value)) {
          if (value !== undefined) {
            warnings.push(`⚠️ ${translate("warning.must-be-number", n.toLowerCase())}`);
          }
        }
      }
      if (
        editedAnchorName !== anchor?.name &&
        instance.anchors.some((anchor) => anchor.name === editedAnchorName)
      ) {
        warnings.push(`⚠️ ${translate("warning.name-must-be-unique")}`);
      }
      warningElement.innerText = warnings.length ? warnings.join("\n") : "";
      dialog.defaultButton.classList.toggle("disabled", warnings.length);
    };

    const anchorNameDefault = anchor ? anchor.name : "anchorName";
    const nameController = new ObservableController({
      anchorName: anchorNameDefault,
      anchorX: undefined,
      anchorY: undefined,
      suggestedAnchorName: anchorNameDefault,
      suggestedAnchorX: anchor ? anchor.x : Math.round(point.x),
      suggestedAnchorY: anchor ? anchor.y : Math.round(point.y),
    });

    nameController.addKeyListener("anchorName", (event) => {
      validateInput();
    });
    nameController.addKeyListener("anchorX", (event) => {
      validateInput();
    });
    nameController.addKeyListener("anchorY", (event) => {
      validateInput();
    });

    const disable =
      nameController.model.anchorName ||
      nameController.model.anchorX ||
      nameController.model.anchorY
        ? false
        : true;
    const { contentElement, warningElement } =
      this._anchorPropertiesContentElement(nameController);

    const dialog = await dialogSetup(titleDialog, null, [
      { title: translate("dialog.cancel"), isCancelButton: true },
      { title: defaultButton, isDefaultButton: true, disabled: disable },
    ]);

    dialog.setContent(contentElement);

    setTimeout(() => {
      const inputNameElement = contentElement.querySelector("#anchor-name-text-input");
      inputNameElement.focus();
      inputNameElement.select();
    }, 0);

    validateInput();

    if (!(await dialog.run())) {
      // User cancelled
      return {};
    }

    const newAnchor = {
      name: nameController.model.anchorName,
      x: Number(nameController.model.anchorX),
      y: Number(nameController.model.anchorY),
    };

    return { anchor: newAnchor };
  }

  _anchorPropertiesContentElement(controller) {
    const warningElement = html.div({
      id: "warning-text-anchor-name",
      style: `grid-column: 1 / -1; min-height: 1.5em;`,
    });
    const contentElement = html.div(
      {
        style: `overflow: hidden;
          white-space: nowrap;
          display: grid;
          gap: 0.5em;
          grid-template-columns: auto auto;
          align-items: center;
          height: 100%;
          min-height: 0;
        `,
      },
      [
        ...labeledTextInput(translate("anchor.labels.name"), controller, "anchorName", {
          placeholderKey: "suggestedAnchorName",
          id: "anchor-name-text-input",
        }),
        ...labeledTextInput("x", controller, "anchorX", {
          placeholderKey: "suggestedAnchorX",
        }),
        ...labeledTextInput("y", controller, "anchorY", {
          placeholderKey: "suggestedAnchorY",
        }),
        html.br(),
        warningElement,
      ]
    );
    return { contentElement, warningElement };
  }

  selectionHasLockedGuidelines() {
    const {
      guideline: guidelineSelection,
      //fontGuideline: fontGuidelineSelection,
    } = parseSelection(this.sceneController.selection);

    const instance = this.sceneModel.getSelectedPositionedGlyph()?.glyph.instance;
    if (guidelineSelection?.some((index) => instance.guidelines[index]?.locked)) {
      return true;
    }

    // TODO: Font Guidelines
    // check if any of the selected guidelines are locked

    return false;
  }

  getLockGuidelineLabel(hasLockedGuidelines) {
    const {
      guideline: guidelineSelection,
      //fontGuideline: fontGuidelineSelection,
    } = parseSelection(this.sceneController.selection);
    const numGuidelines = guidelineSelection?.length || 0;
    // + (fontGuidelineSelection?.length || 0);

    return translatePlural(
      hasLockedGuidelines ? "action.unlock-guideline" : "action.lock-guideline",
      numGuidelines
    );
  }

  canLockGuideline() {
    if (this.fontController.readOnly || this.sceneModel.isSelectedGlyphLocked()) {
      return false;
    }
    const {
      guideline: guidelineSelection,
      //fontGuideline: fontGuidelineSelection,
    } = parseSelection(this.sceneController.selection);
    const numGuidelines = guidelineSelection?.length || 0;
    // + (fontGuidelineSelection?.length || 0);

    return numGuidelines;
  }

  async doLockGuideline(locking = false) {
    const {
      guideline: guidelineSelection,
      //fontGuideline: fontGuidelineSelection,
    } = parseSelection(this.sceneController.selection);

    // Lock glyph guidelines
    if (guidelineSelection) {
      await this.sceneController.editLayersAndRecordChanges((layerGlyphs) => {
        for (const layerGlyph of Object.values(layerGlyphs)) {
          for (const guidelineIndex of guidelineSelection) {
            const guideline = layerGlyph.guidelines[guidelineIndex];
            if (!guideline) {
              continue;
            }
            guideline.locked = locking;
          }
        }
        return translatePlural(
          locking ? "action.unlock-guideline" : "action.lock-guideline",
          guidelineSelection.length
        );
      });
    }
    // TODO: Font Guidelines locking
    // Lock font guidelines
    // if (fontGuidelineSelection) {
    //   XXX
    // }
  }

  // TODO: We may want to make a more general code for adding and editing
  // so we can handle both anchors and guidelines with the same code
  // Guidelines

  async doAddGuideline(global = false) {
    this.visualizationLayersSettings.model["fontra.guidelines"] = true;
    const point = this.sceneController.selectedGlyphPoint(this.contextMenuPosition);
    const { guideline: tempGuideline } = await this.doAddEditGuidelineDialog(
      undefined,
      point,
      global
    );
    if (!tempGuideline) {
      return;
    }

    const newGuideline = {
      x: !isNaN(tempGuideline.x) ? tempGuideline.x : Math.round(point.x),
      y: !isNaN(tempGuideline.y) ? tempGuideline.y : Math.round(point.y),
      angle: !isNaN(tempGuideline.angle) ? tempGuideline.angle : 0,
      locked: tempGuideline.locked !== undefined ? tempGuideline.locked : false,
    };
    if (tempGuideline.name) {
      newGuideline.name = tempGuideline.name;
    }

    if (!global) {
      const instance = this.sceneModel.getSelectedPositionedGlyph().glyph.instance;
      await this.sceneController.editLayersAndRecordChanges((layerGlyphs) => {
        for (const layerGlyph of Object.values(layerGlyphs)) {
          layerGlyph.guidelines.push({ ...newGuideline });
        }
        const newGuidelineIndex = instance.guidelines.length - 1;
        this.sceneController.selection = new Set([`guideline/${newGuidelineIndex}`]);
        return translate("action.add-guideline");
      });
    }
    // TODO: Font Guidelines
  }

  async doAddEditGuidelineDialog(
    guideline = undefined,
    point = undefined,
    global = false
  ) {
    const titleDialog = translate(
      guideline ? "action.edit-guideline" : "action.add-guideline"
    );
    const defaultButton = translate(guideline ? "dialog.edit" : "dialog.add");
    if (!guideline && !point) {
      // Need at least one of the two
      return {};
    }

    const instance = this.sceneModel.getSelectedPositionedGlyph().glyph.instance;

    const validateInput = () => {
      const warnings = [];
      const editedGuidelineName =
        nameController.model.guidelineName ||
        nameController.model.suggestedGuidelineName;
      for (const n of ["X", "Y", "Angle"]) {
        const value = nameController.model[`guideline${n}`];
        if (isNaN(value)) {
          if (value !== undefined) {
            warnings.push(`⚠️ ${translate("warning.must-be-number", n.toLowerCase())}`);
          }
        }
      }
      if (
        editedGuidelineName &&
        editedGuidelineName !== guideline?.name &&
        instance.guidelines.some(
          (guideline) => guideline.name === editedGuidelineName.trim()
        )
      ) {
        warnings.push(`⚠️ ${translate("warning.name-must-be-unique")}`);
      }
      warningElement.innerText = warnings.length ? warnings.join("\n") : "";
      dialog.defaultButton.classList.toggle("disabled", warnings.length);
    };

    const nameController = new ObservableController({
      guidelineName: guideline ? guideline.name : undefined,
      guidelineX: guideline ? guideline.x : Math.round(point.x),
      guidelineY: guideline ? guideline.y : Math.round(point.y),
      guidelineAngle: guideline ? guideline.angle : 0,
      guidelineLocked: guideline ? guideline.locked : false,
    });

    nameController.addKeyListener("guidelineName", (event) => {
      validateInput();
    });
    nameController.addKeyListener("guidelineX", (event) => {
      validateInput();
    });
    nameController.addKeyListener("guidelineY", (event) => {
      validateInput();
    });
    nameController.addKeyListener("guidelineAngle", (event) => {
      validateInput();
    });
    nameController.addKeyListener("guidelineLocked", (event) => {
      validateInput();
    });

    const disable =
      nameController.model.guidelineName ||
      nameController.model.guidelineX ||
      nameController.model.guidelineY ||
      nameController.model.guidelineAngle
        ? false
        : true;
    const { contentElement, warningElement } =
      this._guidelinePropertiesContentElement(nameController);
    const dialog = await dialogSetup(titleDialog, null, [
      { title: translate("dialog.cancel"), isCancelButton: true },
      { title: defaultButton, isDefaultButton: true, disabled: disable },
    ]);

    dialog.setContent(contentElement);

    setTimeout(
      () => contentElement.querySelector("#guideline-name-text-input")?.focus(),
      0
    );

    validateInput();

    if (!(await dialog.run())) {
      // User cancelled
      return {};
    }

    const newGuideline = {
      name: nameController.model.guidelineName
        ? nameController.model.guidelineName.trim()
        : undefined,
      x: Number(nameController.model.guidelineX),
      y: Number(nameController.model.guidelineY),
      angle: Number(nameController.model.guidelineAngle),
      locked: nameController.model.guidelineLocked,
    };

    return { guideline: newGuideline };
  }

  _guidelinePropertiesContentElement(controller) {
    const warningElement = html.div({
      id: "warning-text-guideline-name",
      style: `grid-column: 1 / -1; min-height: 1.5em;`,
    });
    const contentElement = html.div(
      {
        style: `overflow: hidden;
          white-space: nowrap;
          display: grid;
          gap: 0.5em;
          grid-template-columns: auto auto;
          align-items: center;
          height: 100%;
          min-height: 0;
        `,
      },
      [
        ...labeledTextInput(
          translate("guideline.labels.name"),
          controller,
          "guidelineName",
          {
            id: "guideline-name-text-input",
          }
        ),
        ...labeledTextInput("x", controller, "guidelineX", {}),
        ...labeledTextInput("y", controller, "guidelineY", {}),
        ...labeledTextInput(
          translate("guideline.labels.angle"),
          controller,
          "guidelineAngle",
          {}
        ),
        html.div(),
        labeledCheckbox(
          translate("guideline.labels.locked"),
          controller,
          "guidelineLocked",
          {}
        ),
        html.br(),
        warningElement,
      ]
    );
    return { contentElement, warningElement };
  }

  doSelectAllNone(selectNone) {
    const positionedGlyph = this.sceneModel.getSelectedPositionedGlyph();

    if (!positionedGlyph || !this.sceneSettings.selectedGlyph?.isEditing) {
      return;
    }

    if (selectNone) {
      this.sceneController.selection = new Set();
      return;
    }

    let {
      point: pointIndices,
      component: componentIndices,
      anchor: anchorIndices,
      guideline: guidelineIndices,
      //fontGuideline: fontGuidelineIndices,
    } = parseSelection(this.sceneController.selection);
    pointIndices = pointIndices || [];
    componentIndices = componentIndices || [];
    anchorIndices = anchorIndices || [];
    guidelineIndices = guidelineIndices || [];
    //fontGuidelineIndices = fontGuidelineIndices || [];

    let selectObjects = false;
    let selectAnchors = false;
    let selectGuidelines = false;

    const instance = positionedGlyph.glyph.instance;
    const hasObjects =
      instance.components.length > 0 || instance.path.pointTypes.length > 0;
    const hasAnchors = instance.anchors.length > 0;
    const hasGuidelines = instance.guidelines.length > 0;

    const glyphPath = positionedGlyph.glyph.path;
    let onCurvePoints = [];
    for (const [pointIndex, pointType] of enumerate(glyphPath.pointTypes)) {
      if ((pointType & VarPackedPath.POINT_TYPE_MASK) === VarPackedPath.ON_CURVE) {
        onCurvePoints.push(pointIndex);
      }
    }

    const allOnCurvePointsSelected = isSuperset(new Set(pointIndices), onCurvePoints);
    if (
      (!allOnCurvePointsSelected ||
        componentIndices.length < instance.components.length) &&
      !anchorIndices.length &&
      !guidelineIndices.length
      //&& !fontGuidelineIndices.length
    ) {
      if (hasObjects) {
        selectObjects = true;
      } else if (hasAnchors) {
        selectAnchors = true;
      } else if (hasGuidelines) {
        selectGuidelines = true;
      }
    }

    if (
      allOnCurvePointsSelected &&
      componentIndices.length == instance.components.length &&
      !anchorIndices.length &&
      !guidelineIndices.length
      //&& !fontGuidelineIndices.length
    ) {
      if (hasAnchors) {
        selectObjects = true;
        selectAnchors = true;
      } else if (hasGuidelines) {
        selectGuidelines = true;
      }
    }

    if (
      (pointIndices.length || componentIndices.length) &&
      anchorIndices.length &&
      !guidelineIndices.length
      //&& !fontGuidelineIndices.length
    ) {
      if (hasAnchors) {
        selectAnchors = true;
      }
    }

    if (
      !pointIndices.length &&
      !componentIndices.length &&
      anchorIndices.length &&
      !guidelineIndices.length
      //&& !fontGuidelineIndices.length
    ) {
      if (hasGuidelines) {
        selectGuidelines = true;
      }
    }

    let newSelection = new Set();

    if (selectObjects) {
      for (const pointIndex of onCurvePoints) {
        newSelection.add(`point/${pointIndex}`);
      }
      for (const componentIndex of range(positionedGlyph.glyph.components.length)) {
        newSelection.add(`component/${componentIndex}`);
      }
      if (
        !this.sceneSettings.backgroundImagesAreLocked &&
        this.visualizationLayersSettings.model["fontra.background-image"]
      ) {
        for (const backgroundImageIndex of positionedGlyph.glyph.backgroundImage
          ? [0]
          : []) {
          newSelection.add(`backgroundImage/${backgroundImageIndex}`);
        }
      }
    }

    if (selectAnchors) {
      for (const anchorIndex of range(positionedGlyph.glyph.anchors.length)) {
        newSelection.add(`anchor/${anchorIndex}`);
      }
    }

    if (
      selectGuidelines &&
      this.visualizationLayersSettings.model["fontra.guidelines"]
    ) {
      for (const guidelineIndex of range(positionedGlyph.glyph.guidelines.length)) {
        const guideline = positionedGlyph.glyph.guidelines[guidelineIndex];
        if (!guideline.locked) {
          newSelection.add(`guideline/${guidelineIndex}`);
        }
      }
      // TODO: Font Guidelines selection
    }
    this.sceneController.selection = newSelection;
  }

  async doSelectPreviousNextSource(selectPrevious) {
    const instance = this.sceneModel.getSelectedPositionedGlyph()?.glyph;
    if (!instance) {
      return;
    }
    const varGlyphController =
      await this.sceneModel.getSelectedVariableGlyphController();
    const sourceIndex = this.sceneSettings.selectedSourceIndex;
    let newSourceIndex;
    if (sourceIndex === undefined) {
      newSourceIndex = varGlyphController.findNearestSourceForSourceLocation({
        ...this.sceneSettings.fontLocationSourceMapped,
        ...this.sceneSettings.glyphLocation,
      });
    } else {
      newSourceIndex = modulo(
        sourceIndex + (selectPrevious ? -1 : 1),
        varGlyphController.sources.length
      );
    }
    this.sceneController.scrollAdjustBehavior = "pin-glyph-center";
    this.sceneSettings.selectedSourceIndex = newSourceIndex;
  }

  async doSelectPreviousNextSourceLayer(selectPrevious) {
    const panel = this.getSidebarPanel("designspace-navigation");
    panel?.doSelectPreviousNextSourceLayer(selectPrevious);
  }

  async doSelectPreviousNextGlyph(selectPrevious) {
    const panel = this.getSidebarPanel("glyph-search");
    const glyphNames = panel.glyphSearch.getFilteredGlyphNames();
    if (!glyphNames.length) {
      return;
    }

    const selectedGlyphName = this.sceneSettings.selectedGlyphName;
    if (!selectedGlyphName) {
      return;
    }
    const index = glyphNames.indexOf(selectedGlyphName);
    const newIndex =
      index == -1
        ? selectPrevious
          ? glyphNames.length - 1
          : 0
        : modulo(index + (selectPrevious ? -1 : 1), glyphNames.length);

    const glyphInfo = this.fontController.glyphInfoFromGlyphName(glyphNames[newIndex]);
    this.insertGlyphInfos([glyphInfo], 0, true);
  }

  async doFindGlyphsThatUseGlyph() {
    const glyphName = this.sceneSettings.selectedGlyphName;

    const usedBy = await loaderSpinner(
      this.fontController.findGlyphsThatUseGlyph(glyphName)
    );

    if (!usedBy.length) {
      await message(
        `Glyph '${glyphName}' is not used as a component by any glyph.`,
        null
      );
      return;
    }

    usedBy.sort();

    const glyphMap = Object.fromEntries(
      usedBy.map((glyphName) => [glyphName, this.fontController.glyphMap[glyphName]])
    );

    const glyphSearch = document.createElement("glyph-search-list");
    glyphSearch.glyphMap = glyphMap;

    glyphSearch.addEventListener("selectedGlyphNameDoubleClicked", (event) => {
      theDialog.defaultButton.click();
    });

    const theDialog = await dialogSetup(
      translate("dialog.find-glyphs-that-use.title", glyphName),
      null,
      [
        { title: translate("dialog.cancel"), isCancelButton: true },
        {
          title: translate("dialog.find-glyphs-that-use.button.copy-names"),
          resultValue: "copy",
        },
        {
          title: translate("dialog.find-glyphs-that-use.button.add-to-text"),
          isDefaultButton: true,
          resultValue: "add",
        },
      ]
    );

    theDialog.setContent(glyphSearch);

    setTimeout(() => glyphSearch.focusSearchField(), 0); // next event loop iteration

    switch (await theDialog.run()) {
      case "copy": {
        const glyphNamesString = chunks(usedBy, 16)
          .map((chunked) => chunked.map((glyphName) => "/" + glyphName).join(""))
          .join("\n");
        const clipboardObject = {
          "text/plain": glyphNamesString,
        };
        await writeToClipboard(clipboardObject);
        break;
      }
      case "add": {
        const glyphName = glyphSearch.getSelectedGlyphName();
        const MAX_NUM_GLYPHS = 100;
        const truncate = !glyphName && usedBy.length > MAX_NUM_GLYPHS;
        const glyphNames = glyphName
          ? [glyphName]
          : truncate
          ? usedBy.slice(0, MAX_NUM_GLYPHS)
          : usedBy;

        const glyphInfos = glyphNames.map((glyphName) =>
          this.fontController.glyphInfoFromGlyphName(glyphName)
        );
        const selectedGlyphInfo = this.sceneSettings.selectedGlyph;
        const glyphLines = [...this.sceneSettings.glyphLines];
        glyphLines[selectedGlyphInfo.lineIndex].splice(
          selectedGlyphInfo.glyphIndex + 1,
          0,
          ...glyphInfos
        );
        this.sceneSettings.glyphLines = glyphLines;
        if (truncate) {
          await message(
            `The number of added glyphs was truncated to ${MAX_NUM_GLYPHS}`,
            null
          );
        }
        break;
      }
    }
  }

  async runGlyphSearchDialog(
    titleLabel = translate("dialog.glyphs.search"),
    okLabel = translate("dialog.add")
  ) {
    const glyphSearch = document.createElement("glyph-search-list");
    glyphSearch.glyphMap = this.fontController.glyphMap;

    glyphSearch.addEventListener("selectedGlyphNameChanged", (event) => {
      dialog.defaultButton.classList.toggle(
        "disabled",
        !glyphSearch.getSelectedGlyphName()
      );
    });

    glyphSearch.addEventListener("selectedGlyphNameDoubleClicked", (event) => {
      dialog.defaultButton.click();
    });

    const dialog = await dialogSetup(titleLabel, null, [
      { title: translate("dialog.cancel"), isCancelButton: true },
      { title: okLabel, isDefaultButton: true, resultValue: "ok", disabled: true },
    ]);

    dialog.setContent(glyphSearch);

    setTimeout(() => glyphSearch.focusSearchField(), 0); // next event loop iteration

    if (!(await dialog.run())) {
      // User cancelled
      return;
    }

    const glyphName = glyphSearch.getSelectedGlyphName();
    if (!glyphName) {
      // Invalid selection
      return;
    }

    return glyphName;
  }

  async doCanvasInsertGlyph(titleLabel, okLabel, where) {
    const glyphName = await this.runGlyphSearchDialog(titleLabel, okLabel);
    if (!glyphName) {
      return;
    }
    const glyphInfo = this.fontController.glyphInfoFromGlyphName(glyphName);
    this.insertGlyphInfos([glyphInfo], where, true);
  }

  keyUpHandler(event) {
    if (this._matchingKeyUpHandler && this._matchingKeyUpHandler.code == event.code) {
      this._matchingKeyUpHandler.callback(event);
      delete this._matchingKeyUpHandler;
    }
  }

  enterCleanViewAndHandTool(event) {
    this.canvasController.sceneView = this.cleanSceneView;
    this.canvasController.requestUpdate();
    for (const overlay of document.querySelectorAll(".cleanable-overlay")) {
      overlay.classList.add("overlay-layer-hidden");
    }
    this.savedSelectedToolIdentifier = this.selectedToolIdentifier;
    this.setSelectedTool("hand-tool");
    this._matchingKeyUpHandler = {
      code: event.code,
      callback: () => this.leaveCleanViewAndHandTool(),
    };
  }

  leaveCleanViewAndHandTool() {
    this.canvasController.sceneView = this.defaultSceneView;
    this.canvasController.requestUpdate();
    for (const overlay of document.querySelectorAll(".cleanable-overlay")) {
      overlay.classList.remove("overlay-layer-hidden");
    }
    this.setSelectedTool(this.savedSelectedToolIdentifier);
    delete this.savedSelectedToolIdentifier;
  }

  buildContextMenuItems(event) {
    const menuItems = [
      { title: translate("menubar.edit"), getItems: () => this.basicContextMenuItems },
    ];
    if (this.sceneSettings.selectedGlyph?.isEditing) {
      this.sceneController.updateContextMenuState(event);
      menuItems.push(MenuItemDivider);
      menuItems.push(...this.glyphEditContextMenuItems);
    }
    if (this.sceneSettings.selectedGlyph) {
      menuItems.push(MenuItemDivider);
      menuItems.push(...this.glyphSelectedContextMenuItems);
    }
    return menuItems;
  }

  contextMenuHandler(event) {
    event.preventDefault();

    const { x, y } = event;
    this.contextMenuPosition = { x: x, y: y };
    showMenu(this.buildContextMenuItems(event), { x: x + 1, y: y - 1 });
  }

  async newGlyph(glyphName, codePoint, varGlyph, undoLabel = null) {
    await this.fontController.newGlyph(glyphName, codePoint, varGlyph, undoLabel);
  }

  async externalChange(change, isLiveChange) {
    await super.externalChange(change, isLiveChange);

    // Force sync between location and selectedSourceIndex, as the glyph's
    // source list may have changed
    this.sceneSettings.fontLocationSourceMapped = {
      ...this.sceneSettings.fontLocationSourceMapped,
    };
    this.sceneSettings.glyphLocation = { ...this.sceneSettings.glyphLocation };
    await this.sceneModel.updateScene();
    this.canvasController.requestUpdate();
  }

  async reloadEverything() {
    await super.reloadEverything();
    await this.sceneModel.updateScene();
    this.canvasController.requestUpdate();
  }

  async reloadGlyphs(glyphNames) {
    if (glyphNames.includes(this.sceneSettings.selectedGlyphName)) {
      // If the glyph being edited is among the glyphs to be reloaded,
      // cancel the edit, but wait for the cancellation to be completed,
      // or else the reload and edit can get mixed up and the glyph data
      // will be out of sync.
      await this.sceneController.cancelEditing(translate("message.cancel-editing"));
    }
    await super.reloadGlyphs(glyphNames);
    await this.sceneModel.updateScene();
    this.canvasController.requestUpdate();
  }

  async setupFromWindowLocation() {
    this.sceneSettingsController.withSenderInfo({ senderID: this }, () =>
      this._setupFromWindowLocation()
    );
  }

  async _setupFromWindowLocation() {
    let viewInfo;
    const url = new URL(window.location);
    if (url.hash) {
      viewInfo = loadURLFragment(url.hash);
      if (!viewInfo) {
        viewInfo = {};
        message("The URL is malformed", "The UI settings could not be restored."); // TODO: translation
      }
    } else {
      // Legacy URL format
      viewInfo = {};
      for (const key of url.searchParams.keys()) {
        viewInfo[key] = JSON.parse(url.searchParams.get(key));
      }
    }
    this.sceneSettings.align = viewInfo["align"] || "center";
    if (viewInfo["viewBox"]) {
      this.sceneController.autoViewBox = false;
      const viewBox = viewInfo["viewBox"];
      if (viewBox.every((value) => !isNaN(value))) {
        this.sceneSettings.viewBox = rectFromArray(viewBox);
      }
    }

    if (viewInfo["text"]) {
      this.sceneSettings.text = viewInfo["text"];
      // glyphLines is computed from text asynchronously, but its result is needed
      // to for selectedGlyphName, so we'll wait until it's done
      await this.sceneSettingsController.waitForKeyChange("glyphLines");
    }
    this._previousURLText = viewInfo["text"];

    this.sceneModel.setGlyphLocations(viewInfo["glyphLocations"]);

    if (viewInfo["fontAxesUseSourceCoordinates"]) {
      this.sceneSettings.fontAxesUseSourceCoordinates = true;
    }
    if (viewInfo["fontAxesShowEffectiveLocation"]) {
      this.sceneSettings.fontAxesShowEffectiveLocation = true;
    }
    if (viewInfo["fontAxesShowHidden"]) {
      this.sceneSettings.fontAxesShowHidden = true;
    }
    if (viewInfo["fontAxesSkipMapping"]) {
      this.sceneSettings.fontAxesSkipMapping = true;
    }

    if (viewInfo["location"]) {
      this.sceneSettings.fontLocationUser = viewInfo["location"];
    }

    this.sceneSettings.selectedGlyph = viewInfo["selectedGlyph"];

    if (viewInfo["editLayerName"]) {
      this.sceneSettings.editLayerName = viewInfo["editLayerName"];
    }
    if (viewInfo["editingLayers"]) {
      this.sceneSettings.editingLayers = viewInfo["editingLayers"];
    }

    if (viewInfo["selection"]) {
      this.sceneSettings.selection = new Set(viewInfo["selection"]);
    }

    if (
      this.sceneController.autoViewBox &&
      this.sceneSettings.selectedGlyph?.isEditing
    ) {
      // This is a bit of a hack: if isEditing is true, the autoViewBox
      // doesn't work. Also, autoViewBox *needs* to be off in edit mode,
      // or the canvas behaves really weirdly (it resizes as you drag points)
      // We can't call .zoomFit() right away as the scene isn't done setting
      // up. We add a temporary listener to do .zoomFit() once the scene is
      // there.
      const delayedZoomFit = () => {
        this.sceneSettingsController.removeKeyListener(
          "positionedLines",
          delayedZoomFit
        );
        this.zoomFit(false);
      };
      this.sceneSettingsController.addKeyListener("positionedLines", delayedZoomFit);
    }

    this.canvasController.requestUpdate();
    this._didFirstSetup = true;
  }

  _updateWindowLocation() {
    if (!this._didFirstSetup) {
      // We shall not change the window location ever before we've done
      // an initial setup _from_ the window location
      return;
    }
    const viewInfo = {};
    const viewBox = this.sceneSettings.viewBox;

    if (viewBox && Object.values(viewBox).every((value) => !isNaN(value))) {
      viewInfo["viewBox"] = rectToArray(rectRound(viewBox));
    }
    if (this.sceneSettings.text?.length) {
      viewInfo["text"] = this.sceneSettings.text;
    }
    if (this.sceneSettings.selectedGlyph) {
      viewInfo["selectedGlyph"] = this.sceneSettings.selectedGlyph;
    }
    viewInfo["location"] = this.sceneSettings.fontLocationUser;
    if (this.sceneSettings.fontAxesUseSourceCoordinates) {
      viewInfo["fontAxesUseSourceCoordinates"] = true;
    }
    if (this.sceneSettings.fontAxesShowEffectiveLocation) {
      viewInfo["fontAxesShowEffectiveLocation"] = true;
    }
    if (this.sceneSettings.fontAxesShowHidden) {
      viewInfo["fontAxesShowHidden"] = true;
    }
    if (this.sceneSettings.fontAxesSkipMapping) {
      viewInfo["fontAxesSkipMapping"] = true;
    }

    if (this.sceneSettings.editLayerName) {
      viewInfo["editLayerName"] = this.sceneSettings.editLayerName;
    }
    if (
      this.sceneSettings.editingLayers &&
      Object.keys(this.sceneSettings.editingLayers).length
    ) {
      viewInfo["editingLayers"] = this.sceneSettings.editingLayers;
    }

    const glyphLocations = this.sceneController.getGlyphLocations(true);
    if (Object.keys(glyphLocations).length) {
      viewInfo["glyphLocations"] = glyphLocations;
    }
    const selArray = Array.from(this.sceneController.selection);
    if (selArray.length) {
      viewInfo["selection"] = Array.from(selArray);
    }
    if (this.sceneSettings.align !== "center") {
      viewInfo["align"] = this.sceneSettings.align;
    }

    const url = new URL(window.location);
    clearSearchParams(url.searchParams); /* clear legacy URL format */
    writeObjectToURLFragment(viewInfo, this._previousURLText === viewInfo["text"]);
    this._previousURLText = viewInfo["text"];
  }

  async editListenerCallback(editMethodName, senderID, ...args) {
    if (editMethodName === "editFinal") {
      this.sceneController.updateHoverState();
    }
  }

  zoomIn() {
    this._zoom(1 / Math.sqrt(2));
  }

  zoomOut() {
    this._zoom(Math.sqrt(2));
  }

  _zoom(factor) {
    let viewBox = this.sceneSettings.viewBox;
    const selBox = this.sceneController.getSelectionBounds();
    const center = rectCenter(selBox || viewBox);
    viewBox = rectScaleAroundCenter(viewBox, factor, center);

    const adjustFactor =
      this.canvasController.getProposedViewBoxClampAdjustment(viewBox);
    if (adjustFactor !== 1) {
      // The viewBox is too large or too small
      if (Math.abs(adjustFactor * factor - 1) < 0.00000001) {
        // Already at min/max magnification
        return;
      }
      viewBox = rectScaleAroundCenter(viewBox, adjustFactor, center);
    }

    this.animateToViewBox(viewBox);
    this.sceneController.autoViewBox = false;
  }

  zoomFit(animate = true) {
    let viewBox = this.sceneController.getSelectionBounds();
    if (viewBox) {
      let size = rectSize(viewBox);
      if (size.width < 4 && size.height < 4) {
        const center = rectCenter(viewBox);
        viewBox = centeredRect(center.x, center.y, 10, 10);
      } else {
        viewBox = rectAddMargin(viewBox, 0.1);
      }
      if (animate) {
        this.animateToViewBox(viewBox);
      } else {
        this.sceneSettings.viewBox = viewBox;
      }
    }
    this.sceneController.autoViewBox = false;
  }

  toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      const element = document.documentElement;
      element.requestFullscreen();
    }
  }

  updateFullscreenButton() {
    // hide button in case fullscreen is not enabled on device
    const fullscreenButtonEl = document.querySelector(
      ".tool-button[data-tool='toggle-fullscreen']"
    );
    if (!document.fullscreenEnabled) {
      fullscreenButtonEl.style.display = "none";
      return;
    }
    // fullscreen is enabled, show the right icon depending on the fullscreen state
    const fullscreenEnterIconEl = fullscreenButtonEl.querySelector(
      ".tool-icon--fullscreen-enter"
    );
    const fullscreenExitIconEl = fullscreenButtonEl.querySelector(
      ".tool-icon--fullscreen-exit"
    );
    if (document.fullscreenElement) {
      // fullscreen state is on, display exit-fullscreen button icon
      fullscreenEnterIconEl.classList.add("tool-icon--hidden");
      fullscreenExitIconEl.classList.remove("tool-icon--hidden");
    } else {
      // fullscreen state is off, display enter-fullscreen button icon
      fullscreenEnterIconEl.classList.remove("tool-icon--hidden");
      fullscreenExitIconEl.classList.add("tool-icon--hidden");
    }
  }

  animateToViewBox(viewBox) {
    const startViewBox = this.sceneSettings.viewBox;
    const deltaViewBox = subItemwise(viewBox, startViewBox);
    let start;
    const duration = 200;

    const animate = (timestamp) => {
      if (start === undefined) {
        start = timestamp;
      }
      let t = (timestamp - start) / duration;
      if (t > 1.0) {
        t = 1.0;
      }
      const animatingViewBox = addItemwise(
        startViewBox,
        mulScalar(deltaViewBox, easeOutQuad(t))
      );
      if (t < 1.0) {
        this.sceneSettings.viewBox = animatingViewBox;
        requestAnimationFrame(animate);
      } else {
        this.sceneSettings.viewBox = viewBox;
      }
    };
    requestAnimationFrame(animate);
  }

  canPlaceBackgroundImage() {
    return (
      this.fontController.backendInfo.features["background-image"] &&
      this.canEditGlyph()
    );
  }

  canEditGlyph() {
    const positionedGlyph = this.sceneModel.getSelectedPositionedGlyph();
    return !!(
      positionedGlyph &&
      !this.fontController.readOnly &&
      !this.sceneModel.isSelectedGlyphLocked() &&
      positionedGlyph.glyph.canEdit
    );
  }

  // Drop files onto canvas

  _onDragEnter(event) {
    event.preventDefault();
    if (!this.canPlaceBackgroundImage()) {
      return;
    }
    this.canvasController.canvas.classList.add("dropping-files");
  }

  _onDragOver(event) {
    event.preventDefault();
    if (!this.canPlaceBackgroundImage()) {
      return;
    }
    this.canvasController.canvas.classList.add("dropping-files");
  }

  _onDragLeave(event) {
    event.preventDefault();
    if (!this.canPlaceBackgroundImage()) {
      return;
    }
    this.canvasController.canvas.classList.remove("dropping-files");
  }

  async _onDrop(event) {
    event.preventDefault();
    if (!this.canPlaceBackgroundImage()) {
      return;
    }
    this.canvasController.canvas.classList.remove("dropping-files");

    const items = [];

    for (const item of event.dataTransfer?.files || []) {
      const suffix = item.name.split(".").at(-1);
      if (suffix === "png" || suffix === "jpg" || suffix === "jpeg") {
        items.push(item);
      }
    }

    if (items.length != 1) {
      await dialog(
        "Can't drop files",
        "Please drop a single .png, .jpg or .jpeg file",
        [{ title: translate("dialog.okay"), resultValue: "ok", isDefaultButton: true }]
      );
      return;
    }

    await this._placeBackgroundImage(await readFileOrBlobAsDataURL(items[0]));
  }
}

function clearSearchParams(searchParams) {
  for (const key of Array.from(searchParams.keys())) {
    searchParams.delete(key);
  }
}

function easeOutQuad(t) {
  return 1 - (1 - t) ** 2;
}

function matchEvent(handlerDef, event) {
  for (const prop of ["ctrlKey", "shiftKey", "altKey", "repeat"]) {
    if (handlerDef[prop] !== undefined && handlerDef[prop] !== event[prop]) {
      return false;
    }
  }
  return true;
}

function newVisualizationLayersSettings(visualizationLayers) {
  const settings = [];
  for (const definition of visualizationLayers.definitions) {
    if (!definition.userSwitchable) {
      continue;
    }
    if (!(definition.identifier in settings)) {
      settings[definition.identifier] = !!definition.defaultOn;
    }
  }
  const controller = new ObservableController(settings);
  controller.synchronizeWithLocalStorage("fontra-editor-visualization-layers.");
  for (const [key, onOff] of Object.entries(controller.model)) {
    visualizationLayers.toggle(key, onOff);
  }
  return controller;
}

async function runDialogWholeGlyphPaste() {
  const controller = new ObservableController({ behavior: PASTE_BEHAVIOR_REPLACE });
  controller.synchronizeWithLocalStorage("fontra-glyph-paste");
  if (
    controller.model.behavior !== PASTE_BEHAVIOR_REPLACE &&
    controller.model.behavior !== PASTE_BEHAVIOR_ADD
  ) {
    controller.model.behavior = PASTE_BEHAVIOR_REPLACE;
  }

  const dialog = await dialogSetup(translate("dialog.paste-whole-glyph.title"), null, [
    { title: translate("dialog.cancel"), resultValue: "cancel", isCancelButton: true },
    { title: translate("dialog.okay"), resultValue: "ok", isDefaultButton: true },
  ]);

  const radioGroup = [
    html.div({}, translate("dialog.paste-whole-glyph.content.question")),
    html.br(),
  ];

  for (const [label, value] of [
    [translate("dialog.paste-whole-glyph.content.replace"), PASTE_BEHAVIOR_REPLACE],
    [translate("dialog.paste-whole-glyph.content.add"), PASTE_BEHAVIOR_ADD],
  ]) {
    radioGroup.push(
      html.input({
        type: "radio",
        id: value,
        value: value,
        name: "paste-replace-radio-group",
        checked: controller.model.behavior === value,
        onchange: (event) => (controller.model.behavior = event.target.value),
      }),
      html.label({ for: value }, [label]),
      html.br()
    );
  }
  radioGroup.push(html.br());

  dialog.setContent(html.div({}, radioGroup));
  const result = await dialog.run();

  return result === "ok" ? controller.model.behavior : null;
}

function chunks(array, n) {
  const chunked = [];
  for (const i of range(0, array.length, n)) {
    chunked.push(array.slice(i, i + n));
  }
  return chunked;
}

function insecureSafariConnection() {
  return window.safari !== undefined && window.location.protocol === "http:";
}

function collapseSubTools(editToolsElement) {
  // Hide sub tools
  for (const [index, child] of enumerate(editToolsElement.children)) {
    child.style.visibility = index ? "hidden" : "visible";
    child.dataset.tooltipposition = index ? "right" : "bottom";
  }
}
