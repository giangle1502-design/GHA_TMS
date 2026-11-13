import { describe, expect, it } from "vitest";
import { DEFAULT_SHARE_TEMPLATE, SHARE_BUILTIN_SOURCES, driverShareText, type DriverShareRow } from "@/lib/driver-share";

const row = (data: DriverShareRow["data"]): DriverShareRow => ({ shipment_id: "s", shipment_code: "C1", driver_id: data ? "d" : null, data });

describe("driverShareText", () => {
  it("mẫu mặc định giữ đúng 4 dòng như trước", () => {
    const t = driverShareText([row({ full_name: "Lê Văn Dạng", plate_number: "50H25688", national_id: "084091007921", license_no: "790168005497" })], DEFAULT_SHARE_TEMPLATE, SHARE_BUILTIN_SOURCES);
    expect(t).toBe("Tên: Lê Văn Dạng\nSố xe: 50H25688\nSố CCCD: 084091007921\nSố GPLX: 790168005497");
  });
  it("thêm Ngày cấp, SĐT, trường bổ sung; bỏ chuyến chưa có tài xế", () => {
    const sources = [...SHARE_BUILTIN_SOURCES, { key: "cf.hang", label: "Hạng", type: "single_select", options: [{ value: "a", label: "Hạng A" }] }];
    const tpl = [
      { label: "Tên", source: "full_name" },
      { label: "Ngày cấp", source: "national_id_issued_date" },
      { label: "SĐT", source: "phone" },
      { label: "Hạng", source: "cf.hang" },
    ];
    const t = driverShareText([row({ full_name: "A", national_id_issued_date: "2021-04-10", phone: null, cf: { hang: "a" } }), row(null)], tpl, sources);
    expect(t).toBe("Tên: A\nNgày cấp: 10/04/2021\nSĐT: \nHạng: Hạng A");
  });
});
