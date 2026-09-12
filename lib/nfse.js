// Integração com a API Nacional da NFS-e (ADN — Ambiente de Dados Nacional).
//
// ✅ Caminhos confirmados em 2026-09-10 a partir do Swagger oficial
// (baixado direto de https://adn.producaorestrita.nfse.gov.br/contribuintes/docs/index.html
// com um certificado real). A API só documenta dois caminhos, os dois sob
// o prefixo /contribuintes:
//   GET /DFe/{NSU}?cnpjConsulta=...   -> lote de documentos a partir do NSU
//   GET /NFSe/{ChaveAcesso}/Eventos    -> eventos (cancelamento etc) de uma
//                                         nota específica — não é o XML da
//                                         nota em si, por isso não usamos
//                                         esse caminho pra buscar o documento.
// A resposta de /DFe/{NSU} é um objeto (LoteDistribuicaoNSUResponse), não uma
// lista solta: { StatusProcessamento, LoteDFe: [...], Erros: [...], ... }.
// Cada item de LoteDFe já vem com o XML embutido em ArquivoXml (gzip+base64)
// quando TipoDocumento é "NFSE" — não existe um segundo endpoint pra buscar
// o XML separadamente, então se ArquivoXml não vier, a nota é ignorada.
// Os nomes dos campos vêm em PascalCase (NSU, ChaveAcesso, ArquivoXml,
// TipoDocumento, StatusProcessamento) — reparem nisso se for mexer aqui.
//
// 🛑 DANFSe (PDF) — mudança de rumo confirmada em 2026-09-10, lendo a Nota
// Técnica nº 008 (SE/CGNFS-e, 05/05/2026), o próprio manual oficial do
// DANFSe: a API de geração do DANFSe do governo
// (https://adn.nfse.gov.br/danfse/docs/index.html) foi sobrestada
// (suspensa) em 1º de julho de 2026 — ou seja, ela não existe mais desde
// então. O motivo, segundo o próprio documento: a partir de agora é
// responsabilidade de cada software (o nosso incluído) GERAR o PDF do
// DANFSe localmente, seguindo o layout oficial do Anexo I da nota técnica
// (papel A4, campos e posições definidos, QR Code apontando pra
// https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=<chave de acesso>).
// PATHS.danfse abaixo NÃO funciona mais — é só o palpite antigo, mantido
// pra não quebrar import, mas o botão "Baixar PDF" hoje só deve estar
// gerando um arquivo de erro por nota dentro do zip (ver captura de erro
// mais abaixo). Gerar o DANFSe de verdade é uma funcionalidade nova e
// maior (montar o PDF a partir do XML seguindo esse layout), não um ajuste
// de caminho — fica pra depois, com o XML funcionando primeiro.
//
// ⚠️ Busca por período continua sendo feita varrendo o NSU (não existe
// filtro de data pronto na API) e filtrando cada nota pela data de emissão
// real dentro do XML — pode ficar lento pra CNPJs com muito histórico.
//
// ⚠️ TERCEIRO PONTO IMPORTANTE — nomes de campo no XML:
// Ver o comentário em CAMPOS_XML (mais abaixo) pro que já foi confirmado
// contra uma NFS-e real em 2026-09-10 e o que ainda falta confirmar
// (principalmente os valores de retenção federal — a nota real recebida
// não tinha nenhuma retenção pra comparar).

// ⚠️ QUARTO PONTO IMPORTANTE — leitura do .pfx:
// Versões recentes do Node.js (OpenSSL 3) recusam abrir diretamente muitos
// arquivos .pfx de certificado brasileiro, porque o "envelope" de
// criptografia do arquivo usa um algoritmo que o OpenSSL 3 desativou por
// padrão (isso não tem nada a ver com o certificado estar errado ou
// vencido). Por isso lemos o .pfx com a biblioteca `node-forge`, que faz
// essa leitura sozinha, sem depender dessa parte restrita do Node — e
// funciona igual tanto local quanto hospedado.

