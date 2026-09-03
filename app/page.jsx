import { getClientes } from "@/lib/db";
import ListaClientes from "./lista-clientes";

export default function Painel() {
  const clientes = getClientes();

  return (
    <div className="tela">
      <div className="cabecalho">
        <h1>NFS-e em lote</h1>
        <a href="/clientes/novo">+ Novo cliente</a>
      </div>

      {clientes.length === 0 ? (
        <div className="vazio">
          Nenhum cliente cadastrado ainda.
          <br />
          <a href="/clientes/novo">Cadastre o primeiro cliente</a> pra começar a baixar notas.
        </div>
      ) : (
        <ListaClientes clientesIniciais={clientes} />
      )}
    </div>
  );
}
