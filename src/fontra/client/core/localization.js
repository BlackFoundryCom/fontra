import { ObservableController } from "./observable-object.js";
import { fetchJSON } from "./utils.js";

const debugTranslation = false;
let localizationData = {};

export const languageController = new ObservableController({ language: "en" });
languageController.synchronizeWithLocalStorage("fontra-language-");

function languageChanged(locale) {
  fetchJSON(`/lang/${locale}.json`).then((data) => {
    localizationData = data;
  });
}

languageController.addKeyListener("language", (event) => {
  languageChanged(languageController.model.language);
});

languageChanged(languageController.model.language || "en");

export function translate(key) {
  if (debugTranslation) {
    return key;
  }

  return localizationData[key] || `!${key}!`;
}
