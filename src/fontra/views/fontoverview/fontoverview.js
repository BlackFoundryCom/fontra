import {
  doPerformAction,
  getActionIdentifierFromKeyEvent,
  registerAction,
} from "../core/actions.js";
import { FontOverviewNavigation } from "./panel-navigation.js";
import { makeFontraMenuBar } from "/core/fontra-menus.js";
import { GlyphOrganizer } from "/core/glyph-organizer.js";
import * as html from "/core/html-utils.js";
import { loaderSpinner } from "/core/loader-spinner.js";
import { translate } from "/core/localization.js";
import { ObservableController } from "/core/observable-object.js";
import {
  dumpURLFragment,
  glyphMapToItemList,
  isActiveElementTypeable,
  modulo,
  range,
  readObjectFromURLFragment,
  scheduleCalls,
  throttleCalls,
  writeObjectToURLFragment,
} from "/core/utils.js";
import { ViewController } from "/core/view-controller.js";
import { GlyphCellView } from "/web-components/glyph-cell-view.js";
import { message } from "/web-components/modal-dialog.js";

const persistentSettings = [
  { key: "searchString" },
  { key: "fontLocationUser" },
  { key: "glyphSelection", toJSON: (v) => [...v], fromJSON: (v) => new Set(v) },
  { key: "closedGlyphSections", toJSON: (v) => [...v], fromJSON: (v) => new Set(v) },
  { key: "groupByKeys" },
];

function getDefaultFontOverviewSettings() {
  return {
    searchString: "",
    fontLocationUser: {},
    fontLocationSource: {},
    glyphSelection: new Set(),
    closedGlyphSections: new Set(),
    groupByKeys: [],
  };
}

export class FontOverviewController extends ViewController {
  constructor(font) {
    super(font);

    this.basicContextMenuItems = [];
    this.initActions();
    this.initContextMenuItems();

    this.myMenuBar = makeFontraMenuBar(["File", "Edit", "View", "Font", "Glyph"], this);
    document.querySelector(".top-bar-container").appendChild(this.myMenuBar);

    this.updateGlyphSelection = throttleCalls(() => this._updateGlyphSelection(), 50);

    this.updateWindowLocation = scheduleCalls(
      (event) => this._updateWindowLocation(),
      200
    );
  }

  getFileMenuItems() {
    return {
      title: translate("menubar.file"),
      getItems: () => {
        let exportFormats =
          this.fontController.backendInfo.projectManagerFeatures["export-as"] || [];
        if (exportFormats.length > 0) {
          return [
            {
              title: translate("menubar.file.export-as"),
              getItems: () =>
                exportFormats.map((format) => ({
                  actionIdentifier: `action.export-as.${format}`,
                })),
            },
          ];
        } else {
          return [
            {
              title: translate("menubar.file.new"),
              enabled: () => false,
              callback: () => {},
            },
            {
              title: translate("menubar.file.open"),
              enabled: () => false,
              callback: () => {},
            },
          ];
        }
      },
    };
  }

  getEditMenuItems() {
    return {
      title: translate("menubar.edit"),
      getItems: () => {
        return [...this.basicContextMenuItems];
      },
    };
  }

  getViewMenuItems() {
    return {
      title: translate("menubar.view"),
      getItems: () => {
        const items = [
          {
            actionIdentifier: "action.zoom-in",
          },
          {
            actionIdentifier: "action.zoom-out",
          },
        ];
        return items;
      },
    };
  }

  getGlyphMenuItems() {
    return {
      title: translate("menubar.glyph"),
      enabled: () => true,
      getItems: () => [
        { actionIdentifier: "action.glyph.duplicate" },
        { actionIdentifier: "action.glyph.delete" },
      ],
    };
  }

  async start() {
    await loaderSpinner(this._start());
  }

