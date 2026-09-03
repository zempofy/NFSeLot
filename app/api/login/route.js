import { NextResponse } from "next/server";

export async function POST(request) {
  const { senha } = await request.json();

  if (!process.env.SITE_PASSWORD) {
    return NextResponse.json(
      { erro: "SITE_PASSWORD não configurada no servidor." },
      { status: 500 }
    );
  }

  if (senha !== process.env.SITE_PASSWORD) {
    return NextResponse.json({ erro: "Senha incorreta." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("nfse_auth", "ok", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 dias
    path: "/",
  });
  return res;
}
