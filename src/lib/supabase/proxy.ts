import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// /tx: ứng dụng tài xế mở bằng link + biển số xe, không cần tài khoản (quyền kiểm tra trong các hàm driver_link_* của CSDL).
const PUBLIC_PATHS = ["/dang-nhap", "/auth/callback", "/auth/error", "/tx"];

/** Làm mới phiên Supabase và chuyển người chưa đăng nhập về trang đăng nhập. */
export async function updateSession(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const isPublic = PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));

  if (!url || !key) {
    // Chưa cấu hình: chỉ cho xem trang đăng nhập (trang này hiển thị hướng dẫn cấu hình).
    if (isPublic) return NextResponse.next();
    return NextResponse.redirect(new URL("/dang-nhap", request.url));
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });

  // getClaims() xác thực chữ ký JWT; không tin dữ liệu phiên chưa xác thực.
  const { data } = await supabase.auth.getClaims();
  const isLoggedIn = Boolean(data?.claims?.sub);

  if (!isLoggedIn && !isPublic) {
    const loginUrl = new URL("/dang-nhap", request.url);
    const next = request.nextUrl.pathname + request.nextUrl.search;
    if (next !== "/") loginUrl.searchParams.set("next", next);
    return NextResponse.redirect(loginUrl);
  }
  return response;
}
