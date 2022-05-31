import { consolidateChanges } from "../core/changes.js";
import { modulo, reversed } from "../core/utils.js";
import * as vector from "../core/vector.js";
import {
  NIL, SEL, UNS, SHA, SMO, OFF, ANY,
  POINT_TYPES,
  buildPointMatchTree,
} from "./edit-behavior-support.js";


export class EditBehaviorFactory {

  constructor(instance, selection) {
    this.instance = instance;
    const selectionByType = splitSelectionByType(selection);
    this.pointSelectionByContour = splitPointSelectionByContour(instance.path, selectionByType["point"] || []);
    this.componentSelection = selectionByType["component"] || [];

    // Set up all behaviors up front. TODO: do this on-demand.
    this.behaviors = {};
    for (const behaviorName of Object.keys(behaviorTypes)) {
      this.behaviors[behaviorName] = new EditBehavior(this.instance, this.pointSelectionByContour, this.componentSelection, behaviorTypes[behaviorName]);
    }
  }

  getBehavior(behaviorName) {
    return this.behaviors[behaviorName];
  }

}


class EditBehavior {

  constructor(instance, pointSelectionByContour, componentSelection, behavior) {
    this.constrainDelta = behavior.constrainDelta || (v => v);
    const [pointEditFuncs, participatingPointIndices] = makePointEditFuncs(
      instance.path, pointSelectionByContour, behavior,
    );
    this.pointEditFuncs = pointEditFuncs;

    this.componentEditFuncs = componentSelection.map(
      componentIndex => makeComponentTransformFunc(instance.components, componentIndex)
    );

    this.rollbackChange = makeRollbackChange(instance, participatingPointIndices, componentSelection);
  }

  makeChangeForDelta(delta) {
    delta = this.constrainDelta(delta);
    return this.makeChangeForTransformFunc(
      point => {
        return {"x": point.x + delta.x, "y": point.y + delta.y};
      }
    );
  }

  makeChangeForTransformFunc(transformFunc) {
    const pathChanges = this.pointEditFuncs?.map(
      editFunc => makePointChange(...editFunc(transformFunc))
    );
    const componentChanges = this.componentEditFuncs?.map(
      editFunc => makeComponentOriginChange(...editFunc(transformFunc))
    );
    const changes = [];
    if (pathChanges && pathChanges.length) {
      changes.push(consolidateChanges(pathChanges, ["path"]));
    }
    if (componentChanges && componentChanges.length) {
      changes.push(consolidateChanges(componentChanges, ["components"]));
    }
    return consolidateChanges(changes);
  }

}


function makeRollbackChange(instance, pointSelection, componentSelection) {
  const path = instance.path;
  const components = instance.components;

  const pointRollback = pointSelection?.map(
    pointIndex => {
      const point = path.getPoint(pointIndex);
      return makePointChange(pointIndex, point.x, point.y);
    }
  );
  const componentRollback = componentSelection?.map(
    componentIndex => {
      const t = components[componentIndex].transformation;
      return makeComponentOriginChange(componentIndex, t.x, t.y);
    }
  );
  const changes = [];
  if (pointRollback) {
    changes.push(consolidateChanges(pointRollback, ["path"]));
  }
  if (componentRollback) {
    changes.push(consolidateChanges(componentRollback, ["components"]));
  }
  return consolidateChanges(changes);
}


function makeComponentTransformFunc(components, componentIndex) {
  const origin = {
    "x": components[componentIndex].transformation.x,
    "y": components[componentIndex].transformation.y,
  };
  return transformFunc => {
    const editedOrigin = transformFunc(origin);
    return [componentIndex, editedOrigin.x, editedOrigin.y];
  }
}


function makePointChange(pointIndex, x, y) {
  return {"f": "=xy", "k": pointIndex, "a": [x, y]};
}


function makeComponentOriginChange(componentIndex, x, y) {
  return {
    "p": [componentIndex, "transformation"],
    "c": [{"f": "=", "k": "x", "v": x}, {"f": "=", "k": "y", "v": y}],
  };
}


function splitSelectionByType(selection) {
  const result = {};
  for (const selItem of selection) {
    let [tp, index] = selItem.split("/");
    if (result[tp] === undefined) {
      result[tp] = [];
    }
    result[tp].push(Number(index));
  }
  for (const indices of Object.values(result)) {
    // Ensure indices are sorted
    indices.sort((a, b) => a - b);
  }
  return result;
}


function splitPointSelectionByContour(path, pointIndices) {
  // Return an array with one item per contour. An item is either `undefined`,
  // when no points from this contour are selected, or it is an array containing
  // the indices of selected points in this contour.
  const contours = new Array(path.contourInfo.length);
  let contourIndex = 0;
  for (const pointIndex of pointIndices) {
    while (path.contourInfo[contourIndex].endPoint < pointIndex) {
      contourIndex++;
    }
    if (contours[contourIndex] === undefined) {
      contours[contourIndex] = [];
    }
    contours[contourIndex].push(pointIndex);
  }
  return contours;
}


