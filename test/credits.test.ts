import { describe, expect, it } from "vitest";
import { CREDITS, attributionHtml, attributionText } from "../src/credits";

describe("credits", () => {
  it("lists Nyuchi Maps and OpenStreetMap contributors", () => {
    const texts = CREDITS.map((c) => c.text);
    expect(texts).toContain("Nyuchi Maps");
    expect(texts).toContain("© OpenStreetMap contributors");
  });

  it("has no credit twice (by id, text or url)", () => {
    for (const key of ["id", "text", "url"] as const) {
      const values = CREDITS.map((c) => c[key].toLowerCase());
      expect(new Set(values).size, `duplicate ${key}`).toBe(values.length);
    }
  });

  it("renders each credit exactly once in the HTML and the text", () => {
    const html = attributionHtml();
    const text = attributionText();
    for (const c of CREDITS) {
      expect(html.split(c.text).length - 1, c.text).toBe(1);
      expect(text.split(c.text).length - 1, c.text).toBe(1);
    }
  });
});
