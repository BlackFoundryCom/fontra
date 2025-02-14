import { recordChanges } from "../core/change-recorder.js";
import * as html from "../core/html-utils.js";
import { addStyleSheet } from "../core/html-utils.js";
import { ObservableController } from "../core/observable-object.js";
import * as svg from "../core/svg-utils.js";
import {
  NumberFormatter,
  OptionalNumberFormatter,
  checkboxListCell,
  labeledTextInput,
  setupSortableList,
} from "../core/ui-utils.js";
import { enumerate, range, zip } from "../core/utils.js";
import { piecewiseLinearMap } from "../core/var-model.js";
import { IconButton } from "../web-components/icon-button.js"; // for <icon-button>
import { UIList } from "../web-components/ui-list.js";
import { BaseInfoPanel } from "./panel-base.js";
import { translate } from "/core/localization.js";
import "/web-components/add-remove-buttons.js";
import { dialogSetup } from "/web-components/modal-dialog.js";

const presetAxes = [
  {
    label: "Weight",
    name: "weight",
    tag: "wght",
    loclKey: "axes.preset.weight",
    minValue: 100,
    defaultValue: 400,
    maxValue: 900,
  },
  {
    label: "Width",
    name: "width",
    tag: "wdth",
    loclKey: "axes.preset.width",
    minValue: 50,
    defaultValue: 100,
    maxValue: 200,
  },
  {
    label: "Optical Size",
    name: "optical",
    tag: "opsz",
    loclKey: "axes.preset.optical-size",
    minValue: 8,
    defaultValue: 14,
    maxValue: 144,
  },
  {
    label: "Italic",
    name: "italic",
    tag: "ital",
    loclKey: "axes.preset.italic",
    minValue: 0,
    defaultValue: 0,
    maxValue: 1,
  },
  {
    label: "Slant",
    name: "slant",
    tag: "slnt",
    loclKey: "axes.preset.slant",
    minValue: -20,
    defaultValue: 0,
    maxValue: 20,
  },
];

const presetAxesByTag = Object.fromEntries(
  presetAxes.map((presetAxis) => [presetAxis.tag, presetAxis])
);

export class AxesPanel extends BaseInfoPanel {
  static title = "axes.title";
  static id = "axes-panel";
  static fontAttributes = ["axes", "sources"];

  setupUI() {
    const axisContainer = html.div({
      style: "display: grid; gap: 0.5em;",
    });

    const axes = this.fontController.axes;
    for (const index of range(axes.axes.length)) {
      axisContainer.appendChild(
        new AxisBox(axes, index, this.postChange.bind(this), this.deleteAxis.bind(this))
      );
    }

    setupSortableList(axisContainer);

    axisContainer.addEventListener("reordered", (event) => {
      const reorderedAxes = [];
      for (const [index, axisBox] of enumerate(axisContainer.children)) {
        reorderedAxes.push(axisBox.axis);
        axisBox.axisIndex = index;
      }
      this.replaceAxes(reorderedAxes, translate("axes.reorder"));
    });

    this.panelElement.innerHTML = "";
    this.panelElement.style = `
    gap: 1em;
    `;
    this.panelElement.appendChild(
      html.input({
        type: "button",
        class: "fontra-button",
        style: `justify-self: start;`,
        value: translate("axes.new"),
        onclick: (event) => this.newAxis(),
      })
    );
    this.panelElement.appendChild(axisContainer);
    this.panelElement.focus();
  }

