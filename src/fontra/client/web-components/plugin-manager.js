import * as html from "../core/html-utils.js";
import { SimpleElement, createDomElement } from "../core/html-utils.js";
import { ObservableController } from "../core/observable-object.js";
import "/web-components/add-remove-buttons.js";
import { dialogSetup, message } from "/web-components/modal-dialog.js";
import { UIList } from "/web-components/ui-list.js";

export class PluginManager extends SimpleElement {
  static styles = `
  .plugin-manager {
    margin: 1rem;
    display: grid;
    grid-auto-rows: auto auto;
    grid-gap: .5rem;
  }

  .buttons {
    display: flex;
    gap: 0.2rem;
  }

  .no-plugins {
    padding: 0.4rem 0.2rem;
  }
  `;
  constructor() {
    super();
    this.contentElement = this.shadowRoot.appendChild(html.div());
    this.contentElement.classList.add("plugin-manager");
    const observable = new ObservableController({
      plugins: [],
    });
    observable.synchronizeWithLocalStorage("fontra.plugins");
    this.observable = observable;
    this.pluginList = new UIList();
    this.pluginList.minHeight = "5em";
    this.pluginList.setItems(observable.model.plugins);
    this.pluginList.columnDescriptions = [
      {
        key: "address",
        title: "Github repository",
      },
    ];
    this.render();
    this.renderPlugins();
    this.pluginList.addEventListener("listSelectionChanged", async (event) => {
      this.addRemoveButton.disableRemoveButton =
        this.pluginList.selectedItemIndex === undefined;
    });
  }

  async promptAddPlugin(text = "") {
    const newPluginPrompt = await dialogSetup("Add plugin", "", [
      // TODO: translation
      { title: "Cancel", resultValue: "no", isCancelButton: true }, // TODO: translation
      { title: "Create", resultValue: "ok", isDefaultButton: true, disabled: true }, // TODO: translation
    ]);
    let address = text;
    const pluginContent = html.div(
      {
        style:
          "display: grid; grid-template-columns: auto 1fr; grid-gap: 1rem; align-items: center;",
      },
      [
        html.label({ for: `plugin-path` }, "Plugin path:"), // TODO: translation
        html.input({
          id: "plugin-path",
          autofocus: true,
          type: "text",
          value: text,
          oninput: (event) => {
            address = event.target.value;
            const isEmpty = !address.trim();
            const isButtonDisabled =
              newPluginPrompt.defaultButton.classList.contains("disabled");
            if (!isEmpty && isButtonDisabled) {
              newPluginPrompt.defaultButton.classList.remove("disabled");
            } else if (!isButtonDisabled && isEmpty) {
              newPluginPrompt.defaultButton.classList.add("disabled");
            }
          },
        }),
      ]
    );
    newPluginPrompt.setContent(pluginContent);
    const pluginPromptResult = await newPluginPrompt.run();
    if (pluginPromptResult === "ok") {
      const newPlugin = { address };
      const [ok, errorMessage] = await this.validatePlugin(
        parsePluginBasePath(address)
      );
      if (ok) {
        this.observable.setItem("plugins", [
          ...this.observable.model.plugins,
          newPlugin,
        ]);
        this.renderPlugins();
      } else {
        await message("Error", errorMessage);
        return this.promptAddPlugin(address);
      }
    }
  }

  async validatePlugin(pluginPath) {
    if (
      this.observable.model.plugins.some(
        ({ address }) => parsePluginBasePath(address) === pluginPath
      )
    ) {
      return [false, "Plugin exists."]; // TODO: translation
    }
    let response;
    try {
      response = await fetch(`${pluginPath}/plugin.json`);
    } catch (e) {
      return [false, "An error occured when fetching the plugin."]; // TODO: translation
    }
    if (response.status === 404) {
      return [false, "Plugin not found."]; // TODO: translation
    }
    return [true];
  }

  renderPlugins() {
    const plugins = this.observable.model.plugins;
    this.pluginList.setItems(plugins);
  }

  render() {
    const fragment = document.createDocumentFragment();
    fragment.appendChild(html.div({}, ["Fontra plugins:"])); // TODO: translation
    fragment.appendChild(this.pluginList);
    fragment.appendChild(
      (this.addRemoveButton = createDomElement("add-remove-buttons", {
        addButtonCallback: () => {
          this.promptAddPlugin();
        },
        removeButtonCallback: () => {
          this.observable.setItem(
            "plugins",
            this.observable.model.plugins.filter(
              (plugin, index) => index !== this.pluginList.getSelectedItemIndex()
            )
          );
          this.renderPlugins();
        },
        disableRemoveButton: true,
      }))
    );
    this.contentElement.appendChild(fragment);
  }
}

customElements.define("plugin-manager", PluginManager);

export function parsePluginBasePath(address, version = "latest") {
  let baseURL;
  if (address.split("/").length === 2) {
    baseURL = `https://cdn.jsdelivr.net/gh/${address}@${version}`;
  } else {
    baseURL = address.endsWith("/") ? address.slice(0, -1) : address;
  }
  return baseURL;
}
