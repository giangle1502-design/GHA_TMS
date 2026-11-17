import { describe, expect, it } from "vitest";
import { formatContainerNo, isValidContainerNo, normalizeContainerNo } from "@/lib/container-no";

describe("số cont ISO 6346", () => {
  it("kiểm tra số kiểm tra", () => {
    expect(isValidContainerNo("CSQU3054383")).toBe(true);
    expect(isValidContainerNo("csqu 305438-3")).toBe(true);
    expect(isValidContainerNo("MSCU1234566")).toBe(true);
    expect(isValidContainerNo("CSQU3054384")).toBe(false);
    expect(isValidContainerNo("CSQ3054383")).toBe(false);
  });
  it("chuẩn hóa và hiển thị", () => {
    expect(normalizeContainerNo(" tghu-123456 7")).toBe("TGHU1234567");
    expect(formatContainerNo("CSQU3054383")).toBe("CSQU 305438 3");
    expect(formatContainerNo("ABC")).toBe("ABC");
  });
});