import https from "https";
import zlib from "zlib";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import forge from "node-forge";

const AMBIENTES = {
  homologacao: "https://adn.producaorestrita.nfse.gov.br",
  producao: "https://adn.nfse.gov.br",
};

const PATHS = {
  // GET -> lote de documentos fiscais a partir de um NSU, filtrado pelo
  // CNPJ consultado. Confirmado no Swagger oficial (ver aviso no topo).
  dfe: (nsu, cnpjConsulta) => {
    const params = new URLSearchParams({ cnpjConsulta });
    return `/contribuintes/DFe/${nsu}?${params.toString()}`;
  },
  // GET -> PDF (DANFSe). API do governo foi desativada em 01/07/2026 (ver
  // aviso 🛑 no topo do arquivo) — este caminho não funciona mais.
  danfse: (chaveAcesso) => `/danfse/${chaveAcesso}`,
};

// Nomes de tag confirmados em 2026-09-10 com uma NFS-e real (layout NFS-e
// Nacional v1.01, xmlns sped.fazenda.gov.br/nfse) e cruzados com a tabela
// de campos da Nota Técnica nº 008 (DANFSe), que lista o "Caminho no XML"
// de cada campo. dhEmi, vServ e nNFSe já bateram certinho na nota real
// recebida. Os campos de retenção federal ficam dentro de
// NFSe/infNFSe/DPS/infDPS/valores/trib/ — tribMun (vISSQN, tpRetISSQN) e
// tribFed (vRetIRRF, vRetCSLL, vPIS, vCOFINS). A nota real que recebemos
// era do Simples Nacional sem nenhuma retenção, então esse grupo nem
// aparecia no XML (o que é esperado quando não há retenção) — ainda falta
// confirmar esses nomes contra uma nota com retenção de verdade.
const CAMPOS_XML = {
  numeroNota: ["nNFSe", "NumeroNfse", "numeroNfse"],
  dataEmissao: ["dhEmi", "DataEmissao", "dataEmissao"],
  valorServico: ["vServ", "ValorServicos", "valorServico"],
  // Valor apurado do ISSQN (o "ISS normal").
  issqn: ["vISSQN", "ValorIssqn"],
  // 🛑 tpRetISSQN existe e é lido corretamente (tag confirmada na Nota
  // Técnica nº 008), mas o código que significa "retido pelo tomador"
  // ainda NÃO está confirmado — testamos tpRetISSQN==="2" e deu errado
  // (toda nota veio marcada como retida). Por isso extrairDadosNota não usa
  // mais esse valor pra preencher "ISS retido" até confirmarmos o código
  // certo com uma nota real onde o fiscal saiba dizer se teve retenção.
  tpRetISSQN: ["tpRetISSQN"],
  pis: ["vPIS", "ValorPis"],
  cofins: ["vCOFINS", "ValorCofins"],
  csll: ["vRetCSLL", "vCSLL", "ValorCsll"],
  ir: ["vRetIRRF", "vIR", "ValorIr"],
  // cStat "100" é o único valor que vimos numa nota normal — qualquer outro
  // valor tratamos como sinal de que a nota não está mais no estado normal
  // (cancelada, substituída, etc). Ver também a checagem por evento de
  // cancelamento em buscarNotas, que cobre o caso de a nota original ainda
  // trazer cStat=100 mas ter sido cancelada depois por um evento separado.
  cStat: ["cStat"],
};

const CSTAT_NORMAL = "100";

// TipoEvento (enum confirmado no Swagger oficial) que realmente significam
// "a nota está cancelada" — de propósito NÃO inclui
// SOLICITACAO_CANCELAMENTO_ANALISE_FISCAL (só um pedido, ainda não
// decidido) nem CANCELAMENTO_INDEFERIDO_ANALISE_FISCAL (pedido negado —
// a nota continua válida).
const EVENTOS_DE_CANCELAMENTO = new Set([
  "CANCELAMENTO",
  "CANCELAMENTO_POR_SUBSTITUICAO",
  "CANCELAMENTO_DEFERIDO_ANALISE_FISCAL",
  "CANCELAMENTO_POR_OFICIO",
]);

