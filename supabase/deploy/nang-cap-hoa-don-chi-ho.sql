-- =============================================================================
-- KHÁNH HÀ TMS – NÂNG CẤP CƠ SỞ DỮ LIỆU: Đính kèm PDF / ảnh hóa đơn cho phí chi hộ
-- Dán toàn bộ tệp vào Supabase → SQL Editor → Run. Chạy MỘT LẦN trên CSDL đang dùng.
-- Không xóa và không thêm dữ liệu nghiệp vụ. Tệp được ghép tự động – không sửa tay.
-- =============================================================================
begin;

do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'documents' and column_name = 'fee_type_id') then
    raise exception 'CSDL đã được nâng cấp Đính kèm PDF / ảnh hóa đơn cho phí chi hộ trước đó, không cần chạy lại.';
  end if;
end $$;

-- >>> 20261102000053_pass_through_fee_files.sql
-- =============================================================================
-- KHÁNH HÀ TMS - 0053: Đính kèm PDF / ảnh hóa đơn cho từng phí chi hộ của chuyến
-- =============================================================================
-- Dòng phí (shipment_fees) bị xóa và ghi lại mỗi lần lưu phí, nên tệp không gắn vào dòng phí
-- mà gắn vào chuyến + loại phí: entity_type = 'shipment_fee', entity_id = id chuyến, fee_type_id = loại phí.
-- Không tính là chứng từ giao hàng của chuyến (không đổi trạng thái chứng từ, tài xế không thấy).
-- Đường dẫn tệp trên Storage: shipment_fee/<id chuyến>/<uuid>.<pdf|jpg|png|webp|heic>
-- Quyền: như chứng từ khác (tải lên cần documents.create, xem cần documents.view hoặc chính người tải).
-- =============================================================================

alter table public.documents add column if not exists fee_type_id uuid references public.fee_types (id) on delete set null;
comment on column public.documents.fee_type_id is 'Loại phí thu khách mà tệp đính kèm (chỉ dùng với entity_type = shipment_fee)';

alter table public.documents drop constraint documents_entity_type_check;
alter table public.documents add constraint documents_entity_type_check check (entity_type in (
  'shipment', 'shipment_expense', 'advance_request', 'payment', 'vehicle', 'driver', 'driver_payroll',
  'maintenance_record', 'approval_request', 'receivable', 'payable', 'transport_order', 'location', 'customer',
  'purchase_request', 'task', 'shipment_fee'));

alter table public.documents drop constraint if exists documents_fee_type_check;
alter table public.documents add constraint documents_fee_type_check
  check (entity_type <> 'shipment_fee' or fee_type_id is not null);

create index if not exists documents_shipment_fee_idx on public.documents (entity_id, fee_type_id)
  where entity_type = 'shipment_fee' and archived_at is null;

commit;