function makePointEditFuncs(path, selectedContourPointIndices, behavior) {
  if (selectedContourPointIndices.length !== path.contourInfo.length) {
    throw new Error("assert -- contour arrays length mismatch");
  }
  let contourStartPoint = 0;
  const pointEditFuncs = [];
  const participatingPointIndices = [];
  for (let i = 0; i < path.contourInfo.length; i++) {
    const contourEndPoint = path.contourInfo[i].endPoint + 1;
    const selectedPointIndices = selectedContourPointIndices[i];
    if (selectedPointIndices !== undefined) {
      const [editFuncs, pointIndices] = makeContourPointEditFuncs(
        path,
        selectedPointIndices,
        contourStartPoint,
        contourEndPoint,
        path.contourInfo[i].isClosed,
        behavior,
      );
      pointEditFuncs.push(...editFuncs);
      participatingPointIndices.push(...pointIndices);
    }
    contourStartPoint = contourEndPoint;
  }
  return [pointEditFuncs, participatingPointIndices];
}


function makeContourPointEditFuncs(path, selectedPointIndices, startPoint, endPoint, isClosed, behavior) {
  const numPoints = endPoint - startPoint;
  const contourPoints = new Array(numPoints);
  const participatingPointIndices = [];
  for (let i = 0; i < numPoints; i++) {
    contourPoints[i] = path.getPoint(i + startPoint);
  }
  for (const pointIndex of selectedPointIndices) {
    contourPoints[pointIndex - startPoint].selected = true;
  }
  const originalPoints = Array.from(contourPoints);
  const temporaryPoints = Array.from(contourPoints);
  const editFuncsTransform = [];
  const editFuncsConstrain = [];

  for (let i = 0; i < numPoints; i++) {
    const [match, neighborIndices] = findPointMatch(behavior.matchTree, i, contourPoints, numPoints, isClosed);
    if (match === undefined) {
      continue;
    }
    const [prevPrev, prev, thePoint, next, nextNext] = match.direction > 0 ? neighborIndices : reversed(neighborIndices);
    participatingPointIndices.push(thePoint + startPoint);
    const points = originalPoints;
    const editPoints = temporaryPoints;
    const actionFuncionFactory = behavior.actions[match.action];
    if (actionFuncionFactory === undefined) {
      console.log(`Undefined action function: ${match.action}`);
      continue;
    }
    const actionFunc = actionFuncionFactory(points, prevPrev, prev, thePoint, next, nextNext);
    if (!match.constrain) {
      // transform
      editFuncsTransform.push(transformFunc => {
        const point = actionFunc(transformFunc, points, prevPrev, prev, thePoint, next, nextNext);
        editPoints[thePoint] = point;
        return [thePoint + startPoint, point.x, point.y];
      });
    } else {
      // constrain
      editFuncsConstrain.push(transformFunc => {
        const point = actionFunc(transformFunc, editPoints, prevPrev, prev, thePoint, next, nextNext);
        return [thePoint + startPoint, point.x, point.y];
      });
    }
  }
  return [editFuncsTransform.concat(editFuncsConstrain), participatingPointIndices];
}


function findPointMatch(matchTree, pointIndex, contourPoints, numPoints, isClosed) {
  let match = matchTree;
  const neighborIndices = new Array();
  for (let neightborOffset = -2; neightborOffset < 3; neightborOffset++) {
    let neighborIndex = pointIndex + neightborOffset;
    if (isClosed) {
      neighborIndex = modulo(neighborIndex, numPoints);
    }
    neighborIndices.push(neighborIndex);
    const point = contourPoints[neighborIndex];
    let pointType;
    if (point === undefined) {
      pointType = DOESNT_EXIST;
    } else {
      const smooth = boolInt(point.smooth);
      const oncurve = boolInt(point.type === 0);
      const selected = boolInt(point.selected);
      pointType = POINT_TYPES[smooth][oncurve][selected];
    }
    match = match[pointType];
    if (match === undefined) {
      // No match
      break;
    }
  }
  return [match, neighborIndices];
}


function boolInt(v) {
  return v ? 1 : 0;
}