function getBaseUrl() {
  const ambiente = process.env.NFSE_AMBIENTE === "producao" ? "producao" : "homologacao";
  return AMBIENTES[ambiente];
}

// Lê o .pfx (com node-forge, ver aviso 4 no topo) e devolve a chave
// privada e o(s) certificado(s) em formato PEM — é isso que o Node usa
// pra fazer a conexão mTLS de verdade (options.key / options.cert),
// substituindo o pfx+passphrase que o Node não consegue abrir sozinho.
function lerCertificado(pfxBuffer, senha) {
  let p12;
  try {
    const p12Asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfxBuffer.toString("binary")));
    p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, senha);
  } catch (err) {
    throw new Error(
      "Não foi possível abrir o certificado — confira se a senha está certa e se o arquivo é um .pfx/.p12 válido."
    );
  }

  // A chave privada pode vir em pkcs8ShroudedKeyBag (mais comum, protegida
  // por senha) ou em keyBag (sem proteção extra) — tentamos os dois.
  let chavePrivada = null;
  const shroudedBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const shroudedList = shroudedBags[forge.pki.oids.pkcs8ShroudedKeyBag];
  if (shroudedList && shroudedList[0]) chavePrivada = shroudedList[0].key;

  if (!chavePrivada) {
    const keyBags = p12.getBags({ bagType: forge.pki.oids.keyBag });
    const keyList = keyBags[forge.pki.oids.keyBag];
    if (keyList && keyList[0]) chavePrivada = keyList[0].key;
  }

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certList = certBags[forge.pki.oids.certBag] || [];

  if (!chavePrivada || certList.length === 0) {
    throw new Error("O arquivo .pfx não parece conter uma chave privada e um certificado válidos.");
  }

  const chavePem = forge.pki.privateKeyToPem(chavePrivada);
  // Junta o certificado (e qualquer intermediário que esteja dentro do
  // mesmo .pfx) numa cadeia só, na ordem em que vieram no arquivo.
  const certPem = certList.map((bag) => forge.pki.certificateToPem(bag.cert)).join("\n");

  return { chavePem, certPem };
}