  async newAxis() {
    const dialog = await dialogSetup(translate("axes.create"), "", [
      { title: translate("dialog.cancel"), isCancelButton: true },
      { title: translate("axes.add"), resultValue: "ok", isDefaultButton: true },
    ]);

    const radioGroup = [html.div({}, translate("axes.preset"))];
    const selected = "wght";

    const controller = new ObservableController({ ...presetAxesByTag[selected] });
    controller.addKeyListener(["name", "tag", "label"], (event) => {
      if (event.senderInfo !== "radiogroup") {
        radioGroup.forEach((el) => (el.checked = false));
      }
    });

    for (const presetAxis of presetAxes) {
      const identifier = `preset-axis-${presetAxis.tag}`;
      radioGroup.push(
        html.input({
          type: "radio",
          id: identifier,
          value: identifier,
          name: identifier,
          checked: presetAxis.tag === selected,
          onchange: (event) => {
            radioGroup.forEach((el) => (el.checked = event.target === el));
            controller.setItem("name", presetAxis.name, "radiogroup");
            controller.setItem("tag", presetAxis.tag, "radiogroup");
            controller.setItem("label", presetAxis.label, "radiogroup");
          },
        }),
        html.label({ for: identifier }, [
          `${translate(presetAxis.loclKey)} (${presetAxis.label}, ${presetAxis.name}, ${
            presetAxis.tag
          })`,
        ]),
        html.br()
      );
    }

    radioGroup.push(html.br());

    const customFields = html.div(
      {
        style: `
          display: grid;
          grid-template-columns: auto auto;
          justify-content: start;
          align-items: center;
          grid-gap: 0.5em;
        `,
      },
      [
        ...labeledTextInput(translate("axes.names.name"), controller, "name"),
        ...labeledTextInput(translate("axes.names.ot-tag"), controller, "tag"),
        ...labeledTextInput(translate("axes.names.ui-name"), controller, "label"),
      ]
    );

    const dialogContents = html.div({}, [...radioGroup, customFields]);

    dialog.setContent(dialogContents);
    const result = await dialog.run();
    if (!result) {
      return;
    }

    const presetAxis = presetAxesByTag[controller.model.tag] || {
      minValue: 0,
      defaultValue: 0,
      maxValue: 100,
    };

    const newAxis = {
      name: controller.model.name,
      tag: controller.model.tag,
      label: controller.model.label,
      minValue: presetAxis.minValue,
      defaultValue: presetAxis.defaultValue,
      maxValue: presetAxis.maxValue,
    };

    const undoLabel = translate("axes.undo.add", newAxis.name);
    const root = { axes: this.fontController.axes };
    const changes = recordChanges(root, (root) => {
      root.axes.axes.push(newAxis);
    });
    if (changes.hasChange) {
      this.postChange(changes.change, changes.rollbackChange, undoLabel);
      this.setupUI();
    }
  }

  async replaceAxes(updatedAxes, undoLabel) {
    const root = { axes: this.fontController.axes };
    const changes = recordChanges(root, (root) => {
      root.axes.axes.splice(0, root.axes.axes.length, ...updatedAxes);
    });
    await this.postChange(changes.change, changes.rollbackChange, undoLabel);
  }

  async deleteAxis(axisIndex) {
    const undoLabel = translate(
      "axes.undo.delete",
      this.fontController.axes.axes[axisIndex].name
    );
    const root = { axes: this.fontController.axes };
    const changes = recordChanges(root, (root) => {
      root.axes.axes.splice(axisIndex, 1);
    });
    if (changes.hasChange) {
      this.postChange(changes.change, changes.rollbackChange, undoLabel);
      this.setupUI();
    }
  }
}

