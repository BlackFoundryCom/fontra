import { SimpleElement } from "/core/html-utils.js";

export default class Panel extends SimpleElement {
  panelStyles = `
    .panel {
      display: flex;
      flex-direction: column;
      height: 100%;
      gap: 0.5em;
    }
    .panel-section {
      padding: 1em;
    }
    .panel-section--flex {
      flex: 1;
    }
    .panel-section--scrollable {
      overflow: hidden auto;
    }
    .panel-section--noscroll {
      overflow: hidden;
    }
  `;

  constructor(editorController) {
    super();
    this.editorController = editorController;
    this._appendStyle(this.panelStyles);
    this.contentElement = this.getContentElement();
    this.shadowRoot.appendChild(this.contentElement);
  }

  getContentElement() {}

  async toggle(on, focus) {}
}