  async _start() {
    await this.fontController.initialize();

    this.fontSources = await this.fontController.getSources();

    window.addEventListener("popstate", (event) => {
      this._updateFromWindowLocation();
    });

    this.fontOverviewSettingsController = new ObservableController(
      getDefaultFontOverviewSettings()
    );
    this.fontOverviewSettings = this.fontOverviewSettingsController.model;

    this._setupLocationDependencies();

    this._updateFromWindowLocation();

    this.fontOverviewSettingsController.addKeyListener(
      persistentSettings.map(({ key }) => key),
      (event) => {
        if (event.senderInfo?.senderID !== this) {
          this.updateWindowLocation();
        }
      }
    );

    this.fontOverviewSettingsController.addKeyListener("searchString", (event) => {
      this.glyphOrganizer.setSearchString(event.newValue);
      this.updateGlyphSelection();
    });

    this.fontOverviewSettingsController.addKeyListener("groupByKeys", (event) => {
      this.glyphOrganizer.setGroupByKeys(event.newValue);
      this.updateGlyphSelection();
    });

    this.glyphOrganizer = new GlyphOrganizer();
    this.glyphOrganizer.setSearchString(this.fontOverviewSettings.searchString);
    this.glyphOrganizer.setGroupByKeys(this.fontOverviewSettings.groupByKeys);

    const rootSubscriptionPattern = {};
    for (const rootKey of this.fontController.getRootKeys()) {
      rootSubscriptionPattern[rootKey] = null;
    }
    rootSubscriptionPattern["glyphs"] = null;
    await this.fontController.subscribeChanges(rootSubscriptionPattern, false);

    const sidebarContainer = document.querySelector("#sidebar-container");
    const glyphCellViewContainer = document.querySelector("#glyph-cell-view-container");

    this.navigation = new FontOverviewNavigation(this);

    this.glyphCellView = new GlyphCellView(
      this.fontController,
      this.fontOverviewSettingsController,
      { locationKey: "fontLocationSource" }
    );

    this.glyphCellView.onOpenSelectedGlyphs = (event) => this.openSelectedGlyphs();

    sidebarContainer.appendChild(this.navigation);
    glyphCellViewContainer.appendChild(this.glyphCellView);

    this.fontController.addChangeListener({ glyphMap: null }, () => {
      this._updateGlyphItemList();
    });

    document.addEventListener("keydown", (event) => this.handleKeyDown(event));

    this._updateGlyphItemList();
  }

  _setupLocationDependencies() {
    // TODO: This currently does *not* do avar-2 / cross-axis-mapping
    // - We need the "user location" to send to the editor
    // - We would need the "mapped source location" for the glyph cells
    // - We use the "user location" to store in the fontoverview URL fragment
    // - Mapping from "user" to "source" to "mapped source" is easy
    // - The reverse is not: see CrossAxisMapping.unmapLocation()

    this.fontOverviewSettingsController.addKeyListener(
      "fontLocationSource",
      (event) => {
        if (!event.senderInfo?.fromFontLocationUser) {
          this.fontOverviewSettingsController.withSenderInfo(
            { fromFontLocationSource: true },
            () => {
              this.fontOverviewSettingsController.model.fontLocationUser =
                this.fontController.mapSourceLocationToUserLocation(event.newValue);
            }
          );
        }
      }
    );

    this.fontOverviewSettingsController.addKeyListener("fontLocationUser", (event) => {
      if (!event.senderInfo?.fromFontLocationSource) {
        this.fontOverviewSettingsController.withSenderInfo(
          { fromFontLocationUser: true },
          () => {
            this.fontOverviewSettingsController.model.fontLocationSource =
              this.fontController.mapUserLocationToSourceLocation(event.newValue);
          }
        );
      }
    });
  }

  _updateFromWindowLocation() {
    const viewInfo = readObjectFromURLFragment();
    if (!viewInfo) {
      message("The URL is malformed", "The UI settings could not be restored."); // TODO: translation
      return;
    }
    const defaultSettings = getDefaultFontOverviewSettings();
    this.fontOverviewSettingsController.withSenderInfo({ senderID: this }, () => {
      for (const { key, fromJSON } of persistentSettings) {
        const value = viewInfo[key];
        if (value !== undefined) {
          this.fontOverviewSettings[key] = fromJSON?.(value) || value;
        } else {
          this.fontOverviewSettings[key] = defaultSettings[key];
        }
      }
    });
  }

  _updateWindowLocation() {
    const viewInfo = Object.fromEntries(
      persistentSettings.map(({ key, toJSON }) => [
        key,
        toJSON?.(this.fontOverviewSettings[key]) || this.fontOverviewSettings[key],
      ])
    );
    writeObjectToURLFragment(viewInfo);
  }

  _updateGlyphItemList() {
    this._glyphItemList = this.glyphOrganizer.sortGlyphs(
      glyphMapToItemList(this.fontController.glyphMap)
    );
    this._updateGlyphSelection();
  }

  _updateGlyphSelection() {
    // We possibly need to be smarter about this:
    this.glyphCellView.parentElement.scrollTop = 0;

    const glyphItemList = this.glyphOrganizer.filterGlyphs(this._glyphItemList);
    const glyphSections = this.glyphOrganizer.groupGlyphs(glyphItemList);
    this.glyphCellView.setGlyphSections(glyphSections);
  }

