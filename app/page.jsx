import BuscaNotas from "./busca-notas";

export default function Painel() {
  return (
    <div className="tela">
      <div className="cabecalho">
        <h1>iApura</h1>
      </div>
      <BuscaNotas />
    </div>
  );
}
