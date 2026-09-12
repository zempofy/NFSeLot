"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Login() {
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);
  const router = useRouter();

  async function entrar(e) {
    e.preventDefault();
    setErro("");
    setCarregando(true);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senha }),
    });
    setCarregando(false);
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setErro(data.erro || "Senha incorreta.");
    }
  }

  return (
    <div className="tela">
      <form className="form-login" onSubmit={entrar}>
        <h1>iApura</h1>
        {erro && <div className="mensagem-erro">{erro}</div>}
        <div className="campo">
          <label htmlFor="senha">Senha de acesso</label>
          <input
            id="senha"
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            autoFocus
          />
        </div>
        <button className="botao" type="submit" disabled={carregando} style={{ width: "100%" }}>
          {carregando ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
