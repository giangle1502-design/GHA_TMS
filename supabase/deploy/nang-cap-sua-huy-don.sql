-- =============================================================================
-- KHÁNH HÀ TMS – NÂNG CẤP CƠ SỞ DỮ LIỆU: Đổi kiểu trường tương thích, hủy đơn hàng
-- Dán toàn bộ tệp vào Supabase → SQL Editor → Run. Chạy MỘT LẦN trên CSDL đang dùng.
-- Không xóa và không thêm dữ liệu nghiệp vụ. Tệp được ghép tự động – không sửa tay.
-- =============================================================================
begin;

do $$ begin
  if to_regprocedure('public.cancel_transport_order(uuid,text)') is not null then
    raise exception 'CSDL đã được nâng cấp Đổi kiểu trường tương thích, hủy đơn hàng trước đó, không cần chạy lại.';
  end if;
end $$;

-- >>> 20261030000028_field_type_compat.sql
-- =============================================================================
-- 0028: Cho đổi kiểu trường bổ sung đã có dữ liệu khi hai kiểu tương thích
-- (số ↔ tiền ↔ phần trăm; các kiểu chữ với nhau; mọi kiểu sang văn bản).
-- =============================================================================

create or replace function private.field_type_compatible(p_old text, p_new text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_old = p_new
      or (p_old in ('integer', 'decimal', 'currency', 'percent') and p_new in ('decimal', 'currency', 'percent'))
      or (p_old in ('short_text', 'long_text', 'email', 'phone', 'url') and p_new in ('short_text', 'long_text'))
      or (p_old in ('integer', 'decimal', 'currency', 'percent', 'date', 'datetime', 'single_select', 'email', 'phone', 'url') and p_new in ('short_text', 'long_text'))
      or (p_old = 'date' and p_new = 'datetime')
$$;

create or replace function private.guard_field_definitions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  used bigint;
begin
  if tg_op = 'DELETE' then
    if old.field_kind = 'system' then
      raise exception 'Không được xóa trường hệ thống' using errcode = '42501';
    end if;
    used := private.custom_field_usage(old.module, old.field_key);
    if used > 0 then
      raise exception 'Trường "%" đang có dữ liệu ở % bản ghi. Hãy chuyển sang Ngừng sử dụng thay vì xóa.', old.label, used
        using errcode = '42501';
    end if;
    if exists (select 1 from public.field_definitions f
               where f.module = old.module and f.id <> old.id and f.status = 'active'
                 and f.formula ~ ('\m' || old.field_key || '\M')) then
      raise exception 'Trường "%" đang được dùng trong công thức của trường khác.', old.label using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if new.module <> old.module or new.field_key <> old.field_key then
      raise exception 'Không được đổi module hoặc mã trường sau khi tạo' using errcode = '42501';
    end if;
    if new.field_kind = 'system' or old.field_kind = 'system' then
      if new.data_type <> old.data_type or new.field_kind <> old.field_kind then
        raise exception 'Không được đổi kiểu của trường hệ thống' using errcode = '42501';
      end if;
    end if;
    if new.data_type <> old.data_type and not private.field_type_compatible(old.data_type, new.data_type) then
      used := private.custom_field_usage(old.module, old.field_key);
      if used > 0 then
        raise exception 'Không thể đổi kiểu dữ liệu: trường "%" đang có dữ liệu ở % bản ghi và kiểu mới không tương thích. Hãy tạo trường mới đúng kiểu và chuyển trường cũ sang Ngừng sử dụng.', old.label, used
          using errcode = '42501';
      end if;
    end if;
    if (to_jsonb(new) - array['updated_at', 'updated_by', 'version']) is distinct from (to_jsonb(old) - array['updated_at', 'updated_by', 'version']) then
      new.version := old.version + 1;
    else
      new.version := old.version;
    end if;
  end if;
  return new;
end;
$$;


-- Hủy cả đơn hàng (tạo sai): hủy mọi chuyến còn hủy được, ghi lý do; chuyến đã hoàn thành/đóng thì không cho hủy đơn
create or replace function public.cancel_transport_order(p_order_id uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.transport_orders;
  s record;
  n int := 0;
begin
  if not (private.has_perm('dispatch.delete') or private.has_perm('shipments.delete')) then
    raise exception 'Bạn không có quyền hủy đơn hàng' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'Vui lòng nhập lý do hủy đơn hàng' using errcode = '22023';
  end if;
  select * into o from public.transport_orders where id = p_order_id for update;
  if o.id is null then
    raise exception 'Không tìm thấy đơn hàng' using errcode = '22023';
  end if;
  if o.status = 'cancelled' then
    return 0;
  end if;
  if exists (select 1 from public.shipments where order_id = o.id and status in ('driver_completed', 'closed')) then
    raise exception 'Đơn có chuyến đã hoàn thành hoặc đã đóng, không hủy cả đơn được. Hãy hủy từng chuyến chưa chạy.' using errcode = '22023';
  end if;
  for s in select id from public.shipments where order_id = o.id and status not in ('cancelled') for update loop
    update public.shipment_assignments set response = 'superseded', responded_at = now()
     where shipment_id = s.id and response in ('pending', 'accepted');
    update public.shipments set status = 'cancelled', cancel_reason = 'Hủy đơn hàng: ' || trim(p_reason) where id = s.id;
    n := n + 1;
  end loop;
  update public.transport_orders set status = 'cancelled' where id = o.id;
  return n;
end;
$$;
revoke all on function public.cancel_transport_order(uuid, text) from public, anon;
grant execute on function public.cancel_transport_order(uuid, text) to authenticated;

commit;