  openSelectedGlyphs() {
    const selectedGlyphInfo = this.glyphCellView.getSelectedGlyphInfo();
    if (!selectedGlyphInfo.length) {
      return;
    }
    openGlyphsInEditor(
      selectedGlyphInfo,
      this.fontOverviewSettings.fontLocationUser,
      this.fontController.glyphMap
    );
  }

  handleKeyDown(event) {
    if (isActiveElementTypeable()) {
      // The cell area for sure doesn't have the focus
      return;
    }
    this.glyphCellView.handleKeyDown(event);

    const actionIdentifier = getActionIdentifierFromKeyEvent(event);
    if (actionIdentifier) {
      // this.sceneController.updateContextMenuState(null);
      event.preventDefault();
      event.stopImmediatePropagation();
      doPerformAction(actionIdentifier, event);
      return;
    }
  }

  handleRemoteClose(event) {
    //
  }

  handleRemoteError(event) {
    //
  }

  initContextMenuItems() {
    // TODO: Implement the actions + how to handle them?
    this.basicContextMenuItems.push({
      actionIdentifier: "action.undo",
    });
    this.basicContextMenuItems.push({
      actionIdentifier: "action.redo",
    });
  }

  initActions() {
    {
      const topic = "0030-action-topics.menu.edit";

      registerAction(
        "action.undo",
        {
          topic,
          sortIndex: 0,
          defaultShortCuts: [{ baseKey: "z", commandKey: true, shiftKey: false }],
        },
        () => this.doUndoRedo(false),
        () => this.canUndoRedo(false)
      );

      registerAction(
        "action.redo",
        {
          topic,
          defaultShortCuts: [{ baseKey: "z", commandKey: true, shiftKey: true }],
        },
        () => this.doUndoRedo(true),
        () => this.canUndoRedo(true)
      );
    }
    {
      const topic = "0020-action-topics.menu.view";

      registerAction(
        "action.zoom-in",
        {
          topic,
          titleKey: "zoom-in",
          defaultShortCuts: [
            { baseKey: "+", commandKey: true },
            { baseKey: "=", commandKey: true },
          ],
          allowGlobalOverride: true,
        },
        () => this.zoomIn()
      );

      registerAction(
        "action.zoom-out",
        {
          topic,
          titleKey: "zoom-out",
          defaultShortCuts: [{ baseKey: "-", commandKey: true }],
          allowGlobalOverride: true,
        },
        () => this.zoomOut()
      );
    }
    {
      const topic = "0035-action-topics.menu.glyph";
      registerAction("action.glyph.duplicate", { topic }, () => this.duplicateGlyph());
      registerAction("action.glyph.delete", { topic }, () => this.deleteGlyphs());
    }
  }

  async canUndoRedo(isRedo) {
    // TODO: Do we really need this here? Or is it always true anyway?
    return true;
  }

  async doUndoRedo(isRedo) {
    // TODO: Implement the undo/redo functionality.
    console.log(isRedo ? "redo" : "undo");
  }

  async zoomIn() {
    console.log("font overview zoom in");
  }

  async zoomOut() {
    console.log("font overview zoom out");
  }

  async duplicateGlyph() {
    // TODO: See doCopy and doPaste
    console.log("duplicate glyph");
  }

  async deleteGlyphs() {
    // TODO: delete one or more glyphs, based on selection. See _deleteCurrentGlyph(event)
    console.log("delete glyphs");
  }
}

function openGlyphsInEditor(glyphsInfo, userLocation, glyphMap) {
  const url = new URL(window.location);
  url.pathname = url.pathname.replace("/fontoverview/", "/editor/");

  const viewInfo = {
    location: userLocation,
    text: "",
  };

  if (glyphsInfo.length === 1) {
    viewInfo.selectedGlyph = {
      lineIndex: 0,
      glyphIndex: 0,
      isEditing: glyphsInfo[0].glyphName in glyphMap,
    };
  }

  for (const { glyphName, codePoints } of glyphsInfo) {
    if (codePoints.length) {
      viewInfo.text +=
        0x002f === codePoints[0] ? "//" : String.fromCodePoint(codePoints[0]);
    } else {
      viewInfo.text += `/${glyphName}`;
    }
  }

  url.hash = dumpURLFragment(viewInfo);
  window.open(url.toString());
}
