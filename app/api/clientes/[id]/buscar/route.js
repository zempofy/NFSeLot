import { NextResponse } from "next/server";
import { getCliente } from "@/lib/db";
import { buscarNotas } from "@/lib/nfse";

// Recebe, numa única requisição via FormData: o certificado (.pfx) e a
// senha (usados só nesta busca, nunca gravados), a data inicial/final, o
// tipo (emitidas/tomadas) e o formato pedido (xml/pdf). Devolve, numa
// resposta só, o zip pedido E a planilha de retenções já pronta — assim a
// pessoa não precisa anexar o certificado de novo só pra baixar a
// planilha depois de já ter buscado as notas.
export async function POST(request, { params }) {
  const cliente = getCliente(params.id);
  if (!cliente) {
    return NextResponse.json({ erro: "Cliente não encontrado." }, { status: 404 });
  }

  const formData = await request.formData();
  const senha = formData.get("senhaCertificado");
  const arquivo = formData.get("certificado");
  const dataInicial = formData.get("dataInicial");
  const dataFinal = formData.get("dataFinal");
  const tipo = formData.get("tipo"); // "emitidas" | "tomadas"
  const formato = formData.get("formato"); // "xml" | "pdf"

  if (!senha || !arquivo || !dataInicial || !dataFinal || !tipo || !formato) {
    return NextResponse.json(
      { erro: "Preencha data inicial, data final, o tipo de nota, e anexe o certificado com a senha." },
      { status: 400 }
    );
  }

  try {
    const pfxBuffer = Buffer.from(await arquivo.arrayBuffer());

    const { zipBuffer, planilhaBuffer, totalNotas } = await buscarNotas({
      pfxBuffer,
      senha,
      cnpjCliente: cliente.cnpj,
      dataInicial,
      dataFinal,
      tipo,
      formato,
    });

    if (totalNotas === 0) {
      return NextResponse.json(
        { aviso: "Nenhuma nota encontrada nesse período." },
        { status: 200 }
      );
    }

    const sufixo = `${tipo}-${formato}-${dataInicial}-a-${dataFinal}`;

    return NextResponse.json({
      totalNotas,
      tipo,
      formato,
      zipBase64: zipBuffer.toString("base64"),
      planilhaBase64: planilhaBuffer.toString("base64"),
      nomeArquivoZip: `${cliente.cnpj}-${sufixo}.zip`,
      nomeArquivoPlanilha: `${cliente.cnpj}-retencoes-${tipo}-${dataInicial}-a-${dataFinal}.xlsx`,
    });
  } catch (err) {
    // Erros comuns aqui: senha do .pfx errada, certificado vencido, ou
    // caminho/campo da API precisando de ajuste (ver avisos em lib/nfse.js).
    return NextResponse.json(
      { erro: `Falha ao buscar notas: ${err.message}` },
      { status: 502 }
    );
  }
}
