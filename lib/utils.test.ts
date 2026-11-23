import { describe, it, expect } from "vitest";
process.env.TZ = "Europe/Warsaw";
import { localISODate } from "./utils";

describe("localISODate (F9)", () => {
  it("00:30 czasu polskiego to już nowy dzień, nie wczorajszy (UTC)", () => {
    expect(localISODate(new Date("2026-11-23T23:30:00Z"))).toBe("2026-11-24");
  });
  it("latem (UTC+2) 01:30 to nowy dzień", () => {
    expect(localISODate(new Date("2026-07-14T23:30:00Z"))).toBe("2026-07-15");
  });
  it("w ciągu dnia bez zmian", () => {
    expect(localISODate(new Date("2026-11-23T12:00:00Z"))).toBe("2026-11-23");
  });
});
