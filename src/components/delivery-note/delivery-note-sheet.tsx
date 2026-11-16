import { formatNumber } from "@/lib/format";
import { noteCompany, noteDateText, type DeliveryNoteData } from "@/lib/delivery-note";

/** Dấu xác nhận đã nhận hàng (hàng giao về Bãi xe GHA) */
export type NoteConfirm = { receiver: string; receivedAt: string };

/** Mẫu phiếu giao hàng A4 (LE duyệt 15/11/2026). Màu dùng mã hex để xuất PDF bằng ảnh không lệch màu. */
export function DeliveryNoteSheet({ d, confirm }: { d: DeliveryNoteData; /** Có thì in dấu ĐÃ NHẬN HÀNG ở ô Bên nhận */ confirm?: NoteConfirm }) {
  const co = noteCompany(d);
  const items = d.items.length
    ? d.items
    : [{ line_no: 1, item_code: null, item_name: null, unit: null, quantity: d.quantity, bag_count: null, note: null }];
  const bagOf = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));
  const hasBags = items.some((i) => bagOf(i.bag_count) !== null);
  const totalBags = items.reduce((s, i) => s + (bagOf(i.bag_count) ?? 0), 0);
  const total = d.items.reduce((s, i) => s + (Number(i.quantity) || 0), 0) || Number(d.quantity) || 0;
  const plate = [d.plate_number, d.trailer_plate].filter(Boolean).join(" / ");
  const customer = d.delivery_company?.trim() || d.delivery_name;
  return (
    <div className="dn-sheet" data-delivery-note={d.shipment_code}>
      <style>{CSS}</style>
      <div className="dn-head">
        <div className="dn-brand">
          {/* eslint-disable-next-line @next/next/no-img-element -- ảnh tĩnh cùng nguồn, cần thẻ img thường để in và xuất PDF */}
          <img src="/logo-gha.png" alt="GHA Logistics & Services" className="dn-logo" />
          <div>
            <div className="dn-co-name">{co.name}</div>
            <div className="dn-small">Địa chỉ: {co.address}</div>
            <div className="dn-small">
              MST: {co.tax_code}
              {co.phone ? <> · ĐT: {co.phone}</> : null}
            </div>
          </div>
        </div>
        <div className="dn-no">
          Số: <b>{d.shipment_code}</b>
          {d.order_code ? <div>Shipment: {d.order_code}</div> : null}
          {d.voucher_no ? <div>Số PXK: {d.voucher_no}</div> : null}
        </div>
      </div>

      <h1 className="dn-title">PHIẾU GIAO HÀNG</h1>
      <div className="dn-date">{noteDateText(d.note_date)}</div>

      <div className="dn-grid2">
        <div className="dn-box">
          <h3>Bên giao hàng</h3>
          <Row k="Công ty:" v={<b>{d.shipper_name}</b>} />
          {d.shipper_address ? <Row k="Địa chỉ:" v={d.shipper_address} /> : null}
        </div>
        <div className="dn-box">
          <h3>Bên nhận hàng</h3>
          <Row k="Khách hàng:" v={<b>{customer}</b>} />
          {d.delivery_address ? <Row k="Địa chỉ:" v={d.delivery_address} /> : null}
          {d.delivery_phone ? <Row k="SĐT nhận:" v={d.delivery_phone} /> : null}
        </div>
      </div>

      <div className="dn-box dn-mt">
        <h3>Thông tin vận chuyển</h3>
        <div className="dn-grid2 dn-tight">
          <Row k="Số xe:" v={<b>{plate}</b>} />
          {d.container_no ? <Row k="Số cont:" v={d.container_no} /> : <div />}
          <Row k="Tài xế:" v={<b>{d.driver_name}</b>} />
          <Row k="SĐT:" v={d.driver_phone} />
        </div>
      </div>

      <table className="dn-table">
        <thead>
          <tr>
            <th style={{ width: "7%" }}>STT</th>
            <th style={{ width: "16%" }}>Mã hàng</th>
            <th>Tên hàng</th>
            <th style={{ width: "9%" }}>ĐVT</th>
            <th style={{ width: "13%" }}>Số lượng</th>
            <th style={{ width: "11%" }}>Số bao</th>
            <th style={{ width: "14%" }}>Ghi chú</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i, n) => (
            <tr key={i.line_no ?? n}>
              <td className="dn-c">{n + 1}</td>
              <td>{i.item_code}</td>
              <td>{i.item_name}</td>
              <td className="dn-c">{i.unit}</td>
              <td className="dn-r">{formatNumber(i.quantity)}</td>
              <td className="dn-r">{formatNumber(bagOf(i.bag_count))}</td>
              <td>{i.note}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} className="dn-r">
              TỔNG CỘNG
            </td>
            <td className="dn-r">{formatNumber(total)}</td>
            <td className="dn-r">{hasBags ? formatNumber(totalBags) : ""}</td>
            <td />
          </tr>
        </tfoot>
      </table>

      <div className="dn-signs">
        <div>
          <b>Bên giao hàng</b>
          <i>(Ký, ghi rõ họ tên)</i>
        </div>
        <div>
          <b>Bên nhận hàng</b>
          <i>(Ký, ghi rõ họ tên, đóng dấu)</i>
          {confirm ? (
            <div className="dn-stamp" data-confirm-stamp>
              <div className="dn-stamp-head">
                {/* eslint-disable-next-line @next/next/no-img-element -- ảnh tĩnh cùng nguồn, cần thẻ img thường để in và xuất PDF */}
                <img src="/logo-gha.png" alt="" className="dn-stamp-logo" />
                <span>ĐÃ NHẬN HÀNG</span>
              </div>
              <div className="dn-stamp-line">Ngày giờ nhận: {confirm.receivedAt || "......................"}</div>
              <div className="dn-stamp-sign" />
              <div className="dn-stamp-line">
                Người nhận: <b>{confirm.receiver || "......................"}</b>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="dn-row">
      <span>{k}</span>
      <span>{v}</span>
    </div>
  );
}