addStyleSheet(`
:root {
  --fontra-ui-font-info-axes-panel-max-list-height: 12em;
}

.fontra-ui-font-info-axes-panel-axis-box {
  background-color: var(--ui-element-background-color);
  border-radius: 0.5em;
  padding: 1em;
  cursor: pointer;
  display: grid;
  grid-template-rows: auto auto;
  grid-template-columns: max-content max-content max-content max-content auto auto;
  grid-row-gap: 0.1em;
  grid-column-gap: 1em;
}

.fontra-ui-font-info-axes-panel-axis-box-values,
.fontra-ui-font-info-axes-panel-axis-box-names {
  display: grid;
  grid-template-columns: minmax(4.5em, max-content) max-content;
  gap: 0.5em;
  align-items: center;
  align-content: start;
}

.fontra-ui-font-info-axes-panel-axis-box-mapping-list {
  width: 9em;
  max-height: var(--fontra-ui-font-info-axes-panel-max-list-height);
}

.fontra-ui-font-info-axes-panel-axis-box-label-list {
  max-width: max-content;
  max-height: var(--fontra-ui-font-info-axes-panel-max-list-height);
}

.fontra-ui-font-info-axes-panel-axis-box-delete {
  justify-self: end;
  align-self: start;
}

select {
  font-family: "fontra-ui-regular";
}

.fontra-ui-font-info-axes-panel-axis-box-header {
  font-weight: bold;
}
`);

class AxisBox extends HTMLElement {
  constructor(axes, axisIndex, postChange, deleteAxis) {
    super();
    this.classList.add("fontra-ui-font-info-axes-panel-axis-box");
    this.draggable = true;
    this.axes = axes;
    this.axisIndex = axisIndex;
    this.postChange = postChange;
    this.deleteAxis = deleteAxis;
    this._updateContents();
  }

  get axis() {
    return this.axes.axes[this.axisIndex];
  }

  editAxis(editFunc, undoLabel) {
    const root = { axes: this.axes };
    const changes = recordChanges(root, (root) => {
      editFunc(root.axes.axes[this.axisIndex]);
    });
    if (changes.hasChange) {
      this.postChange(changes.change, changes.rollbackChange, undoLabel);
    }
  }

  replaceAxis(newAxis, undoLabel) {
    const root = { axes: this.axes };
    const changes = recordChanges(root, (root) => {
      root.axes.axes[this.axisIndex] = newAxis;
    });
    if (changes.hasChange) {
      this.postChange(changes.change, changes.rollbackChange, undoLabel);
    }
  }

