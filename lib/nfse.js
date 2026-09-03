// Integração com a API Nacional da NFS-e (ADN — Ambiente de Dados Nacional).
//
// ⚠️ IMPORTANTE — leia antes de usar com certificado de verdade:
// A documentação oficial (Swagger) só abre no navegador se você já estiver
// autenticado com um certificado digital válido, então não consegui abrir e
// confirmar cada rota programaticamente. Os caminhos abaixo (PATHS) foram
// montados a partir da documentação técnica pública e de guias de terceiros
// que integraram com essa API. O esqueleto e a lógica (mTLS, loop de NSU,
// gzip+base64, montagem do zip) são o que a integração realmente precisa —
// mas antes de usar com um cliente de verdade, abram uma das rotas do
// Swagger com um certificado válido em homologação e confirmem se os
// caminhos batem:
//   https://adn.producaorestrita.nfse.gov.br/contribuintes/docs/index.html
// Se algum caminho estiver diferente, é só ajustar aqui em PATHS.
//
// ⚠️ SEGUNDO PONTO IMPORTANTE — busca por período:
// A API nacional (pelo que dava pra confirmar sem certificado) expõe a
// distribuição de documentos por NSU (Número Sequencial Único) — um cursor
// que avança, não um filtro de data pronto. Ou seja: pra buscar "notas
// entre 01/03 e 31/03", este código varre o NSU desde o começo e filtra
// cada nota pela data de emissão real do XML — não existe (ainda
// confirmado) um jeito de "pular direto" pro NSU de uma data. Isso funciona,
// mas pode ficar lento pra CNPJs com muito histórico ou datas antigas,
// porque estamos baixando e abrindo XML de nota por nota até achar o
// período certo. Se durante os testes em homologação vocês encontrarem uma
// rota de busca por data já pronta na API (algo tipo
// /contribuintes/nfse?dataInicial=...&dataFinal=...), troquem por ela aqui
// — vai ser bem mais rápido que esse jeito de varrer tudo.
//
// ⚠️ TERCEIRO PONTO IMPORTANTE — nomes de campo no XML:
// Os nomes de tag em CAMPOS_XML abaixo (vServ, vISSRet, vPIS, etc.) são o
// "layout padrão" mais comum da NFS-e Nacional, mas não foram confirmados
// contra um XML de verdade. Depois que a busca funcionar com um certificado
// real, abram um dos XMLs baixados, comparem os nomes das tags com o que
// está em CAMPOS_XML, e ajustem aqui se algo vier em branco na planilha.

import https from "https";
import zlib from "zlib";
import JSZip from "jszip";
import * as XLSX from "xlsx";

const AMBIENTES = {
  homologacao: "https://adn.producaorestrita.nfse.gov.br",
  producao: "https://adn.nfse.gov.br",
};

const PATHS = {
  // GET -> lista (ou item único, depende da implementação) de documentos
  // fiscais novos a partir de um NSU. É o mecanismo de varredura que usamos
  // pra montar a busca por período (ver aviso no topo do arquivo).
  dfe: (nsu) => `/contribuintes/DFe/${nsu}`,
  // GET -> XML completo (gzip+base64) de uma NFS-e específica.
  nfse: (chaveAcesso) => `/contribuintes/nfse/${chaveAcesso}`,
  // GET -> PDF (DANFSe) pronto pra imprimir/conferir.
  danfse: (chaveAcesso) => `/danfse/${chaveAcesso}`,
};

// "Melhor palpite" de onde ficam os dados na nota — ver aviso 3 no topo.
const CAMPOS_XML = {
  dataEmissao: ["dhEmi", "DataEmissao", "dataEmissao"],
  valorServico: ["vServ", "ValorServicos", "valorServico"],
  issRetido: ["vISSRet", "vISS", "ValorIssRetido"],
  pis: ["vPIS", "ValorPis"],
  cofins: ["vCOFINS", "ValorCofins"],
  csll: ["vCSLL", "ValorCsll"],
  ir: ["vIR", "ValorIr"],
};

function getBaseUrl() {
  const ambiente = process.env.NFSE_AMBIENTE === "producao" ? "producao" : "homologacao";
  return AMBIENTES[ambiente];
}

