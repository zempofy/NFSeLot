import { buscarNotas } from "@/lib/nfse";

// Sem banco de dados, sem cadastro de cliente: tudo que a busca precisa
// (CNPJ, período, tipo, certificado e senha) vem direto do formulário,
// numa requisição só. O certificado é usado só nesta chamada e descartado
// junto com o resto assim que a resposta é enviada.
//
// A resposta é um stream de linhas JSON (NDJSON, uma por linha), não um
// JSON único no final — assim a tela consegue mostrar o progresso da busca
// (página do NSU, quantas notas já achou) enquanto ela ainda está rodando,
// em vez de ficar "Buscando…" parado sem informação até o fim. A última
// linha sempre é o evento final: "resultado", "aviso" ou "erro".
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
    return linhaUnica(
      { tipo: "erro", erro: "Preencha o CNPJ, o período, o tipo de nota, e anexe o certificado com a senha." },
      400
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const enviar = (evento) => controller.enqueue(encoder.encode(JSON.stringify(evento) + "\n"));

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
          onProgresso: (evento) => enviar({ tipo: "progresso", ...evento }),
        });

        if (totalNotas === 0) {
          enviar({ tipo: "aviso", aviso: "Nenhuma nota encontrada nesse período." });
        } else {
          const cnpjLimpo = cnpj.replace(/\D/g, "") || cnpj;
          const sufixo = `${tipo}-${formato}-${dataInicial}-a-${dataFinal}`;

          enviar({
            tipo: "resultado",
            totalNotas,
            tipo_nota: tipo,
            formato,
            zipBase64: zipBuffer.toString("base64"),
            planilhaBase64: planilhaBuffer.toString("base64"),
            nomeArquivoZip: `${cnpjLimpo}-${sufixo}.zip`,
            nomeArquivoPlanilha: `${cnpjLimpo}-retencoes-${tipo}-${dataInicial}-a-${dataFinal}.xlsx`,
          });
        }
      } catch (err) {
        // Erros comuns aqui: senha do .pfx errada, certificado vencido, ou
        // caminho/campo da API precisando de ajuste (ver avisos em lib/nfse.js).
        enviar({ tipo: "erro", erro: `Falha ao buscar notas: ${err.message}` });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}

function linhaUnica(evento, status) {
  return new Response(JSON.stringify(evento) + "\n", {
    status,
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}
