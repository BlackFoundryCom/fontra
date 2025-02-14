import { difference, isSuperset, union } from "../core/set-ops.js";
import { subVectors } from "../core/vector.js";
import { translate } from "/core/localization.js";
import { rectToPoints } from "/core/rectangle.js";
import { decomposedToTransform } from "/core/transform.js";
import {
  chain,
  clamp,
  enumerate,
  makeUPlusStringFromCodePoint,
  parseSelection,
  rgbaToCSS,
  round,
  unionIndexSets,
  withSavedState,
} from "/core/utils.js";

export const visualizationLayerDefinitions = [];

export function registerVisualizationLayerDefinition(newLayerDef) {
  let index = 0;
  let layerDef;
  for (index = 0; index < visualizationLayerDefinitions.length; index++) {
    layerDef = visualizationLayerDefinitions[index];
    if (newLayerDef.zIndex < layerDef.zIndex) {
      break;
    }
  }
  visualizationLayerDefinitions.splice(index, 0, newLayerDef);
}

registerVisualizationLayerDefinition({
  identifier: "fontra.upm.grid",
  name: "sidebar.user-settings.glyph.upmgrid",
  selectionMode: "editing",
  userSwitchable: true,
  defaultOn: true,
  zIndex: 0,
  dontTranslate: true,
  screenParameters: { strokeWidth: 2 },
  colors: { strokeColor: "#FFF" },
  colorsDarkMode: { strokeColor: "#3C3C3C" },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    if (controller.magnification < 4) {
      return;
    }
    context.strokeStyle = parameters.strokeColor;
    context.lineWidth = parameters.strokeWidth;
    let { xMin, yMin, xMax, yMax } = controller.getViewBox();
    xMin -= positionedGlyph.x;
    xMax -= positionedGlyph.x;
    yMin -= positionedGlyph.y;
    yMax -= positionedGlyph.y;
    for (let x = Math.floor(xMin); x < Math.ceil(xMax); x++) {
      strokeLine(context, x, yMin, x, yMax);
    }
    for (let y = Math.floor(yMin); y < Math.ceil(yMax); y++) {
      strokeLine(context, xMin, y, xMax, y);
    }
  },
});

registerVisualizationLayerDefinition({
  identifier: "fontra.empty.selected.glyph",
  name: "Empty selected glyph",
  selectionMode: "selected",
  selectionFilter: (positionedGlyph) => positionedGlyph.isEmpty,
  zIndex: 200,
  colors: { fillColor: "#D8D8D8" /* Must be six hex digits */ },
  colorsDarkMode: { fillColor: "#585858" /* Must be six hex digits */ },
  draw: _drawEmptyGlyphLayer,
});

registerVisualizationLayerDefinition({
  identifier: "fontra.empty.hovered.glyph",
  name: "Empty hovered glyph",
  selectionMode: "hovered",
  selectionFilter: (positionedGlyph) => positionedGlyph.isEmpty,
  zIndex: 200,
  colors: { fillColor: "#E8E8E8" /* Must be six hex digits */ },
  colorsDarkMode: { fillColor: "#484848" /* Must be six hex digits */ },
  draw: _drawEmptyGlyphLayer,
});

function _drawEmptyGlyphLayer(context, positionedGlyph, parameters, model, controller) {
  const box = positionedGlyph.unpositionedBounds;
  const fillColor = parameters.fillColor;
  if (fillColor[0] === "#" && fillColor.length === 7) {
    const gradient = context.createLinearGradient(0, box.yMin, 0, box.yMax);
    gradient.addColorStop(0.0, fillColor + "00");
    gradient.addColorStop(0.2, fillColor + "DD");
    gradient.addColorStop(0.5, fillColor + "FF");
    gradient.addColorStop(0.8, fillColor + "DD");
    gradient.addColorStop(1.0, fillColor + "00");
    context.fillStyle = gradient;
  } else {
    context.fillStyle = fillColor;
  }
  context.fillRect(box.xMin, box.yMin, box.xMax - box.xMin, box.yMax - box.yMin);
}

registerVisualizationLayerDefinition({
  identifier: "fontra.context.glyphs",
  name: "Context glyphs",
  selectionMode: "unselected",
  zIndex: 200,
  colors: { fillColor: "#000", errorColor: "#AAA" },
  colorsDarkMode: { fillColor: "#FFF", errorColor: "#999" },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    context.fillStyle = positionedGlyph.glyph.errors?.length
      ? parameters.errorColor
      : parameters.fillColor;
    context.fill(positionedGlyph.glyph.flattenedPath2d);
  },
});

registerVisualizationLayerDefinition({
  identifier: "fontra.undefined.glyph",
  name: "Undefined glyph",
  selectionMode: "all",
  selectionFilter: (positionedGlyph) => positionedGlyph.isUndefined,
  zIndex: 500,
  colors: {
    fillColor: "#0006",
  },
  colorsDarkMode: {
    fillColor: "#FFF6",
  },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    context.fillStyle = parameters.fillColor;
    context.textAlign = "center";
    const lineDistance = 1.2;

    const glyphNameFontSize = 0.1 * positionedGlyph.glyph.xAdvance;
    const placeholderFontSize = 0.75 * positionedGlyph.glyph.xAdvance;
    context.font = `${glyphNameFontSize}px fontra-ui-regular, sans-serif`;
    context.scale(1, -1);
    context.fillText(positionedGlyph.glyphName, positionedGlyph.glyph.xAdvance / 2, 0);
    if (positionedGlyph.character) {
      const uniStr = makeUPlusStringFromCodePoint(
        positionedGlyph.character.codePointAt(0)
      );
      context.fillText(
        uniStr,
        positionedGlyph.glyph.xAdvance / 2,
        -lineDistance * glyphNameFontSize
      );
      context.font = `${placeholderFontSize}px fontra-ui-regular, sans-serif`;
      context.fillText(
        positionedGlyph.character,
        positionedGlyph.glyph.xAdvance / 2,
        -lineDistance * glyphNameFontSize - 0.4 * placeholderFontSize
      );
    }
  },
});

registerVisualizationLayerDefinition({
  identifier: "fontra.baseline",
  name: "sidebar.user-settings.glyph.baseline",
  selectionMode: "editing",
  userSwitchable: true,
  defaultOn: false,
  zIndex: 500,
  screenParameters: { strokeWidth: 1 },
  colors: { strokeColor: "#0004" },
  colorsDarkMode: { strokeColor: "#FFF6" },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    context.strokeStyle = parameters.strokeColor;
    context.lineWidth = parameters.strokeWidth;
    strokeLine(context, 0, 0, positionedGlyph.glyph.xAdvance, 0);
  },
});

