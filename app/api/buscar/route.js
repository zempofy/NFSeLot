import { NextResponse } from "next/server";
import { buscarNotas } from "@/lib/nfse";

// Sem banco de dados, sem cadastro de cliente: tudo que a busca precisa
// (CNPJ, período, tipo, certificado e senha) vem direto do formulário,
// numa requisição só. O certificado é usado só nesta chamada e descartado
// junto com o resto assim que a resposta é enviada.
export async function POST(request) {
  const formData = await request.formData();
  const cnpj = formData.get("cnpj");
  const senha = formData.get("senhaCertificado");
  const arquivo = formData.get("certificado");
  const dataInicial = formData.get("dataInicial");
  const dataFinal = formData.get("dataFinal");
  const tipo = formData.get("tipo"); // "emitidas" | "tomadas"
  const formato = formData.get("formato"); // "xml" | "pdf"

  if (!cnpj || !senha || !arquivo || !dataInicial || !dataFinal || !tipo || !formato) {
    return NextResponse.json(
      { erro: "Preencha o CNPJ, o período, o tipo de nota, e anexe o certificado com a senha." },
      { status: 400 }
    );
  }

  try {
    const pfxBuffer = Buffer.from(await arquivo.arrayBuffer());

    const { zipBuffer, planilhaBuffer, totalNotas } = await buscarNotas({
      pfxBuffer,
      senha,
      cnpjCliente: cnpj,
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

    const cnpjLimpo = cnpj.replace(/\D/g, "") || cnpj;
    const sufixo = `${tipo}-${formato}-${dataInicial}-a-${dataFinal}`;

    return NextResponse.json({
      totalNotas,
      tipo,
      formato,
      zipBase64: zipBuffer.toString("base64"),
      planilhaBase64: planilhaBuffer.toString("base64"),
      nomeArquivoZip: `${cnpjLimpo}-${sufixo}.zip`,
      nomeArquivoPlanilha: `${cnpjLimpo}-retencoes-${tipo}-${dataInicial}-a-${dataFinal}.xlsx`,
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
