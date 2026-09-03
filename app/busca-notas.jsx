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
  const [carregando, setCarregando] = useState(false);
  const [mensagem, setMensagem] = useState(null); // { texto, tipo }
  const [resultado, setResultado] = useState(null); // { planilhaBase64, nomeArquivoPlanilha, totalNotas }
  const formRef = useRef(null);

  async function buscar(formato) {
    const formEl = formRef.current;
    if (!formEl) return;
    const formData = new FormData(formEl);
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
      return;
    }

    setCarregando(false);

    if (!res.ok || data.erro) {
      setMensagem({ texto: data.erro || "Algo deu errado.", tipo: "erro" });
      return;
    }
    if (data.aviso) {
      setMensagem({ texto: data.aviso, tipo: "aviso" });
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
        style={{ display: "flex", flexDirection: "column", maxWidth: 420 }}
      >
        <div className="campo">
          <label htmlFor="cnpj">CNPJ do cliente</label>
          <input id="cnpj" name="cnpj" type="text" placeholder="00.000.000/0000-00" required disabled={carregando} />
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <div className="campo" style={{ flex: 1 }}>
            <label htmlFor="dataInicial">De</label>
            <input id="dataInicial" name="dataInicial" type="date" required disabled={carregando} />
          </div>
          <div className="campo" style={{ flex: 1 }}>
            <label htmlFor="dataFinal">Até</label>
            <input id="dataFinal" name="dataFinal" type="date" required disabled={carregando} />
          </div>
        </div>

        <div className="campo" style={{ fontSize: 14, display: "flex", gap: 16 }}>
          <label>
            <input type="radio" name="tipo" value="emitidas" defaultChecked disabled={carregando} /> Notas emitidas
          </label>
          <label>
            <input type="radio" name="tipo" value="tomadas" disabled={carregando} /> Notas tomadas
          </label>
        </div>

        <div className="campo">
          <label htmlFor="certificado">Certificado digital (.pfx)</label>
          <input id="certificado" name="certificado" type="file" accept=".pfx,.p12" required disabled={carregando} />
        </div>

        <div className="campo">
          <label htmlFor="senhaCertificado">Senha do certificado</label>
          <input id="senhaCertificado" name="senhaCertificado" type="password" required disabled={carregando} />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="botao" disabled={carregando} onClick={() => buscar("xml")}>
            {carregando ? "Buscando…" : "Baixar XML"}
          </button>
          <button type="button" className="botao" disabled={carregando} onClick={() => buscar("pdf")}>
            {carregando ? "Buscando…" : "Baixar PDF"}
          </button>
        </div>
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