// Faz uma requisição GET autenticada com o certificado do cliente (mTLS).
function requisitarComCertificado({ chavePem, certPem, path, accept = "application/json" }) {
  return new Promise((resolve, reject) => {
    const baseUrl = new URL(getBaseUrl());
    const options = {
      hostname: baseUrl.hostname,
      path,
      method: "GET",
      key: chavePem,
      cert: certPem,
      headers: { Accept: accept },
      // nunca desligue isso: garante que estamos falando com o servidor
      // certo (e não um golpe/man-in-the-middle).
      rejectUnauthorized: true,
      // agent: false força uma conexão TCP/TLS totalmente nova a cada
      // chamada, sem reaproveitar nada de uma requisição anterior — evita
      // um tipo de erro de "decryption failed / bad record mac" que pode
      // acontecer quando alguma coisa no meio do caminho (ex: antivírus
      // com inspeção HTTPS) se confunde tentando reaproveitar a conexão.
      agent: false,
      // exige pelo menos TLS 1.2 (nunca versões antigas e inseguras); não
      // trava numa versão exata, só estabelece um piso.
      minVersion: "TLSv1.2",
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        // A API do governo responde 404 (em vez de 200 com lista vazia)
        // quando não existe mais nenhum documento a partir do NSU pedido
        // (StatusProcessamento: "NENHUM_DOCUMENTO_LOCALIZADO", código
        // E2220) — confirmado testando de verdade em 2026-09-10. Isso não
        // é erro, é "acabaram as notas", então tratamos como sucesso e
        // deixamos o JSON do corpo (que já tem StatusProcessamento/Erros)
        // ser interpretado por quem chamou.
        const semDocumentoNoNsu = res.statusCode === 404 && accept === "application/json";
        if ((res.statusCode >= 200 && res.statusCode < 300) || semDocumentoNoNsu) {
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
      // "unable to verify the first certificate" ou certificado vencido.
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
// usado pra isolar <prest>...</prest> de <toma>...</toma> antes de procurar
// o CNPJ dentro — senão um regex simples pegaria o CNPJ errado (o primeiro
// que aparecer no XML inteiro).
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
  // Confirmado em 2026-09-10 com uma NFS-e real: os blocos são <prest> e
  // <toma> (dentro de NFSe/infNFSe/DPS/infDPS/), não <prestador>/<tomador>.
  const blocoPrestador = extrairBloco(xml, ["prest", "Prest"]);
  const blocoTomador = extrairBloco(xml, ["toma", "Toma"]);
  const blocoEmitente = extrairBloco(xml, ["emit", "Emit"]);

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
  const nomesCandidatos = ["xNome", "XNome", "razaoSocial", "RazaoSocial"];
  // <prest> às vezes não repete o xNome (já está em <emit>, no topo do
  // XML) — se não achar em <prest>, cai pro <emit> como reserva.
  const nomeOutraParte =
    extrairValor(blocoOutraParte, nomesCandidatos) ||
    (papel === "tomadas" ? extrairValor(blocoEmitente, nomesCandidatos) : "");

  const issqn = extrairValor(xml, CAMPOS_XML.issqn);
  const cStat = extrairValor(xml, CAMPOS_XML.cStat);

  return {
    papel, // "emitidas" | "tomadas"
    numeroNota: extrairValor(xml, CAMPOS_XML.numeroNota),
    dataEmissao,
    nomeOutraParte,
    cnpjOutraParte: papel === "emitidas" ? cnpjTomador : cnpjPrestador,
    valorServico: extrairValor(xml, CAMPOS_XML.valorServico),
    issqn,
    // 🛑 Testado em 2026-09-12: o palpite de que tpRetISSQN==="2" significa
    // "retido pelo tomador" estava errado (ou pelo menos não bate com esse
    // lote) — toda nota com ISSQN preenchido veio marcada como retida,
    // duplicando o valor nas duas colunas da planilha. Como isso mexe com
    // valor de imposto de verdade, preferimos deixar em branco a confirmar
    // errado — desligado até confirmarmos o código certo com uma nota que
    // o fiscal saiba, de olhar a nota, se teve retenção ou não.
    issRetido: "",
    pis: extrairValor(xml, CAMPOS_XML.pis),
    cofins: extrairValor(xml, CAMPOS_XML.cofins),
    csll: extrairValor(xml, CAMPOS_XML.csll),
    ir: extrairValor(xml, CAMPOS_XML.ir),
    // cStat "100" é o único valor visto numa nota normal até agora —
    // qualquer outro é tratado como "não está mais normal" (cancelada,
    // substituída, etc).
    cancelada: cStat !== "" && cStat !== CSTAT_NORMAL,
  };
}

// Layout de colunas definido junto com o setor fiscal (planilha de
// referência deles): N° Nota, Chave de acesso, Data da emissão,
// Tomador/Prestador, CNPJ, Valor do serviço, ISSQN, ISS retido, PIS,
// COFINS, CSLL.
function linhaPlanilha(doc, colunaOutraParte) {
  return {
    "N° Nota": doc.dados.numeroNota || "",
    "Chave de acesso": doc.chaveAcesso,
    "Data de emissão": doc.dados.dataEmissao ? doc.dados.dataEmissao.toISOString().slice(0, 10) : "",
    [colunaOutraParte]: doc.dados.nomeOutraParte || "",
    "CNPJ": doc.dados.cnpjOutraParte || "",
    "Valor do serviço": Number(doc.dados.valorServico) || 0,
    "ISSQN": Number(doc.dados.issqn) || 0,
    "ISS retido": Number(doc.dados.issRetido) || 0,
    "PIS": Number(doc.dados.pis) || 0,
    "COFINS": Number(doc.dados.cofins) || 0,
    "CSLL": Number(doc.dados.csll) || 0,
  };
}

function gerarPlanilhaRetencoes(documentos, tipo) {
  const colunaOutraParte = tipo === "emitidas" ? "Tomador" : "Prestador";
  const normais = documentos.filter((doc) => !doc.dados.cancelada);
  const canceladas = documentos.filter((doc) => doc.dados.cancelada);

  const livro = XLSX.utils.book_new();
  const nomeAba = tipo === "emitidas" ? "Notas emitidas" : "Notas tomadas";
  XLSX.utils.book_append_sheet(
    livro,
    XLSX.utils.json_to_sheet(normais.map((doc) => linhaPlanilha(doc, colunaOutraParte))),
    nomeAba
  );
  if (canceladas.length > 0) {
    XLSX.utils.book_append_sheet(
      livro,
      XLSX.utils.json_to_sheet(canceladas.map((doc) => linhaPlanilha(doc, colunaOutraParte))),
      "Canceladas"
    );
  }
  return XLSX.write(livro, { type: "buffer", bookType: "xlsx" });
}

// Função principal chamada pela rota da API. Varre o NSU do cliente,
// filtra pelo período e pelo tipo (emitidas/tomadas) pedidos, monta o zip
// no formato pedido (xml ou pdf) e sempre monta a planilha de retenções
// junto — assim a pessoa não precisa anexar o certificado de novo só pra
// pegar a planilha depois.
export async function buscarNotas({
  pfxBuffer,
  senha,
  cnpjCliente,
  dataInicial,
  dataFinal,
  tipo,
  formato,
  // Opcional: chamado a cada página do NSU e a cada PDF buscado, pra quem
  // chamou poder mostrar uma barra de progresso. Nunca lança erro por causa
  // disso — se o callback falhar, ignoramos e seguimos a busca.
  onProgresso,
}) {
  const { chavePem, certPem } = lerCertificado(pfxBuffer, senha);

  const cnpjLimpo = (cnpjCliente || "").replace(/\D/g, "");
  // Fuso fixo -03:00 (horário de Brasília, sem horário de verão hoje em
  // dia): dhEmi das notas sempre vem com o offset dela embutido, então
  // comparamos maçã com maçã. Sem isso, "T00:00:00" seria interpretado no
  // fuso do servidor (ex: UTC no Render), deslocando a janela em ~3h e
  // podendo perder/incluir nota errada perto da virada do dia.
  const inicio = new Date(`${dataInicial}T00:00:00-03:00`);
  const fim = new Date(`${dataFinal}T23:59:59-03:00`);
  const incluirPdf = formato === "pdf";

  const documentos = [];
  // Chaves de acesso que apareceram com um evento de cancelamento
  // confirmado (ver EVENTOS_DE_CANCELAMENTO) — cobre o caso de a nota em
  // si ainda estar com cStat=100 mas ter sido cancelada por um evento
  // separado depois.
  const chavesCanceladasPorEvento = new Set();
  let nsuAtual = "0";
  const LIMITE_DE_SEGURANCA = 5000; // evita loop infinito se o formato mudar

  function notificar(evento) {
    try {
      onProgresso?.(evento);
    } catch {
      // Falha ao notificar progresso não pode derrubar a busca em si.
    }
  }

  for (let i = 0; i < LIMITE_DE_SEGURANCA; i++) {
    notificar({ etapa: "buscando", pagina: i + 1, notasEncontradas: documentos.length });

    const { body } = await requisitarComCertificado({
      chavePem,
      certPem,
      path: PATHS.dfe(nsuAtual, cnpjLimpo),
    });

    let resposta;
    try {
      resposta = JSON.parse(body.toString("utf-8"));
    } catch {
      break;
    }

    if (resposta.StatusProcessamento === "REJEICAO") {
      const mensagens = (resposta.Erros || []).map((e) => e.Descricao || e.Codigo).join("; ");
      throw new Error(`Governo rejeitou a consulta: ${mensagens || "sem detalhes"}`);
    }

    const lote = resposta.LoteDFe || [];
    if (lote.length === 0) break;

    let maiorNsu = null;
    for (const item of lote) {
      if (item.NSU && (maiorNsu === null || Number(item.NSU) > Number(maiorNsu))) {
        maiorNsu = item.NSU;
      }

      if (item.TipoDocumento === "EVENTO" || item.TipoDocumento === "CNC") {
        if (item.ChaveAcesso && EVENTOS_DE_CANCELAMENTO.has(item.TipoEvento)) {
          chavesCanceladasPorEvento.add(item.ChaveAcesso);
        }
        continue;
      }
      if (item.TipoDocumento !== "NFSE") continue; // ignora DPS, etc.
      const chaveAcesso = item.ChaveAcesso;
      if (!chaveAcesso || !item.ArquivoXml) continue;

      let xml;
      try {
        xml = descompactarXml(item.ArquivoXml);
      } catch {
        xml = Buffer.from(item.ArquivoXml, "base64").toString("utf-8");
      }

      const dados = extrairDadosNota(xml, cnpjCliente);
      if (!dados) continue; // não deu pra classificar emitida/tomada com segurança
      if (dados.papel !== tipo) continue;
      if (dados.dataEmissao && (dados.dataEmissao < inicio || dados.dataEmissao > fim)) continue;

      documentos.push({ chaveAcesso, xml, dados });
    }

    notificar({ etapa: "buscando", pagina: i + 1, notasEncontradas: documentos.length });

    // sem NSU novo no lote: não tem como avançar o cursor, para pra não girar em loop.
    if (maiorNsu === null) break;
    nsuAtual = String(Number(maiorNsu) + 1);

    if (resposta.StatusProcessamento !== "DOCUMENTOS_LOCALIZADOS") break;
  }

  // Reconcilia com os eventos de cancelamento vistos em qualquer ponto da
  // varredura (podem ter aparecido antes ou depois da própria nota, já que
  // NSU é ordem de disponibilização, não ordem de emissão/cancelamento).
  for (const doc of documentos) {
    if (chavesCanceladasPorEvento.has(doc.chaveAcesso)) doc.dados.cancelada = true;
  }

  notificar({ etapa: "montando_arquivos", notasEncontradas: documentos.length });

  const zip = new JSZip();
  for (const [indice, doc] of documentos.entries()) {
    // Notas canceladas ficam isoladas numa pasta própria dentro do zip —
    // as normais continuam soltas na raiz, pra não misturar sem querer.
    const pasta = doc.dados.cancelada ? "canceladas/" : "";
    if (!incluirPdf) {
      zip.file(`${pasta}${doc.chaveAcesso}.xml`, doc.xml);
      continue;
    }
    notificar({
      etapa: "baixando_pdf",
      notasEncontradas: documentos.length,
      notaAtual: indice + 1,
    });
    try {
      const { body } = await requisitarComCertificado({
        chavePem,
        certPem,
        path: PATHS.danfse(doc.chaveAcesso),
        accept: "application/pdf",
      });
      zip.file(`${pasta}${doc.chaveAcesso}.pdf`, body);
    } catch (err) {
      zip.file(`${pasta}${doc.chaveAcesso}-ERRO.txt`, `Falha ao buscar PDF: ${err.message}`);
    }
  }

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
  const planilhaBuffer =
    documentos.length > 0 ? gerarPlanilhaRetencoes(documentos, tipo) : null;

  return { zipBuffer, planilhaBuffer, totalNotas: documentos.length };
}