registerVisualizationLayerDefinition({
  identifier: "fontra.lineMetrics",
  name: "sidebar.user-settings.line-metrics",
  selectionMode: "editing",
  userSwitchable: true,
  defaultOn: true,
  zIndex: 100,
  screenParameters: { strokeWidth: 1 },
  colors: {
    strokeColor: "#0004",
    zoneColor: "#00BFFF18",
    zoneStrokeColor: "#00608018",
  },
  colorsDarkMode: {
    strokeColor: "#FFF6",
    zoneColor: "#00BFFF18",
    zoneStrokeColor: "#80DFFF18",
  },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    context.lineWidth = parameters.strokeWidth;

    if (!model.fontSourceInstance) {
      return;
    }
    const lineMetrics = model.fontSourceInstance.lineMetricsHorizontalLayout;
    const glyphWidth = positionedGlyph.glyph.xAdvance
      ? positionedGlyph.glyph.xAdvance
      : 0;

    // glyph box
    const pathBox = new Path2D();
    if (lineMetrics.ascender && lineMetrics.descender) {
      pathBox.rect(
        0,
        lineMetrics.descender.value,
        positionedGlyph.glyph.xAdvance,
        lineMetrics.ascender.value - lineMetrics.descender.value
      );
    }

    // collect paths: vertical metrics and alignment zones
    const zoneFillPaths = [];
    const zoneEndStrokes = new Path2D();
    for (const [key, metric] of Object.entries(lineMetrics)) {
      if (metric.zone) {
        const pathZone = new Path2D();
        pathZone.rect(0, metric.value, glyphWidth, metric.zone);
        zoneFillPaths.push(pathZone);
        const zoneY = metric.value + metric.zone;
        zoneEndStrokes.moveTo(0, zoneY);
        zoneEndStrokes.lineTo(glyphWidth, zoneY);
      }

      const pathMetric = new Path2D();
      pathMetric.moveTo(0, metric.value);
      pathMetric.lineTo(glyphWidth, metric.value);
      pathBox.addPath(pathMetric);
    }

    // draw zones (with filled path)
    context.fillStyle = parameters.zoneColor;
    zoneFillPaths.forEach((zonePath) => context.fill(zonePath));

    // draw zone top/bottom terminating stroke
    context.strokeStyle = parameters.zoneStrokeColor;
    context.stroke(zoneEndStrokes);

    // draw glyph box + vertical metrics (with stroke path)
    context.strokeStyle = parameters.strokeColor;
    context.stroke(pathBox);
  },
});

// the following icon SVG path code is from https://tabler.io/icons/icon/lock
const lockIconPath2D = new Path2D(
  `M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6z
  M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0 M8 11v-4a4 4 0 1 1 8 0v4`
);

registerVisualizationLayerDefinition({
  identifier: "fontra.glyph.locking",
  name: "Glyph locking",
  selectionMode: "editing",
  zIndex: 700,
  screenParameters: { iconSize: 19 },
  colors: { strokeColor: "#000C" },
  colorsDarkMode: { strokeColor: "#FFFC" },
  draw: _drawGlyphLockIcon,
});

registerVisualizationLayerDefinition({
  identifier: "fontra.glyph.locking.non-editing",
  name: "sidebar.user-settings.glyph.lockicon",
  selectionMode: "notediting",
  userSwitchable: true,
  zIndex: 700,
  screenParameters: { iconSize: 19 },
  colors: { strokeColor: "#000C" },
  colorsDarkMode: { strokeColor: "#FFFC" },
  selectionFilter: (positionedGlyph) => !positionedGlyph.isUndefined,
  draw: _drawGlyphLockIcon,
});

function _drawGlyphLockIcon(context, positionedGlyph, parameters, model, controller) {
  if (
    !!positionedGlyph.varGlyph?.glyph.customData["fontra.glyph.locked"] ||
    model.fontController.readOnly
  ) {
    const boundsYMin = positionedGlyph.glyph.controlBounds?.yMin || 0;
    _drawLockIcon(
      context,
      positionedGlyph.glyph.xAdvance / 2 - parameters.iconSize / 2,
      boundsYMin - 24,
      parameters.strokeColor,
      parameters.iconSize
    );
  }
}

registerVisualizationLayerDefinition({
  identifier: "fontra.anchors",
  name: "Anchors",
  selectionMode: "editing",
  zIndex: 500,
  screenParameters: {
    strokeWidth: 1,
    originMarkerRadius: 4,
  },
  colors: { strokeColor: "#0006" },
  colorsDarkMode: { strokeColor: "#FFF8" },

  draw: (context, positionedGlyph, parameters, model, controller) => {
    context.strokeStyle = parameters.strokeColor;
    context.lineWidth = parameters.strokeWidth;
    for (const anchor of positionedGlyph.glyph.anchors) {
      strokeCircle(context, anchor.x, anchor.y, parameters.originMarkerRadius);
    }
  },
});

registerVisualizationLayerDefinition({
  identifier: "fontra.selected.anchors",
  name: "Selected anchors",
  selectionMode: "editing",
  zIndex: 500,
  screenParameters: {
    smoothSize: 8,
    strokeWidth: 1,
    hoverStrokeOffset: 4,
    underlayOffset: 2,
  },
  colors: { hoveredColor: "#BBB", selectedColor: "#000", underColor: "#FFFA" },
  colorsDarkMode: { hoveredColor: "#BBB", selectedColor: "#FFF", underColor: "#0008" },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    const glyph = positionedGlyph.glyph;
    const smoothSize = parameters.smoothSize;

    const { anchor: hoveredAnchorIndices } = parseSelection(model.hoverSelection);
    const { anchor: selectedAnchorIndices } = parseSelection(model.selection);

    // Under layer
    context.fillStyle = parameters.underColor;
    for (const anchorIndex of selectedAnchorIndices || []) {
      const anchor = glyph.anchors[anchorIndex];
      if (!anchor) {
        continue;
      }
      fillRoundNode(context, anchor, smoothSize + parameters.underlayOffset);
    }

    // Selected anchor
    context.fillStyle = parameters.selectedColor;
    for (const anchorIndex of selectedAnchorIndices || []) {
      const anchor = glyph.anchors[anchorIndex];
      if (!anchor) {
        continue;
      }
      fillRoundNode(context, anchor, smoothSize);
    }

    // Hovered anchor
    context.strokeStyle = parameters.hoveredColor;
    context.lineWidth = parameters.strokeWidth;
    for (const anchorIndex of hoveredAnchorIndices || []) {
      const anchor = glyph.anchors[anchorIndex];
      if (!anchor) {
        continue;
      }
      strokeRoundNode(context, anchor, smoothSize + parameters.hoverStrokeOffset);
    }
  },
});

registerVisualizationLayerDefinition({
  identifier: "fontra.anchor.names",
  name: "sidebar.user-settings.glyph.anchornames",
  selectionMode: "editing",
  userSwitchable: true,
  defaultOn: true,
  zIndex: 600,
  screenParameters: { fontSize: 11 },
  colors: { boxColor: "#FFFB", color: "#000" },
  colorsDarkMode: { boxColor: "#1118", color: "#FFF" },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    const fontSize = parameters.fontSize;

    const margin = 0.5 * fontSize;
    const boxHeight = 1.68 * fontSize;
    const bottomY = 0.75 * fontSize * -1 - boxHeight + margin;

    context.font = `${fontSize}px fontra-ui-regular, sans-serif`;
    context.textAlign = "center";
    context.scale(1, -1);

    for (const anchor of positionedGlyph.glyph.anchors) {
      const pt = { x: anchor.x, y: anchor.y };

      const strLine = `${anchor.name}`;
      const width = Math.max(context.measureText(strLine).width) + 2 * margin;

      context.fillStyle = parameters.boxColor;
      drawRoundRect(
        context,
        pt.x - width / 2,
        -pt.y - bottomY + margin,
        width,
        -boxHeight / 2 - 2 * margin,
        boxHeight / 4 // corner radius
      );

      context.fillStyle = parameters.color;
      context.fillText(strLine, pt.x, -pt.y - bottomY);
    }
  },
});

