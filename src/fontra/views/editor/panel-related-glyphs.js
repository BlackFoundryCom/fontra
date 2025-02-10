import Panel from "./panel.js";
import { getCodePointFromGlyphName, getSuggestedGlyphName } from "/core/glyph-data.js";
import * as html from "/core/html-utils.js";
import { translate } from "/core/localization.js";
import { unicodeMadeOf, unicodeUsedBy } from "/core/unicode-utils.js";

import { getCharFromCodePoint, throttleCalls } from "/core/utils.js";
import { GlyphCellView } from "/web-components/glyph-cell-view.js";
import { GlyphCell } from "/web-components/glyph-cell.js";
import { showMenu } from "/web-components/menu-panel.js";

export default class RelatedGlyphPanel extends Panel {
  identifier = "related-glyphs";
  iconPath = "/tabler-icons/binary-tree-2.svg";

  static styles = `
    glyph-cell-view {
      flex: 1;
      overflow: hidden;
      height: 100%;
    }

    .related-glyphs-section {
      height: 100%;
      display: flex;
      gap: 1em;
      flex-direction: column;
    }

    .no-related-glyphs {
      color: #999;
      padding-top: 1em;
    }
  `;

  constructor(editorController) {
    super(editorController);
    this.throttledUpdate = throttleCalls((senderID) => this.update(senderID), 100);
    this.fontController = this.editorController.fontController;
    this.sceneController = this.editorController.sceneController;

    this.setupGlyphRelationshipsElement();

    this.sceneController.sceneSettingsController.addKeyListener(
      ["selectedGlyphName"],
      (event) => this.throttledUpdate()
    );

    this.fontController.addChangeListener({ glyphMap: null }, (event) =>
      this.throttledUpdate()
    );
  }

  getContentElement() {
    this.glyphCellView = new GlyphCellView(
      this.editorController.fontController,
      this.editorController.sceneSettingsController,
      { glyphSelectionKey: "relatedGlyphsGlyphSelection" }
    );

    this.glyphCellView.onOpenSelectedGlyphs = (event) => this.openSelectedGlyphs(event);

    this.glyphCellView.onCellContextMenu = (event, glyphCell) =>
      this.handleContextMenu(event, glyphCell);

    this.glyphCellView.onNoGlyphsToDisplay = () => {
      this.relatedGlyphsHeaderElement.appendChild(
        html.div({ class: "no-related-glyphs" }, [
          translate(
            "sidebar.related-glyphs.no-related-glyphs-or-characters-were-found"
          ),
        ])
      );
    };

    return html.div(
      {
        class: "panel",
      },
      [
        html.div(
          {
            class: "panel-section panel-section--flex related-glyphs-section",
          },
          [
            html.div({ id: "related-glyphs-header" }, [
              translate("sidebar.related-glyphs.related-glyphs"),
            ]),
            this.glyphCellView,
          ]
        ),
      ]
    );
  }

  setupGlyphRelationshipsElement() {
    this.relatedGlyphsHeaderElement = this.contentElement.querySelector(
      "#related-glyphs-header"
    );
  }

  async update() {
    const glyphName = this.sceneController.sceneSettings.selectedGlyphName;
    const character = glyphName
      ? getCharFromCodePoint(
          this.fontController.codePointForGlyph(glyphName) ||
            getCodePointFromGlyphName(glyphName)
        ) || ""
      : "";
    const codePoint = character ? character.codePointAt(0) : undefined;

    const varGlyphController =
      await this.sceneController.sceneModel.getSelectedVariableGlyphController();
    const varGlyph = varGlyphController?.glyph;

    const displayGlyphString =
      character && character != glyphName ? `“${character}”, ${glyphName}` : glyphName;

    this.relatedGlyphsHeaderElement.innerHTML = glyphName
      ? `<b>${translate("sidebar.related-glyphs.title", displayGlyphString)}</b>`
      : `<b>${translate("sidebar.related-glyphs")}</b>`;

    if (glyphName) {
      const sectionDefinitions = [
        {
          labelKey: "sidebar.related-glyphs.alternate-glyphs",
          getRelatedGlyphsFunc: getRelatedGlyphsByExtension,
        },
        {
          labelKey: "sidebar.related-glyphs.components-used-by-this-glyph",
          getRelatedGlyphsFunc: getComponentGlyphs,
        },
        {
          labelKey: "sidebar.related-glyphs.glyphs-using-this-glyph-as-a-component",
          getRelatedGlyphsFunc: getUsedByGlyphs,
        },
        {
          labelKey: "sidebar.related-glyphs.character-decomposition",
          getRelatedGlyphsFunc: getUnicodeDecomposed,
        },
        {
          labelKey: "sidebar.related-glyphs.character-decompose-with-character",
          getRelatedGlyphsFunc: getUnicodeUsedBy,
        },
      ];

      const sections = sectionDefinitions.map(({ labelKey, getRelatedGlyphsFunc }) => ({
        label: translate(labelKey),
        glyphs: getRelatedGlyphsFunc(this.fontController, glyphName, codePoint),
      }));
      this.glyphCellView.setGlyphSections(sections, true);
    } else {
      this.glyphCellView.setGlyphSections([], true);

      this.relatedGlyphsHeaderElement.appendChild(
        html.div({ class: "no-related-glyphs" }, [
          translate("sidebar.related-glyphs.no-glyph-selected"),
        ])
      );
    }
  }

