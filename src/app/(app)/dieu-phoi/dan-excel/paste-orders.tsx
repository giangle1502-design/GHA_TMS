"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CheckCircle2, ClipboardPaste, FileSpreadsheet, ImageUp, Loader2, Plus, Save, Trash2, Upload, X } from "lucide-react";
import { ReferenceSelect } from "@/components/entities/reference-select";
import { carrierValues, filterCostCont, readCostContFile, toTSV, type CarrierFilter, type SheetData } from "@/lib/cost-cont-import";
import { EntityFormDialog } from "@/components/entities/entity-form-dialog";
import { getEntityMeta } from "@/lib/entities/actions";
import type { CustomFieldRow } from "@/lib/entities/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SearchSelect } from "@/components/ui/search-select";
import { cn } from "@/lib/utils";
import {
  FIELD_LABELS,
  TEMPLATES,
  containerOf,
  deliveryDisplay,
  deliveryMethodOf,
  deliveryNames,
  groupRef,
  pickupNames,
  templateOf,
  type PasteTemplate,
  buildMatcher,
  containerCheckOk,
  detectColumns,
  isoDate,
  looksDelivered,
  looksScientific,
  matchKey,
  orderGroupKey,
  parseQty,
  parseTSV,
  toRecordRows,
  tripNote,
  type ColumnMap,
  type MatchResult,
  type PasteField,
  type PasteRecord,
} from "@/lib/paste-orders";
import { gridToTSV } from "@/lib/ocr-table";
import { ocrTableImage } from "@/lib/ocr-image";
import { commitPaste, deleteAlias, findExistingContainers, loadPasteCatalog, saveAliases, type AliasKind, type CatalogItem, type PasteCatalog, type PasteOutcome, type SavedAlias } from "./actions";

const KIND_LABEL: Record<AliasKind, string> = { customer: "Khách hàng (Pháp nhân)", location: "Địa điểm", product: "Mã hàng" };
const RAW_KEEP = "__raw";
const dmy = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
const label = (x: CatalogItem | undefined) => (x ? (x.code && x.code !== x.name ? `${x.code} · ${x.name}` : x.name) : "");

type Pick = { id: string | null; how: "manual" | "alias" | "code" | "name" | "core" | "ambiguous" | "none" | "empty"; candidates: string[] };
type Role = "pickup" | "delivery";
type Name = { kind: AliasKind; raw: string; key: string; rows: number; auto: MatchResult; roles: Set<Role> };
const ENTITY_OF: Record<AliasKind, string> = { customer: "customers", location: "locations", product: "products" };
type QuickMeta = { customRows: CustomFieldRow[]; canCreate: boolean };