registerVisualizationLayerDefinition({
  identifier: "fontra.background-image",
  name: "sidebar.user-settings.glyph.background-image",
  selectionMode: "editing",
  userSwitchable: true,
  defaultOn: true,
  zIndex: 50,
  screenParameters: {
    strokeWidth: 2,
  },
  colors: { strokeColor: "#888", hoverStrokeColor: "#8885" },
  colorsDarkMode: { strokeColor: "#FFF", hoverStrokeColor: "#FFF5" },

  draw: (context, positionedGlyph, parameters, model, controller) => {
    const backgroundImage = positionedGlyph.glyph.backgroundImage;
    if (!backgroundImage) {
      return;
    }

    const image = model.fontController.getBackgroundImageColorizedCached(
      backgroundImage.identifier,
      backgroundImage.color
        ? rgbaToCSS([
            backgroundImage.color.red,
            backgroundImage.color.green,
            backgroundImage.color.blue,
          ])
        : null,
      () => controller.requestUpdate()
    );

    if (!image) {
      return;
    }

    const affine = decomposedToTransform(backgroundImage.transformation)
      .translate(0, image.height)
      .scale(1, -1);

    withSavedState(context, () => {
      context.transform(
        affine.xx,
        affine.xy,
        affine.yx,
        affine.yy,
        affine.dx,
        affine.dy
      );
      // if (backgroundImage.color) {
      //   // TODO: solve colorizing with backgroundImage.color
      // }
      context.globalAlpha = backgroundImage.opacity;
      context.drawImage(image, 0, 0, image.width, image.height);
    });

    const backgroundImageBounds = {
      xMin: 0,
      yMin: 0,
      xMax: image.width,
      yMax: image.height,
    };
    const rectPoly = rectToPoints(backgroundImageBounds);
    const polygon = rectPoly.map((point) => affine.transformPointObject(point));

    const isSelected = model.selection.has("backgroundImage/0");
    const isHovered = model.hoverSelection.has("backgroundImage/0");

    if (isSelected || isHovered) {
      context.strokeStyle =
        isHovered && !isSelected ? parameters.hoverStrokeColor : parameters.strokeColor;
      context.lineWidth = parameters.strokeWidth;
      context.lineJoin = "round";
      strokePolygon(context, polygon);
    }
  },
});

registerVisualizationLayerDefinition({
  identifier: "fontra.guidelines",
  name: "sidebar.user-settings.guidelines",
  selectionMode: "editing",
  userSwitchable: true,
  defaultOn: true,
  zIndex: 500,
  screenParameters: {
    fontSize: 10,
    strokeWidth: 1,
    originMarkerRadius: 4,
    strokeDash: 3,
    margin: 5,
    iconSize: 12,
  },
  colors: {
    strokeColor: "#0006",
    strokeColorFontGuideline: "#00BFFF",
  },
  colorsDarkMode: {
    strokeColor: "#FFF8",
    strokeColorFontGuideline: "#00BFFFC0",
  },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    context.font = `${parameters.fontSize}px fontra-ui-regular, sans-serif`;
    context.textAlign = "center";
    const { xMin, yMin, xMax, yMax } = controller.getViewBox();
    parameters.strokeLength = Math.max(
      Math.sqrt((xMax - xMin) ** 2 + (yMax - yMin) ** 2),
      2000
    );

    // Draw glyph guidelines
    for (const guideline of positionedGlyph.glyph.guidelines) {
      _drawGuideline(context, parameters, guideline, parameters.strokeColor);
    }

    // Draw font guidelines
    if (!model.fontSourceInstance) {
      return;
    }
    for (const guideline of model.fontSourceInstance.guidelines) {
      _drawGuideline(
        context,
        parameters,
        guideline,
        parameters.strokeColorFontGuideline
      );
    }
  },
});

function _drawGuideline(context, parameters, guideline, strokeColor) {
  withSavedState(context, () => {
    context.strokeStyle = strokeColor;
    context.lineWidth = parameters.strokeWidth;
    //translate to guideline origin
    context.translate(guideline.x, guideline.y);

    //draw lock icon or the "node"
    if (guideline.locked) {
      _drawLockIcon(
        context,
        -parameters.iconSize / 2,
        parameters.iconSize / 2,
        strokeColor,
        parameters.iconSize
      );
    } else {
      strokeCircle(context, 0, 0, parameters.originMarkerRadius);
    }

    withSavedState(context, () => {
      context.rotate((guideline.angle * Math.PI) / 180);
      context.scale(1, -1);

      let textWidth;
      let moveText;
      const halfMarker = parameters.originMarkerRadius / 2 + parameters.strokeWidth * 2;
      // draw name
      if (guideline.name) {
        const strLine = `${guideline.name}`;
        textWidth = Math.max(context.measureText(strLine).width);
        const textVerticalCenter = Math.max(getTextVerticalCenter(context, strLine));

        context.fillStyle = strokeColor;
        moveText =
          0 - // this is centered to the guideline origin
          textWidth / 2 - // move half width left -> right aligned to origin
          halfMarker - // move half of the marker radius left + stroke width
          parameters.margin * // move one margin to left to get a short line on the left
            2; // move another margin left to get the margin on the right
        context.fillText(strLine, moveText, textVerticalCenter);
      }

      // collect lines
      let lines = [[halfMarker, parameters.strokeLength]];
      if (guideline.name !== undefined && guideline.name.trim() !== "") {
        // with name
        lines.push([
          -textWidth / 2 + moveText - parameters.margin,
          -parameters.strokeLength,
        ]);
        lines.push([-parameters.margin * 2, -halfMarker]);
      } else {
        // without name
        lines.push([-halfMarker, -parameters.strokeLength]);
      }
      // draw lines
      for (const [x1, x2] of lines) {
        strokeLineDashed(context, x1, 0, x2, 0, [
          parameters.strokeDash * 2,
          parameters.strokeDash,
        ]);
      }
    });
  });
}

registerVisualizationLayerDefinition({
  identifier: "fontra.selected.guidelines",
  name: "Selected guidelines",
  selectionMode: "editing",
  zIndex: 500,
  screenParameters: {
    smoothSize: 8,
    strokeWidth: 1,
    hoverStrokeOffset: 4,
    underlayOffset: 2,
    iconSize: 12,
  },
  colors: {
    hoveredColorIcon: "#0006",
    hoveredColor: "#BBB",
    selectedColor: "#000",
    underColor: "#FFFA",
    underColorIcon: "#f6f6f6",
  },
  colorsDarkMode: {
    hoveredColorIcon: "#BBB",
    hoveredColor: "#BBB",
    selectedColor: "#FFF",
    underColor: "#0008",
    underColorIcon: "#333",
  },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    const glyph = positionedGlyph.glyph;
    const smoothSize = parameters.smoothSize;

    const {
      guideline: hoveredGuidelineIndices,
      fontGuideline: hoveredFontGuidelineIndices,
    } = parseSelection(model.hoverSelection);
    const {
      guideline: selectedGuidelineIndices,
      fontGuideline: selectedFontGuidelineIndices,
    } = parseSelection(model.selection);

    // TODO: Font Guidelines

    // Under layer
    context.fillStyle = parameters.underColor;
    for (const i of selectedGuidelineIndices || []) {
      const guideline = glyph.guidelines[i];
      if (!guideline) {
        continue;
      }
      if (guideline.locked) {
        _drawLockIcon(
          context,
          guideline.x - parameters.iconSize / 2,
          guideline.y + parameters.iconSize / 2,
          parameters.strokeColor,
          parameters.iconSize
        );
      } else {
        fillRoundNode(context, guideline, smoothSize + parameters.underlayOffset);
      }
    }

    // Hovered guideline
    context.strokeStyle = parameters.hoveredColor;
    context.lineWidth = parameters.strokeWidth;
    for (const i of hoveredGuidelineIndices || []) {
      const guideline = glyph.guidelines[i];
      if (!guideline) {
        continue;
      }
      if (guideline.locked) {
        const drawIcons = [
          [parameters.hoveredColor, 11],
          [parameters.underColorIcon, 7],
          [parameters.hoveredColorIcon, 2],
        ];
        for (const [color, strokeSize] of drawIcons) {
          _drawLockIcon(
            context,
            guideline.x - parameters.iconSize / 2,
            guideline.y + parameters.iconSize / 2,
            color,
            parameters.iconSize,
            strokeSize
          );
        }
      } else {
        strokeRoundNode(context, guideline, smoothSize + parameters.hoverStrokeOffset);
      }
    }

    // Selected guideline
    context.fillStyle = parameters.selectedColor;
    for (const i of selectedGuidelineIndices || []) {
      const guideline = glyph.guidelines[i];
      if (!guideline) {
        continue;
      }
      if (guideline.locked) {
        _drawLockIcon(
          context,
          guideline.x - parameters.iconSize / 2,
          guideline.y + parameters.iconSize / 2,
          parameters.selectedColor,
          parameters.iconSize
        );
      } else {
        fillRoundNode(context, guideline, smoothSize);
      }
    }
  },
});

