import { InlineSVG } from "./inline-svg.js";
import { themeColorCSS } from "./theme-support.js";
import { guessGlyphPlaceholderString } from "/core/glyph-data.js";
import { SVGPath2D } from "/core/glyph-svg.js";
import * as html from "/core/html-utils.js";
import { UnlitElement } from "/core/html-utils.js";
import * as svg from "/core/svg-utils.js";
import { Transform } from "/core/transform.js";
import { assert, rgbaToCSS, throttleCalls } from "/core/utils.js";

const colors = {
  "cell-background-color": ["#EEEEEE", "#585858"],
  "cell-hover-color": ["#E5E5E5", "#606060"],
  "cell-active-color": ["#D8D8D8", "#6F6F6F"],
  "cell-selected-color": ["#C8C8C8", "#8F8F8F"],
  "glyph-shape-placeholder-color": ["#AAA", "#AAA"],
};

const UNSCALED_CELL_HEIGHT = 75;

const cellObserver = new IntersectionObserver(
  (entries, observer) => {
    entries.forEach((entry) => {
      const cell = entry.target;
      if (entry.intersectionRatio > 0) {
        cell.locationController.addKeyListener(cell.locationKey, cell.throttledUpdate);
        cell.fontController.addGlyphChangeListener(
          cell.glyphName,
          cell.throttledUpdate
        );
        cell.throttledUpdate();
      } else {
        if (cell._glyphInstanceRequestID) {
          cell.fontController.cancelGlyphInstanceRequest(cell._glyphInstanceRequestID);
          delete cell._glyphInstanceRequestID;
        }
        cell.locationController.removeKeyListener(
          cell.locationKey,
          cell.throttledUpdate
        );
        cell.fontController.removeGlyphChangeListener(
          cell.glyphName,
          cell.throttledUpdate
        );
      }
    });
  },
  {
    root: document.documentElement, // Maybe use a more nearby clipping element?
  }
);

export class GlyphCell extends UnlitElement {
  static styles = `
    ${themeColorCSS(colors)}

  :host {
    display: inline-block;
    --glyph-cell-scale-factor: calc(var(--glyph-cell-scale-factor-override, 1));
  }

  #glyph-cell-container {
    background-color: var(--cell-background-color);
    display: inline-block;
    margin: 1px;
    border-radius: 0.3rem;
    overflow: hidden;
    transition: 100ms;
    cursor: pointer;
  }

  #glyph-cell-container:hover {
    background-color: var(--cell-hover-color);
  }

  #glyph-cell-container:active {
    background-color: var(--cell-active-color);
  }

  #glyph-cell-container.selected {
    background-color: var(--cell-selected-color);
  }

  #glyph-cell-content {
    display: grid;
    grid-template-rows: calc(${UNSCALED_CELL_HEIGHT}px * var(--glyph-cell-scale-factor, 1)) auto auto;
    justify-items: center;
    gap: 0;
    user-select: none;
    -webkit-user-select: none;
  }

  .glyph-shape-placeholder {
    display: grid;  /* for vertical text centering */
    place-items: center;
    color: var(--glyph-shape-placeholder-color);
    text-align: center;
  }

  .glyph-name-label {
    font-size: 0.85em;
    overflow-x: hidden;
    text-overflow: ellipsis;
    text-overflow: ellipsis;
    text-wrap: nowrap;
    text-align: center;
    word-break: keep-all;
  }

  .glyph-status-color {
    height: 0.3rem;
    justify-self: stretch;
  }
  `;

  constructor(fontController, glyphName, codePoints, locationController, locationKey) {
    super();
    this.fontController = fontController;
    this.glyphName = glyphName;
    this.codePoints = codePoints;
    this.locationController = locationController;
    this.locationKey = locationKey;
    this.throttledUpdate = throttleCalls(() => this._updateGlyph(), 50);
    this.marginTop = 0.2;
    this.marginBottom = 0.05;
    this.marginSide = 0;
    this.size = 60;
    this.height = (1 + this.marginTop + this.marginBottom) * this.size;
    assert(this.height === UNSCALED_CELL_HEIGHT, "manual size dependency incorrect");
    this.width = this.height;
    this._placeholderString = guessGlyphPlaceholderString(
      this.codePoints,
      this.glyphName
    );
    this._selected = false;
  }