  _updateContents() {
    const axis = this.axis;
    const isDiscreteAxis = !!axis.values;
    const axisModel = { ...axis };
    if (axisModel.values) {
      axisModel.valuesString = axisModel.values.join(" ");
    }
    this.axisController = new ObservableController(axisModel);
    this.axisController.addListener((event) => {
      if (event.key === "valuesString") {
        const newValues = event.newValue
          .split(/[ ]+/)
          .map(Number)
          .filter((n) => !isNaN(n));
        newValues.sort((a, b) => a - b);
        this.axisController.model.values = newValues;
        this.axisController.model.valuesString = newValues.join(" ");
      } else {
        this.editAxis(
          (axis) => {
            axis[event.key] = event.newValue;
          },
          translate("axes.undo.edit", event.key)
        );
      }
    });
    this.axisController.addKeyListener("mapping", (event) => {
      const newGraph = buildMappingGraph(this.axisController);
      this.mappingGraph.replaceWith(newGraph);
      this.mappingGraph = newGraph;
    });

    this.mappingGraph = buildMappingGraph(this.axisController);
    this.mappingList = buildMappingList(this.axisController);
    this.valueLabelList = buildValueLabelList(this.axisController);

    const axisTypeSelect = html.select(
      {
        id: `fontra-ui-font-info-axes-panel-axis-box-axis-type-${this.axisIndex}`,
        onchange: (event) => {
          this.convertAxis(event.target.value);
        },
      },
      [
        html.option({ value: "continuous", selected: !isDiscreteAxis }, [
          translate("axes.range.axis-type.continuous"),
        ]),
        html.option({ value: "discrete", selected: isDiscreteAxis }, [
          translate("axes.range.axis-type.discrete"),
        ]),
      ]
    );
    const axisItems = !isDiscreteAxis
      ? [
          [translate("axes.range.minimum"), "minValue"],
          [translate("axes.range.default"), "defaultValue"],
          [translate("axes.range.maxium"), "maxValue"],
        ]
      : [
          [translate("axes.range.values"), "valuesString"],
          [translate("axes.range.default"), "defaultValue"],
        ];

    this.innerHTML = "";

    this.append(
      html.div({ class: "fontra-ui-font-info-axes-panel-axis-box-header" }, [
        translate("axes.names"),
      ]),
      html.div({ class: "fontra-ui-font-info-axes-panel-axis-box-header" }, [
        translate("axes.range"),
      ]),
      html.div({ class: "fontra-ui-font-info-axes-panel-axis-box-header" }, [
        translate("axes.mapping-graph"),
      ]),
      html.div({ class: "fontra-ui-font-info-axes-panel-axis-box-header" }, [
        translate("axes.mapping-list"),
      ]),
      html.div({ class: "fontra-ui-font-info-axes-panel-axis-box-header" }, [
        translate("axes.axis-values"),
      ]),
      html.createDomElement("icon-button", {
        "class": "fontra-ui-font-info-axes-panel-axis-box-delete",
        "src": "/tabler-icons/trash.svg",
        "onclick": (event) => this.deleteAxis(this.axisIndex),
        "data-tooltip": translate("axes.delete-axis"),
        "data-tooltipposition": "left",
      }),

      // html.div({ class: "fontra-ui-font-info-axes-panel-axis-box-header" }, ["x"]),
      html.div(
        { class: "fontra-ui-font-info-axes-panel-axis-box-names" },
        [
          [translate("axes.names.name"), "name"],
          [translate("axes.names.ot-tag"), "tag"],
          [translate("axes.names.ui-name"), "label"],
        ]
          .map(([labelName, keyName]) =>
            labeledTextInput(labelName, this.axisController, keyName, {
              continuous: false,
            })
          )
          .flat()
      ),
      html.div({ class: "fontra-ui-font-info-axes-panel-axis-box-values" }, [
        html.label(
          {
            for: axisTypeSelect.id,
            style: "text-align: right",
          },
          [translate("axes.range.axis-type")]
        ),
        axisTypeSelect,
        ...axisItems
          .map(([labelName, keyName]) =>
            labeledTextInput(labelName, this.axisController, keyName, {
              type: keyName === "valuesString" ? "text" : "number",
              continuous: false,
              formatter: keyName !== "valuesString" ? NumberFormatter : undefined,
            })
          )
          .flat(),
      ]),
      this.mappingGraph,
      this.mappingList,
      this.valueLabelList
    );
  }

  convertAxis(type) {
    const newAxis = { ...this.axis };
    if (type === "discrete") {
      const values = [
        ...new Set([newAxis.minValue, newAxis.defaultValue, newAxis.maxValue]),
      ];
      values.sort((a, b) => a - b);
      delete newAxis.minValue;
      delete newAxis.maxValue;
      newAxis.values = values;
    } else {
      newAxis.minValue = Math.min(...newAxis.values);
      newAxis.maxValue = Math.max(...newAxis.values);
      delete newAxis.values;
    }
    this.replaceAxis(newAxis, `convert to ${type}`);
    this._updateContents();
  }
}

customElements.define("axis-box", AxisBox);

