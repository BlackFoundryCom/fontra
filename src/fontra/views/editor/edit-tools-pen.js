import { consolidateChanges } from "../core/changes.js";
import { reversed, roundPoint } from "../core/utils.js";
import * as vector from "../core/vector.js";
import { BaseTool, shouldInitiateDrag } from "./edit-tools-base.js";
import { constrainHorVerDiag } from "./edit-behavior.js";


export class PenTool extends BaseTool {

  handleHover(event) {
    if (!this.sceneModel.selectedGlyphIsEditing) {
      this.editor.tools["pointer-tool"].handleHover(event);
      return;
    }
    this.canvasController.canvas.style.cursor = "crosshair";
  }

  async handleDrag(eventStream, initialEvent) {
    if (!this.sceneModel.selectedGlyphIsEditing) {
      await this.editor.tools["pointer-tool"].handleDrag(eventStream, initialEvent);
      return;
    }
    const editContext = await this.sceneController.getGlyphEditContext(this);
    if (!editContext) {
      return;
    }

    const initialSelection = this.sceneController.selection;

    const anchorPoint = roundPoint(this.sceneController.selectedGlyphPoint(initialEvent));
    const pointAdder = new PointAdder(
      editContext.glyphController.instance.path,
      initialSelection,
      anchorPoint,
    );

    this.sceneController.selection = pointAdder.getSelection();

    await editContext.editBegin();
    await editContext.editSetRollback(pointAdder.getRollbackChange());
    await editContext.editIncremental(pointAdder.getInitialChange());

    if (await shouldInitiateDrag(eventStream, initialEvent)) {
      pointAdder.startDragging();
      this.sceneController.selection = pointAdder.getSelection();
      await editContext.editSetRollback(pointAdder.getRollbackChange());
      await editContext.editIncremental(pointAdder.getInitialChange());

      let moveChange;
      for await (const event of eventStream) {
        const point = this.sceneController.selectedGlyphPoint(event);
        moveChange = pointAdder.getIncrementalChange(point, event.shiftKey);
        await editContext.editIncrementalMayDrop(moveChange);
      }
      if (moveChange) {
        await editContext.editIncremental(moveChange);
      }
    }

    const undoInfo = {
      "label": "draw point",
      "undoSelection": initialSelection,
      "redoSelection": this.sceneController.selection,
      "location": this.sceneController.getLocation(),
    }

    await editContext.editEnd(pointAdder.getFinalChange(), undoInfo);
  }

}


class PointAdder {

  constructor(path, initialSelection, anchorPoint) {
    this.path = path;
    this.initialSelection = initialSelection;
    this.anchorPoint = anchorPoint;
    this.isNewContour = false;
    this._rollbackChanges = [];
    this._editChanges = [];
    this._moveChanges = [];
    let [contourIndex, contourPointIndex, isAppend] = getAppendIndices(path, initialSelection);

    if (contourIndex === undefined) {
      // Let's add a new contour
      this.isNewContour = true;
      contourIndex = path.numContours;
      contourPointIndex = 0;

      this._rollbackChanges.push(deleteContour(contourIndex));
      this._editChanges.push(appendEmptyContour(contourIndex));
    }

    let contourStartPoint;
    if (contourIndex >= path.numContours) {
      contourStartPoint = path.numPoints;
    } else {
      contourStartPoint = path.getAbsolutePointIndex(contourIndex, 0, true);
    }
    this._newSelection = new Set([`point/${contourStartPoint + contourPointIndex}`]);

    this._rollbackChanges.push(deletePoint(contourIndex, contourPointIndex));
    this._editChanges.push(insertPoint(contourIndex, contourPointIndex, anchorPoint));

    this.contourIndex = contourIndex;
    this.contourPointIndex = contourPointIndex;
    this.isAppend = isAppend;
    this.contourStartPoint = contourStartPoint;
  }

  startDragging() {
    // Let's start over, revert the last insertPoint
    this._rollbackChanges.splice(-1);
    this._editChanges.splice(-1);

    const [handleInIndex, handleOutIndex, insertIndices, newPoints] = (
      this.isNewContour
      ?
      this._getIndicesAndPointsHandleOut()
      :
      this._getIndicesAndPointsHandleInOut()
    );
    this.handleInIndex = handleInIndex;
    this.handleOutIndex = handleOutIndex;

    for (let i = 0; i < newPoints.length; i++) {
      this._rollbackChanges.push(deletePoint(this.contourIndex, insertIndices[i]));
      this._editChanges.push(insertPoint(this.contourIndex, insertIndices[i], newPoints[i]));
    }

    this._newSelection = new Set([`point/${this.contourStartPoint + this.handleOutIndex}`]);
  }

