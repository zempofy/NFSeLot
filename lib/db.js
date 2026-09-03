// ATENÇÃO — leia antes de usar em produção:
//
// Esta camada guarda os dados num arquivo JSON local (data/clientes.json).
// Isso funciona perfeitamente rodando `npm run dev` no seu computador, e é
// ótimo pra testar o fluxo todo sem depender de nada externo.
//
// Só que a Vercel (e qualquer hospedagem serverless) NÃO garante que arquivos
// escritos em disco persistam entre uma chamada e outra — cada requisição
// pode cair numa instância diferente, e o disco é temporário. Ou seja: se
// vocês subirem isso pro Vercel do jeito que está, os clientes cadastrados
// podem simplesmente sumir.
//
// Antes de colocar em produção de verdade, troque as funções abaixo por um
// banco hospedado (ex: Vercel Postgres, Neon, Supabase, Turso — todos têm
// plano gratuito que dá conta desse volume). A vantagem de centralizar tudo
// aqui é que só este arquivo precisa mudar; o resto do app chama só estas
// funções (getClientes, addCliente, etc) e não sabe onde o dado mora.
//
// NOTA: este arquivo NUNCA guarda certificado digital nem senha de
// certificado — só os dados de cadastro do cliente (nome, CNPJ). O .pfx e a
// senha são enviados pela pessoa a cada busca e usados só naquela
// requisição (ver app/api/clientes/[id]/buscar/route.js) — nunca chegam
// aqui. Também não guardamos mais um "último NSU" por cliente: a busca
// agora é por período escolhido a cada vez, não incremental.

import fs from "fs";
import path from "path";
import crypto from "crypto";

const DB_PATH = path.join(process.cwd(), "data", "clientes.json");

function ensureFile() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, "[]", "utf-8");
}

function readAll() {
  ensureFile();
  const raw = fs.readFileSync(DB_PATH, "utf-8");
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeAll(clientes) {
  ensureFile();
  fs.writeFileSync(DB_PATH, JSON.stringify(clientes, null, 2), "utf-8");
}

export function getClientes() {
  return readAll();
}

export function getCliente(id) {
  return readAll().find((c) => c.id === id) || null;
}

export function addCliente({ nome, cnpj }) {
  const clientes = readAll();
  const novo = {
    id: crypto.randomUUID(),
    nome,
    cnpj,
    criadoEm: new Date().toISOString(),
  };
  clientes.push(novo);
  writeAll(clientes);
  return novo;
}