  openSelectedGlyphs(event) {
    const selectedGlyphInfo = this.glyphCellView.getSelectedGlyphInfo(true);
    if (!selectedGlyphInfo.length) {
      return;
    }
    this.insertGlyphIntoTextString(
      selectedGlyphInfo,
      event.altKey ? 1 : 0,
      !event.altKey
    );
  }

  insertGlyphIntoTextString(selectedGlyphInfo, where, select) {
    const glyphInfos = selectedGlyphInfo.map((glyphInfo) => ({
      glyphName: glyphInfo.glyphName,
      character: getCharFromCodePoint(glyphInfo.codePoints[0]),
    }));
    this.editorController.insertGlyphInfos(glyphInfos, where, select);
  }

  handleContextMenu(event, glyphCell) {
    event.preventDefault();

    const selectedGlyphInfo = this.glyphCellView.getSelectedGlyphInfo(true);
    if (!selectedGlyphInfo.length) {
      return;
    }

    const items = [
      {
        title: translate("sidebar.related-glyphs.replace-selected-glyph"),
        callback: () => {
          this.insertGlyphIntoTextString(selectedGlyphInfo, 0, true);
        },
      },
      {
        title: translate("sidebar.related-glyphs.insert-after-selected-glyph"),
        callback: () => {
          this.insertGlyphIntoTextString(selectedGlyphInfo, 1, false);
        },
      },
      {
        title: translate(
          "sidebar.related-glyphs.insert-after-selected-glyph-and-select"
        ),
        callback: () => {
          this.insertGlyphIntoTextString(selectedGlyphInfo, 1, true);
        },
      },
      {
        title: translate("sidebar.related-glyphs.insert-before-selected-glyph"),
        callback: () => {
          this.insertGlyphIntoTextString(selectedGlyphInfo, -1, false);
        },
      },
      {
        title: translate(
          "sidebar.related-glyphs.insert-before-selected-glyph-and-select"
        ),
        callback: () => {
          this.insertGlyphIntoTextString(selectedGlyphInfo, -1, true);
        },
      },
    ];
    const { x, y } = event;
    showMenu(items, { x: x + 1, y: y - 1 });
  }

  async toggle(on, focus) {
    if (on) {
      this.update();
    }
  }
}

function getRelatedGlyphsByExtension(fontController, targetGlyphName, targetCodePoint) {
  const targetBaseGlyphName = targetGlyphName.split(".")[0];
  const glyphNames = Object.keys(fontController.glyphMap)
    .filter((glyphName) => {
      const baseGlyphName = glyphName.split(".")[0];
      return baseGlyphName == targetBaseGlyphName && glyphName != targetGlyphName;
    })
    .sort();
  return addCharInfo(fontController, glyphNames);
}

async function getComponentGlyphs(fontController, targetGlyphName, targetCodePoint) {
  const varGlyph = await fontController.getGlyph(targetGlyphName);
  const componentNames = [...(varGlyph?.getAllComponentNames() || [])];
  componentNames.sort();

  return addCharInfo(fontController, componentNames);
}

async function getUsedByGlyphs(fontController, targetGlyphName, targetCodePoint) {
  const glyphNames = await fontController.findGlyphsThatUseGlyph(targetGlyphName);
  return addCharInfo(fontController, glyphNames);
}

async function getUnicodeDecomposed(fontController, targetGlyphName, targetCodePoint) {
  return await _getRelatedUnicode(
    fontController,
    targetGlyphName,
    targetCodePoint,
    unicodeMadeOf
  );
}

async function getUnicodeUsedBy(fontController, targetGlyphName, targetCodePoint) {
  return await _getRelatedUnicode(
    fontController,
    targetGlyphName,
    targetCodePoint,
    unicodeUsedBy
  );
}

async function _getRelatedUnicode(
  fontController,
  targetGlyphName,
  targetCodePoint,
  uniFunc
) {
  const codePoint =
    fontController.codePointForGlyph(targetGlyphName) || targetCodePoint;
  if (!codePoint) {
    return [];
  }
  const usedByCodePoints = uniFunc(codePoint);
  const glyphInfo = [];
  for (const codePoint of usedByCodePoints) {
    const glyphName =
      fontController.characterMap[codePoint] || getSuggestedGlyphName(codePoint);
    glyphInfo.push({ glyphName, codePoints: [codePoint] });
  }
  return glyphInfo;
}

function addCharInfo(fontController, glyphNames) {
  const glyphMap = fontController.glyphMap;
  return glyphNames.map((glyphName) => {
    return { glyphName, codePoints: glyphMap[glyphName] || [] };
  });
}

customElements.define("panel-related-glyph", RelatedGlyphPanel);