function buildMappingGraph(axisController) {
  const axis = axisController.model;
  const marginLeft = 16;
  const marginRight = 16;
  const marginTop = 16;
  const marginBottom = 16;
  const labelOffset = -13;
  const graphSize = 100;
  const width = graphSize + marginLeft + marginRight;
  const height = graphSize + marginTop + marginBottom;

  if (!axis.mapping?.length || axis.mapping.length < 2) {
    return html.div({
      style: `width: ${width}px; height: ${height}px;background-color: #AAA1;`,
    }); // filler for non-graphable mapping
  }

  const xs = axis.mapping?.map(([x, y]) => x) || [];
  const ys = axis.mapping?.map(([x, y]) => y) || [];
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const graphX = xs.map((x) => (graphSize * (x - xMin)) / (xMax - xMin));
  const graphY = ys.map((y) => (graphSize * (y - yMin)) / (yMax - yMin));
  const graphPoints = [...zip(graphX, graphY)].map(([x, y]) => {
    return { x, y };
  });
  let defaultLines = [];
  if (
    axis.mapping?.length &&
    axis.defaultValue != axis.minValue &&
    axis.defaultValue != axis.maxValue
  ) {
    const defaultX = (graphSize * (axis.defaultValue - xMin)) / (xMax - xMin);
    const mappedDefault = piecewiseLinearMap(
      axis.defaultValue,
      Object.fromEntries(axis.mapping || [])
    );
    const defaultY = (graphSize * (mappedDefault - yMin)) / (yMax - yMin);

    defaultLines = [
      svg.line({
        class: "grid default-line",
        x1: defaultX,
        y1: 0,
        x2: defaultX,
        y2: graphSize,
      }),
      svg.line({
        class: "grid default-line",
        x1: 0,
        y1: defaultY,
        x2: graphSize,
        y2: defaultY,
      }),
    ];
  }

  const graphLabels = (v1, v2, v3) => {
    return [
      svg.text({ x: 0, y: 0, transform: svg.scale(1, -1) }, [v1]),
      svg.text(
        {
          "x": graphSize / 2,
          "y": 0,
          "transform": svg.scale(1, -1),
          "text-anchor": "middle",
        },
        [v2]
      ),
      svg.text(
        {
          "x": graphSize,
          "y": 0,
          "transform": svg.scale(1, -1),
          "text-anchor": "end",
        },
        [v3]
      ),
    ];
  };

  const graphElement = svg.polyline({
    class: "graph",
    points: svg.points(graphPoints),
  });

  const nodes = [];
  for (const [i, { x, y }] of enumerate(graphPoints)) {
    nodes.push(
      svg.circle({
        class: "node",
        cx: x,
        cy: y,
        onmouseenter: (event) => {
          nodeCoordinates[i].classList.add("visible");
          nodes.map((node) => {
            if (node !== event.target) {
              node.classList.add("faded");
            }
            defaultLines.map((element) => element.classList.add("faded"));
            graphElement.classList.add("faded");
          });
        },
        onmouseleave: (event) => {
          nodeCoordinates[i].classList.remove("visible");
          nodes.map((node) => node.classList.remove("faded"));
          defaultLines.map((element) => element.classList.remove("faded"));
          graphElement.classList.remove("faded");
        },
      })
    );
  }

  const nodeCoordinates = [];
  for (const i of range(graphPoints.length)) {
    const coordString = `${xs[i]} → ${ys[i]}`;
    const { x, y } = graphPoints[i];
    const textAnchor =
      x < graphSize / 4 ? "start" : x < (3 * graphSize) / 4 ? "middle" : "end";
    nodeCoordinates.push(
      svg.g({ class: "node-coords-group" }, [
        svg.line({ class: "grid", x1: x, y1: 0, x2: x, y2: graphSize }),
        svg.line({ class: "grid", x1: 0, y1: y, x2: graphSize, y2: y }),
        svg.text(
          {
            x,
            "y": -y - 6,
            "transform": svg.scale(1, -1),
            "text-anchor": textAnchor,
          },
          [coordString]
        ),
      ])
    );
  }

  return svg.svg(
    {
      width,
      height,
      viewBox: svg.viewBox(0, 0, width, height),
      tabindex: 0,
      style: "outline: none;",
    },
    [
      svg.style({}, [
        `
        .background {
          fill: #BBB2;
          cursor: initial;
        }
        .grid {
          fill: none;
          stroke: #9995;
        }
        .graph {
          stroke: #AAA;
          stroke-width: 1.5px;
          fill: none;
        }
        .graph.faded {
          opacity: 60%;
        }
        .default-line {
          transition: 200ms;
        }
        text {
          font-size: 0.8em;
        }
        .faded {
          opacity: 10%;
        }
        .node {
          r: 3.5px;
          transition: 150ms;
        }
        .node:hover {
          r: 4.5px;
        }
        .node-coords-group {
          opacity: 0%;
          transition: 200ms;
          pointer-events: none;
        }
        .node-coords-group.visible {
          opacity: 100%;
          text-shadow: 0 0 2px #DDD;
        }
      `,
      ]),
      svg.rect({ class: "background", x: 0, y: 0, width, height }),
      svg.g({ transform: svg.translate(0, height).scale(1, -1) }, [
        svg.g({ transform: svg.translate(marginLeft, marginBottom) }, [
          ...defaultLines,
          svg.rect({
            class: "grid",
            x: 0,
            y: 0,
            width: graphSize,
            height: graphSize,
          }),
          graphElement,
          ...nodes,
          ...nodeCoordinates,
          svg.g(
            { transform: svg.translate(0, labelOffset) },
            graphLabels(xMin, translate("axes.mapping.user"), xMax)
          ),
          svg.g(
            {
              transform: svg
                .translate(graphSize, 0)
                .rotate(90)
                .translate(0, labelOffset),
            },
            graphLabels(yMin, translate("axes.mapping.source"), yMax)
          ),
        ]),
      ]),
    ]
  );
}