/** Ngày hôm nay + n ngày (YYYY-MM-DD, giờ máy người dùng) */
function ymdOf(addDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + addDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const rangeLabel = (f: { from: string; to: string }) => (f.from === f.to ? `ngày ${dmy(f.from)}` : `từ ${dmy(f.from)} đến ${dmy(f.to)}`);

/** Đầu tháng → cuối tháng hiện tại (YYYY-MM-DD) */
function thisMonth(): { from: string; to: string } {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth();
  const p = (n: number) => String(n).padStart(2, "0");
  return { from: `${y}-${p(m + 1)}-01`, to: `${y}-${p(m + 1)}-${p(new Date(y, m + 1, 0).getDate())}` };
}

export function PasteOrders({ catalog: initialCatalog }: { catalog: PasteCatalog }) {
  /** Danh mục (tải lại sau khi người dùng bấm "Thêm mới") */
  const [catalog, setCatalog] = useState<PasteCatalog>(initialCatalog);
  /** Ô "Thêm mới" đang mở: tên trong Excel cần thêm vào danh mục */
  const [adding, setAdding] = useState<Name | null>(null);
  const [quickMeta, setQuickMeta] = useState<Partial<Record<AliasKind, QuickMeta>>>({});
  const [text, setText] = useState("");
  const [map, setMap] = useState<ColumnMap>([]);
  const [headerRow, setHeaderRow] = useState<number | null>(null);
  const [grid, setGrid] = useState<string[][]>([]);
  /** Chọn tay: "kind|khóa tên" → id (áp cho mọi dòng cùng tên) */
  const [manual, setManual] = useState<Map<string, string>>(new Map());
  const [remember, setRemember] = useState<Set<string>>(new Set());
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [merge, setMerge] = useState(true);
  /** Số đơn gõ tay theo dòng: cùng số = một đơn, khác số = đơn riêng */
  const [orderNos, setOrderNos] = useState<Map<number, string>>(new Map());
  const [existing, setExisting] = useState<Map<string, string>>(new Map());
  const [aliases, setAliases] = useState<SavedAlias[]>(catalog.aliases);
  const [outcome, setOutcome] = useState<PasteOutcome | null>(null);
  const [pending, start] = useTransition();
  /** Đọc từ ảnh: ô đọc chưa chắc theo [dòng][cột] của phần dán; null = dán chữ */
  const [unsure, setUnsure] = useState<boolean[][] | null>(null);
  /** Mẫu dữ liệu: "auto" = tự nhận ra theo dòng tiêu đề */
  const [tplChoice, setTplChoice] = useState<PasteTemplate | "auto">("auto");
  const [template, setTemplate] = useState<PasteTemplate>("theo_doi");
  const [ocr, setOcr] = useState<{ busy: boolean; progress: number; error: string }>({ busy: false, progress: 0, error: "" });
  /** Điểm nhận / điểm giao chọn tay theo từng dòng: "dòng|pickup" → id địa điểm (ưu tiên hơn ghép theo tên) */
  const [rowLoc, setRowLoc] = useState<Map<string, string>>(new Map());
  /** File Excel (sheet COST CONT) đã đọc + bộ lọc Nhà vận chuyển / ngày giao */
  const [sheet, setSheet] = useState<SheetData | null>(null);
  const [sheetFilter, setSheetFilter] = useState<CarrierFilter>(() => ({ carrier: "GHA", from: ymdOf(0), to: ymdOf(0), onlyPending: false }));
  const [fileState, setFileState] = useState<{ busy: boolean; error: string }>({ busy: false, error: "" });

  const byId = useMemo(() => {
    const m = new Map<string, CatalogItem>();
    for (const x of [...catalog.customers, ...catalog.locations, ...catalog.products]) m.set(x.id, x);
    return m;
  }, [catalog]);
  const lists: Record<AliasKind, CatalogItem[]> = useMemo(
    () => ({ customer: catalog.customers, location: catalog.locations, product: catalog.products }),
    [catalog],
  );
  const matchers = useMemo(() => {
    const al = (k: AliasKind) => aliases.filter((a) => a.kind === k);
    return {
      customer: buildMatcher(catalog.customers, al("customer"), { core: true }),
      location: buildMatcher(catalog.locations, al("location"), { core: true }),
      product: buildMatcher(catalog.products, al("product")),
    };
  }, [catalog, aliases]);

  const read = (t: string, fromImage: boolean[][] | null = null, tpl: PasteTemplate | "auto" = tplChoice) => {
    setText(t);
    setUnsure(t ? fromImage : null);
    setOutcome(null);
    const rows = parseTSV(t);
    const d = detectColumns(rows, tpl === "auto" ? undefined : tpl);
    setTemplate(d.template);
    if (rows.length !== grid.length) {
      setOrderNos(new Map());
      setRowLoc(new Map());
    }
    setGrid(rows);
    setMap(d.map);
    setHeaderRow(d.headerRow);
    setSkip(new Set());
  };
  const recordRows = useMemo(() => toRecordRows(grid, map, headerRow), [grid, map, headerRow]);
  const records: PasteRecord[] = useMemo(() => recordRows.map((x) => x.rec), [recordRows]);

  const readImage = async (file: Blob) => {
    setOcr({ busy: true, progress: 0, error: "" });
    try {
      const g = await ocrTableImage(file, (p) => setOcr((o) => ({ ...o, progress: p })));
      if (!g.rows.length) throw new Error("Không thấy chữ nào trong ảnh");
      read(gridToTSV(g.rows), g.unsure);
      setOcr({ busy: false, progress: 1, error: "" });
    } catch (e) {
      setOcr({ busy: false, progress: 0, error: e instanceof Error ? e.message : "Không đọc được ảnh" });
    }
  };
  /** Lọc sheet COST CONT theo Nhà vận chuyển + ngày giao rồi đưa vào ô dán (kèm dòng tiêu đề) */
  const applySheet = (data: SheetData, f: CarrierFilter) => {
    setSheetFilter(f);
    // Bắt buộc có khoảng ngày giao: không lọc ngày thì dễ tạo nhầm đơn của ngày khác
    const { rows: picked } = f.from && f.to ? filterCostCont(data, f) : { rows: [] };
    setRowLoc(new Map());
    setOrderNos(new Map());
    read(picked.length ? toTSV(data.header, picked) : "", null, "theo_doi");
  };
  const readFile = async (file: File) => {
    setFileState({ busy: true, error: "" });
    try {
      const data = await readCostContFile(file);
      setSheet(data);
      setTplChoice("auto");
      applySheet(data, sheetFilter);
      setFileState({ busy: false, error: "" });
    } catch (e) {
      setFileState({ busy: false, error: e instanceof Error ? e.message : "Không đọc được file" });
    }
  };
  /** Đổi bộ lọc: đã có file thì lọc lại ngay */
  const changeFilter = (f: CarrierFilter) => {
    if (sheet) applySheet(sheet, f);
    else setSheetFilter(f);
  };
  const setDates = (from: string, to: string) => changeFilter({ ...sheetFilter, from, to });
  const sheetStats = useMemo(() => (sheet ? { ...filterCostCont(sheet, sheetFilter), carriers: carrierValues(sheet) } : null), [sheet, sheetFilter]);

  const imageFrom = (dt: DataTransfer | null) => [...(dt?.files ?? [])].find((f) => f.type.startsWith("image/"));

  const pick = (kind: AliasKind, raw: string | undefined): Pick => {
    const k = matchKey(raw ?? "");
    if (!k) return { id: null, how: "empty", candidates: [] };
    const m = manual.get(`${kind}|${k}`);
    if (m) return { id: m === RAW_KEEP ? RAW_KEEP : m, how: "manual", candidates: [] };
    const r = matchers[kind](raw ?? "");
    if (r.status === "ok") return { id: r.id, how: r.how, candidates: [] };
    if (r.status === "empty") return { id: null, how: "empty", candidates: [] };
    return { id: null, how: r.status, candidates: r.candidates };
  };
  /** Nhiều cột có thể là cùng một điểm (Điểm đi / Kho xuất…): lấy cột đầu tiên ghép được, chưa được thì cột dễ đọc nhất */
  const pickFrom = (kind: AliasKind, raws: string[], display?: string): Pick & { raw: string } => {
    for (const raw of raws) {
      const p = pick(kind, raw);
      if (p.id) return { ...p, raw };
    }
    const raw = display || raws.find((x) => x.trim()) || "";
    return { ...pick(kind, raw), raw };
  };

  /** Điểm chọn tay ở dòng này (cột "chọn") thay cho kết quả ghép theo tên */
  const withRowChoice = (p: Pick & { raw: string }, id: string | undefined): Pick & { raw: string } => (id ? { ...p, id, how: "manual", candidates: [] } : p);
  const setRowChoice = (i: number, role: Role, id: string) =>
    setRowLoc((m) => {
      const n = new Map(m);
      if (id) n.set(`${i}|${role}`, id);
      else n.delete(`${i}|${role}`);
      return n;
    });

  // Danh sách tên khác nhau trong phần dán, để xem và chọn lại một lần cho mọi dòng
  const names: Name[] = useMemo(() => {
    const m = new Map<string, Name>();
    const add = (kind: AliasKind, raw: string | undefined, role?: Role) => {
      const key = matchKey(raw ?? "");
      if (!key) return;
      const id = `${kind}|${key}`;
      const cur = m.get(id) ?? { kind, raw: raw!, key, rows: 0, auto: matchers[kind](raw!), roles: new Set<Role>() };
      cur.rows++;
      if (role) cur.roles.add(role);
      m.set(id, cur);
    };
    for (const r of records) {
      add("customer", r.phap_nhan);
      add("location", pickFrom("location", pickupNames(r)).raw, "pickup");
      add("location", pickFrom("location", deliveryNames(r), deliveryDisplay(r)).raw, "delivery");
      add("product", r.ma_hang);
    }
    const rank = (n: Name) => (n.auto.status === "ok" ? 2 : n.auto.status === "ambiguous" ? 1 : 0);
    const order = (n: Name) => (n.kind === "customer" ? 0 : n.kind === "product" ? 3 : n.roles.has("pickup") ? 1 : 2);
    return [...m.values()].sort((a, b) => rank(a) - rank(b) || order(a) - order(b) || a.raw.localeCompare(b.raw));
    // pickFrom đọc manual + matchers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, matchers, manual]);

  // Cảnh báo cont đã có trong phần mềm
  const containers = useMemo(() => [...new Set(records.map((r) => containerOf(r)).filter(Boolean))], [records]);
  useEffect(() => {
    if (!containers.length) return;
    let alive = true;
    void findExistingContainers(containers).then((r) => {
      if (!alive || !r.ok || !r.data) return;
      const m = new Map(r.data.map((x) => [x.container, x.code]));
      setExisting(m);
      setSkip((s) => {
        const n = new Set(s);
        records.forEach((rec, i) => {
          if (m.has(containerOf(rec))) n.add(i);
        });
        return n;
      });
    });
    return () => {
      alive = false;
    };
    // records đổi cùng containers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containers.join(",")]);

  const rows = useMemo(() => {
    const out = records.map((r, i) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      const customer = pick("customer", r.phap_nhan);
      const pickup = withRowChoice(pickFrom("location", pickupNames(r)), rowLoc.get(`${i}|pickup`));
      const delivery = withRowChoice(pickFrom("location", deliveryNames(r), deliveryDisplay(r)), rowLoc.get(`${i}|delivery`));
      const product = pick("product", r.ma_hang);
      const date = isoDate(r.ngay_giao);
      const cont = containerOf(r);
      // ảnh chụp hay đọc nhầm "24,750" thành "24.750": số lượng đọc từ ảnh có dạng 24.750 hiểu là hàng nghìn
      const qty = parseQty(unsure && /^\d{1,3}(\.\d{3})+$/.test((r.so_luong ?? "").trim()) ? r.so_luong!.replace(/\./g, "") : r.so_luong);
      if (!r.phap_nhan) errors.push(template === "theo_doi" ? "Thiếu Pháp nhân" : "Thiếu Công ty");
      else if (!customer.id) errors.push(`Chưa ghép khách hàng "${r.phap_nhan}"`);
      if (!pickup.raw && !pickup.id) errors.push(template === "theo_doi" ? "Thiếu Điểm lấy cont" : "Thiếu Điểm đi / Kho xuất");
      else if (!pickup.id) errors.push(`Chưa chọn điểm nhận cho "${pickup.raw}"`);
      if (!delivery.raw && !delivery.id) errors.push(template === "theo_doi" ? "Thiếu Điểm giao" : template === "ecount_ck" ? "Thiếu Điểm đến / Kho nhập" : "Thiếu khách hàng nhận");
      else if (!delivery.id) errors.push(`Chưa chọn điểm giao cho "${delivery.raw}"`);
      if (pickup.id && pickup.id === delivery.id) errors.push("Điểm lấy cont và điểm giao trùng nhau");
      if (r.ma_hang && !product.id) errors.push(`Chưa ghép mã hàng "${r.ma_hang}"`);
      if (sheet && date && (date < sheetFilter.from || date > sheetFilter.to)) errors.push(`Ngày giao ${dmy(date)} ngoài khoảng đã chọn (${rangeLabel(sheetFilter)}): không tạo`);
      if (!r.ngay_giao) errors.push(template === "theo_doi" ? "Thiếu Ngày giao" : "Thiếu Ngày");
      else if (!date) errors.push(`Ngày giao "${r.ngay_giao}" không đúng dạng dd/mm/yyyy`);
      if (r.so_luong && qty === null) errors.push(`Số lượng "${r.so_luong}" không phải số`);
      if (cont.length > 30) errors.push("Số cont quá 30 ký tự");
      else if (cont && !containerCheckOk(cont)) warnings.push(`Số cont ${cont} sai chữ số kiểm tra, xem lại`);
      if (!cont && template === "theo_doi") warnings.push("Không có số cont");
      if (existing.has(cont)) warnings.push(`Cont ${cont} đã có ở chuyến ${existing.get(cont)}`);
      if (looksDelivered(r.tinh_trang)) warnings.push(`Tình trạng "${r.tinh_trang}"`);
      if (unsure) {
        const src = recordRows[i]?.src;
        const cols = map.flatMap((f, c) => (f && unsure[src]?.[c] ? [FIELD_LABELS[f]] : []));
        if (cols.length) warnings.push(`Ảnh đọc chưa chắc: ${cols.join(", ")}. Đối chiếu với ảnh, sửa trong ô dán nếu sai`);
      }
      if (looksScientific(r.so_to_khai)) warnings.push("Số tờ khai bị Excel đổi dạng 1.08E+11: định dạng cột là Text rồi copy lại");
      return { i, r, customer, pickup, delivery, product, date, cont, qty, method: deliveryMethodOf(r), errors, warnings, group: "" };
    });
    // Đánh số đơn: tự gợi ý theo nhóm, người dùng sửa được ô "Đơn" (cùng số = một đơn)
    const nums = new Map<string, number>();
    const no = new Map<number, string>();
    for (const x of out) {
      if (x.errors.length || skip.has(x.i)) continue;
      const auto = orderGroupKey({ customerId: x.customer.id!, toKhai: groupRef(x.r), deliveryId: x.delivery.id!, date: x.date! }, x.i, merge);
      if (!nums.has(auto)) nums.set(auto, nums.size + 1);
      const n = (orderNos.get(x.i) ?? "").trim() || String(nums.get(auto));
      no.set(x.i, n);
      // Một đơn chỉ thuộc một khách hàng: cùng số mà khác khách thì vẫn tách
      x.group = `${n.toUpperCase()}|${x.customer.id}`;
    }
    const customersOf = new Map<string, Set<string>>();
    for (const x of out) if (x.group) customersOf.set(no.get(x.i)!, (customersOf.get(no.get(x.i)!) ?? new Set()).add(x.customer.id!));
    for (const x of out)
      if (x.group && customersOf.get(no.get(x.i)!)!.size > 1) x.warnings.push(`Đơn ${no.get(x.i)} có dòng khác khách hàng: sẽ tách thành đơn riêng theo khách`);
    return out.map((x) => ({ ...x, orderNo: no.get(x.i) ?? null }));
    // pick đọc manual + matchers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, manual, matchers, existing, merge, skip, unsure, recordRows, map, orderNos, template, rowLoc, sheet, sheetFilter]);

  const errorCount = rows.filter((x) => x.errors.length).length;
  const chosen = rows.filter((x) => !x.errors.length && !skip.has(x.i));
  const orderCount = new Set(chosen.map((x) => x.group)).size;
  const unmatched = names.filter((n) => !pick(n.kind, n.raw).id).length;

  // Quyền "Thêm mới" theo từng danh mục (lấy khi đã có tên cần ghép)
  const hasNames = names.length > 0;
  useEffect(() => {
    if (!hasNames) return;
    let alive = true;
    for (const kind of ["customer", "location", "product"] as AliasKind[]) {
      void getEntityMeta(ENTITY_OF[kind]).then((r) => {
        if (alive && r.ok && r.data) setQuickMeta((m) => ({ ...m, [kind]: { customRows: r.data!.customRows, canCreate: r.data!.access.create } }));
      });
    }
    return () => {
      alive = false;
    };
  }, [hasNames]);

  /** Đã thêm mục mới vào danh mục: tải lại danh mục rồi chọn mục đó cho tên này */
  const onAdded = async (n: Name, id: string) => {
    const r = await loadPasteCatalog();
    if (r.ok && r.data) setCatalog({ ...r.data, aliases: catalog.aliases });
    setChoice(n, id);
    toast.success("Đã thêm vào danh mục và chọn cho tên này");
  };

  const setChoice = (n: Name, v: string) => {
    const id = `${n.kind}|${n.key}`;
    setManual((m) => {
      const x = new Map(m);
      if (v) x.set(id, v);
      else x.delete(id);
      return x;
    });
    setRemember((s) => {
      const x = new Set(s);
      if (v && v !== RAW_KEEP && !(n.auto.status === "ok" && n.auto.id === v)) x.add(id);
      else x.delete(id);
      return x;
    });
  };

  const aliasPayload = () =>
    names
      .filter((n) => remember.has(`${n.kind}|${n.key}`))
      .map((n) => ({ kind: n.kind, alias: n.raw, targetId: manual.get(`${n.kind}|${n.key}`)! }))
      .filter((a) => a.targetId && a.targetId !== RAW_KEEP);

  const rememberOnly = () =>
    start(async () => {
      const list = aliasPayload();
      if (!list.length) return void toast.info("Chưa có tên nào được đánh dấu ghi nhớ.");
      const r = await saveAliases(list);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Đã ghi nhớ ${list.length} tên gọi khác.`);
      setAliases((cur) => [
        ...cur.filter((a) => !list.some((l) => l.kind === a.kind && matchKey(l.alias) === matchKey(a.alias))),
        ...list.map((l, i) => ({ id: `new-${Date.now()}-${i}`, kind: l.kind, alias: l.alias, target_id: l.targetId })),
      ]);
      setRemember(new Set());
    });

  const commit = () => {
    const groups = new Map<string, typeof chosen>();
    for (const x of chosen) groups.set(x.group, [...(groups.get(x.group) ?? []), x]);
    const orders = [...groups.values()].map((list) => ({
      customerId: list[0].customer.id!,
      date: list[0].date!,
      refNo: (list[0].r.so_to_khai || list[0].r.so_phieu || "").slice(0, 100),
      voucherNo: [...new Set(list.map((x) => x.r.pxk).filter(Boolean))].join(", ").slice(0, 100),
      trips: list.map((x) => {
        const p = x.product.id && x.product.id !== RAW_KEEP ? byId.get(x.product.id) : undefined;
        return {
          rowNo: x.i + 1,
          pickupLocationId: x.pickup.id!,
          deliveryLocationId: x.delivery.id!,
          containerNo: x.cont,
          productCode: p?.code ?? (x.r.ma_hang ?? "").slice(0, 100),
          productName: p && p.name !== p.code ? p.name.slice(0, 300) : "",
          // Số lượng 1 cont trong bảng theo dõi tính bằng kg (24,750 = 990 bao 25 kg)
          productUnit: x.qty !== null ? "KG" : "",
          quantity: x.qty,
          deliveryMethod: x.method,
          note: tripNote(x.r),
        };
      }),
    }));
    const al = aliasPayload();
    start(async () => {
      const r = await commitPaste({ orders, aliases: al });
      if (!r.ok || !r.data) return void toast.error(r.ok ? "Không tạo được đơn" : r.error);
      setOutcome(r.data);
      const trips = r.data.orders.reduce((s, o) => s + o.trips, 0);
      if (r.data.failed.length) toast.warning(`Đã tạo ${trips} chuyến, ${r.data.failed.length} đơn bị lỗi. Xem chi tiết bên dưới.`);
      else toast.success(`Đã tạo ${r.data.orders.length} đơn, ${trips} chuyến chờ phân công.`);
      if (r.data.aliasesSaved)
        setAliases((cur) => [
          ...cur.filter((a) => !al.some((l) => l.kind === a.kind && matchKey(l.alias) === matchKey(a.alias))),
          ...al.map((l, i) => ({ id: `new-${Date.now()}-${i}`, kind: l.kind, alias: l.alias, target_id: l.targetId })),
        ]);
      if (!r.data.failed.length) {
        setText("");
        setUnsure(null);
        setGrid([]);
        setMap([]);
        setManual(new Map());
        setRemember(new Set());
        setRowLoc(new Map());
      }
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardPaste className="size-4" /> 1. Dán dữ liệu
          </CardTitle>
          <CardDescription>
            Bôi đen các dòng cần tạo (nên kèm dòng tiêu đề), Ctrl+C rồi bấm vào ô dưới, Ctrl+V; hoặc dán ảnh chụp. Nhận 3 mẫu: bảng theo dõi hàng (Excel), phiếu chuyển kho và
            phiếu giao hàng của Ecount; có dòng tiêu đề thì phần mềm tự nhận ra mẫu. Không kèm tiêu đề thì chọn mẫu bên dưới, cột hiểu theo thứ tự:{" "}
            {templateOf(tplChoice === "auto" ? template : tplChoice)
              .columns.filter((c) => c.key !== "ghi_chu")
              .map((c) => c.label)
              .join(", ")}
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2 rounded-md border border-dashed bg-muted/30 p-3 text-sm" data-cost-cont>
            <p className="font-medium">Nhập từ file Excel (sheet COST CONT): chỉ tạo đơn cho dòng Nhà vận chuyển (cột AA) = {sheetFilter.carrier} có Ngày giao (cột M) trong khoảng chọn dưới đây.</p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-0.5 text-xs font-medium">
                Ngày giao từ
                <input
                  type="date"
                  aria-label="Ngày giao từ"
                  value={sheetFilter.from}
                  onChange={(e) => setDates(e.target.value, sheetFilter.to && e.target.value > sheetFilter.to ? e.target.value : sheetFilter.to)}
                  className="h-9 rounded border border-primary bg-background px-1 text-sm"
                />
              </label>
              <label className="flex flex-col gap-0.5 text-xs font-medium">
                đến ngày
                <input
                  type="date"
                  aria-label="Ngày giao đến"
                  value={sheetFilter.to}
                  onChange={(e) => setDates(sheetFilter.from && e.target.value < sheetFilter.from ? e.target.value : sheetFilter.from, e.target.value)}
                  className="h-9 rounded border border-primary bg-background px-1 text-sm"
                />
              </label>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => setDates(ymdOf(0), ymdOf(0))}>
                  Hôm nay
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDates(ymdOf(1), ymdOf(1))}>
                  Ngày mai
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDates(thisMonth().from, thisMonth().to)}>
                  Cả tháng này
                </Button>
              </div>
              <label className="flex h-9 items-center gap-1.5">
                <input type="checkbox" checked={sheetFilter.onlyPending} onChange={(e) => changeFilter({ ...sheetFilter, onlyPending: e.target.checked })} />
                Chỉ dòng Chưa giao
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 font-medium hover:bg-muted",
                  (fileState.busy || !sheetFilter.from || !sheetFilter.to) && "pointer-events-none opacity-50",
                )}
              >
                <FileSpreadsheet className="size-4 text-emerald-700" /> {sheet ? "Chọn file khác…" : "Chọn file Excel…"}
                <input
                  type="file"
                  accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12"
                  className="hidden"
                  data-cost-cont-file
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void readFile(f);
                    e.target.value = "";
                  }}
                />
              </label>
              {!sheetFilter.from || !sheetFilter.to ? <span className="text-destructive">Chọn đủ ngày giao từ, đến trước.</span> : null}
              {fileState.busy ? (
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Đang đọc file…
                </span>
              ) : sheet ? (
                <span className="text-muted-foreground">
                  {sheet.fileName} · sheet {sheet.sheet} · {sheet.rows.length.toLocaleString("en-US")} dòng
                </span>
              ) : null}
              {fileState.error ? <span className="text-destructive">{fileState.error}</span> : null}
            </div>
            {sheet && sheetStats && sheetFilter.from && sheetFilter.to ? (
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1 text-xs">
                  Nhà vận chuyển
                  <select
                    aria-label="Nhà vận chuyển"
                    value={sheetStats.carriers.find((c) => matchKey(c.value) === matchKey(sheetFilter.carrier))?.value ?? sheetFilter.carrier}
                    onChange={(e) => changeFilter({ ...sheetFilter, carrier: e.target.value })}
                    className="h-8 rounded border bg-background px-1 text-sm"
                  >
                    {sheetStats.carriers.some((c) => matchKey(c.value) === matchKey(sheetFilter.carrier)) ? null : <option value={sheetFilter.carrier}>{sheetFilter.carrier} (0 dòng)</option>}
                    {sheetStats.carriers.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.value} ({c.rows.toLocaleString("en-US")} dòng)
                      </option>
                    ))}
                  </select>
                </label>
                <Badge variant={sheetStats.rows.length ? "info" : "warning"} data-cost-cont-count>
                  {sheetStats.rows.length} dòng {sheetFilter.carrier} giao {rangeLabel(sheetFilter)} (trong {sheetStats.carrierRows} dòng {sheetFilter.carrier} của file)
                </Badge>
                {sheetStats.noDate ? <span className="text-xs text-muted-foreground">{sheetStats.noDate} dòng không có ngày giao: bỏ qua</span> : null}
              </div>
            ) : null}
          </div>
          <textarea
            value={text}
            onChange={(e) => read(e.target.value, unsure)}
            onPaste={(e) => {
              // Dán dữ liệu mới: không còn là dữ liệu lọc từ file
              setSheet(null);
              const img = imageFrom(e.clipboardData);
              if (img && !e.clipboardData.getData("text/plain")) {
                e.preventDefault();
                void readImage(img);
              }
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              const img = imageFrom(e.dataTransfer);
              if (img) {
                e.preventDefault();
                void readImage(img);
              }
            }}
            placeholder="Dán (Ctrl+V) các dòng copy từ Excel, hoặc dán / kéo thả ảnh chụp bảng vào đây…"
            aria-label="Dữ liệu dán từ Excel"
            className="h-28 w-full rounded-md border bg-background p-2 font-mono text-xs whitespace-pre"
            spellCheck={false}
          />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 hover:bg-muted", ocr.busy && "pointer-events-none opacity-50")}>
              <ImageUp className="size-4" /> Chọn ảnh chụp bảng…
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void readImage(f);
                  e.target.value = "";
                }}
              />
            </label>
            {ocr.busy ? (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Đang đọc ảnh{ocr.progress ? ` ${Math.round(ocr.progress * 100)}%` : " (lần đầu tải bộ đọc tiếng Việt, chờ vài giây)"}…
              </span>
            ) : null}
            {ocr.error ? <span className="text-destructive">{ocr.error}</span> : null}
          </div>
          {unsure && grid.length ? (
            <Alert>
              <AlertDescription>
                Dữ liệu đọc từ ảnh: máy đọc có thể nhầm (nhất là số cont, số tờ khai, chữ có dấu). Đối chiếu với ảnh, sửa trực tiếp trong ô dán ở trên nếu sai. Dòng có ô
                đọc chưa chắc được ghi ở cột Kiểm tra. Copy từ Excel vẫn chính xác hơn.
              </AlertDescription>
            </Alert>
          ) : null}
          {grid.length ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="muted">{records.length} dòng</Badge>
              <select
                aria-label="Mẫu dữ liệu"
                value={tplChoice}
                onChange={(e) => {
                  const v = e.target.value as PasteTemplate | "auto";
                  setTplChoice(v);
                  read(text, unsure, v);
                }}
                className="h-7 rounded border bg-background px-1 text-xs"
              >
                <option value="auto">Tự nhận mẫu ({templateOf(template).label})</option>
                {TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              <Badge variant={headerRow === null ? "warning" : "success"}>
                {headerRow === null ? "Không có dòng tiêu đề: hiểu theo thứ tự cột mặc định" : "Đã nhận ra dòng tiêu đề"}
              </Badge>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSheet(null);
                  read("");
                }}
              >
                <X /> Xóa
              </Button>
            </div>
          ) : null}
          {grid.length ? <ColumnMapper grid={grid} map={map} headerRow={headerRow} columns={templateOf(template).columns} onChange={setMap} /> : null}
        </CardContent>
      </Card>

      {outcome ? <Outcome outcome={outcome} /> : null}

      {names.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Ghép tên với danh mục</CardTitle>
            <CardDescription>
              Tên trong Excel có thể khác tên trong phần mềm. Xem cột &quot;Ghép với&quot; và chọn lại nếu chưa đúng; chọn một lần là áp cho mọi dòng cùng tên. Phần mềm
              KHÔNG tự thêm tên trong Excel vào danh mục; khách, điểm hay mã hàng mới thật sự thì bấm &quot;Thêm mới&quot; dưới ô chọn. Tick &quot;Ghi nhớ&quot; để lần sau tự ghép tên đó với mục đã chọn.
              {!catalog.aliasesReady ? " (Chưa bật ghi nhớ: cần chạy bản nâng cấp 9010.)" : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant={unmatched ? "destructive" : "success"}>{unmatched ? `${unmatched} tên chưa ghép` : "Đã ghép hết"}</Badge>
              <Badge variant="muted">{names.length} tên khác nhau</Badge>
            </div>
            <div className="max-h-[50vh] overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted text-left">
                  <tr>
                    {["Loại", "Tên trong Excel", "Số dòng", "Ghép với", "Cách ghép", "Ghi nhớ"].map((h) => (
                      <th key={h} className="px-2 py-1.5 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {names.map((n) => {
                    const id = `${n.kind}|${n.key}`;
                    const p = pick(n.kind, n.raw);
                    const sugg = n.auto.status === "ambiguous" || n.auto.status === "none" ? n.auto.candidates : [];
                    return (
                      <tr key={id} className={cn("border-t", !p.id && "bg-destructive/5")}>
                        <td className="px-2 py-1 text-xs whitespace-nowrap">
                          <KindLabel n={n} template={template} />
                        </td>
                        <td className="px-2 py-1 font-medium">{n.raw}</td>
                        <td className="px-2 py-1 text-center tabular-nums">{n.rows}</td>
                        <td className="min-w-72 px-2 py-1">
                          <SearchSelect
                            aria-label={`Ghép "${n.raw}"`}
                            value={manual.get(id) ?? p.id ?? ""}
                            onChange={(e) => setChoice(n, e.target.value)}
                            className="h-8 w-full text-sm"
                          >
                            <option value="">— Chọn —</option>
                            {n.kind === "product" ? <option value={RAW_KEEP}>Giữ mã như Excel (không có trong danh mục)</option> : null}
                            {sugg.length ? (
                              <optgroup label="Gợi ý">
                                {sugg.map((c) => (
                                  <option key={`s-${c}`} value={c}>
                                    {label(byId.get(c))}
                                  </option>
                                ))}
                              </optgroup>
                            ) : null}
                            <optgroup label={KIND_LABEL[n.kind]}>
                              {lists[n.kind].map((x) => (
                                <option key={x.id} value={x.id}>
                                  {label(x)}
                                </option>
                              ))}
                            </optgroup>
                          </SearchSelect>
                          {quickMeta[n.kind]?.canCreate ? (
                            <button
                              type="button"
                              onClick={() => setAdding(n)}
                              className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            >
                              <Plus className="size-3" /> Thêm mới vào danh mục {KIND_LABEL[n.kind].toLowerCase()}
                            </button>
                          ) : null}
                        </td>
                        <td className="px-2 py-1 whitespace-nowrap">
                          <HowBadge how={p.how} />
                        </td>
                        <td className="px-2 py-1 text-center">
                          <input
                            type="checkbox"
                            aria-label={`Ghi nhớ "${n.raw}"`}
                            disabled={!catalog.aliasesReady || !manual.get(id) || manual.get(id) === RAW_KEEP}
                            checked={remember.has(id)}
                            onChange={(e) =>
                              setRemember((s) => {
                                const x = new Set(s);
                                if (e.target.checked) x.add(id);
                                else x.delete(id);
                                return x;
                              })
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {catalog.aliasesReady ? (
              <Button size="sm" variant="outline" disabled={pending || !remember.size} onClick={rememberOnly}>
                <Save /> Chỉ ghi nhớ tên đã chọn ({remember.size})
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {rows.length ? (
        <Card>
          <CardHeader className="gap-2">
            <CardTitle className="text-base">3. Xem trước và tạo đơn</CardTitle>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="muted">{rows.length} dòng</Badge>
              <Badge variant={errorCount ? "destructive" : "muted"}>{errorCount} chưa đủ thông tin</Badge>
              <Badge variant="info">
                Sẽ tạo {orderCount} đơn, {chosen.length} chuyến
              </Badge>
              <label className="ml-2 flex items-center gap-1.5">
                <input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} />
                Tự gợi ý gộp cont cùng tờ khai (hoặc cùng số phiếu Ecount), cùng điểm giao, cùng ngày
              </label>
              {orderNos.size ? (
                <Button size="sm" variant="ghost" onClick={() => setOrderNos(new Map())}>
                  Đặt lại số đơn
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Sửa số ở cột &quot;Đơn&quot; để chia đơn: các dòng cùng số gộp thành một đơn, khác số thành đơn riêng (VD 1, 2, 3 = 3 đơn; 1, 1, 2 = 2 đơn).
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="max-h-[60vh] overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted text-left">
                  <tr>
                    <th className="px-2 py-1.5">
                      <input
                        type="checkbox"
                        aria-label="Chọn tất cả"
                        checked={chosen.length > 0 && chosen.length === rows.length - errorCount}
                        onChange={(e) => setSkip(e.target.checked ? new Set() : new Set(rows.map((x) => x.i)))}
                      />
                    </th>
                    {[
                      "Dòng",
                      "Đơn",
                      "Khách hàng",
                      template === "theo_doi" ? "Số tờ khai" : "Số phiếu",
                      "Mã hàng",
                      "Số lượng (kg)",
                      "Hình thức giao",
                      "Số cont",
                      "Ngày giao",
                      "Điểm nhận trong file",
                      "Điểm nhận (chọn)",
                      "Điểm giao trong file",
                      "Điểm giao (chọn)",
                      "Kiểm tra",
                    ].map((h) => (
                      <th key={h} className="px-2 py-1.5 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((x) => (
                    <tr key={x.i} className={cn("border-t align-top", x.errors.length ? "bg-destructive/5" : skip.has(x.i) && "opacity-50")}>
                      <td className="px-2 py-1">
                        <input
                          type="checkbox"
                          aria-label={`Tạo dòng ${x.i + 1}`}
                          disabled={x.errors.length > 0}
                          checked={!x.errors.length && !skip.has(x.i)}
                          onChange={(e) =>
                            setSkip((s) => {
                              const n = new Set(s);
                              if (e.target.checked) n.delete(x.i);
                              else n.add(x.i);
                              return n;
                            })
                          }
                        />
                      </td>
                      <td className="px-2 py-1 tabular-nums">{x.i + 1}</td>
                      <td className="px-2 py-1 whitespace-nowrap">
                        {x.orderNo ? (
                          <input
                            aria-label={`Số đơn dòng ${x.i + 1}`}
                            value={orderNos.get(x.i) ?? x.orderNo}
                            maxLength={10}
                            onChange={(e) =>
                              setOrderNos((m) => {
                                const n = new Map(m);
                                n.set(x.i, e.target.value);
                                return n;
                              })
                            }
                            onBlur={(e) => {
                              if (!e.target.value.trim())
                                setOrderNos((m) => {
                                  const n = new Map(m);
                                  n.delete(x.i);
                                  return n;
                                });
                            }}
                            className={cn("h-7 w-12 rounded border bg-background px-1 text-center tabular-nums", orderNos.has(x.i) && "border-primary font-medium")}
                          />
                        ) : null}
                      </td>
                      <Cell raw={x.r.phap_nhan} id={x.customer.id} byId={byId} />
                      <td className="px-2 py-1 font-mono whitespace-nowrap">{groupRef(x.r)}</td>
                      <Cell raw={x.r.ma_hang} id={x.product.id} byId={byId} codeOnly />
                      <td className="px-2 py-1 text-right tabular-nums">{x.qty !== null ? x.qty.toLocaleString("en-US") : x.r.so_luong}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{x.method}</td>
                      <td className="px-2 py-1 font-mono whitespace-nowrap">{x.cont}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{x.date ? dmy(x.date) : x.r.ngay_giao}</td>
                      <td className="max-w-48 px-2 py-1 font-medium">{x.pickup.raw || "—"}</td>
                      <PlaceCell i={x.i} role="pickup" id={x.pickup.id} manual={rowLoc.has(`${x.i}|pickup`)} byId={byId} onChange={setRowChoice} />
                      <td className="max-w-48 px-2 py-1 font-medium">{x.delivery.raw || "—"}</td>
                      <PlaceCell i={x.i} role="delivery" id={x.delivery.id} manual={rowLoc.has(`${x.i}|delivery`)} byId={byId} onChange={setRowChoice} />
                      <td className="min-w-56 px-2 py-1 text-xs">
                        {x.errors.map((e) => (
                          <p key={e} className="text-destructive">
                            • {e}
                          </p>
                        ))}
                        {x.warnings.map((w) => (
                          <p key={w} className="text-amber-700 dark:text-amber-400">
                            • {w}
                          </p>
                        ))}
                        {!x.errors.length && !x.warnings.length ? <span className="text-emerald-700">Hợp lệ</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Chuyến tạo ra ở trạng thái Chờ phân công, giá lấy theo bảng giá. Số tờ khai / số phiếu Ecount, PXK ghi vào đơn; BCT, NCC, loại cont, lưu bãi, gia hạn, lưu cont ghi vào ghi
                chú chuyến. Dòng có cont đã có trong phần mềm được bỏ chọn sẵn.
              </p>
              <Button disabled={pending || !chosen.length} onClick={commit}>
                {pending ? <Loader2 className="animate-spin" /> : <Upload />} Tạo {orderCount} đơn, {chosen.length} chuyến
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {adding && quickMeta[adding.kind] ? (
        <EntityFormDialog
          entityKey={ENTITY_OF[adding.kind]}
          customRows={quickMeta[adding.kind]!.customRows}
          open
          onOpenChange={(o) => {
            if (!o) setAdding(null);
          }}
          quick
          initialValues={adding.kind === "product" ? { code: adding.raw, name: adding.raw } : { name: adding.raw }}
          onSaved={(res) => {
            const n = adding;
            setAdding(null);
            void onAdded(n, res.id);
          }}
        />
      ) : null}
      {catalog.aliasesReady ? <SavedAliases aliases={aliases} byId={byId} onDeleted={(id) => setAliases((a) => a.filter((x) => x.id !== id))} /> : null}
    </div>
  );
}

/**
 * Ô chọn điểm nhận / điểm giao của một dòng: tìm trong TOÀN BỘ danh mục địa điểm trên máy chủ (gõ tên, mã),
 * không phụ thuộc gợi ý tự động. Không thêm tên trong file vào danh mục.
 */
function PlaceCell({
  i,
  role,
  id,
  manual,
  byId,
  onChange,
}: {
  i: number;
  role: Role;
  id: string | null;
  manual: boolean;
  byId: Map<string, CatalogItem>;
  onChange: (i: number, role: Role, id: string) => void;
}) {
  const v = id && id !== RAW_KEEP ? id : "";
  return (
    <td className={cn("min-w-60 px-2 py-1", !v && "bg-destructive/10")} data-place-cell={`${i + 1}-${role}`}>
      <ReferenceSelect
        key={v}
        id={`dx-${role}-${i}`}
        refKey="locations"
        value={v}
        initialLabel={label(byId.get(v))}
        invalid={!v}
        allowQuickCreate={false}
        onChange={(nv) => onChange(i, role, nv)}
      />
      {v && !manual ? <span className="text-[11px] text-muted-foreground">Tự ghép theo tên, bấm để đổi</span> : null}
    </td>
  );
}

/** Loại tên: tách rõ điểm nhận (điểm đi) và điểm giao (điểm đến) */
function KindLabel({ n, template }: { n: Name; template: PasteTemplate }) {
  if (n.kind !== "location") return <span className="text-muted-foreground">{KIND_LABEL[n.kind]}</span>;
  const tags: { role: Role; text: string; cls: string }[] = [
    { role: "pickup", text: template === "theo_doi" ? "Điểm nhận (lấy cont)" : "Điểm nhận (điểm đi)", cls: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300" },
    { role: "delivery", text: template === "theo_doi" ? "Điểm giao" : "Điểm giao (điểm đến)", cls: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300" },
  ];
  return (
    <span className="flex flex-col items-start gap-0.5">
      {tags
        .filter((t) => n.roles.has(t.role))
        .map((t) => (
          <span key={t.role} className={cn("rounded px-1.5 py-0.5 font-medium", t.cls)}>
            {t.text}
          </span>
        ))}
    </span>
  );
}

function HowBadge({ how }: { how: Pick["how"] }) {
  const m: Record<Pick["how"], [string, "success" | "info" | "warning" | "destructive" | "muted" | "purple"]> = {
    manual: ["Đã chọn tay", "purple"],
    alias: ["Tên đã ghi nhớ", "info"],
    code: ["Khớp mã", "success"],
    name: ["Khớp tên", "success"],
    core: ["Gần đúng tên, xem lại", "warning"],
    ambiguous: ["Nhiều kết quả, chọn một", "destructive"],
    none: ["Chưa khớp, chọn tay", "destructive"],
    empty: ["Trống", "muted"],
  };
  return <Badge variant={m[how][1]}>{m[how][0]}</Badge>;
}

function Cell({ raw, id, byId, codeOnly }: { raw?: string; id: string | null; byId: Map<string, CatalogItem>; codeOnly?: boolean }) {
  const x = id && id !== RAW_KEEP ? byId.get(id) : undefined;
  const shown = x ? (codeOnly ? (x.code ?? x.name) : x.name) : id === RAW_KEEP ? raw : "";
  const same = shown && raw && matchKey(shown) === matchKey(raw);
  return (
    <td className="max-w-56 px-2 py-1">
      {shown ? <span>{shown}</span> : <span className="text-destructive">{raw || "—"}</span>}
      {shown && raw && !same ? <span className="block text-xs text-muted-foreground">Excel: {raw}</span> : null}
    </td>
  );
}

function ColumnMapper({
  grid,
  map,
  headerRow,
  columns,
  onChange,
}: {
  grid: string[][];
  map: ColumnMap;
  headerRow: number | null;
  columns: { key: PasteField; label: string }[];
  onChange: (m: ColumnMap) => void;
}) {
  const sample = grid[headerRow === null ? 0 : headerRow + 1] ?? [];
  const head = headerRow === null ? null : grid[headerRow];
  return (
    <details className="rounded-md border p-2 text-sm" open={map.filter(Boolean).length < 6}>
      <summary className="cursor-pointer select-none">Cột trong phần dán ({map.filter(Boolean).length} cột được dùng). Bấm để xem / đổi.</summary>
      <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
        {map.map((f, i) => (
          <div key={i} className="w-36 shrink-0 space-y-1 rounded border p-1.5">
            <p className="truncate text-xs text-muted-foreground" title={head?.[i] ?? sample[i]}>
              {head ? `Tiêu đề: ${head[i] ?? ""}` : `Cột ${i + 1}`}
            </p>
            <p className="truncate font-mono text-xs" title={sample[i]}>
              {sample[i] || "—"}
            </p>
            <select
              aria-label={`Cột ${i + 1}`}
              value={f ?? ""}
              onChange={(e) => {
                const v = (e.target.value || null) as PasteField | null;
                onChange(map.map((x, j) => (j === i ? v : v && x === v ? null : x)));
              }}
              className="h-7 w-full rounded border bg-background text-xs"
            >
              <option value="">(bỏ qua)</option>
              {columns.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </details>
  );
}

function SavedAliases({ aliases, byId, onDeleted }: { aliases: SavedAlias[]; byId: Map<string, CatalogItem>; onDeleted: (id: string) => void }) {
  const [pending, start] = useTransition();
  if (!aliases.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tên gọi khác đã ghi nhớ ({aliases.length})</CardTitle>
        <CardDescription>Muốn đổi: chọn lại ở bước 2 khi dán rồi tick Ghi nhớ, hoặc xóa ở đây. Xóa không ảnh hưởng đơn đã tạo.</CardDescription>
      </CardHeader>
      <CardContent>
        <details>
          <summary className="cursor-pointer text-sm select-none">Xem danh sách</summary>
          <div className="mt-2 max-h-80 overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <tbody>
                {aliases.map((a) => (
                  <tr key={a.id} className="border-t">
                    <td className="px-2 py-1 text-xs text-muted-foreground">{KIND_LABEL[a.kind]}</td>
                    <td className="px-2 py-1 font-medium">{a.alias}</td>
                    <td className="px-2 py-1">→ {label(byId.get(a.target_id)) || <span className="text-muted-foreground">(mục đã ngừng dùng)</span>}</td>
                    <td className="px-2 py-1 text-right">
                      {a.id.startsWith("new-") ? null : (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          aria-label={`Xóa tên gọi ${a.alias}`}
                          onClick={() =>
                            start(async () => {
                              const r = await deleteAlias(a.id);
                              if (r.ok) onDeleted(a.id);
                              else toast.error(r.error);
                            })
                          }
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function Outcome({ outcome }: { outcome: PasteOutcome }) {
  const trips = outcome.orders.reduce((s, o) => s + o.trips, 0);
  return (
    <Card className="border-emerald-300">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CheckCircle2 className="size-5 text-emerald-600" /> Đã tạo {outcome.orders.length} đơn, {trips} chuyến chờ phân công
        </CardTitle>
        <CardDescription>
          {outcome.aliasesSaved ? `Đã ghi nhớ ${outcome.aliasesSaved} tên gọi khác. ` : ""}
          Phân công xe, tài xế ở{" "}
          <Link href="/dieu-phoi" className="text-primary underline">
            Điều phối
          </Link>
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {outcome.failed.length || outcome.warnings.length ? (
          <Alert variant={outcome.failed.length ? "destructive" : "default"}>
            <AlertDescription>
              {outcome.failed.map((f) => (
                <p key={f.rows.join(",")}>
                  Dòng {f.rows.join(", ")} chưa tạo: {f.error}
                </p>
              ))}
              {outcome.warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {outcome.orders.map((o) => (
            <Link key={o.orderId} href={`/dieu-phoi/don-hang/${o.orderId}`} className="rounded-md border px-2 py-1 text-xs hover:bg-muted">
              {o.orderCode} · {o.trips} chuyến · dòng {o.rows.join(", ")}
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
