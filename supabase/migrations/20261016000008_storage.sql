-- =============================================================================
-- GHA TMS - 0008: Supabase Storage cho chứng từ (bucket riêng tư, truy cập bằng signed URL)
-- =============================================================================
-- Quy ước đường dẫn tệp: {entity_type}/{entity_id}/{uuid}-{tên tệp}
-- Tải lên: qua server action (kiểm tra quyền + loại tệp + dung lượng) rồi ghi metadata vào public.documents.
-- Xem/tải: server tạo signed URL ngắn hạn sau khi kiểm tra quyền đọc bản ghi documents (RLS).
-- =============================================================================
do $outer$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'Bỏ qua cấu hình Storage: không có schema storage (môi trường kiểm thử cục bộ).';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('documents', 'documents', false, 10485760, array[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

  execute $p$
    create policy documents_bucket_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'documents' and private.has_perm('documents.create'))
  $p$;
  execute $p$
    create policy documents_bucket_select on storage.objects for select to authenticated
    using (bucket_id = 'documents' and exists (
      select 1 from public.documents d where d.bucket = 'documents' and d.storage_path = storage.objects.name
    ))
  $p$;
end
$outer$;
