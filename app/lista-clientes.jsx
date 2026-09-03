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

export default function ListaClientes({ clientesIniciais }) {
  // id -> { aberto, carregando, mensagem, tipo, resultado }
  const [status, setStatus] = useState({});
  const formRefs = useRef({});

  function abrirFormulario(id) {
    setStatus((s) => ({ ...s, [id]: { aberto: true } }));
  }

  function fecharFormulario(id) {
    setStatus((s) => ({ ...s, [id]: { ...s[id], aberto: false } }));
  }

  async function buscar(cliente, formato) {
    const formEl = formRefs.current[cliente.id];
    if (!formEl) return;
    const formData = new FormData(formEl);
    formData.set("formato", formato);

    setStatus((s) => ({
      ...s,
      [cliente.id]: { aberto: true, carregando: true },
    }));

    let res, data;
    try {
      res = await fetch(`/api/clientes/${cliente.id}/buscar`, { method: "POST", body: formData });
      data = await res.json();
    } catch {
      setStatus((s) => ({
        ...s,
        [cliente.id]: { aberto: true, carregando: false, mensagem: "Falha de conexão. Tente de novo.", tipo: "erro" },
      }));
      return;
    }

    if (!res.ok || data.erro) {
      setStatus((s) => ({
        ...s,
        [cliente.id]: { aberto: true, carregando: false, mensagem: data.erro || "Algo deu errado.", tipo: "erro" },
      }));
      return;
    }

    if (data.aviso) {
      setStatus((s) => ({
        ...s,
        [cliente.id]: { aberto: true, carregando: false, mensagem: data.aviso, tipo: "aviso" },
      }));
      return;
    }

    // Baixa automaticamente o arquivo pedido (XML ou PDF).
    baixarBase64(data.zipBase64, data.nomeArquivoZip, "application/zip");

    setStatus((s) => ({
      ...s,
      [cliente.id]: {
        aberto: false,
        carregando: false,
        mensagem: `${data.totalNotas} nota(s) baixada(s) em ${formato.toUpperCase()}.`,
        tipo: "ok",
        resultado: {
          planilhaBase64: data.planilhaBase64,
          nomeArquivoPlanilha: data.nomeArquivoPlanilha,
          totalNotas: data.totalNotas,
        },
      },
    }));
  }

  function baixarPlanilha(cliente) {
    const r = status[cliente.id]?.resultado;
    if (!r) return;
    baixarBase64(r.planilhaBase64, r.nomeArquivoPlanilha, MIME_XLSX);
  }

  return (
    <table className="tabela">
      <thead>
        <tr>
          <th>Empresa</th>
          <th>CNPJ</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {clientesIniciais.map((cliente) => {
          const s = status[cliente.id] || {};
          return (
            <tr key={cliente.id}>
              <td>
                {cliente.nome}
                {s.mensagem && (
                  <div
                    style={{
                      fontSize: 13,
                      marginTop: 4,
                      color: s.tipo === "erro" ? "var(--erro)" : "var(--tinta-suave)",
                    }}
                  >
                    {s.mensagem}
                  </div>
                )}
                {s.resultado && (
                  <button
                    className="botao botao-secundario"
                    style={{ marginTop: 6, fontSize: 13 }}
                    onClick={() => baixarPlanilha(cliente)}
                  >
                    Baixar planilha de retenções ({s.resultado.totalNotas} notas)
                  </button>
                )}
              </td>
              <td className="cnpj">{cliente.cnpj}</td>
              <td style={{ textAlign: "right" }}>
                {!s.aberto ? (
                  <button className="botao" onClick={() => abrirFormulario(cliente.id)}>
                    Buscar notas
                  </button>
                ) : (
                  <form
                    ref={(el) => (formRefs.current[cliente.id] = el)}
                    onSubmit={(e) => e.preventDefault()}
                    style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}
                  >
                    <div style={{ display: "flex", gap: 6 }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                        <label style={{ fontSize: 12 }}>De</label>
                        <input name="dataInicial" type="date" required disabled={s.carregando} />
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                        <label style={{ fontSize: 12 }}>Até</label>
                        <input name="dataFinal" type="date" required disabled={s.carregando} />
                      </div>
                    </div>

                    <div style={{ fontSize: 13, display: "flex", gap: 12 }}>
                      <label>
                        <input type="radio" name="tipo" value="emitidas" defaultChecked disabled={s.carregando} />{" "}
                        Notas emitidas
                      </label>
                      <label>
                        <input type="radio" name="tipo" value="tomadas" disabled={s.carregando} /> Notas tomadas
                      </label>
                    </div>

                    <div style={{ fontSize: 13, color: "var(--tinta-suave)" }}>
                      Anexe o certificado deste cliente:
                    </div>
                    <input name="certificado" type="file" accept=".pfx,.p12" required disabled={s.carregando} />
                    <input
                      name="senhaCertificado"
                      type="password"
                      placeholder="Senha do certificado"
                      required
                      disabled={s.carregando}
                    />

                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        className="botao botao-secundario"
                        onClick={() => fecharFormulario(cliente.id)}
                        disabled={s.carregando}
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        className="botao"
                        disabled={s.carregando}
                        onClick={() => buscar(cliente, "xml")}
                      >
                        {s.carregando ? "Buscando…" : "Baixar XML"}
                      </button>
                      <button
                        type="button"
                        className="botao"
                        disabled={s.carregando}
                        onClick={() => buscar(cliente, "pdf")}
                      >
                        {s.carregando ? "Buscando…" : "Baixar PDF"}
                      </button>
                    </div>
                  </form>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