function _drawLockIcon(context, x, y, strokeColor, iconSize, lineWidth = 2) {
  withSavedState(context, () => {
    context.translate(x, y);
    context.scale(iconSize / 24, (-1 * iconSize) / 24);
    context.lineWidth = lineWidth;
    context.strokeStyle = strokeColor;
    context.stroke(lockIconPath2D);
  });
}

registerVisualizationLayerDefinition({
  identifier: "fontra.sidebearings.unselected",
  name: "sidebar.user-settings.glyph.sidebearings",
  selectionMode: "notediting",
  userSwitchable: true,
  defaultOn: false,
  zIndex: 190,
  screenParameters: { strokeWidth: 1, extent: 16 },
  colors: { strokeColor: "#0004" },
  colorsDarkMode: { strokeColor: "#FFF6" },
  draw: _drawMiniSideBearings,
});

registerVisualizationLayerDefinition({
  identifier: "fontra.sidebearings",
  name: "Sidebearings",
  selectionMode: "editing",
  zIndex: 500,
  screenParameters: { strokeWidth: 1, extent: 16 },
  colors: { strokeColor: "#0004" },
  colorsDarkMode: { strokeColor: "#FFF6" },
  draw: _drawMiniSideBearings,
});

function _drawMiniSideBearings(
  context,
  positionedGlyph,
  parameters,
  model,
  controller
) {
  const glyph = positionedGlyph.glyph;
  context.strokeStyle = parameters.strokeColor;
  context.lineWidth = parameters.strokeWidth;
  const extent = parameters.extent;
  strokeLine(context, 0, -extent, 0, extent);
  strokeLine(context, glyph.xAdvance, -extent, glyph.xAdvance, extent);
  if (extent < glyph.xAdvance / 2) {
    strokeLine(context, 0, 0, extent, 0);
    strokeLine(context, glyph.xAdvance, 0, glyph.xAdvance - extent, 0);
  } else {
    strokeLine(context, 0, 0, glyph.xAdvance, 0);
  }
}

registerVisualizationLayerDefinition({
  identifier: "fontra.crosshair",
  name: "sidebar.user-settings.glyph.dragcrosshair",
  selectionMode: "editing",
  userSwitchable: true,
  defaultOn: false,
  zIndex: 500,
  screenParameters: { strokeWidth: 1, lineDash: [4, 4] },
  colors: { strokeColor: "#8888" },
  colorsDarkMode: { strokeColor: "#AAA8" },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    const pointIndex = model.initialClickedPointIndex;
    if (pointIndex === undefined) {
      return;
    }
    const { x, y } = positionedGlyph.glyph.path.getPoint(pointIndex);
    context.strokeStyle = parameters.strokeColor;
    context.lineWidth = parameters.strokeWidth;
    context.setLineDash(parameters.lineDash);
    const { xMin, yMin, xMax, yMax } = controller.getViewBox();
    const dx = -positionedGlyph.x;
    const dy = -positionedGlyph.y;
    strokeLine(context, x, yMin + dy, x, yMax + dy);
    strokeLine(context, xMin + dx, y, xMax + dx, y);
  },
});

registerVisualizationLayerDefinition({
  identifier: "fontra.ghostpath",
  name: "sidebar.user-settings.glyph.dragghostpath",
  selectionMode: "editing",
  userSwitchable: true,
  defaultOn: true,
  zIndex: 500,
  screenParameters: { strokeWidth: 1 },
  colors: { strokeColor: "#AAA6" },
  colorsDarkMode: { strokeColor: "#8886" },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    if (!model.ghostPath) {
      return;
    }
    context.lineJoin = "round";
    context.strokeStyle = parameters.strokeColor;
    context.lineWidth = parameters.strokeWidth;
    context.stroke(model.ghostPath);
  },
});

registerVisualizationLayerDefinition({
  identifier: "fontra.edit.path.fill",
  name: "Edit path fill",
  selectionMode: "editing",
  zIndex: 500,
  screenParameters: { strokeWidth: 1 },
  colors: { fillColor: "#0001" },
  colorsDarkMode: { fillColor: "#FFF3" },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    context.fillStyle = parameters.fillColor;
    context.fill(positionedGlyph.glyph.closedContoursPath2d);
  },
});

registerVisualizationLayerDefinition({
  identifier: "fontra.selected.glyph",
  name: "Selected glyph",
  selectionMode: "selected",
  selectionFilter: (positionedGlyph) => !positionedGlyph.isEmpty,
  zIndex: 200,
  screenParameters: { outerStrokeWidth: 10, innerStrokeWidth: 3 },
  colors: { fillColor: "#000", strokeColor: "#7778", errorColor: "#AAA" },
  colorsDarkMode: { fillColor: "#FFF", strokeColor: "#FFF8", errorColor: "#999" },
  draw: _drawSelectedGlyphLayer,
});

registerVisualizationLayerDefinition({
  identifier: "fontra.hovered.glyph",
  name: "Hovered glyph",
  selectionMode: "hovered",
  selectionFilter: (positionedGlyph) => !positionedGlyph.isEmpty,
  zIndex: 200,
  screenParameters: { outerStrokeWidth: 10, innerStrokeWidth: 3 },
  colors: { fillColor: "#000", strokeColor: "#BBB8", errorColor: "#AAA" },
  colorsDarkMode: { fillColor: "#FFF", strokeColor: "#CCC8", errorColor: "#999" },
  draw: _drawSelectedGlyphLayer,
});

function _drawSelectedGlyphLayer(context, positionedGlyph, parameters) {
  drawWithDoubleStroke(
    context,
    positionedGlyph.glyph.flattenedPath2d,
    parameters.outerStrokeWidth,
    parameters.innerStrokeWidth,
    parameters.strokeColor,
    positionedGlyph.glyph.errors?.length ? parameters.errorColor : parameters.fillColor
  );
}

