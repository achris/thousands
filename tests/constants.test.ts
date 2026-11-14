import { describe, expect, it } from "vitest";
import { MODULE_ID, initMessage } from "../src/constants.js";

describe("initMessage", () => {
  it("prefixes the module id", () => {
    expect(initMessage(MODULE_ID)).toBe("thousands | Initializing");
  });
});
