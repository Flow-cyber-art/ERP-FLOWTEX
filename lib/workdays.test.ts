import { describe, it, expect } from "vitest";
import { addWorkdaysISO, firstWorkdayISO, isWorkdayUTC } from "./workdays";
describe("dni robocze", () => {
  it("niedziela + 3", () => expect(addWorkdaysISO("2026-11-22", 3)).toBe("2026-11-25"));
  it("pon + 1", () => expect(addWorkdaysISO("2026-11-23", 1)).toBe("2026-11-23"));
  it("pt + 2", () => expect(addWorkdaysISO("2026-11-27", 2)).toBe("2026-11-30"));
  it("11 listopada", () => expect(addWorkdaysISO("2026-11-10", 2)).toBe("2026-11-12"));
  it("wielkanoc 2027", () => expect(addWorkdaysISO("2027-03-26", 2)).toBe("2027-03-30"));
  it("start sob", () => expect(firstWorkdayISO("2026-11-21")).toBe("2026-11-23"));
  it("swieta", () => expect(addWorkdaysISO("2026-12-23", 2)).toBe("2026-12-28"));
});
describe("dni robocze — urlop (F29)", () => {
  const count = (a: string, b: string) => {
    let n = 0;
    for (let d = new Date(a + "T00:00:00Z"); d <= new Date(b + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) if (isWorkdayUTC(d)) n++;
    return n;
  };
  it("23–28.12.2026 = 2 dni (Wigilia, święta, weekend)", () => expect(count("2026-12-23", "2026-12-28")).toBe(2));
  it("Wielkanoc 2027: 26–30.03 = 2 dni", () => expect(count("2027-03-26", "2027-03-30")).toBe(2));
  it("Boże Ciało 2026 (4.06) wolne", () => expect(isWorkdayUTC(new Date("2026-06-04T00:00:00Z"))).toBe(false));
});
