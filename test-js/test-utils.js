import { expect } from "chai";
import {
  arrayExtend,
  boolInt,
  capitalizeFirstLetter,
  chain,
  clamp,
  consolidateCalls,
  dumpURLFragment,
  enumerate,
  fileNameExtension,
  getCharFromUnicode,
  guessCharFromGlyphName,
  hyphenatedToCamelCase,
  loadURLFragment,
  makeUPlusStringFromCodePoint,
  makeUPlusStringFromCodePoints,
  memoize,
  modulo,
  objectsEqual,
  parseCookies,
  parseSelection,
  product,
  range,
  reversed,
  reversedEnumerate,
  rgbaToCSS,
  round,
  scheduleCalls,
  splitGlyphNameExtension,
  throttleCalls,
  withTimeout,
} from "../src/fontra/client/core/utils.js";

import { getTestData, parametrize } from "./test-support.js";

describe("objectsEquals", () => {
  it("falsy values", () => {
    expect(objectsEqual(null, null)).equals(true);
    expect(objectsEqual(undefined, null)).equals(false);
    expect(objectsEqual("", "")).equals(true);
    expect(objectsEqual("", null)).equals(false);
  });
  it("with things inside", () => {
    expect(objectsEqual({}, { a: 1 })).equals(false);
    expect(objectsEqual({ a: 1 }, {})).equals(false);
    expect(objectsEqual({ a: 1 }, { a: 2 })).equals(false);
    expect(objectsEqual({ a: 2 }, { a: 2 })).equals(true);
  });
  it("thing in their prototype", () => {
    // making sure only objects own properties checked
    class Thing {
      constructor(value) {
        this.b = value;
      }
    }
    Thing.prototype.a = 1;
    expect(objectsEqual(new Thing(1), { b: 1 })).equals(true);
    expect(objectsEqual(new Thing(1), { b: 1, a: 1 })).equals(false);
  });
});

describe("consolidateCalls", () => {
  it("returns a function that will be executed in the next cycle of event loop", () => {
    let itWorked = false;
    const fun = consolidateCalls(() => {
      itWorked = true;
    });
    fun();
    expect(itWorked).to.be.false;
    setTimeout(() => {
      expect(itWorked).to.be.true;
    });
  });
  it("the callback should be executed only once", () => {
    let workedTimes = 0;
    const fun = consolidateCalls(() => {
      workedTimes++;
    });
    expect(workedTimes).to.be.equals(0);
    fun();
    expect(workedTimes).to.be.equals(0);
    fun();
    setTimeout(() => {
      expect(workedTimes).to.be.equals(1);
    });
  });
});

describe("scheduleCalls", () => {
  it("schedules a function to be executed with given timeout", () => {
    let worked = false;
    const fun = scheduleCalls(() => {
      worked = true;
    });
    fun();
    expect(worked).to.be.false;
    setTimeout(() => {
      expect(worked).to.be.true;
    });
  });
  it("delete the previous schedule, creates a new one, if the function executed before timeout", () => {
    let worked = false;
    const fun = scheduleCalls(() => {
      worked = true;
    }, 5);
    fun();
    setTimeout(() => {
      expect(worked).to.be.false;
      fun();
    }, 4);
    setTimeout(() => {
      expect(worked).to.be.false;
    }, 8);
    setTimeout(() => {
      expect(worked).to.be.true;
    }, 12);
  });
});

describe("throttleCalls", () => {
  it("delays the consequent call if it is executed before the given time in milliseconds", () => {
    let workedTimes = 0;
    const fun = throttleCalls(() => {
      workedTimes++;
    }, 10);
    fun();
    fun();
    expect(workedTimes).to.be.equal(1);
    setTimeout(() => {
      expect(workedTimes).to.be.equal(2);
    }, 20);
  });
  it("ignore the consequent call if it is another call already scheduled", () => {
    let workedTimes = 0;
    const fun = throttleCalls(() => {
      workedTimes++;
    }, 10);
    fun();
    fun();
    setTimeout(() => {
      fun();
    }, 5);
    expect(workedTimes).to.be.equal(1);
    setTimeout(() => {
      expect(workedTimes).to.be.equal(2);
    }, 20);
  });
});