// Faz uma requisição GET autenticada com o certificado do cliente (mTLS).
function requisitarComCertificado({ pfxBuffer, senha, path, accept = "application/json" }) {
  return new Promise((resolve, reject) => {
    const baseUrl = new URL(getBaseUrl());
    const options = {
      hostname: baseUrl.hostname,
      path,
      method: "GET",
      pfx: pfxBuffer,
      passphrase: senha,
      headers: { Accept: accept },
      // nunca desligue isso: garante que estamos falando com o servidor
      // certo (e não um golpe/man-in-the-middle).
      rejectUnauthorized: true,
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, body });
        } else {
          reject(
            new Error(
              `Governo respondeu ${res.statusCode} em ${path}: ${body.toString("utf-8").slice(0, 500)}`
            )
          );
        }
      });
    });

    req.on("error", (err) => {
      // Erro de certificado (mTLS) costuma aparecer aqui, ex:
      // "unable to verify the first certificate" ou senha errada do .pfx.
      reject(err);
    });

    req.end();
  });
}

function descompactarXml(base64Gzip) {
  const comprimido = Buffer.from(base64Gzip, "base64");
  return zlib.gunzipSync(comprimido).toString("utf-8");
}

// Extrai o conteúdo de uma tag simples (<tag>valor</tag>), tentando cada
// nome candidato em ordem até achar um que exista.
function extrairValor(xmlOuBloco, tags) {
  for (const tag of tags) {
    const m = xmlOuBloco.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i"));
    if (m) return m[1].trim();
  }
  return "";
}

// Extrai o bloco inteiro de uma tag composta (<tag>...conteúdo...</tag>),
// usado pra isolar <prestador>...</prestador> de <tomador>...</tomador>
// antes de procurar o CNPJ dentro — senão um regex simples pegaria o CNPJ
// errado (o primeiro que aparecer no XML inteiro).
function extrairBloco(xml, tags) {
  for (const tag of tags) {
    const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
    if (m) return m[1];
  }
  return "";
}

// A partir do XML de uma nota, descobre: se o CNPJ do cliente é o
// prestador (nota emitida) ou o tomador (nota tomada), a data de emissão,
// e os valores de retenção. Devolve null se não conseguir classificar a
// nota com segurança (melhor ignorar do que colocar na planilha errada).
function extrairDadosNota(xml, cnpjCliente) {
  const blocoPrestador = extrairBloco(xml, ["prestador", "Prestador"]);
  const blocoTomador = extrairBloco(xml, ["tomador", "Tomador"]);

  const cnpjPrestador = extrairValor(blocoPrestador, ["CNPJ", "Cnpj"]).replace(/\D/g, "");
  const cnpjTomador = extrairValor(blocoTomador, ["CNPJ", "Cnpj"]).replace(/\D/g, "");
  const cnpjLimpo = (cnpjCliente || "").replace(/\D/g, "");

  let papel = null;
  if (cnpjPrestador && cnpjPrestador === cnpjLimpo) papel = "emitidas";
  else if (cnpjTomador && cnpjTomador === cnpjLimpo) papel = "tomadas";
  if (!papel) return null;

  const dataStr = extrairValor(xml, CAMPOS_XML.dataEmissao);
  const dataEmissao = dataStr ? new Date(dataStr) : null;

  const blocoOutraParte = papel === "emitidas" ? blocoTomador : blocoPrestador;

  return {
    papel, // "emitidas" | "tomadas"
    dataEmissao,
    nomeOutraParte: extrairValor(blocoOutraParte, ["xNome", "XNome", "razaoSocial", "RazaoSocial"]),
    cnpjOutraParte: papel === "emitidas" ? cnpjTomador : cnpjPrestador,
    valorServico: extrairValor(xml, CAMPOS_XML.valorServico),
    issRetido: extrairValor(xml, CAMPOS_XML.issRetido),
    pis: extrairValor(xml, CAMPOS_XML.pis),
    cofins: extrairValor(xml, CAMPOS_XML.cofins),
    csll: extrairValor(xml, CAMPOS_XML.csll),
    ir: extrairValor(xml, CAMPOS_XML.ir),
  };
}