const CSS = `
.dn-sheet { background:#fff; color:#111; width:100%; max-width:210mm; margin:0 auto; padding:12mm;
  font-family:"Times New Roman", Times, serif; font-size:13pt; line-height:1.3; box-shadow:0 2px 12px rgba(0,0,0,.15); }
.dn-sheet * { box-sizing:border-box; border-color:#333; }
.dn-head { display:flex; justify-content:space-between; gap:12px; border-bottom:2px solid #0b3d6e; padding-bottom:8px; }
.dn-brand { display:flex; align-items:center; gap:10px; min-width:0; }
.dn-logo { width:34mm; height:auto; flex:none; }
.dn-co-name { font-weight:bold; font-size:12.5pt; color:#0b3d6e; text-transform:uppercase; }
.dn-small { font-size:11pt; }
.dn-no { text-align:right; font-size:12.5pt; white-space:nowrap; }
.dn-no b { font-size:14pt; }
.dn-title { text-align:center; font-size:20pt; font-weight:bold; margin:10px 0 0; letter-spacing:1px; }
.dn-date { text-align:center; font-style:italic; margin-bottom:8px; }
.dn-grid2 { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.dn-tight { gap:2px 16px; }
.dn-mt { margin-top:10px; }
.dn-box { border:1px solid #333; padding:8px 10px; }
.dn-box h3 { font-size:13pt; font-weight:bold; text-transform:uppercase; background:#eef2f7; margin:-8px -10px 6px; padding:4px 10px; border-bottom:1px solid #333; }
.dn-row { display:flex; gap:6px; }
.dn-row > span:first-child { color:#555; min-width:96px; flex:none; }
.dn-table { width:100%; border-collapse:collapse; margin-top:10px; }
.dn-table th, .dn-table td { border:1px solid #333; padding:6px 7px; vertical-align:top; }
.dn-table th { background:#eef2f7; font-weight:bold; }
.dn-table tfoot td { font-weight:bold; }
.dn-c { text-align:center; } .dn-r { text-align:right; }
.dn-signs { display:grid; grid-template-columns:1fr 1fr; text-align:center; margin-top:18px; min-height:40mm; }
.dn-signs b { display:block; text-transform:uppercase; }
.dn-signs i { font-size:11.5pt; color:#555; }
.dn-stamp { display:inline-block; margin-top:10px; border:2.5px solid #c8102e; border-radius:10px; padding:6px 12px 5px; color:#c8102e;
  transform:rotate(-3deg); text-align:left; font-family:Arial, Helvetica, sans-serif; min-width:62mm; }
.dn-stamp-head { display:flex; align-items:center; gap:8px; border-bottom:1.5px solid #c8102e; padding-bottom:3px; }
.dn-stamp-head span { font-weight:bold; font-size:15pt; letter-spacing:.5px; }
.dn-stamp-logo { width:15mm; height:auto; }
.dn-stamp-line { font-size:10.5pt; margin-top:3px; color:#c8102e; }
.dn-stamp-line b { display:inline; text-transform:none; color:#c8102e; }
.dn-stamp-sign { height:12mm; }
@media screen and (max-width: 640px) {
  .dn-sheet { padding:14px; font-size:11.5pt; }
  .dn-head { flex-direction:column; } .dn-no { text-align:left; white-space:normal; }
  .dn-grid2 { grid-template-columns:1fr; }
}
.dn-sheet.dn-a4 { width:794px; max-width:794px; padding:0; box-shadow:none; font-size:13pt; }
.dn-a4 .dn-head { flex-direction:row; } .dn-a4 .dn-no { text-align:right; white-space:nowrap; }
.dn-a4 .dn-grid2 { grid-template-columns:1fr 1fr; }
@media print {
  @page { size:A4 portrait; margin:12mm; }
  body * { visibility:hidden; }
  .dn-sheet, .dn-sheet * { visibility:visible; }
  .dn-sheet { position:absolute; left:0; top:0; max-width:none; padding:0; box-shadow:none; }
  .dn-batch .dn-sheet { position:static; break-after:page; page-break-after:always; margin:0; }
  .dn-batch .dn-sheet:last-child { break-after:auto; page-break-after:auto; }
}
@media screen { .dn-batch .dn-sheet + .dn-sheet { margin-top:16px; } }
`;