describe("parseCookies", () => {
  it("should parse the given cookie string", () => {
    expect(parseCookies("cacao=yes;fruits=no")).deep.equal({
      cacao: "yes",
      fruits: "no",
    });
    expect(parseCookies("cacao=no;fruits=no;fruits=yes")).deep.equal({
      cacao: "no",
      fruits: "yes",
    });
  });
  it("should parse the given cookie with trailing semicolon", () => {
    expect(parseCookies("cacao=yes;fruits=no;")).deep.equal({
      cacao: "yes",
      fruits: "no",
    });
  });
});

describe("capitalizeFirstLetter", () => {
  it("basic functionality", () => {
    expect(capitalizeFirstLetter("sam")).equals("Sam");
    expect(capitalizeFirstLetter("Sam")).equals("Sam");
  });
  it("with spaces prefixed", () => {
    expect(capitalizeFirstLetter(" sam")).equals(" sam");
  });
});

describe("hyphenatedToCamelCase", () => {
  it("should camelize", () => {
    expect(hyphenatedToCamelCase("test-case")).equals("testCase");
  });
  it("should not delete the hypen when the second part is not a lowercase letter", () => {
    expect(hyphenatedToCamelCase("test-1")).equals("test-1");
  });
});

describe("modulo", () => {
  it("should return the remaining when divide", () => {
    expect(modulo(12, 5)).equals(2);
  });
  it("python behavior of modulus when mod a minus value", () => {
    expect(modulo(-3, 5)).equals(2);
  });
});

describe("boolInt", () => {
  it("1 for truthy", () => {
    expect(boolInt(true)).equals(1);
    expect(boolInt([])).equals(1);
    expect(boolInt(1)).equals(1);
    expect(boolInt({})).equals(1);
  });
  it("0 for falsy", () => {
    expect(boolInt(false)).equals(0);
    expect(boolInt("")).equals(0);
    expect(boolInt(0)).equals(0);
    expect(boolInt(null)).equals(0);
    expect(boolInt(undefined)).equals(0);
  });
});

describe("reversed", () => {
  it("reverse an iterator", () => {
    const numbers = [1, 2, 3];
    const numbersReversed = [...reversed(numbers)];
    expect(numbersReversed).deep.equals([3, 2, 1]);
  });
});