function gerarPlanilhaRetencoes(documentos, tipo) {
  const colunaOutraParte = tipo === "emitidas" ? "Tomador" : "Prestador";

  const linhas = documentos.map((doc) => ({
    "Chave de acesso": doc.chaveAcesso,
    "Data de emissão": doc.dados.dataEmissao ? doc.dados.dataEmissao.toISOString().slice(0, 10) : "",
    [colunaOutraParte]: doc.dados.nomeOutraParte || "",
    "CNPJ": doc.dados.cnpjOutraParte || "",
    "Valor do serviço": Number(doc.dados.valorServico) || 0,
    "ISS retido": Number(doc.dados.issRetido) || 0,
    "PIS": Number(doc.dados.pis) || 0,
    "COFINS": Number(doc.dados.cofins) || 0,
    "CSLL": Number(doc.dados.csll) || 0,
    "IR": Number(doc.dados.ir) || 0,
  }));

  const planilha = XLSX.utils.json_to_sheet(linhas);
  const livro = XLSX.utils.book_new();
  const nomeAba = tipo === "emitidas" ? "Notas emitidas" : "Notas tomadas";
  XLSX.utils.book_append_sheet(livro, planilha, nomeAba);
  return XLSX.write(livro, { type: "buffer", bookType: "xlsx" });
}

// Função principal chamada pela rota da API. Varre o NSU do cliente,
// filtra pelo período e pelo tipo (emitidas/tomadas) pedidos, monta o zip
// no formato pedido (xml ou pdf) e sempre monta a planilha de retenções
// junto — assim a pessoa não precisa anexar o certificado de novo só pra
// pegar a planilha depois.
export async function buscarNotas({ pfxBuffer, senha, cnpjCliente, dataInicial, dataFinal, tipo, formato }) {
  const inicio = new Date(`${dataInicial}T00:00:00`);
  const fim = new Date(`${dataFinal}T23:59:59`);
  const incluirPdf = formato === "pdf";

  const documentos = [];
  let nsuAtual = "0";
  const LIMITE_DE_SEGURANCA = 5000; // evita loop infinito se o formato mudar

  for (let i = 0; i < LIMITE_DE_SEGURANCA; i++) {
    const { body } = await requisitarComCertificado({ pfxBuffer, senha, path: PATHS.dfe(nsuAtual) });

    let resposta;
    try {
      resposta = JSON.parse(body.toString("utf-8"));
    } catch {
      break;
    }

    const lote = Array.isArray(resposta) ? resposta : [resposta];
    if (lote.length === 0 || !lote[0]) break;

    for (const item of lote) {
      if (item?.nsu) nsuAtual = item.nsu;

      const chaveAcesso = item.chaveAcesso || item.chave || item.nsu;
      if (!chaveAcesso) continue;

      let xml = null;
      const xmlBase64 = item.arquivoXml || item.xmlGzipB64 || item.docFiscal;
      if (xmlBase64) {
        try {
          xml = descompactarXml(xmlBase64);
        } catch {
          xml = Buffer.from(xmlBase64, "base64").toString("utf-8");
        }
      } else {
        try {
          const r = await requisitarComCertificado({ pfxBuffer, senha, path: PATHS.nfse(chaveAcesso) });
          xml = descompactarXml(JSON.parse(r.body.toString("utf-8")).arquivoXml);
        } catch {
          continue; // não trava o lote todo por causa de uma nota problemática
        }
      }
      if (!xml) continue;

      const dados = extrairDadosNota(xml, cnpjCliente);
      if (!dados) continue; // não deu pra classificar emitida/tomada com segurança
      if (dados.papel !== tipo) continue;
      if (dados.dataEmissao && (dados.dataEmissao < inicio || dados.dataEmissao > fim)) continue;

      documentos.push({ chaveAcesso, xml, dados });
    }

    if (!resposta.temMais && !Array.isArray(resposta)) break;
  }

  const zip = new JSZip();
  for (const doc of documentos) {
    if (!incluirPdf) {
      zip.file(`${doc.chaveAcesso}.xml`, doc.xml);
      continue;
    }
    try {
      const { body } = await requisitarComCertificado({
        pfxBuffer,
        senha,
        path: PATHS.danfse(doc.chaveAcesso),
        accept: "application/pdf",
      });
      zip.file(`${doc.chaveAcesso}.pdf`, body);
    } catch (err) {
      zip.file(`${doc.chaveAcesso}-ERRO.txt`, `Falha ao buscar PDF: ${err.message}`);
    }
  }

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
  const planilhaBuffer =
    documentos.length > 0 ? gerarPlanilhaRetencoes(documentos, tipo) : null;

  return { zipBuffer, planilhaBuffer, totalNotas: documentos.length };
}
