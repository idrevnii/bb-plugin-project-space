import { describe, expect, it } from "vitest";
import { defaultCalloutTitle, formatCalloutMarker, parseCalloutMarker } from "../lib/callouts";

describe("parseCalloutMarker", () => {
  it("reads GitHub alerts", () => {
    expect(parseCalloutMarker("[!NOTE]")).toEqual({ type: "NOTE", kind: "note", fold: "", title: "" });
    expect(parseCalloutMarker("[!CAUTION]")?.kind).toBe("caution");
  });

  it("reads Obsidian callouts with fold and title", () => {
    expect(parseCalloutMarker("[!info]- Custom **title**  ")).toEqual({
      type: "info",
      kind: "note",
      fold: "-",
      title: "Custom **title**",
    });
    expect(parseCalloutMarker("[!bug]+")?.kind).toBe("caution");
    expect(parseCalloutMarker("[!success]")?.kind).toBe("tip");
  });

  it("reads unknown types as notes", () => {
    expect(parseCalloutMarker("[!custom-thing]")?.kind).toBe("note");
  });

  it("rejects lines that are not a marker", () => {
    expect(parseCalloutMarker("[!not a marker]")).toBeNull();
    expect(parseCalloutMarker("[!NOTE]text")).toBeNull();
    expect(parseCalloutMarker("text [!NOTE]")).toBeNull();
    expect(parseCalloutMarker("[NOTE]")).toBeNull();
  });
});

describe("callout titles and markers", () => {
  it("capitalizes the type as the default title", () => {
    expect(defaultCalloutTitle("WARNING")).toBe("Warning");
    expect(defaultCalloutTitle("tip")).toBe("Tip");
  });

  it("writes the marker back as parsed", () => {
    for (const line of ["[!NOTE]", "[!info]- Custom **title**", "[!tip]+"]) {
      expect(formatCalloutMarker(parseCalloutMarker(line)!)).toBe(line);
    }
  });
});
