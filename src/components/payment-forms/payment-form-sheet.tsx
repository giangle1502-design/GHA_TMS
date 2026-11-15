import { formatDate, formatNumber } from "@/lib/format";
import { GHA_COMPANY, noteDateText } from "@/lib/delivery-note";
import { FORM_TITLES, formTotal, numberToVietnameseWords, type PaymentFormData } from "@/lib/payment-request-form";

const dots = "........................................................................";

/** Mẫu A4 Giấy đề nghị thanh toán (05-TT) / đề nghị tạm ứng (03-TT), logo GHA như phiếu giao hàng. Màu dùng mã hex để xuất PDF bằng ảnh. */
export function PaymentFormSheet({ d }: { d: PaymentFormData }) {
  const co = GHA_COMPANY;
  const total = formTotal(d);
  const isPay = d.form_type === "payment";
  const remain = total - (Number(d.advance_amount) || 0);
  return (
    <div className="pf-sheet" data-form={d.code ?? ""}>
      <style>{CSS}</style>
      <div className="pf-head">
        <div className="pf-brand">
          {/* eslint-disable-next-line @next/next/no-img-element -- ảnh tĩnh cùng nguồn, cần thẻ img thường để in và xuất PDF */}
          <img src="/logo-gha.png" alt="GHA Logistics & Services" className="pf-logo" />
          <div>
            <div className="pf-co-name">{co.name}</div>
            <div className="pf-small">Địa chỉ: {co.address}</div>
            <div className="pf-small">MST: {co.tax_code}</div>
          </div>
        </div>
        <div className="pf-no">
          <div className="pf-form-code">Mẫu số {isPay ? "05-TT" : "03-TT"}</div>
          <div className="pf-tiny">(Theo Thông tư 133/2016/TT-BTC)</div>
          <div className="pf-mt4">
            Số: <b>{d.code || "............"}</b>
          </div>
        </div>
      </div>

      <h1 className="pf-title">{FORM_TITLES[d.form_type]}</h1>
      <div className="pf-date">{noteDateText(d.form_date)}</div>

      <div className="pf-body">
        <p>
          <span className="pf-k">Kính gửi:</span> <b>{d.recipient || dots}</b>
        </p>
        <p>
          <span className="pf-k">{isPay ? "Họ và tên người đề nghị thanh toán:" : "Tên tôi là:"}</span> <b>{d.requester_name || dots}</b>
        </p>
        <p>
          <span className="pf-k">Bộ phận (hoặc địa chỉ):</span> {d.department || dots}
        </p>
        {isPay ? (
          <>
            <p>
              <span className="pf-k">Nội dung thanh toán:</span> {d.content || dots}
            </p>
            {d.items.length ? (
              <table className="pf-table">
                <thead>
                  <tr>
                    <th style={{ width: "7%" }}>STT</th>
                    <th>Nội dung chi</th>
                    <th style={{ width: "15%" }}>Số hóa đơn</th>
                    <th style={{ width: "14%" }}>Ngày HĐ</th>
                    <th style={{ width: "19%" }}>Số tiền (đ)</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((it, i) => (
                    <tr key={i}>
                      <td className="pf-c">{i + 1}</td>
                      <td>{it.content}</td>
                      <td className="pf-c">{it.invoice_no}</td>
                      <td className="pf-c">{it.invoice_date ? formatDate(it.invoice_date) : ""}</td>
                      <td className="pf-r">{formatNumber(it.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4} className="pf-r">
                      TỔNG CỘNG
                    </td>
                    <td className="pf-r">{formatNumber(total)}</td>
                  </tr>
                </tfoot>
              </table>
            ) : null}
            <p>
              <span className="pf-k">Số tiền:</span> <b>{formatNumber(total)} đồng</b>
            </p>
            <p>
              <span className="pf-k">Viết bằng chữ:</span> <i>{numberToVietnameseWords(total)}</i>
            </p>
            {Number(d.advance_amount) > 0 ? (
              <>
                <p>
                  <span className="pf-k">Số tiền đã tạm ứng:</span> {formatNumber(d.advance_amount)} đồng
                </p>
                <p>
                  <span className="pf-k">{remain >= 0 ? "Số tiền còn phải thanh toán:" : "Số tạm ứng chi không hết phải hoàn lại:"}</span>{" "}
                  <b>{formatNumber(Math.abs(remain))} đồng</b> <i>({numberToVietnameseWords(Math.abs(remain))})</i>
                </p>
              </>
            ) : null}
          </>
        ) : (
          <>
            <p>
              <span className="pf-k">Đề nghị cho tạm ứng số tiền:</span> <b>{formatNumber(total)} đồng</b>
            </p>
            <p>
              <span className="pf-k">Viết bằng chữ:</span> <i>{numberToVietnameseWords(total)}</i>
            </p>
            <p>
              <span className="pf-k">Lý do tạm ứng:</span> {d.content || dots}
            </p>
            <p>
              <span className="pf-k">Thời hạn thanh toán:</span> {d.due_date ? formatDate(d.due_date) : dots}
            </p>
          </>
        )}
        <p>
          <span className="pf-k">Hình thức {isPay ? "thanh toán" : "nhận tiền"}:</span>{" "}
          {d.payment_method === "transfer" ? (
            <>
              Chuyển khoản · STK: <b>{d.bank_account_no || "............"}</b> · Ngân hàng: {d.bank_name || "............"} · Chủ TK:{" "}
              {d.account_holder || d.requester_name || "............"}
            </>
          ) : (
            "Tiền mặt"
          )}
        </p>
        {isPay ? (
          <p>
            <span className="pf-k">Kèm theo:</span> {d.attachment_count ? formatNumber(d.attachment_count) : "......"} chứng từ gốc.
          </p>
        ) : null}
        {d.notes ? (
          <p>
            <span className="pf-k">Ghi chú:</span> {d.notes}
          </p>
        ) : null}
      </div>

      <div className={isPay ? "pf-signs pf-signs3" : "pf-signs pf-signs4"}>
        {(isPay
          ? ["Người đề nghị thanh toán", "Kế toán trưởng", "Người duyệt"]
          : ["Giám đốc", "Kế toán trưởng", "Phụ trách bộ phận", "Người đề nghị tạm ứng"]
        ).map((t) => (
          <div key={t}>
            <b>{t}</b>
            <i>(Ký, họ tên)</i>
          </div>
        ))}
      </div>
    </div>
  );
}

const CSS = `
.pf-sheet { background:#fff; color:#111; width:100%; max-width:210mm; margin:0 auto; padding:12mm;
  font-family:"Times New Roman", Times, serif; font-size:13pt; line-height:1.35; box-shadow:0 2px 12px rgba(0,0,0,.15); }
.pf-sheet * { box-sizing:border-box; border-color:#333; }
.pf-head { display:flex; justify-content:space-between; gap:12px; border-bottom:2px solid #0b3d6e; padding-bottom:8px; }
.pf-brand { display:flex; align-items:center; gap:10px; min-width:0; }
.pf-logo { width:30mm; height:auto; flex:none; }
.pf-co-name { font-weight:bold; font-size:12.5pt; color:#0b3d6e; text-transform:uppercase; }
.pf-small { font-size:11pt; }
.pf-tiny { font-size:9.5pt; font-style:italic; }
.pf-no { text-align:center; font-size:12pt; white-space:nowrap; }
.pf-form-code { font-weight:bold; }
.pf-mt4 { margin-top:4px; }
.pf-title { text-align:center; font-size:19pt; font-weight:bold; margin:12px 0 0; letter-spacing:.5px; }
.pf-date { text-align:center; font-style:italic; margin-bottom:10px; }
.pf-body p { margin:5px 0; }
.pf-k { color:#333; }
.pf-table { width:100%; border-collapse:collapse; margin:6px 0 8px; font-size:12pt; }
.pf-table th, .pf-table td { border:1px solid #333; padding:4px 6px; vertical-align:top; }
.pf-table th { background:#eef2f7; font-weight:bold; }
.pf-table tfoot td { font-weight:bold; }
.pf-c { text-align:center; } .pf-r { text-align:right; }
.pf-signs { display:grid; text-align:center; margin-top:18px; min-height:38mm; gap:6px; }
.pf-signs3 { grid-template-columns:1fr 1fr 1fr; }
.pf-signs4 { grid-template-columns:1fr 1fr 1fr 1fr; }
.pf-signs b { display:block; }
.pf-signs i { font-size:11pt; color:#555; }
@media screen and (max-width: 640px) {
  .pf-sheet { padding:14px; font-size:11.5pt; }
  .pf-head { flex-direction:column; } .pf-no { text-align:left; }
  .pf-signs3, .pf-signs4 { grid-template-columns:1fr 1fr; }
}
.pf-sheet.pf-a4 { width:794px; max-width:794px; padding:0; box-shadow:none; font-size:13pt; }
.pf-a4 .pf-head { flex-direction:row; } .pf-a4 .pf-no { text-align:center; }
.pf-a4 .pf-signs3 { grid-template-columns:1fr 1fr 1fr; } .pf-a4 .pf-signs4 { grid-template-columns:1fr 1fr 1fr 1fr; }
@media print {
  @page { size:A4 portrait; margin:12mm; }
  body * { visibility:hidden; }
  .pf-sheet, .pf-sheet * { visibility:visible; }
  .pf-sheet { position:absolute; left:0; top:0; max-width:none; padding:0; box-shadow:none; }
}
`;
