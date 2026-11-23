import { describe, it, expect } from "vitest";
import { addWorkdaysISO, firstWorkdayISO } from "./workdays";
describe("dni robocze", () => {
  it("niedziela + 3", () => expect(addWorkdaysISO("2026-11-22", 3)).toBe("2026-11-25"));
  it("pon + 1", () => expect(addWorkdaysISO("2026-11-23", 1)).toBe("2026-11-23"));
  it("pt + 2", () => expect(addWorkdaysISO("2026-11-27", 2)).toBe("2026-11-30"));
  it("11 listopada", () => expect(addWorkdaysISO("2026-11-10", 2)).toBe("2026-11-12"));
  it("wielkanoc 2027", () => expect(addWorkdaysISO("2027-03-26", 2)).toBe("2027-03-30"));
  it("start sob", () => expect(firstWorkdayISO("2026-11-21")).toBe("2026-11-23"));
  it("swieta", () => expect(addWorkdaysISO("2026-12-23", 2)).toBe("2026-12-28"));
});
