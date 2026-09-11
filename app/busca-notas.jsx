"use client";

import { useState, useRef } from "react";

// Converte um base64 (vindo da API) num download de verdade no navegador,
// sem precisar de outra requisição — os dados já estão na memória do
// navegador, então "Baixar planilha" depois de "Baixar XML/PDF" é
// instantâneo e não pede o certificado de novo.
function baixarBase64(base64, nomeArquivo, mime) {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  a.click();
  URL.revokeObjectURL(url);
}

const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export default function BuscaNotas() {
  const [tipo, setTipo] = useState("emitidas");
  const [carregando, setCarregando] = useState(false);
  const [mensagem, setMensagem] = useState(null); // { texto, tipo }
  const [resultado, setResultado] = useState(null); // { planilhaBase64, nomeArquivoPlanilha, totalNotas }
  const formRef = useRef(null);

  // "Baixar PDF" foi tirado da tela: a API do governo que gerava o DANFSe
  // foi desativada em 01/07/2026. Pra reativar, precisa montar o PDF
  // localmente a partir do XML, seguindo o layout da Nota Técnica nº 008
  // (SE/CGNFS-e) — ver aviso 🛑 em lib/nfse.js. formato "xml" continua
  // sendo o único suportado por enquanto.
  async function buscar(formato) {
    const formEl = formRef.current;
    if (!formEl) return;
    const formData = new FormData(formEl);
    formData.set("tipo", tipo);
    formData.set("formato", formato);

    setCarregando(true);
    setMensagem(null);
    setResultado(null);

    let res, data;
    try {
      res = await fetch("/api/buscar", { method: "POST", body: formData });
      data = await res.json();
    } catch {
      setCarregando(false);
      setMensagem({ texto: "Falha de conexão. Tente de novo.", tipo: "erro" });
      alert("Falha de conexão. Tente de novo.");
      return;
    }

    setCarregando(false);

    if (!res.ok || data.erro) {
      const texto = data.erro || "Algo deu errado.";
      setMensagem({ texto, tipo: "erro" });
      alert(texto);
      return;
    }
    if (data.aviso) {
      setMensagem({ texto: data.aviso, tipo: "aviso" });
      alert(data.aviso);
      return;
    }

    // Baixa automaticamente o arquivo pedido (XML ou PDF).
    baixarBase64(data.zipBase64, data.nomeArquivoZip, "application/zip");

    setMensagem({
      texto: `${data.totalNotas} nota(s) baixada(s) em ${formato.toUpperCase()}.`,
      tipo: "ok",
    });
    setResultado({
      planilhaBase64: data.planilhaBase64,
      nomeArquivoPlanilha: data.nomeArquivoPlanilha,
      totalNotas: data.totalNotas,
    });
  }

  function baixarPlanilha() {
    if (!resultado) return;
    baixarBase64(resultado.planilhaBase64, resultado.nomeArquivoPlanilha, MIME_XLSX);
  }

  return (
    <div>
      <form
        ref={formRef}
        onSubmit={(e) => e.preventDefault()}
        style={{ display: "flex", flexDirection: "column", maxWidth: 460 }}
      >
        <div className="campo">
          <label htmlFor="cnpj">CNPJ do cliente</label>
          <input id="cnpj" name="cnpj" type="text" placeholder="00.000.000/0000-00" required disabled={carregando} />
        </div>

        <div className="grupo">
          <div className="grupo-titulo">Período</div>
          <div className="grupo-linha">
            <div className="campo">
              <label htmlFor="dataInicial">De</label>
              <input id="dataInicial" name="dataInicial" type="date" required disabled={carregando} />
            </div>
            <div className="campo">
              <label htmlFor="dataFinal">Até</label>
              <input id="dataFinal" name="dataFinal" type="date" required disabled={carregando} />
            </div>
          </div>
        </div>

        <div className="campo">
          <div className="segmentado" role="group" aria-label="Tipo de nota">
            <button
              type="button"
              className={tipo === "emitidas" ? "ativo" : ""}
              aria-pressed={tipo === "emitidas"}
              disabled={carregando}
              onClick={() => setTipo("emitidas")}
            >
              Notas emitidas
            </button>
            <button
              type="button"
              className={tipo === "tomadas" ? "ativo" : ""}
              aria-pressed={tipo === "tomadas"}
              disabled={carregando}
              onClick={() => setTipo("tomadas")}
            >
              Notas tomadas
            </button>
          </div>
        </div>

        <div className="grupo">
          <div className="grupo-titulo">Certificado</div>
          <div className="grupo-linha">
            <div className="campo">
              <label htmlFor="certificado">Arquivo (.pfx)</label>
              <input id="certificado" name="certificado" type="file" accept=".pfx,.p12" required disabled={carregando} />
            </div>
            <div className="campo">
              <label htmlFor="senhaCertificado">Senha</label>
              <input id="senhaCertificado" name="senhaCertificado" type="password" required disabled={carregando} />
            </div>
          </div>
        </div>

        <button
          type="button"
          className="botao"
          style={{ width: "100%" }}
          disabled={carregando}
          onClick={() => buscar("xml")}
        >
          {carregando ? "Buscando…" : "Baixar XML"}
        </button>
      </form>

      {mensagem && (
        <div
          style={{
            marginTop: 16,
            fontSize: 14,
            color: mensagem.tipo === "erro" ? "var(--erro)" : "var(--tinta-suave)",
          }}
        >
          {mensagem.texto}
        </div>
      )}

      {resultado && (
        <button className="botao botao-secundario" style={{ marginTop: 8 }} onClick={baixarPlanilha}>
          Baixar planilha de retenções ({resultado.totalNotas} notas)
        </button>
      )}
    </div>
  );
}