registerVisualizationLayerDefinition({
  identifier: "fontra.component.selection",
  name: "Component selection",
  selectionMode: "editing",
  zIndex: 500,
  screenParameters: {
    hoveredStrokeWidth: 3,
    selectedStrokeWidth: 3,
    originMarkerStrokeWidth: 1,
    selectedOriginMarkerStrokeWidth: 2,
    originMarkerSize: 10,
    originMarkerRadius: 4,
  },
  colors: {
    hoveredStrokeColor: "#CCC",
    selectedStrokeColor: "#888",
    originMarkerColor: "#BBB",
    tCenterMarkerColor: "#777",
  },
  colorsDarkMode: {
    hoveredStrokeColor: "#666",
    selectedStrokeColor: "#AAA",
    originMarkerColor: "#BBB",
    tCenterMarkerColor: "#DDD",
  },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    const glyph = positionedGlyph.glyph;

    const selectedItems = parseComponentSelection(
      model.selection || new Set(),
      glyph.components.length
    );
    const hoveredItems = parseComponentSelection(
      model.hoverSelection || new Set(),
      glyph.components.length
    );

    selectedItems.component = union(
      union(selectedItems.component, selectedItems.componentOrigin),
      selectedItems.componentTCenter
    );

    hoveredItems.component = union(
      union(hoveredItems.component, hoveredItems.componentOrigin),
      hoveredItems.componentTCenter
    );

    hoveredItems.component = difference(
      hoveredItems.component,
      selectedItems.component
    );
    hoveredItems.componentOrigin = difference(
      hoveredItems.componentOrigin,
      selectedItems.componentOrigin
    );
    hoveredItems.componentTCenter = difference(
      hoveredItems.componentTCenter,
      selectedItems.componentTCenter
    );

    const relevantComponents = union(selectedItems.component, hoveredItems.component);

    const visibleMarkers = {
      componentOrigin: difference(
        difference(relevantComponents, selectedItems.componentOrigin),
        hoveredItems.componentOrigin
      ),
      componentTCenter: difference(
        difference(relevantComponents, selectedItems.componentTCenter),
        hoveredItems.componentTCenter
      ),
    };

    const hoveredParms = {
      color: parameters.hoveredStrokeColor,
      width: parameters.hoveredStrokeWidth,
    };
    const selectedParms = {
      color: parameters.selectedStrokeColor,
      width: parameters.selectedStrokeWidth,
    };

    context.lineJoin = "round";
    context.lineCap = "round";

    for (const [componentIndices, parms] of [
      [hoveredItems.component, hoveredParms],
      [selectedItems.component, selectedParms],
    ]) {
      for (const componentIndex of componentIndices) {
        const componentController = glyph.components[componentIndex];

        context.lineWidth = parms.width;
        context.strokeStyle = parms.color;
        context.stroke(componentController.path2d);
      }
    }

    const markerVisibleParms = {
      color: parameters.hoveredStrokeColor,
      width: parameters.originMarkerStrokeWidth,
    };
    const markerHoveredParms = {
      color: parameters.hoveredStrokeColor,
      width: parameters.selectedOriginMarkerStrokeWidth,
    };
    const markerSelectedParms = {
      color: parameters.selectedStrokeColor,
      width: parameters.selectedOriginMarkerStrokeWidth,
    };

    for (const [markers, parms] of [
      [visibleMarkers, markerVisibleParms],
      [hoveredItems, markerHoveredParms],
      [selectedItems, markerSelectedParms],
    ]) {
      // Component origin
      context.lineWidth = parms.width;
      context.strokeStyle = parameters.originMarkerColor;
      for (const componentIndex of markers.componentOrigin) {
        const componentController = glyph.components[componentIndex];
        const component = componentController.compo;

        const transformation = component.transformation;
        const [x, y] = [transformation.translateX, transformation.translateY];
        strokeLine(
          context,
          x - parameters.originMarkerSize,
          y,
          x + parameters.originMarkerSize,
          y
        );
        strokeLine(
          context,
          x,
          y - parameters.originMarkerSize,
          x,
          y + parameters.originMarkerSize
        );
      }

      // Component transformation center
      context.lineWidth = parms.width;
      context.strokeStyle = parameters.tCenterMarkerColor;
      for (const componentIndex of markers.componentTCenter) {
        const componentController = glyph.components[componentIndex];
        const component = componentController.compo;
        const transformation = component.transformation;

        const affine = decomposedToTransform(transformation);
        const [cx, cy] = affine.transformPoint(
          transformation.tCenterX,
          transformation.tCenterY
        );
        const pt1 = affine.transformPoint(
          transformation.tCenterX - parameters.originMarkerSize,
          transformation.tCenterY
        );
        const pt2 = affine.transformPoint(
          transformation.tCenterX + parameters.originMarkerSize,
          transformation.tCenterY
        );
        const pt3 = affine.transformPoint(
          transformation.tCenterX,
          transformation.tCenterY - parameters.originMarkerSize
        );
        const pt4 = affine.transformPoint(
          transformation.tCenterX,
          transformation.tCenterY + parameters.originMarkerSize
        );
        strokeLine(context, ...pt1, ...pt2);
        strokeLine(context, ...pt3, ...pt4);
        strokeCircle(context, cx, cy, parameters.originMarkerRadius);
      }
    }
  },
});

function parseComponentSelection(selection, numComponents) {
  const parsed = parseSelection(selection);
  const result = {};
  for (const prop of ["component", "componentOrigin", "componentTCenter"]) {
    result[prop] = new Set((parsed[prop] || []).filter((i) => i < numComponents));
  }
  return result;
}

const START_POINT_ARC_GAP_ANGLE = 0.25 * Math.PI;

registerVisualizationLayerDefinition({
  identifier: "fontra.startpoint.indicator",
  name: "Startpoint indicator",
  selectionMode: "editing",
  zIndex: 500,
  screenParameters: { radius: 9, strokeWidth: 2 },
  colors: { color: "#989898A0" },
  colorsDarkMode: { color: "#989898A0" },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    const glyph = positionedGlyph.glyph;
    context.strokeStyle = parameters.color;
    context.lineWidth = parameters.strokeWidth;
    const radius = parameters.radius;
    let startPointIndex = 0;
    for (const contourInfo of glyph.path.contourInfo) {
      const startPoint = glyph.path.getPoint(startPointIndex);
      let angle;
      if (startPointIndex < contourInfo.endPoint) {
        const nextPoint = glyph.path.getPoint(startPointIndex + 1);
        const direction = subVectors(nextPoint, startPoint);
        angle = Math.atan2(direction.y, direction.x);
      }
      let startAngle = 0;
      let endAngle = 2 * Math.PI;
      if (angle !== undefined) {
        startAngle += angle + START_POINT_ARC_GAP_ANGLE;
        endAngle += angle - START_POINT_ARC_GAP_ANGLE;
      }
      context.beginPath();
      context.arc(startPoint.x, startPoint.y, radius, startAngle, endAngle, false);
      context.stroke();
      startPointIndex = contourInfo.endPoint + 1;
    }
  },
});

registerVisualizationLayerDefinition({
  identifier: "fontra.contour.index",
  name: "sidebar.user-settings.glyph.contour",
  selectionMode: "editing",
  userSwitchable: true,
  defaultOn: false,
  zIndex: 600,
  screenParameters: { fontSize: 11 },
  colors: { boxColor: "#FFFB", color: "#000" },
  colorsDarkMode: { boxColor: "#1118", color: "#FFF" },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    const glyph = positionedGlyph.glyph;
    const fontSize = parameters.fontSize;

    const margin = 0.5 * fontSize;
    const boxHeight = 1.68 * fontSize;
    const bottomY = 0.75 * fontSize * -1 - boxHeight + margin / 2;

    context.font = `${fontSize}px fontra-ui-regular, sans-serif`;
    context.textAlign = "center";
    context.scale(1, -1);

    let startPointIndex = 0;

    for (const [contourIndex, contourInfo] of enumerate(glyph.path.contourInfo)) {
      const startPoint = glyph.path.getPoint(startPointIndex);

      const strLine = `${contourIndex}`;
      const width = Math.max(context.measureText(strLine).width) + 2 * margin;

      context.fillStyle = parameters.boxColor;
      drawRoundRect(
        context,
        startPoint.x - width / 2,
        -startPoint.y - bottomY + margin,
        width,
        -boxHeight / 2 - 2 * margin,
        boxHeight / 4 // corner radius
      );

      context.fillStyle = parameters.color;
      context.fillText(strLine, startPoint.x, -startPoint.y - bottomY);
      startPointIndex = contourInfo.endPoint + 1;
    }
  },
});

