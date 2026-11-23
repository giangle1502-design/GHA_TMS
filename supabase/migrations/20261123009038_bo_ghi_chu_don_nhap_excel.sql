-- =============================================================================
-- GHA 9038: Bỏ ghi chú của các đơn đã tạo từ file Excel / file Mua (sheet COST CONT) (LE 23/11/2026)
--   Ghi chú trong file là của khách (tờ khai, STO, NCC, kho xuất/nhập, ghi chú khách...), không phải ghi chú của GHA.
--   Đơn dán / nhập từ Excel nhận biết bằng ghi chú đơn tự sinh bắt đầu bằng "Dán từ Excel".
--   1. Sao lưu ghi chú cũ vào bảng private.backup_9038_notes (lấy lại được nếu cần).
--   2. Xóa ghi chú chuyến (shipments.notes) và ghi chú đơn (transport_orders.notes) của các đơn đó.
--   Số tờ khai của đơn vẫn còn ở ô Số đơn của khách (transport_orders.ref_no).
--   Từ bản web mới, nhập file Excel không ghi ghi chú nữa.
-- Chạy một lần trong Supabase SQL Editor. Chạy lại không sao (lần sau không còn gì để xóa).
-- =============================================================================

create table if not exists private.backup_9038_notes (
  kind text not null,          -- 'order' | 'shipment'
  id uuid not null,
  code text,
  notes text,
  backed_up_at timestamptz not null default now(),
  primary key (kind, id)
);

with o as (
  select id from public.transport_orders where notes like 'Dán từ Excel%'
)
insert into private.backup_9038_notes (kind, id, code, notes)
select 'shipment', s.id, s.shipment_code, s.notes
from public.shipments s
where s.order_id in (select id from o) and coalesce(s.notes, '') <> ''
on conflict (kind, id) do nothing;

insert into private.backup_9038_notes (kind, id, code, notes)
select 'order', t.id, t.order_code, t.notes
from public.transport_orders t
where t.notes like 'Dán từ Excel%'
on conflict (kind, id) do nothing;

update public.shipments s
set notes = null
where s.order_id in (select id from public.transport_orders where notes like 'Dán từ Excel%')
  and coalesce(s.notes, '') <> '';

update public.transport_orders
set notes = null
where notes like 'Dán từ Excel%';

-- Kiểm tra: số đơn / chuyến đã sao lưu và xóa ghi chú
select kind, count(*) as so_dong from private.backup_9038_notes group by kind;
