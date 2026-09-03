import { NextResponse } from "next/server";

// Protege todo o site com uma senha simples, guardada num cookie após o
// login. Não é um sistema de usuários completo — é o suficiente pra não
// deixar o site 100% aberto pra qualquer um que ache a URL do Vercel.
// Se no futuro cada pessoa do escritório precisar de login próprio, dá pra
// trocar isso por NextAuth sem mexer no resto do app.

export function middleware(request) {
  const { pathname } = request.nextUrl;

  const rotasLivres = ["/login", "/api/login"];
  if (rotasLivres.some((r) => pathname.startsWith(r)) || pathname.startsWith("/_next")) {
    return NextResponse.next();
  }

  const autenticado = request.cookies.get("nfse_auth")?.value === "ok";
  if (!autenticado) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