registerVisualizationLayerDefinition({
  identifier: "fontra.component.index",
  name: "sidebar.user-settings.glyph.component",
  selectionMode: "editing",
  userSwitchable: true,
  defaultOn: false,
  zIndex: 600,
  screenParameters: { fontSize: 11 },
  colors: { boxColor: "#FFFB", color: "#000" },
  colorsDarkMode: { boxColor: "#1118", color: "#FFF" },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    const glyph = positionedGlyph.glyph;
    const fontSize = parameters.fontSize;

    const margin = 0.5 * fontSize;
    const boxHeight = 1.68 * fontSize;
    const lineHeight = fontSize;
    const bottomY = -boxHeight / 2;

    context.font = `${fontSize}px fontra-ui-regular, sans-serif`;
    context.textAlign = "center";
    context.scale(1, -1);

    for (const [shapeIndex, componentController] of enumerate(glyph.components)) {
      const bounds = componentController.controlBounds;
      if (!bounds) {
        // Shouldn't happen due to the "empty base glyph placeholder",
        // a.k.a. makeEmptyComponentPlaceholderGlyph(), but let's be safe.
        continue;
      }
      const pt = {
        x: (bounds.xMax - bounds.xMin) / 2 + bounds.xMin,
        y: (bounds.yMax - bounds.yMin) / 2 + bounds.yMin,
      };

      const strLine1 = `${componentController.compo.name}`;
      const strLine2 = `${shapeIndex}`;
      const width =
        Math.max(
          context.measureText(strLine1).width,
          context.measureText(strLine2).width
        ) +
        2 * margin;
      context.fillStyle = parameters.boxColor;
      drawRoundRect(
        context,
        pt.x - width / 2,
        -pt.y - bottomY + margin,
        width,
        -boxHeight - 2 * margin,
        boxHeight / 4 // corner radius
      );

      context.fillStyle = parameters.color;
      context.fillText(strLine1, pt.x, -pt.y - bottomY - lineHeight);
      context.fillText(strLine2, pt.x, -pt.y - bottomY);
    }
  },
});

registerVisualizationLayerDefinition({
  identifier: "fontra.component.nodes",
  name: "sidebar.user-settings.component.nodes",
  selectionMode: "editing",
  userSwitchable: true,
  defaultOn: false,
  zIndex: 450,
  screenParameters: {
    cornerSize: 8,
    smoothSize: 8,
    handleSize: 6.5,
    strokeWidth: 1,
  },
  colors: { color: "#BBB5" },
  colorsDarkMode: { color: "#8885" },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    const glyph = positionedGlyph.glyph;
    const cornerSize = parameters.cornerSize;
    const smoothSize = parameters.smoothSize;
    const handleSize = parameters.handleSize;

    context.strokeStyle = parameters.color;
    context.lineWidth = parameters.strokeWidth;
    for (const [pt1, pt2] of glyph.componentsPath.iterHandles()) {
      strokeLine(context, pt1.x, pt1.y, pt2.x, pt2.y);
    }

    context.fillStyle = parameters.color;
    for (const pt of glyph.componentsPath.iterPoints()) {
      fillNode(context, pt, cornerSize, smoothSize, handleSize);
    }
  },
});

registerVisualizationLayerDefinition({
  identifier: "fontra.handles",
  name: "Bezier handles",
  selectionMode: "editing",
  zIndex: 500,
  screenParameters: { strokeWidth: 1 },
  colors: { color: "#BBB" },
  colorsDarkMode: { color: "#777" },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    const glyph = positionedGlyph.glyph;
    context.strokeStyle = parameters.color;
    context.lineWidth = parameters.strokeWidth;
    for (const [pt1, pt2] of glyph.path.iterHandles()) {
      strokeLine(context, pt1.x, pt1.y, pt2.x, pt2.y);
    }
  },
});

registerVisualizationLayerDefinition({
  identifier: "fontra.nodes",
  name: "Nodes",
  selectionMode: "editing",
  zIndex: 500,
  screenParameters: { cornerSize: 8, smoothSize: 8, handleSize: 6.5 },
  colors: { color: "#BBB" },
  colorsDarkMode: { color: "#BBB" },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    const glyph = positionedGlyph.glyph;
    const cornerSize = parameters.cornerSize;
    const smoothSize = parameters.smoothSize;
    const handleSize = parameters.handleSize;

    context.fillStyle = parameters.color;
    for (const pt of glyph.path.iterPoints()) {
      fillNode(context, pt, cornerSize, smoothSize, handleSize);
    }
  },
});

registerVisualizationLayerDefinition({
  identifier: "fontra.selected.nodes",
  name: "Selected nodes",
  selectionMode: "editing",
  zIndex: 500,
  screenParameters: {
    cornerSize: 8,
    smoothSize: 8,
    handleSize: 6.5,
    strokeWidth: 1,
    hoverStrokeOffset: 4,
    underlayOffset: 2,
  },
  colors: { hoveredColor: "#BBB", selectedColor: "#000", underColor: "#FFFA" },
  colorsDarkMode: { hoveredColor: "#BBB", selectedColor: "#FFF", underColor: "#0008" },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    const glyph = positionedGlyph.glyph;
    const cornerSize = parameters.cornerSize;
    const smoothSize = parameters.smoothSize;
    const handleSize = parameters.handleSize;

    const { point: hoveredPointIndices } = parseSelection(model.hoverSelection);
    const { point: selectedPointIndices } = parseSelection(model.selection);

    // Under layer
    const underlayOffset = parameters.underlayOffset;
    context.fillStyle = parameters.underColor;
    for (const pt of iterPointsByIndex(glyph.path, selectedPointIndices)) {
      fillNode(
        context,
        pt,
        cornerSize + underlayOffset,
        smoothSize + underlayOffset,
        handleSize + underlayOffset
      );
    }
    // Selected nodes
    context.fillStyle = parameters.selectedColor;
    for (const pt of iterPointsByIndex(glyph.path, selectedPointIndices)) {
      fillNode(context, pt, cornerSize, smoothSize, handleSize);
    }
    // Hovered nodes
    context.strokeStyle = parameters.hoveredColor;
    context.lineWidth = parameters.strokeWidth;
    const hoverStrokeOffset = parameters.hoverStrokeOffset;
    for (const pt of iterPointsByIndex(glyph.path, hoveredPointIndices)) {
      strokeNode(
        context,
        pt,
        cornerSize + hoverStrokeOffset,
        smoothSize + hoverStrokeOffset,
        handleSize + hoverStrokeOffset
      );
    }
  },
});

registerVisualizationLayerDefinition({
  identifier: "fontra.coordinates",
  name: "sidebar.user-settings.glyph.coordinates",
  selectionMode: "editing",
  userSwitchable: true,
  defaultOn: false,
  zIndex: 600,
  screenParameters: { fontSize: 10 },
  colors: { boxColor: "#FFFB", color: "#000" },
  colorsDarkMode: { boxColor: "#1118", color: "#FFF" },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    const glyph = positionedGlyph.glyph;
    const fontSize = parameters.fontSize;

    let {
      point: pointSelection,
      component: componentSelection,
      componentOrigin: componentOriginSelection,
      anchor: anchorSelection,
      guideline: guidelineSelection,
    } = parseSelection(model.sceneSettings.combinedSelection);
    componentSelection = unionIndexSets(componentSelection, componentOriginSelection);

    const margin = 0.2 * fontSize;
    const boxHeight = 1.68 * fontSize;
    const lineHeight = fontSize;
    const bottomY = 0.75 * fontSize;

    context.font = `${fontSize}px fontra-ui-regular, sans-serif`;
    context.textAlign = "center";
    context.scale(1, -1);

    for (const pt of chain(
      iterPointsByIndex(glyph.path, pointSelection),
      iterComponentOriginsByIndex(glyph.instance.components, componentSelection),
      iterAnchorsPointsByIndex(glyph.anchors, anchorSelection),
      iterGuidelinesPointsByIndex(glyph.guidelines, guidelineSelection)
    )) {
      const xString = `${round(pt.x, 1)}`;
      const yString = `${round(pt.y, 1)}`;
      const width =
        Math.max(
          context.measureText(xString).width,
          context.measureText(yString).width
        ) +
        2 * margin;
      context.fillStyle = parameters.boxColor;
      context.fillRect(
        pt.x - width / 2,
        -pt.y - bottomY + margin,
        width,
        -boxHeight - 2 * margin
      );

      context.fillStyle = parameters.color;
      context.fillText(xString, pt.x, -pt.y - bottomY - lineHeight);
      context.fillText(yString, pt.x, -pt.y - bottomY);
    }
  },
});