function buildMappingList(axisController) {
  const axis = axisController.model;

  const makeItem = (user, source) => {
    const item = new ObservableController({ user, source });
    item.addListener((event) => {
      const sortedItems = [...mappingList.items];
      sortedItems.sort((a, b) => a.user - b.user);

      if (!arraysEqual(mappingList.items, sortedItems)) {
        mappingList.setItems(sortedItems);
      }

      const newMapping = sortedItems.map(({ user, source }) => [user, source]);
      axis.mapping = newMapping;
    });
    return item.model;
  };

  const items = axis.mapping?.map(([user, source]) => makeItem(user, source)) || [];

  const mappingList = new UIList();
  mappingList.classList.add("fontra-ui-font-info-axes-panel-axis-box-mapping-list");
  mappingList.columnDescriptions = [
    {
      key: "user",
      title: translate("axes.mapping.user"),
      width: "3.5em",
      align: "right",
      editable: true,
      formatter: NumberFormatter,
      continuous: false,
    },
    {
      key: "source",
      title: translate("axes.mapping.source"),
      width: "3.5em",
      align: "right",
      editable: true,
      formatter: NumberFormatter,
      continuous: false,
    },
  ];
  mappingList.showHeader = true;
  mappingList.minHeight = "5em";
  mappingList.setItems(items);

  const deleteSelectedItem = () => {
    const index = mappingList.getSelectedItemIndex();
    if (index === undefined) {
      return;
    }
    const items = [...mappingList.items];
    items.splice(index, 1);
    mappingList.setItems(items);
    const newMapping = items.map(({ user, source }) => [user, source]);
    axis.mapping = newMapping;
    // addRemoveButton.disableRemoveButton = true;  // this messes with the focus??
  };

  mappingList.addEventListener("deleteKey", deleteSelectedItem);

  const addRemoveButton = html.createDomElement("add-remove-buttons", {
    addButtonCallback: () => {
      const newItem = makeItem(0, 0);
      const newItems = [newItem, ...mappingList.items];
      axis.mapping = items.map(({ user, source }) => [user, source]);
      mappingList.setItems(newItems);
      mappingList.setSelectedItemIndex(0);
      mappingList.editCell(0, "user");
    },
    removeButtonCallback: deleteSelectedItem,
    disableRemoveButton: true,
  });

  updateRemoveButton(mappingList, addRemoveButton);

  return html.div({ style: "display: grid; grid-gap: 0.3em;" }, [
    mappingList,
    addRemoveButton,
  ]);
}

