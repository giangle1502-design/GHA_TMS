import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next") ?? "/";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";

  if (!code) {
    return NextResponse.redirect(`${origin}/dang-nhap?loi=thieu-ma`);
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/dang-nhap?loi=xac-thuc`);
  }
  // Trang "/" sẽ chuyển tiếp theo trạng thái tài khoản và quyền
  return NextResponse.redirect(`${origin}${next}`);
}
