import { describe, it, expect } from "vitest";
import { defaultRouteFor } from "../src/persona.js";

describe("persona", () => {
  it("STUDENT → /", () => expect(defaultRouteFor("STUDENT")).toBe("/"));
  it("TEACHER → /teacher", () => expect(defaultRouteFor("TEACHER")).toBe("/teacher"));
  it("PARENT  → /parent", () => expect(defaultRouteFor("PARENT")).toBe("/parent"));
});
