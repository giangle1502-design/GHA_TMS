/** Lỗi PostgREST / Postgres do cột chưa có (CSDL chưa chạy SQL nâng cấp) */
export function missingColumn(error: { code?: string; message?: string } | null | undefined, column: string): boolean {
  if (!error) return false;
  const msg = error.message ?? "";
  return (error.code === "42703" || error.code === "PGRST204" || /does not exist|could not find/i.test(msg)) && msg.includes(column);
}
