import { describe, expect, it } from "vitest";
import { pickDriverView } from "@/lib/driver-view";

const t = (id: string, status: string, done = false) => ({ shipment_id: id, status, completed_at: done ? "2026-11-02T10:00:00Z" : null });

describe("pickDriverView", () => {
  it("chỉ hiện chuyến chờ nhận đầu tiên", () => {
    const v = pickDriverView([t("a", "assigned"), t("b", "assigned")]);
    expect(v.shown?.shipment_id).toBe("a");
    expect(v.after).toBe(1);
  });
  it("ưu tiên chuyến đang chạy / đã nhận", () => {
    expect(pickDriverView([t("a", "assigned"), t("b", "accepted")]).shown?.shipment_id).toBe("b");
    expect(pickDriverView([t("a", "accepted"), t("b", "in_transit")]).shown?.shipment_id).toBe("b");
  });
  it("vừa hoàn thành: hiện chuyến đó, chuyến tiếp theo chờ bấm Tìm chuyến khác", () => {
    const trips = [t("b", "assigned"), t("a", "driver_completed", true)];
    const v = pickDriverView(trips, "a");
    expect(v.shown?.shipment_id).toBe("a");
    expect(v.justDone).not.toBeNull();
    expect(pickDriverView(trips).shown?.shipment_id).toBe("b");
  });
  it("không còn chuyến", () => {
    const v = pickDriverView([t("a", "closed", true)]);
    expect(v.shown).toBeNull();
    expect(v.recentDone).toHaveLength(1);
  });
});
