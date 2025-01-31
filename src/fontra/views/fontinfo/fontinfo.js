import * as html from "../core/html-utils.js";
import { AxesPanel } from "./panel-axes.js";
import { CrossAxisMappingPanel } from "./panel-cross-axis-mapping.js";
import { DevelopmentStatusDefinitionsPanel } from "./panel-development-status-definitions.js";
import { FontInfoPanel } from "./panel-font-info.js";
import { SourcesPanel } from "./panel-sources.js";
import { makeFontraMenuBar } from "/core/fontra-menus.js";
import { translate } from "/core/localization.js";
import { ViewController } from "/core/view-controller.js";

export class FontInfoController extends ViewController {
  static titlePattern(displayPath) {
    return `Fontra Font Info — ${decodeURI(displayPath)}`;
  }

  async start() {
    await super.start();

    const url = new URL(window.location);
    this.selectedPanel = url.hash ? url.hash.slice(1) : "font-info-panel";

    const myMenuBar = makeFontraMenuBar(["File", "Font"], this);
    document.querySelector(".top-bar-container").appendChild(myMenuBar);

    const panelContainer = document.querySelector("#panel-container");
    const headerContainer = document.querySelector("#header-container");

    this.panels = {};
    const observer = setupIntersectionObserver(panelContainer, this.panels);

    const subscribePattern = {};

    for (const panelClass of [
      FontInfoPanel,
      AxesPanel,
      CrossAxisMappingPanel,
      SourcesPanel,
      DevelopmentStatusDefinitionsPanel,
    ]) {
      panelClass.fontAttributes.forEach((fontAttr) => {
        subscribePattern[fontAttr] = null;
      });

      const headerElement = html.div(
        {
          class: "header",
          onclick: (event) => {
            document.querySelector(".header.selected")?.classList.remove("selected");
            const clickedHeader = event.target;
            clickedHeader.classList.add("selected");
            this.selectedPanel = clickedHeader.getAttribute("for");
            for (const el of document.querySelectorAll(".font-info-panel")) {
              el.hidden = el.id != this.selectedPanel;
              if (el.id == this.selectedPanel) {
                el.focus(); // So it can receive key events
              }
            }

            const url = new URL(window.location);
            url.hash = `#${this.selectedPanel}`;
            window.history.replaceState({}, "", url);
          },
        },
        [translate(panelClass.title)]
      );
      if (panelClass.id === this.selectedPanel) {
        headerElement.classList.add("selected");
      }
      headerElement.setAttribute("for", panelClass.id);
      headerContainer.appendChild(headerElement);

      const panelElement = html.div({
        class: "font-info-panel",
        tabindex: 1,
        id: panelClass.id,
        hidden: panelClass.id != this.selectedPanel,
      });
      panelContainer.appendChild(panelElement);

      this.panels[panelClass.id] = new panelClass(this, panelElement);
      observer.observe(panelElement);
    }

    await this.fontController.subscribeChanges(subscribePattern, false);

    window.addEventListener("keydown", (event) => this.handleKeyDown(event));
  }

  handleKeyDown(event) {
    const panel = this.panels[this.selectedPanel];
    panel?.handleKeyDown?.(event);
  }
}

function setupIntersectionObserver(panelContainer, panels) {
  return new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        const panel = panels[entry.target.id];
        if (!panel) {
          return;
        }
        if (panel.visible !== entry.isIntersecting) {
          panel.visibilityChanged(entry.isIntersecting);
        }
      });
    },
    {
      root: panelContainer,
    }
  );
}