describe("enumerate", () => {
  it("enumerate an array, enumeration start with 0 by default", () => {
    const numbers = [1, 2, 3];
    const numbersEnumerated = [...enumerate(numbers)];
    expect(numbersEnumerated).deep.equals([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
  });
  it("enumaration start with a different number than 0", () => {
    const numbers = [1, 2, 3];
    const numbersEnumerated = [...enumerate(numbers, 1)];
    expect(numbersEnumerated).deep.equals([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });
});

describe("reversedEnumerate", () => {
  it("enumerate and reverse an iterator", () => {
    const numbers = [1, 2, 3];
    const numbersReversed = [...reversedEnumerate(numbers)];
    expect(numbersReversed).deep.equals([
      [2, 3],
      [1, 2],
      [0, 1],
    ]);
  });
});

describe("range", () => {
  it("should generate a range of numbers", () => {
    const numbers = [...range(3)];
    expect(numbers).deep.equals([0, 1, 2]);
  });
  it("should generate a range of numbers, with start and stop values", () => {
    const numbers = [...range(10, 13)];
    expect(numbers, [10, 11, 12]);
  });
  it("should generate a range of numbers, with start, stop and step values", () => {
    const numbers = [...range(10, 15, 2)];
    expect(numbers, [10, 12, 14]);
  });
});

describe("chain", () => {
  it("chain iterators", () => {
    const chained = [...chain(range(2), range(2))];
    expect(chained, [0, 1, 0, 1]);
  });
});

describe("makeUPlusStringFromCodePoint", () => {
  it("throws an exception when an invalid parameter is given", () => {
    expect(() => makeUPlusStringFromCodePoint("not-a-number")).to.throw();
  });
  it("should not throw an exception for a falsy value", () => {
    expect(() => makeUPlusStringFromCodePoint("")).to.not.throw();
  });
  it("make a number unicode hex", () => {
    expect(makeUPlusStringFromCodePoint(97)).equals("U+0061"); // a
    expect(makeUPlusStringFromCodePoint(65)).equals("U+0041"); // A
  });
});

describe("makeUPlusStringFromCodePoints", () => {
  it("throws an exception when an invalid parameter is given", () => {
    expect(() => makeUPlusStringFromCodePoints("not-a-number")).to.throw();
  });
  it("should not throw an exception for a falsy value", () => {
    expect(() => makeUPlusStringFromCodePoints("")).to.not.throw();
  });
  it("make an array unicode hex", () => {
    expect(makeUPlusStringFromCodePoints([97, 65])).equals("U+0061,U+0041"); // a,A
  });
  it("make an array unicode hex", () => {
    expect(makeUPlusStringFromCodePoints(97)).equals("U+0061"); // a
  });
});

describe("parseSelection", () => {
  it("should parse given selection info, return in order", () => {
    expect(parseSelection(["point/2", "point/3", "point/4"])).deep.equal({
      point: [2, 3, 4],
    });
  });
});

describe("getCharFromUnicode", () => {
  it("should return an empty string if an argument is not passed", () => {
    expect(getCharFromUnicode()).equals("");
  });
  it("should convert a unicode symbol number to a character", () => {
    expect(getCharFromUnicode(97)).equals("a");
  });
});

describe("guessCharFromGlyphName", () => {
  it("should guess a character from code points in free text", () => {
    expect(guessCharFromGlyphName("text 0061 text")).equals("a");
    expect(guessCharFromGlyphName("text ff0061 text")).equals("a");
    expect(guessCharFromGlyphName("text ff0041 text")).equals("A");
    expect(guessCharFromGlyphName("text 110000 text")).equals("");
    expect(guessCharFromGlyphName("text 10FFFF text")).equals("");
    expect(guessCharFromGlyphName("text 100000 text")).equals("");
    expect(guessCharFromGlyphName("text 1F440 text")).equals("👀");
  });
});

describe("fileNameExtension", () => {
  it("should return the file extension of a file name", () => {
    expect(fileNameExtension("test-utils.js")).equals("js");
  });
  it("should work well when there is a dot in the file name", () => {
    expect(fileNameExtension("test.utils.js")).equals("js");
  });
  it("should return the given file name when there is no extension", () => {
    expect(fileNameExtension("utils")).equals("utils");
  });
});

describe("arrayExtend", () => {
  it("should extend arrays with another one", () => {
    const array = [1, 2, 3];
    arrayExtend(array, [4, 5]);
    expect(array).deep.equals([1, 2, 3, 4, 5]);
  });
  it("test chunk-by-chunk addition by 1024", () => {
    const destinationArray = [1, 2, 3];
    arrayExtend(destinationArray, [...range(1025)]);
    expect(destinationArray).deep.equals([1, 2, 3, ...range(1025)]);
  });
});

describe("rgbaToCSS", () => {
  it("should convert an array of decimals to rgb string", () => {
    expect(rgbaToCSS([0, 0, 0])).to.be.equal("rgb(0,0,0)");
    expect(rgbaToCSS([0, 1, 0])).to.be.equal("rgb(0,255,0)");
    expect(rgbaToCSS([1, 0, 0, 1])).to.be.equal("rgb(255,0,0)");
  });
  it("should convert an array of decimals to rgba string", () => {
    expect(rgbaToCSS([0, 0, 0, 0])).to.be.equal("rgba(0,0,0,0)");
    expect(rgbaToCSS([0, 0, 0, 0.2])).to.be.equal("rgba(0,0,0,51)");
  });
  it("should always create rgb if the opacity is 1", () => {
    expect(rgbaToCSS([0, 0, 0, 1])).to.be.equal("rgb(0,0,0)");
  });
});

describe("clamp", () => {
  it("should give the minimum when the number is below the range", () => {
    expect(clamp(10, 50, 80)).equals(50);
  });
  it("should give the minimum when the number exceeds the range", () => {
    expect(clamp(81, 50, 80)).equals(80);
  });
});

describe("round", () => {
  parametrize(
    "round tests",
    [
      [1, 0, 1],
      [1.1, 0, 1],
      [1.1, 1, 1.1],
      [1.12, 1, 1.1],
      [1.07, 1, 1.1],
      [1.123456, 2, 1.12],
      [1.123456, 3, 1.123],
      [1.123456, 4, 1.1235],
      [1.123456, 5, "nDigits out of range"],
      [1.123456, -1, "nDigits out of range"],
      [1.123456, 0.5, "nDigits out of range"],
    ],
    (testData) => {
      const [inputNumber, nDigits, expectedResult] = testData;
      if (typeof expectedResult === "number") {
        expect(round(inputNumber, nDigits)).to.equal(expectedResult);
      } else {
        expect(() => round(inputNumber, nDigits)).to.throw(expectedResult);
      }
    }
  );
});

describe("memoize", () => {
  it("should memoize the result of given function", () => {
    let nTimesWorked = 0;
    const func = memoize((n) => {
      nTimesWorked += 1;
      return n * n;
    });
    expect(func(2)).equal(4);
    expect(nTimesWorked).equal(1);
    expect(func(2)).to.equal(func(2));
    expect(func(2)).to.not.equal(func(4));
  });
  it("should memoize the result of given async function", async () => {
    let nTimesWorked = 0;
    const func = memoize(async (n) => {
      nTimesWorked += 1;
      return n * n;
    });
    expect(await func(2)).equal(4);
    expect(await func(2)).equal(4);
    expect(nTimesWorked).equal(1);
  });
  it("should give the awaiting promise when a function called before the previous execution is done", async () => {
    let nTimesWorked = 0;
    const func = memoize(async (n) => {
      nTimesWorked += 1;
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
      return n * n;
    });
    const pending = func(2);
    expect(nTimesWorked).equal(1);
    await func(2);
    await pending;
    expect(nTimesWorked).equal(1);
    const result = await func(4);
    expect(nTimesWorked).equal(2);
    expect(result).equal(16);
  });
});

describe("withTimeout", () => {
  it("creates a promise that resolves if the given promise resolved before the timeout, otherwise rejects", async () => {
    let thrown = false;
    try {
      await withTimeout((resolve) => {}, 10);
    } catch {
      thrown = true;
    }
    expect(thrown).to.be.true;
    thrown = false;
    try {
      await withTimeout(Promise.resolve(), 10);
    } catch (e) {
      console.log(e);
      thrown = true;
    }
    expect(thrown).to.be.false;
    thrown = false;
    try {
      await withTimeout(new Promise((resolve) => setTimeout(resolve, 1)), 10);
    } catch (e) {
      console.log(e);
      thrown = true;
    }
    expect(thrown).to.be.false;
  });
});

describe("splitGlyphNameExtension", () => {
  parametrize(
    "splitGlyphNameExtension tests",
    [
      ["", ["", ""]],
      ["a", ["a", ""]],
      [".notdef", [".notdef", ""]],
      [".x", [".x", ""]],
      ["a.alt", ["a", ".alt"]],
      ["a.alt.etc", ["a", ".alt.etc"]],
      ["aring.alt.etc", ["aring", ".alt.etc"]],
    ],
    (testData) => {
      const [inputGlyphName, expectedResult] = testData;
      expect(splitGlyphNameExtension(inputGlyphName)).to.deep.equal(expectedResult);
    }
  );
});

describe("loadURLFragment + dumpURLFragment", () => {
  const testData = getTestData("url-fragment-test-data.json");
  parametrize("loadURLFragment/dumpURLFragment tests", testData, (testCase) => {
    const obj = testCase.object;
    const expectedFragment = testCase.fragment;
    expect(dumpURLFragment(obj)).to.equal(expectedFragment);
    expect(loadURLFragment(expectedFragment)).to.deep.equal(obj);
    expect(loadURLFragment(dumpURLFragment(obj))).to.deep.equal(obj);
  });
});

describe("product", () => {
  const testData = [
    { args: [], product: [[]] },
    { args: [[]], product: [] },
    { args: [[1], []], product: [] },
    { args: [[], [2]], product: [] },
    { args: [[1, 2]], product: [[1], [2]] },
    {
      args: [
        [1, 2],
        [3, 4],
      ],
      product: [
        [1, 3],
        [1, 4],
        [2, 3],
        [2, 4],
      ],
    },
    {
      args: [
        [1, 2],
        [3, 4],
        [5, 6],
      ],
      product: [
        [1, 3, 5],
        [1, 3, 6],
        [1, 4, 5],
        [1, 4, 6],
        [2, 3, 5],
        [2, 3, 6],
        [2, 4, 5],
        [2, 4, 6],
      ],
    },
  ];
  parametrize("product test", testData, (testCase) => {
    expect([...product(...testCase.args)]).to.deep.equal(testCase.product);
  });
});