const defaultRules = [
  //   prevPrev    prev        the point   next        nextNext    Constrain   Action

  // Default rule: if no other rules apply, just move the selected point
  [    ANY|NIL,    ANY|NIL,    ANY|SEL,    ANY|NIL,    ANY|NIL,    false,      "Move"],

  // Off-curve point next to a smooth point next to a selected point
  [    ANY|SEL,    SMO|UNS,    OFF,        OFF|SHA|NIL,ANY|NIL,    true,       "RotateNext"],

  // Selected tangent point: its neighboring off-curve point should move
  [    SHA|SMO,    SMO|SEL,    OFF|UNS,    OFF|SHA|NIL,ANY|NIL,    true,       "RotateNext"],

  // Selected tangent point, selected handle: constrain both on original angle
  [    SHA|SMO|UNS,SMO|SEL,    OFF|SEL,    OFF|SHA|NIL,ANY|NIL,    true,       "ConstrainPrevAngle"],
  [    ANY,        SHA|SMO|UNS,SMO|SEL,    OFF|SEL,    OFF|SHA|NIL,true,       "ConstrainMiddle"],

  // Free off-curve point, move with on-curve neighbor
  [    ANY|NIL,    SHA|SEL,    OFF,        OFF|SHA|NIL,ANY|NIL,    false,      "Move"],
  [    OFF,        SMO|SEL,    OFF,        OFF|SHA|NIL,ANY|NIL,    false,      "Move"],

  // An unselected off-curve between two on-curve points
  [    ANY,        SMO|SHA|SEL,OFF|UNS,    SMO|SHA,    ANY|NIL,    true,       "HandleIntersect"],
  // An unselected off-curve between two smooth points
  [    ANY|SEL,    SMO,        OFF|UNS,    SMO,        ANY|NIL,    true,       "TangentIntersect"],

  // Tangent bcp constraint
  [    SMO|SHA,    SMO|UNS,    OFF|SEL,    ANY|NIL,    ANY|NIL,    false,      "ConstrainPrevAngle"],

  // Two selected points with an unselected smooth point between them
  [    ANY|SEL,    SMO|UNS,    ANY|SEL,    ANY|NIL,    ANY|NIL,    false,      "ConstrainPrevAngle"],
  [    ANY|SEL,    SMO|UNS,    ANY|SEL,    SMO|UNS,    ANY|SEL,    false,      "DontMove"],
  [    ANY|SEL,    SMO|UNS,    ANY|SEL,    SMO|UNS,    SMO|UNS,    false,      "DontMove"],

];


const defaultActions = {

  "DontMove": (points, prevPrev, prev, thePoint, next, nextNext) => {
    return (transformFunc, points, prevPrev, prev, thePoint, next, nextNext) => {
      return points[thePoint];
    };
  },

  "Move": (points, prevPrev, prev, thePoint, next, nextNext) => {
    return (transformFunc, points, prevPrev, prev, thePoint, next, nextNext) => {
      return transformFunc(points[thePoint]);
    };
  },

  "RotateNext": (points, prevPrev, prev, thePoint, next, nextNext) => {
    const handle = vector.subVectors(points[thePoint], points[prev]);
    const handleLength = Math.hypot(handle.x, handle.y);
    return (transformFunc, points, prevPrev, prev, thePoint, next, nextNext) => {
      const delta = vector.subVectors(points[prev], points[prevPrev]);
      const angle = Math.atan2(delta.y, delta.x);
      const handlePoint = {
        "x": points[prev].x + handleLength * Math.cos(angle),
        "y": points[prev].y + handleLength * Math.sin(angle),
      }
      return handlePoint;
    };
  },

  "ConstrainPrevAngle": (points, prevPrev, prev, thePoint, next, nextNext) => {
    const pt1 = points[prevPrev]
    const pt2 = points[prev];
    const perpVector = vector.rotateVector90CW(vector.subVectors(pt2, pt1));
    return (transformFunc, points, prevPrev, prev, thePoint, next, nextNext) => {
      let point = transformFunc(points[thePoint]);
      const [intersection, t1, t2] = vector.intersect(pt1, pt2, point, vector.addVectors(point, perpVector));
      return intersection;
    };
  },

  "ConstrainMiddle": (points, prevPrev, prev, thePoint, next, nextNext) => {
    const pt1 = points[prev]
    const pt2 = points[next];
    const perpVector = vector.rotateVector90CW(vector.subVectors(pt2, pt1));
    return (transformFunc, points, prevPrev, prev, thePoint, next, nextNext) => {
      let point = transformFunc(points[thePoint]);
      const [intersection, t1, t2] = vector.intersect(pt1, pt2, point, vector.addVectors(point, perpVector));
      return intersection;
    };
  },

  "TangentIntersect": (points, prevPrev, prev, thePoint, next, nextNext) => {
    return (transformFunc, points, prevPrev, prev, thePoint, next, nextNext) => {
      let point = transformFunc(points[thePoint]);
      const [intersection, t1, t2] = vector.intersect(points[prevPrev], points[prev], points[next], points[nextNext]);
      if (!intersection) {
        // TODO: fallback to midPoint?
      }
      return intersection;
    };
  },

  "HandleIntersect": (points, prevPrev, prev, thePoint, next, nextNext) => {
    const vector1 = vector.subVectors(points[thePoint], points[prev]);
    const vector2 = vector.subVectors(points[thePoint], points[next]);
    return (transformFunc, points, prevPrev, prev, thePoint, next, nextNext) => {
      let point = transformFunc(points[thePoint]);
      const [intersection, t1, t2] = vector.intersect(points[prev], vector.addVectors(points[prev], vector1), points[next], vector.addVectors(points[next], vector2));
      if (!intersection) {
        // TODO: fallback to midPoint?
      }
      return intersection;
    };
  },

}


const behaviorTypes = {

  "default": {
    "matchTree": buildPointMatchTree(defaultRules),
    "actions": defaultActions,
  },

  "constrain": {
    "matchTree": buildPointMatchTree(defaultRules),
    "actions": defaultActions,
    "constrainDelta": vector.constrainHorVer,
  },

}