  _getIndicesAndPointsHandleOut() {
    let handleInIndex, handleOutIndex, insertIndices;
    if (this.isAppend) {
      handleInIndex = undefined;
      const anchorIndex = this.contourPointIndex;
      handleOutIndex = this.contourPointIndex + 1;
      insertIndices = [anchorIndex, handleOutIndex];
    } else {
      handleInIndex = undefined;
      handleOutIndex = 0;
      insertIndices = [0, 0];
    }
    const newPoints = [
      {...this.anchorPoint},
      {...this.anchorPoint, "type": "cubic"},
    ];
    return [handleInIndex, handleOutIndex, insertIndices, newPoints];
  }

  _getIndicesAndPointsHandleInOut() {
    let handleInIndex, handleOutIndex, insertIndices;
    if (this.isAppend) {
      handleInIndex = this.contourPointIndex;
      const anchorIndex = this.contourPointIndex + 1;
      handleOutIndex = this.contourPointIndex + 2;
      insertIndices = [handleInIndex, anchorIndex, handleOutIndex];
    } else {
      handleInIndex = 2;
      handleOutIndex = 0;
      insertIndices = [0, 0, 0];
    }
    const newPoints = [
      {...this.anchorPoint, "type": "cubic"},
      {...this.anchorPoint, "smooth": true},
      {...this.anchorPoint, "type": "cubic"},
    ];
    return [handleInIndex, handleOutIndex, insertIndices, newPoints];
  }

  getSelection() {
    return this._newSelection;
  }

  getRollbackChange() {
    return consolidateChanges([...reversed(this._rollbackChanges)]);
  }

  getInitialChange() {
    return consolidateChanges(this._editChanges);
  }

  getIncrementalChange(point, constrain) {
    const handleOut = getHandle(point, this.anchorPoint, constrain);
    this._moveChanges = [];
    if (this.handleInIndex !== undefined) {
      const handleIn = oppositeHandle(this.anchorPoint, handleOut);
      this._moveChanges.push(
        movePoint(this.contourStartPoint + this.handleInIndex, handleIn.x, handleIn.y)
      );
    }
    this._moveChanges.push(
      movePoint(this.contourStartPoint + this.handleOutIndex, handleOut.x, handleOut.y)
    );
    return consolidateChanges(this._moveChanges);
  }

  getFinalChange() {
    return consolidateChanges(this._editChanges.concat(this._moveChanges));
  }

}


function getAppendIndices(path, selection) {
  if (selection.size === 1) {
    const sel = [...selection][0];
    const [tp, pointIndex] = sel.split("/");
    if (pointIndex < path.numPoints) {
      const [selContourIndex, selContourPointIndex] = path.getContourAndPointIndex(pointIndex);
      const numPointsContour = path.getNumPointsOfContour(selContourIndex);
      if (
        !path.contourInfo[selContourIndex].isClosed
        && (selContourPointIndex === 0 || selContourPointIndex === numPointsContour - 1)
      ) {
        // Let's append or prepend a point to an existing contour
        const contourIndex = selContourIndex;
        const isAppend = !!(selContourPointIndex || numPointsContour === 1);
        const contourPointIndex = isAppend ? selContourPointIndex + 1 : 0;
        return [contourIndex, contourPointIndex, isAppend];
      }
    }
  }
  return [undefined, undefined, true];
}


function deleteContour(contourIndex) {
  return {
    "p": ["path"],
    "f": "deleteContour",
    "a": [contourIndex],
  };
}

function appendEmptyContour(contourIndex) {
  return {
    "p": ["path"],
    "f": "insertContour",
    "a": [contourIndex, emptyContour()],
  };
}

function deletePoint(contourIndex, contourPointIndex) {
  return {
    "p": ["path"],
    "f": "deletePoint",
    "a": [contourIndex, contourPointIndex],
  };
}

function insertPoint(contourIndex, contourPointIndex, point) {
  return {
    "p": ["path"],
    "f": "insertPoint",
    "a": [contourIndex, contourPointIndex, point],
  };
}

function movePoint(pointIndex, x, y) {
  return {
    "p": ["path"],
    "f": "=xy",
    "a": [pointIndex, x, y],
  };
}

function emptyContour() {
  return {"coordinates": [], "pointTypes": [], "isClosed": false};
}


function getHandle(handleOut, anchorPoint, constrain) {
  if (constrain) {
    handleOut = shiftConstrain(anchorPoint, handleOut);
  }
  return roundPoint(handleOut);
}


function oppositeHandle(anchorPoint, handlePoint) {
  return vector.addVectors(
    anchorPoint, vector.mulVector(vector.subVectors(handlePoint, anchorPoint), -1)
  );
}

function shiftConstrain(anchorPoint, handlePoint) {
  const delta = constrainHorVerDiag(vector.subVectors(handlePoint, anchorPoint));
  return vector.addVectors(anchorPoint, delta);
}
