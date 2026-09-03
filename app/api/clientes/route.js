import { NextResponse } from "next/server";
import { getClientes, addCliente } from "@/lib/db";

export async function GET() {
  return NextResponse.json(getClientes());
}

export async function POST(request) {
  const formData = await request.formData();
  const nome = formData.get("nome");
  const cnpj = formData.get("cnpj");

  if (!nome || !cnpj) {
    return NextResponse.json(
      { erro: "Preencha nome e CNPJ." },
      { status: 400 }
    );
  }

  const novo = addCliente({ nome, cnpj });
  return NextResponse.json(novo, { status: 201 });
}