registerVisualizationLayerDefinition({
  identifier: "fontra.point.index",
  name: "sidebar.user-settings.glyph.point.index",
  selectionMode: "editing",
  userSwitchable: true,
  defaultOn: false,
  zIndex: 600,
  screenParameters: { fontSize: 10 },
  colors: { boxColor: "#FFFB", color: "#000" },
  colorsDarkMode: { boxColor: "#1118", color: "#FFF" },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    const glyph = positionedGlyph.glyph;
    const fontSize = parameters.fontSize;

    let { point: pointSelection } = parseSelection(
      model.sceneSettings.combinedSelection
    );

    const margin = 0.2 * fontSize;
    const boxHeight = (1.68 * fontSize) / 2;
    const bottomY = -0.75 * fontSize * 2;

    context.font = `${fontSize}px fontra-ui-regular, sans-serif`;
    context.textAlign = "center";
    context.scale(1, -1);

    for (const pointIndex of pointSelection || []) {
      const pt = glyph.path.getPoint(pointIndex);
      const xString = `${pointIndex}`;
      const width = context.measureText(xString).width + 2 * margin;
      context.fillStyle = parameters.boxColor;
      context.fillRect(
        pt.x - width / 2,
        -pt.y - bottomY + margin,
        width,
        -boxHeight - 2 * margin
      );

      context.fillStyle = parameters.color;
      context.fillText(xString, pt.x, -pt.y - bottomY);
    }
  },
});

registerVisualizationLayerDefinition({
  identifier: "fontra.connect-insert.point",
  name: "Connect/insert point",
  selectionMode: "editing",
  zIndex: 500,
  screenParameters: {
    connectRadius: 11,
    insertHandlesRadius: 5,
    deleteOffCurveIndicatorLength: 7,
    canDragOffCurveIndicatorRadius: 9,
    strokeWidth: 2,
  },
  colors: { color: "#3080FF80" },
  colorsDarkMode: { color: "#50A0FF80" },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    const targetPoint = model.pathConnectTargetPoint;
    const insertHandles = model.pathInsertHandles;
    const danglingOffCurve = model.pathDanglingOffCurve;
    const canDragOffCurve = model.pathCanDragOffCurve;
    if (!targetPoint && !insertHandles && !danglingOffCurve && !canDragOffCurve) {
      return;
    }

    context.fillStyle = parameters.color;
    context.strokeStyle = parameters.color;
    context.lineWidth = parameters.strokeWidth;
    context.lineCap = "round";

    if (targetPoint) {
      const radius = parameters.connectRadius;
      fillRoundNode(context, targetPoint, 2 * radius);
    }
    for (const point of insertHandles?.points || []) {
      const radius = parameters.insertHandlesRadius;
      fillRoundNode(context, point, 2 * radius);
    }
    if (danglingOffCurve) {
      const d = parameters.deleteOffCurveIndicatorLength;
      const { x, y } = danglingOffCurve;
      let dx = d;
      let dy = d;
      const inner = 0.666;
      for (let i = 0; i < 4; i++) {
        [dx, dy] = [-dy, dx];
        strokeLine(context, x + inner * dx, y + inner * dy, x + dx, y + dy);
      }
    }
    if (canDragOffCurve) {
      const dashLength = (parameters.canDragOffCurveIndicatorRadius * Math.PI) / 6;
      context.setLineDash([dashLength]);
      strokeRoundNode(
        context,
        canDragOffCurve,
        2 * parameters.canDragOffCurveIndicatorRadius
      );
    }
  },
});

registerVisualizationLayerDefinition({
  identifier: "fontra.status.color",
  name: "sidebar.user-settings.glyph.statuscolor",
  selectionMode: "all",
  userSwitchable: true,
  defaultOn: false,
  zIndex: 100,
  screenParameters: {
    minThickness: 3,
    maxThickness: 15,
  },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    const statusFieldDefinitions =
      model.fontController.customData["fontra.sourceStatusFieldDefinitions"];
    if (!statusFieldDefinitions) {
      return;
    }

    const sourceIndex = positionedGlyph.glyph.sourceIndex;
    if (sourceIndex === undefined) {
      return;
    }

    let status =
      positionedGlyph.varGlyph.sources[sourceIndex].customData[
        "fontra.development.status"
      ];

    if (status === undefined) {
      status = statusFieldDefinitions.find((statusDef) => statusDef.isDefault)?.value;
      if (status === undefined) {
        return;
      }
    }

    if (!statusFieldDefinitions[status]) {
      return;
    }

    const color = [...statusFieldDefinitions[status].color];
    if (positionedGlyph.isEditing) {
      // in editing mode reduce opacity
      color[3] = color[3] * 0.4;
    }

    const thickness = clamp(
      0.05 * model.fontController.unitsPerEm,
      parameters.minThickness,
      parameters.maxThickness
    );
    context.fillStyle = rgbaToCSS(color);
    context.fillRect(
      0,
      -0.12 * model.fontController.unitsPerEm - thickness,
      positionedGlyph.glyph.xAdvance,
      thickness
    );
  },
});

registerVisualizationLayerDefinition({
  identifier: "fontra.edit.background.layers",
  name: "Background glyph layers",
  selectionMode: "editing",
  zIndex: 490,
  screenParameters: {
    strokeWidth: 1,
    anchorRadius: 4,
  },
  colors: { color: "#AAA8", colorAnchor: "#AAA7" },
  colorsDarkMode: { color: "#8888", colorAnchor: "#8887" },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    context.lineJoin = "round";
    context.lineWidth = parameters.strokeWidth;
    for (const layerGlyph of Object.values(model.backgroundLayerGlyphs || {})) {
      context.strokeStyle = parameters.color;
      context.stroke(layerGlyph.flattenedPath2d);

      // visualizing anchors
      context.strokeStyle = parameters.colorAnchor;
      for (const anchor of layerGlyph.anchors) {
        strokeCircle(context, anchor.x, anchor.y, parameters.anchorRadius);
      }
    }
  },
});

registerVisualizationLayerDefinition({
  identifier: "fontra.edit.editing.layers",
  name: "Editing glyph layers",
  selectionMode: "editing",
  zIndex: 490,
  screenParameters: {
    strokeWidth: 1,
    anchorRadius: 4,
  },
  colors: { color: "#66FA", colorAnchor: "#66F5" },
  colorsDarkMode: { color: "#88FA", colorAnchor: "#88F7" },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    const primaryEditingInstance = positionedGlyph.glyph;
    context.lineJoin = "round";
    context.lineWidth = parameters.strokeWidth;
    for (const layerGlyph of Object.values(model.editingLayerGlyphs || {})) {
      if (layerGlyph !== primaryEditingInstance) {
        context.strokeStyle = parameters.color;
        context.stroke(layerGlyph.flattenedPath2d);

        // visualizing anchors
        context.strokeStyle = parameters.colorAnchor;
        for (const anchor of layerGlyph.anchors) {
          strokeCircle(context, anchor.x, anchor.y, parameters.anchorRadius);
        }
      }
    }
  },
});

