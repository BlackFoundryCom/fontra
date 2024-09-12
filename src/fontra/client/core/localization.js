import { ObservableController } from "./observable-object.js";
import { fetchJSON } from "./utils.js";

const debugTranslation = false;
let localizationData = {};

export const languageController = new ObservableController({ language: "en" });
languageController.synchronizeWithLocalStorage("fontra-language-");

let resolveLanguageHasLoaded;

/**
 * `ensureLanguageHasLoaded` is a promise that will be resolved once
 * the language file has been loaded.
 */
export const ensureLanguageHasLoaded = new Promise((resolve) => {
  resolveLanguageHasLoaded = resolve;
});

function languageChanged(locale) {
  fetchJSON(`/lang/${locale}.json`).then((data) => {
    localizationData = data;
    resolveLanguageHasLoaded();
  });
}

languageController.addKeyListener("language", (event) => {
  languageChanged(languageController.model.language);
  // TODO: Implement a better way to localize the page
  // This method does not work perfectly on Chrome (and Edge maybe)
  window.location.reload(true);
});

languageChanged(languageController.model.language || "en");

function formatString(template, ...args) {
  return template.replace(/%\d+/g, (match) => {
    const index = parseInt(match.substring(1), 10);

    // Validation: Check that the index is a non-negative integer, and within bounds
    return Number.isInteger(index) && index >= 0 && index < args.length
      ? String(args[index])
      : match;
  });
}

/**
 * Translate the key to the corresponding value in the localizationData
 * @param {string} key - The key to translate
 * @param {...string} [args] - The arguments to replace in the translated value
 * @returns {string} The translated value
 */
export function translate(key, ...args) {
  const translation = localizationData[key];

  if (typeof key !== "string" || translation === undefined || debugTranslation) {
    return key;
  }

  return args.length > 0 ? formatString(translation, ...args) : translation;
}

/**
 * Translate the key to the corresponding value in the localizationData, with pluralization
 * @param {string} key - The key to translate
 * @param {number} quantity - The argument to replace in the translated value
 * @returns {string} The translated value
 */
export function translatePlural(key, quantity = 0) {
  const translation = localizationData[key];

  if (typeof key !== "string" || translation === undefined || debugTranslation) {
    return key;
  }

  const translationPlural = localizationData[key + ".plural"];

  if (translationPlural === undefined) {
    return formatString(translation, quantity);
  } else {
    return Math.abs(quantity) == 1
      ? formatString(translation, quantity)
      : formatString(translationPlural, quantity);
  }
}

export function localizePage() {
  // Translate all elements' data-tooltip that have data-tool attribute
  document.querySelectorAll("[data-tool]").forEach((el) => {
    if (
      el.classList.contains("tool-button") ||
      el.classList.contains("subtool-button")
    ) {
      // Skip tool buttons, because they have their own tooltips.
      // This function causes a visual bug otherwiese.
      return;
    }
    const key = el.getAttribute("data-tool");
    el.setAttribute("data-tooltip", translate(key));
  });

  // Translate all elements' innerHTML that have data-translate-key attribute
  document.querySelectorAll("[data-translate-key]").forEach((el) => {
    const key = el.getAttribute("data-translate-key");
    el.innerHTML = translate(key);
  });
}
