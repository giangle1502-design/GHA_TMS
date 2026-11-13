-- =============================================================================
-- KHÁNH HÀ TMS – NÂNG CẤP CƠ SỞ DỮ LIỆU: Điều phối làm thay tài xế, bỏ qua ảnh có lý do
-- Dán toàn bộ tệp vào Supabase → SQL Editor → Run. Chạy MỘT LẦN trên CSDL đang dùng.
-- Không xóa và không thêm dữ liệu nghiệp vụ. Tệp được ghép tự động – không sửa tay.
-- =============================================================================
begin;

do $$ begin
  if to_regprocedure('public.dispatch_act_for_driver(uuid,text,text,text,boolean,text)') is not null then
    raise exception 'CSDL đã được nâng cấp Điều phối làm thay tài xế, bỏ qua ảnh có lý do trước đó, không cần chạy lại.';
  end if;
end $$;

-- >>> 20261030000026_dispatch_act_for_driver.sql
-- =============================================================================
-- 0026: Điều phối làm thay tài xế 3 bước trên chuyến (nhận đơn, bắt đầu chạy, hoàn thành).
-- Bước hoàn thành: điều phối tải ảnh thay, hoặc bỏ qua ảnh khi nhập lý do (chứng từ để "Thiếu", bổ sung sau).
-- Tài xế trên điện thoại vẫn bắt buộc ảnh như cũ. Chi phí: điều phối nhập bằng nút "Nhập chi phí" có sẵn.
-- =============================================================================

alter table public.shipments add column if not exists photo_skip_reason text;
comment on column public.shipments.photo_skip_reason is
  'Lý do điều phối hoàn thành chuyến thay tài xế mà chưa có ảnh/phiếu ký nhận (bổ sung chứng từ sau)';
alter table public.shipments drop constraint if exists shipments_photo_skip_reason_len;
alter table public.shipments add constraint shipments_photo_skip_reason_len check (photo_skip_reason is null or length(photo_skip_reason) <= 500);

create or replace function public.dispatch_act_for_driver(
  p_shipment_id uuid, p_step text, p_result text default null, p_note text default null,
  p_no_expense boolean default null, p_photo_skip_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.shipments;
  v_a public.shipment_assignments;
  v_driver text;
  v_me text;
  v_photos int;
  v_3pl boolean;
  v_skip text := nullif(trim(coalesce(p_photo_skip_reason, '')), '');
begin
  if not private.has_perm('dispatch.update') then
    raise exception 'Bạn không có quyền làm thay tài xế' using errcode = '42501';
  end if;
  select * into v_s from public.shipments where id = p_shipment_id for update;
  if v_s.id is null then
    raise exception 'Không tìm thấy chuyến' using errcode = '22023';
  end if;
  if v_s.driver_id is null then
    raise exception 'Chuyến chưa phân công tài xế' using errcode = '22023';
  end if;
  select full_name into v_driver from public.drivers where id = v_s.driver_id;
  select coalesce(nullif(full_name, ''), email) into v_me from public.profiles where id = auth.uid();
  v_me := coalesce(v_me, 'Điều phối');

  if p_step = 'accept' then
    if v_s.status <> 'assigned' then
      raise exception 'Chuyến không còn ở trạng thái chờ tài xế nhận' using errcode = '22023';
    end if;
    select * into v_a from public.shipment_assignments
     where shipment_id = v_s.id and driver_id = v_s.driver_id and response = 'pending' for update;
    if v_a.id is not null then
      update public.shipment_assignments set response = 'accepted', responded_at = now() where id = v_a.id;
    end if;
    update public.shipments set status = 'accepted' where id = v_s.id;
    perform private.driver_link_note(v_s.id, 'accepted', v_me || ' nhận chuyến thay tài xế ' || v_driver);

  elsif p_step = 'start' then
    if v_s.status <> 'accepted' then
      raise exception 'Chỉ bắt đầu được chuyến đã nhận' using errcode = '22023';
    end if;
    update public.shipments set status = 'in_transit', departed_pickup_at = coalesce(departed_pickup_at, now()) where id = v_s.id;
    perform private.driver_link_note(v_s.id, 'in_transit', v_me || ' bấm bắt đầu chạy thay tài xế ' || v_driver);

  elsif p_step = 'complete' then
    if v_s.status <> 'in_transit' then
      raise exception 'Bấm "Bắt đầu chạy" trước khi hoàn thành chuyến' using errcode = '22023';
    end if;
    if coalesce(p_result, '') not in ('full', 'partial', 'failed') then
      raise exception 'Chọn kết quả giao hàng' using errcode = '22023';
    end if;
    if p_result <> 'full' and length(trim(coalesce(p_note, ''))) = 0 then
      raise exception 'Giao thiếu hoặc không giao được: vui lòng ghi lý do' using errcode = '22023';
    end if;
    if length(coalesce(p_note, '')) > 500 or length(coalesce(v_skip, '')) > 500 then
      raise exception 'Ghi chú tối đa 500 ký tự' using errcode = '22023';
    end if;
    v_3pl := private.shipment_is_3pl(v_s);
    if p_no_expense is null and not v_3pl then
      raise exception 'Chọn "Có chi phí" hoặc "Không phát sinh chi phí"' using errcode = '22023';
    end if;
    select count(*) into v_photos from public.documents
     where entity_type = 'shipment' and entity_id = v_s.id and doc_type in ('photo', 'delivery_note') and archived_at is null;
    if v_photos = 0 and v_skip is null then
      raise exception 'Tải ít nhất 1 ảnh hàng hoặc phiếu ký nhận, hoặc ghi lý do chưa có chứng từ' using errcode = '22023';
    end if;
    update public.shipments
       set status = 'driver_completed',
           completed_at = now(),
           arrived_delivery_at = coalesce(arrived_delivery_at, now()),
           delivery_result = p_result,
           completion_note = nullif(trim(coalesce(p_note, '')), ''),
           photo_skip_reason = case when v_photos = 0 then v_skip end,
           document_status = case when v_photos > 0 and document_status in ('missing', 'rejected') then 'submitted' else document_status end,
           expense_declaration = case when v_3pl then null when p_no_expense then 'none' else 'has' end,
           expense_declared_at = case when v_3pl then null else now() end
     where id = v_s.id;
    perform private.driver_link_note(v_s.id, 'driver_completed', v_me || ' hoàn thành chuyến thay tài xế ' || v_driver
      || case when v_photos > 0 then ' (' || v_photos || ' ảnh)' else ' (chưa có ảnh: ' || v_skip || ')' end);
  else
    raise exception 'Bước không hợp lệ' using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.dispatch_act_for_driver(uuid, text, text, text, boolean, text) from public, anon;
grant execute on function public.dispatch_act_for_driver(uuid, text, text, text, boolean, text) to authenticated;

-- Bổ sung ảnh sau: xóa lý do bỏ qua ảnh khi đã có chứng từ giao hàng
create or replace function private.clear_photo_skip_reason()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.entity_type = 'shipment' and new.doc_type in ('photo', 'delivery_note') then
    update public.shipments set photo_skip_reason = null where id = new.entity_id and photo_skip_reason is not null;
  end if;
  return new;
end;
$$;
drop trigger if exists documents_clear_photo_skip on public.documents;
create trigger documents_clear_photo_skip after insert on public.documents
  for each row execute function private.clear_photo_skip_reason();

commit;