function buildValueLabelList(axisController) {
  const axis = axisController.model;

  const makeItem = (label) => {
    const item = new ObservableController({ ...label });
    item.addListener((event) => {
      const sortedItems = [...labelList.items];
      sortedItems.sort((a, b) => a.value - b.value);

      if (!arraysEqual(labelList.items, sortedItems)) {
        labelList.setItems(sortedItems);
      }

      const newValueLabels = sortedItems.map((valueLabel) => {
        return { ...valueLabel };
      });
      axis.valueLabels = newValueLabels;
    });
    return item.model;
  };

  const items = axis.valueLabels?.map(makeItem) || [];

  const labelList = new UIList();
  labelList.classList.add("fontra-ui-font-info-axes-panel-axis-box-label-list");
  labelList.style = `min-width: 9em;`;
  labelList.columnDescriptions = [
    {
      key: "name",
      title: translate("axes.mapping.values.name"),
      width: "5em",
      editable: true,
      continuous: false,
    },
    {
      key: "value",
      title: translate("axes.mapping.values.value"),
      width: "3em",
      align: "right",
      editable: true,
      formatter: NumberFormatter,
      continuous: false,
    },
    {
      key: "minValue",
      title: translate("axes.mapping.values.min"),
      width: "3.5em",
      align: "right",
      editable: true,
      formatter: OptionalNumberFormatter,
      continuous: false,
    },
    {
      key: "maxValue",
      title: translate("axes.mapping.values.max"),
      width: "3.5em",
      align: "right",
      editable: true,
      formatter: OptionalNumberFormatter,
      continuous: false,
    },
    {
      key: "linkedValue",
      title: translate("axes.mapping.values.linked"),
      width: "3.5em",
      align: "right",
      editable: true,
      formatter: OptionalNumberFormatter,
      continuous: false,
    },
    {
      key: "dummy",
      title: " ",
      width: "0.25em",
    },
    {
      key: "elidable",
      title: translate("axes.mapping.values.elidable"),
      width: "3.5em",
      cellFactory: checkboxListCell,
    },
    // {
    //   key: "olderSibling",
    //   title: "Older sibling",
    //   width: "3em",
    // },
  ];
  labelList.showHeader = true;
  labelList.minHeight = "5em";
  labelList.setItems(items);

  const deleteSelectedItem = () => {
    const index = labelList.getSelectedItemIndex();
    if (index === undefined) {
      return;
    }
    const items = [...labelList.items];
    items.splice(index, 1);
    labelList.setItems(items);
    const newValueLabels = items.map((valueLabel) => {
      return { ...valueLabel };
    });
    axis.valueLabels = newValueLabels;
    // addRemoveButton.disableRemoveButton = true;  // this messes with the focus??
  };

  labelList.addEventListener("deleteKey", deleteSelectedItem);

  const addRemoveButton = html.createDomElement("add-remove-buttons", {
    addButtonCallback: () => {
      const newItem = makeItem({ name: "Untitled", value: 0 });
      const newItems = [newItem, ...labelList.items];
      axis.valueLabels = newItems.map((label) => {
        return { ...label };
      });
      labelList.setItems(newItems);
      labelList.setSelectedItemIndex(0);
      labelList.editCell(0, "name");
    },
    removeButtonCallback: deleteSelectedItem,
    disableRemoveButton: true,
  });

  updateRemoveButton(labelList, addRemoveButton);

  return html.div({ style: "display: grid; grid-gap: 0.3em;" }, [
    labelList,
    addRemoveButton,
  ]);
}

// TODO: Refactor this.
export function updateRemoveButton(list, buttons) {
  list.addEventListener("listSelectionChanged", (event) => {
    buttons.disableRemoveButton = list.getSelectedItemIndex() === undefined;
  });
}

function arraysEqual(arrayA, arrayB) {
  if (arrayA.length !== arrayB.length) {
    return false;
  }
  for (const [itemA, itemB] of zip(arrayA, arrayB)) {
    if (itemA !== itemB) {
      return false;
    }
  }
  return true;
}
