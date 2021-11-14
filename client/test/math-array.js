import chai from "chai";
const assert = chai.assert,
      expect = chai.expect;

import MathArray from "../src/math-array.js";


describe("MathArray Tests", () => {
  const a1 = new MathArray(1, 2, 3, 4),
        a2 = new MathArray(5, 6, 7, 8);

  it("copy", () => {
    const a3 = a1.copy();
    a3[1] = 1000;
    expect(a1).to.deep.equal([1, 2, 3, 4]);
    expect(a3).to.deep.equal([1, 1000, 3, 4]);
  })

  it("addItemwise", () => {
    expect(a1.addItemwise(a2)).to.deep.equal([6, 8, 10, 12]);
  })

  it("addItemwise Array", () => {
    expect(a1.addItemwise([5, 6, 7, 8])).to.deep.equal([6, 8, 10, 12]);
  })

  it("subItemwise", () => {
    expect(a1.subItemwise(a2)).to.deep.equal([-4, -4, -4, -4]);
  })

  it("mulScalar", () => {
    expect(a1.mulScalar(3)).to.deep.equal([3, 6, 9, 12]);
  })

  it("throws addItemwise", () => {
    assert.throw(() => {
      a1.addItemwise([1, 2, 3]);
    }, Error, "arrays have different lengths: 4 vs. 3");
  })

  it("throws addItemwise 2", () => {
    expect(() => {
      a1.addItemwise([1, 2, 3]);
    }).to.throw("arrays have different lengths: 4 vs. 3");
  })

})
