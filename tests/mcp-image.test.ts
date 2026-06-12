import { describe, it, expect } from "vitest";
import { extractImage } from "@localant/mcp";

describe("extractImage", () => {
  it("returns no image and the data unchanged when there is no __image field", () => {
    const data = { path: "/tmp/a.txt", content: "hello" };
    const { image, rest } = extractImage(data);
    expect(image).toBeUndefined();
    expect(rest).toEqual(data);
  });

  it("returns no image for non-object data", () => {
    expect(extractImage("just text")).toEqual({ rest: "just text" });
    expect(extractImage(null)).toEqual({ rest: null });
    expect(extractImage(42)).toEqual({ rest: 42 });
  });

  it("extracts a valid __image payload and strips it from rest", () => {
    const data = {
      path: "/tmp/pic.png",
      __image: { mimeType: "image/png", base64: "QUJD" },
    };
    const { image, rest } = extractImage(data);
    expect(image).toEqual({ mimeType: "image/png", base64: "QUJD" });
    expect(rest).toEqual({ path: "/tmp/pic.png" });
    expect(rest).not.toHaveProperty("__image");
  });

  it("ignores a malformed __image payload (missing base64)", () => {
    const data = { __image: { mimeType: "image/png" } };
    const { image, rest } = extractImage(data);
    expect(image).toBeUndefined();
    expect(rest).toBe(data);
  });

  it("ignores a __image that is not an object", () => {
    const data = { __image: "not-an-object" };
    const { image, rest } = extractImage(data);
    expect(image).toBeUndefined();
    expect(rest).toBe(data);
  });
});
