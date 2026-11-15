import { formatNumber } from "@/lib/format";
import { noteCompany, noteDateText, type DeliveryNoteData } from "@/lib/delivery-note";

/** Mẫu phiếu giao hàng A4 (LE duyệt 15/11/2026). Màu dùng mã hex để xuất PDF bằng ảnh không lệch màu. */
export function DeliveryNoteSheet({ d }: { d: DeliveryNoteData }) {
  const co = noteCompany(d);
  const items = d.items.length
    ? d.items
    : [{ line_no: 1, item_code: null, item_name: null, unit: null, quantity: d.quantity, note: null }];
  const total = d.items.reduce((s, i) => s + (Number(i.quantity) || 0), 0) || Number(d.quantity) || 0;
  const plate = [d.plate_number, d.trailer_plate].filter(Boolean).join(" / ");
  const customer = d.delivery_company?.trim() || d.delivery_name;
  return (
    <div className="dn-sheet" data-delivery-note={d.shipment_code}>
      <style>{CSS}</style>
      <div className="dn-head">
        <div>
          <div className="dn-co-name">{co.name}</div>
          <div className="dn-small">Địa chỉ: {co.address}</div>
          <div className="dn-small">
            MST: {co.tax_code}
            {co.phone ? <> · ĐT: {co.phone}</> : null}
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
          <h3>Bên giao hàng (điểm nhận)</h3>
          {d.shipper_name ? <Row k="Đơn vị:" v={<b>{d.shipper_name}</b>} /> : null}
          <Row k="Kho nhận:" v={[d.pickup_name, d.pickup_address].filter(Boolean).join(" – ")} />
          {d.pickup_phone ? <Row k="Liên hệ:" v={d.pickup_phone} /> : null}
        </div>
        <div className="dn-box">
          <h3>Bên nhận hàng (điểm giao)</h3>
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
            <th style={{ width: "8%" }}>STT</th>
            <th style={{ width: "19%" }}>Mã hàng</th>
            <th>Tên hàng</th>
            <th style={{ width: "10%" }}>ĐVT</th>
            <th style={{ width: "15%" }}>Số lượng</th>
            <th style={{ width: "16%" }}>Ghi chú</th>
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
}
`;
