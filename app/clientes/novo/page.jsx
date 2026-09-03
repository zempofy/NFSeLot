"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NovoCliente() {
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);
  const router = useRouter();

  async function salvar(e) {
    e.preventDefault();
    setErro("");
    setCarregando(true);

    const formData = new FormData(e.target);
    const res = await fetch("/api/clientes", { method: "POST", body: formData });

    setCarregando(false);
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setErro(data.erro || "Não foi possível salvar o cliente.");
    }
  }

  return (
    <div className="tela">
      <div className="cabecalho">
        <h1>Novo cliente</h1>
        <a href="/">← Voltar</a>
      </div>

      <p style={{ color: "var(--tinta-suave)", marginTop: -8, marginBottom: 20 }}>
        Só nome e CNPJ. O certificado digital (.pfx) não é cadastrado aqui —
        ele é anexado na hora de cada download, direto na tela do cliente.
      </p>

      {erro && <div className="mensagem-erro">{erro}</div>}

      <form onSubmit={salvar}>
        <div className="campo">
          <label htmlFor="nome">Nome da empresa</label>
          <input id="nome" name="nome" type="text" required />
        </div>

        <div className="campo">
          <label htmlFor="cnpj">CNPJ</label>
          <input id="cnpj" name="cnpj" type="text" placeholder="00.000.000/0000-00" required />
        </div>

        <button className="botao" type="submit" disabled={carregando}>
          {carregando ? "Salvando…" : "Salvar cliente"}
        </button>
      </form>
    </div>
  );
}