  connectedCallback() {
    super.connectedCallback();
    cellObserver.observe(this);
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();
    cellObserver.unobserve(this);
    this.locationController.removeKeyListener(this.locationKey, this.throttledUpdate);
    this.fontController.removeGlyphChangeListener(this.glyphName, this.throttledUpdate);
  }

  async _updateGlyph() {
    this.width = this.height;

    const location = this.locationController.model[this.locationKey];
    const request = this.fontController.requestGlyphInstance(this.glyphName, location);
    this._glyphInstanceRequestID = request.requestID;
    const glyphController = await request.instancePromise;
    delete this._glyphInstanceRequestID;
    if (!glyphController) {
      // glyph instance request got cancelled, or glyph does not exist
      this._glyphSVG = null;
      return;
    }

    const unitsPerEm = this.fontController.unitsPerEm;
    const fontSource = this.fontController.fontSourcesInstancer.instantiate(location);
    const ascender =
      fontSource?.lineMetricsHorizontalLayout["ascender"]?.value || 0.8 * unitsPerEm;
    const descender =
      fontSource?.lineMetricsHorizontalLayout["descender"]?.value || -0.2 * unitsPerEm;

    const svgPath = new SVGPath2D();
    glyphController.flattenedPath.drawToPath2d(svgPath);

    const size = this.size;
    const height = this.height;
    this.width = Math.max(
      height,
      ((1 + 2 * this.marginSide) * size * glyphController.xAdvance) / unitsPerEm
    );

    const svgElement = svg.svg(
      {
        viewBox: svg.viewBox(
          -this.marginSide * unitsPerEm,
          -(ascender + this.marginTop * unitsPerEm),
          Math.max(glyphController.xAdvance + 2 * this.marginSide * unitsPerEm, 1), // a width of 0 is problematic
          ascender - descender + (this.marginTop + this.marginBottom) * unitsPerEm
        ),
        width: "100%",
        height: "100%",
      },
      [
        svg.path({
          d: svgPath.getPath(),
          transform: new Transform(1, 0, 0, -1, 0, 0),
        }),
      ]
    );

    this._glyphStatusColor = getStatusColor(
      this.fontController.customData["fontra.sourceStatusFieldDefinitions"],
      glyphController.varGlyph,
      glyphController.sourceIndex
    );
    this._glyphSVG = svgElement;
    this.requestUpdate();
  }

  render() {
    const fallbackFontSize = this.height / 2;
    this._glyphCellContent = html.div({ id: "glyph-cell-container" }, [
      html.div(
        {
          id: "glyph-cell-content",
          style: `width: calc(${this.width}px * var(--glyph-cell-scale-factor));`,
        },
        [
          this._glyphSVG
            ? this._glyphSVG
            : html.div(
                {
                  class: "glyph-shape-placeholder",
                  dir: "auto",
                  style: `
                  width: calc(${this.width}px * var(--glyph-cell-scale-factor));
                  font-size: calc(${fallbackFontSize}px * var(--glyph-cell-scale-factor));
                  line-height: ${fallbackFontSize}px;
                `,
                },
                [this._placeholderString]
              ),
          html.div(
            {
              class: "glyph-name-label",
              style: `width: calc(${this.width}px * var(--glyph-cell-scale-factor));`,
            },
            [this.glyphName]
          ),
          html.div({
            class: "glyph-status-color",
            style: `background-color: ${this._glyphStatusColor};`,
          }),
        ]
      ),
    ]);

    // update the selected state when rebuilding the cell contents
    this._updateSelectedState();

    return this._glyphCellContent;
  }

  get selected() {
    return this._selected;
  }

  set selected(onOff) {
    this._selected = onOff;
    this._updateSelectedState();
  }

  _updateSelectedState() {
    this._glyphCellContent?.classList.toggle("selected", this._selected);
  }
}

function getStatusColor(statusFieldDefinitions, varGlyph, sourceIndex) {
  let statusColor = "var(--cell-background-color)";
  if (!statusFieldDefinitions || sourceIndex === undefined) {
    return statusColor;
  }

  let status = varGlyph?.sources[sourceIndex].customData["fontra.development.status"];
  if (status === undefined) {
    status = statusFieldDefinitions.find((statusDef) => statusDef.isDefault)?.value;
  }

  const color = statusFieldDefinitions[status]?.color;
  if (color) {
    statusColor = rgbaToCSS(color);
  }

  return statusColor;
}

customElements.define("glyph-cell", GlyphCell);
