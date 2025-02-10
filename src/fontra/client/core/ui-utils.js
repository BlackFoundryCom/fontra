import * as html from "./html-utils.js";
import { uniqueID, zip } from "./utils.js";
import { PopupMenu } from "/web-components/popup-menu.js";

const containerClassName = "fontra-ui-sortable-list-container";
const draggingClassName = "fontra-ui-sortable-list-dragging";

html.addStyleSheet(`
.${draggingClassName} {
  opacity: 0.3;
}
`);

export function setupSortableList(listContainer) {
  listContainer.classList.add(containerClassName);
  let originalItems;
  // We need to compare the vertical middle of the dragged item with the sibling,
  // independently of where the user grabbed the item, so on dragstart we calculate
  // the difference between the middle of the dragged item and clientY
  let clientYOffset;

  listContainer.addEventListener("dragover", (event) => {
    event.preventDefault();
    const draggingItem = listContainer.querySelector(
      `.${containerClassName} > .${draggingClassName}`
    );

    // Getting all items except currently dragging and making array of them
    const siblings = [
      ...listContainer.querySelectorAll(
        `.${containerClassName} > [draggable="true"]:not(.${draggingClassName})`
      ),
    ];

    // Finding the sibling after which the dragging item should be placed
    const nextSibling = siblings.find((sibling) => {
      return (
        event.clientY + clientYOffset <= sibling.offsetTop + sibling.offsetHeight / 2
      );
    });

    // Inserting the dragging item before the found sibling
    if (draggingItem.nextSibling != nextSibling) {
      listContainer.insertBefore(draggingItem, nextSibling);
    }
  });

  listContainer.addEventListener("dragenter", (event) => event.preventDefault());

  listContainer.addEventListener("dragstart", (event) => {
    if (listContainer.contains(document.activeElement)) {
      // Don't allow dragging on the active element (for example a text input)
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    setTimeout(() => {
      event.target.classList.add(draggingClassName);
    }, 0);
    originalItems = [
      ...listContainer.querySelectorAll(`.${containerClassName} > [draggable="true"]`),
    ];
    // Calculate the difference between the middle of the dragged item and clientY
    clientYOffset =
      event.target.offsetTop + event.target.offsetHeight / 2 - event.clientY;
  });

  listContainer.addEventListener("dragend", (event) => {
    const draggingItem = listContainer.querySelector(
      `.${containerClassName} > .${draggingClassName}`
    );
    draggingItem.classList.remove(draggingClassName);

    const currentItems = [
      ...listContainer.querySelectorAll(`.${containerClassName} > [draggable="true"]`),
    ];
    if (didReorder(originalItems, currentItems)) {
      const event = new CustomEvent("reordered", {
        bubbles: false,
        detail: listContainer,
      });
      listContainer.dispatchEvent(event);
    }

    originalItems = undefined;
  });
}

function didReorder(a, b) {
  for (const [itemA, itemB] of zip(a, b)) {
    if (itemA !== itemB) {
      return true;
    }
  }
  return false;
}

export function labeledCheckbox(label, controller, key, options) {
  const checkboxID = options?.id || `checkbox-${uniqueID()}-${key}`;
  const inputElement = html.input({ type: "checkbox", id: checkboxID });
  inputElement.checked = controller.model[key];

  const inputWrapper = html.div();
  if (options?.class) {
    inputWrapper.className = options.class;
  }

  if (label) {
    const labelElement = html.label({ for: checkboxID }, [label]);
    if (options?.labelClass) {
      labelElement.className = options.labelClass;
    }

    const labeledCheckBoxElement = html.div(
      {
        style: `
          display: grid;
          grid-template-columns: auto auto;
          justify-content: left;
          gap: 0.1em;
          align-items: center;
        `,
      },
      [inputElement, labelElement]
    );
    inputWrapper.appendChild(labeledCheckBoxElement);
  } else {
    inputWrapper.appendChild(inputElement);
  }

  inputElement.onchange = () => {
    controller.model[key] = inputElement.checked;
  };

  controller.addKeyListener(key, (event) => {
    inputElement.checked = event.newValue;
  });

  return inputWrapper;
}

export function labelForElement(label, element, options) {
  const labelElement = html.label(
    { for: element.id, style: "white-space: nowrap; text-align: right;" },
    [label]
  );
  if (options?.labelClass) {
    labelElement.className = options.labelClass;
  }
  return labelElement;
}

export function choicesForInput(choices, inputElement) {
  const choicesID = `${inputElement.id}-choices`;
  inputElement.setAttribute("list", choicesID);
  return html.createDomElement(
    "datalist",
    { id: choicesID },
    choices.map((item) => html.createDomElement("option", { value: item }))
  );
}

export function textInput(controller, key, options) {
  options = { continuous: true, ...options };
  const inputID = options?.id || `input-${uniqueID()}-${key}`;
  const formatter = options?.formatter || DefaultFormatter;

  const inputElement = html.input({ type: options?.type || "text", id: inputID });
  if (options?.class) {
    inputElement.className = options.class;
  }
  inputElement.value = formatter.toString(controller.model[key]);
  inputElement[options.continuous ? "oninput" : "onchange"] = () => {
    const { value, error } = formatter.fromString(inputElement.value);
    if (!error) {
      controller.model[key] = value;
    }
  };

  controller.addKeyListener(key, (event) => {
    inputElement.value = formatter.toString(event.newValue);
  });

  if (options?.placeholderKey) {
    inputElement.placeholder = controller.model[options.placeholderKey];
    controller.addKeyListener(
      options.placeholderKey,
      (event) => (inputElement.placeholder = event.newValue)
    );
  }

  return inputElement;
}

export function labeledTextInput(label, controller, key, options) {
  const inputElement = textInput(controller, key, options);
  const items = [labelForElement(label, inputElement, options), inputElement];

  if (options?.choices) {
    items.push(choicesForInput(options.choices, inputElement));
  }
  return items;
}

export function popupSelect(controller, key, popupItems, options) {
  function findLabel() {
    const option = popupItems.find(({ value }) => value === controller.model[key]);
    return option?.label || "";
  }

  controller.addKeyListener(key, (event) => {
    menu.valueLabel = findLabel();
  });

  const menu = new PopupMenu(findLabel(), () =>
    popupItems.map(({ value, label }) => ({
      title: label,
      checked: value === controller.model[key],
      callback: () => {
        controller.model[key] = value;
        menu.valueLabel = label;
      },
    }))
  );

  if (options?.class) {
    menu.className = options.class;
  }

  return menu;
}

export function labeledPopupSelect(label, controller, key, popupItems, options) {
  const inputElement = popupSelect(controller, key, popupItems, options);
  return [labelForElement(label, inputElement, options), inputElement];
}

export const DefaultFormatter = {
  toString: (value) => (value !== undefined && value !== null ? value.toString() : ""),
  fromString: (value) => {
    return {
      value: value,
    };
  },
};

export const NumberFormatter = {
  toString: (value) => value.toString(),
  fromString: (value) => {
    const number = Number(value);
    if (isNaN(number) || !value) {
      return { error: "not a number" };
    } else {
      return { value: number };
    }
  },
};

export const OptionalNumberFormatter = {
  toString: (value) => (value != undefined ? value.toString() : ""),
  fromString: (value) => {
    if (!value) {
      return { value: null };
    }
    const number = Number(value);
    if (isNaN(number)) {
      return { error: "not a number" };
    } else {
      return { value: number };
    }
  },
};

export function checkboxListCell(item, colDesc) {
  const value = item[colDesc.key];
  return html.input({
    type: "checkbox",
    style: `width: auto; margin: 0; padding: 0; outline: none;`,
    checked: value,
    onclick: (event) => {
      item[colDesc.key] = event.target.checked;
      event.stopImmediatePropagation();
    },
    ondblclick: (event) => {
      event.stopImmediatePropagation();
    },
  });
}

export function pickFile(fileTypes) {
  /*
   * Returns a promise for a file object or null. If `fileTypes` is given, it should
   * be an array of file suffixes (ingluding dot, for example [".png"]), which
   * will be used to filter the selectable results. If `fileTypes` is not given,
   * all file types can be selected.
   */

  // Adapted from https://stackoverflow.com/questions/8385758/file-dialog-from-javascript-without-input

  const inputElement = document.createElement("input");
  inputElement.style.display = "none";
  inputElement.type = "file";
  if (fileTypes && fileTypes.length) {
    inputElement.accept = fileTypes.join(",");
  }

  const resultPromise = new Promise((resolve, reject) => {
    inputElement.addEventListener("change", () => {
      if (inputElement.files) {
        resolve(inputElement.files[0]);
      } else {
        resolve(null);
      }
    });
    inputElement.addEventListener("cancel", () => {
      resolve(null);
    });
  });

  const teardown = () => {
    document.body.removeEventListener("focus", teardown, true);
    setTimeout(() => {
      document.body.removeChild(inputElement);
    }, 500);
  };
  document.body.addEventListener("focus", teardown, true);

  document.body.appendChild(inputElement);
  inputElement.click();

  return resultPromise;
}