registerVisualizationLayerDefinition({
  identifier: "fontra.edit.path.under.stroke",
  name: "Underlying edit path stroke",
  selectionMode: "editing",
  zIndex: 490,
  screenParameters: {
    strokeWidth: 3,
  },
  colors: { color: "#FFF6" },
  colorsDarkMode: { color: "#0004" },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    context.lineJoin = "round";
    context.lineWidth = parameters.strokeWidth;
    context.strokeStyle = parameters.color;
    context.stroke(positionedGlyph.glyph.flattenedPath2d);
  },
});

registerVisualizationLayerDefinition({
  identifier: "fontra.edit.path.stroke",
  name: "Edit path stroke",
  selectionMode: "editing",
  zIndex: 500,
  screenParameters: {
    strokeWidth: 1,
  },
  colors: { color: "#000" },
  colorsDarkMode: { color: "#FFF" },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    context.lineJoin = "round";
    context.lineWidth = parameters.strokeWidth;
    context.strokeStyle = parameters.color;
    context.stroke(positionedGlyph.glyph.flattenedPath2d);
  },
});

registerVisualizationLayerDefinition({
  identifier: "fontra.rect.select",
  name: "Rect select",
  selectionMode: "editing",
  zIndex: 500,
  screenParameters: {
    strokeWidth: 1,
    lineDash: [10, 10],
  },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    if (model.selectionRect === undefined) {
      return;
    }
    const selRect = model.selectionRect;
    const x = selRect.xMin;
    const y = selRect.yMin;
    const w = selRect.xMax - x;
    const h = selRect.yMax - y;
    context.lineWidth = parameters.strokeWidth;
    context.strokeStyle = "#000";
    context.strokeRect(x, y, w, h);
    context.strokeStyle = "#FFF";
    context.setLineDash(parameters.lineDash);
    context.strokeRect(x, y, w, h);
  },
});

//
// allGlyphsCleanVisualizationLayerDefinition is not registered, but used
// separately for the "clean" display.
//
export const allGlyphsCleanVisualizationLayerDefinition = {
  identifier: "fontra.all.glyphs",
  name: "All glyphs",
  selectionMode: "all",
  zIndex: 500,
  colors: { fillColor: "#000" },
  colorsDarkMode: { fillColor: "#FFF" },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    context.fillStyle = parameters.fillColor;
    context.fill(positionedGlyph.glyph.flattenedPath2d);
  },
};

// Drawing helpers

function fillNode(context, pt, cornerNodeSize, smoothNodeSize, handleNodeSize) {
  if (!pt.type && !pt.smooth) {
    fillSquareNode(context, pt, cornerNodeSize);
  } else if (!pt.type) {
    fillRoundNode(context, pt, smoothNodeSize);
  } else {
    fillRoundNode(context, pt, handleNodeSize);
  }
}

function strokeNode(context, pt, cornerNodeSize, smoothNodeSize, handleNodeSize) {
  if (!pt.type && !pt.smooth) {
    strokeSquareNode(context, pt, cornerNodeSize);
  } else if (!pt.type) {
    strokeRoundNode(context, pt, smoothNodeSize);
  } else {
    strokeRoundNode(context, pt, handleNodeSize);
  }
}

function fillSquareNode(context, pt, nodeSize) {
  context.fillRect(pt.x - nodeSize / 2, pt.y - nodeSize / 2, nodeSize, nodeSize);
}

export function fillRoundNode(context, pt, nodeSize) {
  context.beginPath();
  context.arc(pt.x, pt.y, nodeSize / 2, 0, 2 * Math.PI, false);
  context.fill();
}

export function strokeSquareNode(context, pt, nodeSize) {
  context.strokeRect(pt.x - nodeSize / 2, pt.y - nodeSize / 2, nodeSize, nodeSize);
}

export function strokeRoundNode(context, pt, nodeSize) {
  context.beginPath();
  context.arc(pt.x, pt.y, nodeSize / 2, 0, 2 * Math.PI, false);
  context.stroke();
}

export function strokeLine(context, x1, y1, x2, y2) {
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
}

function strokeLineDashed(context, x1, y1, x2, y2, pattern = [5, 5]) {
  context.beginPath();
  context.setLineDash(pattern);
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
}

function strokeCircle(context, cx, cy, radius) {
  context.beginPath();
  context.arc(cx, cy, radius, 0, 2 * Math.PI, false);
  context.stroke();
}

function strokePolygon(context, points) {
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (const pt of points.slice(1)) {
    context.lineTo(pt.x, pt.y);
  }
  context.closePath();
  context.stroke();
}

function drawWithDoubleStroke(
  context,
  path,
  outerLineWidth,
  innerLineWidth,
  strokeStyle,
  fillStyle
) {
  context.lineJoin = "round";
  context.lineWidth = outerLineWidth;
  context.strokeStyle = strokeStyle;
  context.stroke(path);
  context.lineWidth = innerLineWidth;
  context.strokeStyle = "black";
  context.globalCompositeOperation = "destination-out";
  context.stroke(path);
  context.globalCompositeOperation = "source-over";
  context.fillStyle = fillStyle;
  context.fill(path);
}

function lenientUnion(setA, setB) {
  if (!setA) {
    return setB || new Set();
  }
  if (!setB) {
    return setA || new Set();
  }
  return union(setA, setB);
}

function* iterPointsByIndex(path, pointIndices) {
  if (!pointIndices) {
    return;
  }
  for (const index of pointIndices) {
    const pt = path.getPoint(index);
    if (pt) {
      yield pt;
    }
  }
}

function* iterAnchorsPointsByIndex(anchors, anchorIndices) {
  if (!anchorIndices || !anchors.length) {
    return;
  }
  for (const index of anchorIndices) {
    if (anchors[index]) {
      yield anchors[index];
    }
  }
}

function* iterGuidelinesPointsByIndex(guidelines, guidelineIndices) {
  if (!guidelineIndices || !guidelines.length) {
    return;
  }
  for (const index of guidelineIndices) {
    if (guidelines[index]) {
      yield guidelines[index];
    }
  }
}

function* iterComponentOriginsByIndex(components, componentIndices) {
  if (!componentIndices) {
    return;
  }
  for (const index of componentIndices) {
    const compo = components[index];
    if (compo) {
      yield { x: compo.transformation.translateX, y: compo.transformation.translateY };
    }
  }
}

// {
//   identifier: "fontra.baseline",
//   name: "Baseline",
//   selectionMode: "unselected",  // choice from all, unselected, hovered, selected, editing
//   selectionFilter: (positionedGlyph) => ...some condition...,  // OPTIONAL
//   zIndex: 50
//   screenParameters: {},  // in screen/pixel units
//   glyphParameters: {},  // in glyph units
//   colors: {},
//   colorsDarkMode: {},
//   draw: (context, positionedGlyph, parameters, model, controller) => { /* ... */ },
// }

function drawRoundRect(context, x, y, width, height, radii) {
  // older versions of Safari don't support roundRect,
  // so we use rect instead
  context.beginPath();
  if (context.roundRect) {
    context.roundRect(x, y, width, height, radii);
  } else {
    context.rect(x, y, width, height);
  }
  context.fill();
}

function getTextVerticalCenter(context, text) {
  const metrics = context.measureText(text);
  return (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
}
