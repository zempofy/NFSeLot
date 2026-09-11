// Diagnóstico local de um .pfx problemático — roda só na sua máquina, nunca
// envia nada pra lugar nenhum. Imprime só informação pública do certificado
// (validade, quantos certificados/chaves tem dentro do arquivo, algoritmo),
// nunca a senha nem a chave privada.
//
// Uso:
//   node scripts/diagnosticar-certificado.js "caminho\para\certificado.pfx" "senha"

import fs from "fs";
import forge from "node-forge";

const [, , caminhoPfx, senha] = process.argv;

if (!caminhoPfx || !senha) {
  console.error("Uso: node scripts/diagnosticar-certificado.js <caminho.pfx> <senha>");
  process.exit(1);
}

const pfxBuffer = fs.readFileSync(caminhoPfx);

let p12;
try {
  const p12Asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfxBuffer.toString("binary")));
  p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, senha);
} catch (err) {
  console.error("Não abriu o .pfx — senha errada ou arquivo inválido:", err.message);
  process.exit(1);
}

const shroudedBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
const shroudedList = shroudedBags[forge.pki.oids.pkcs8ShroudedKeyBag] || [];
const keyBags = p12.getBags({ bagType: forge.pki.oids.keyBag });
const keyList = keyBags[forge.pki.oids.keyBag] || [];
const chavePrivada = shroudedList[0]?.key || keyList[0]?.key;

const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
const certList = certBags[forge.pki.oids.certBag] || [];

console.log("=== Chaves privadas encontradas ===");
console.log("pkcs8ShroudedKeyBag:", shroudedList.length);
console.log("keyBag (sem proteção extra):", keyList.length);
console.log("Chave privada extraída:", chavePrivada ? "sim" : "NÃO — problema aqui");
if (chavePrivada) {
  console.log("Algoritmo da chave: RSA, tamanho do módulo (bits):", chavePrivada.n.bitLength());
}

console.log("\n=== Certificados encontrados (nessa ordem) ===");
certList.forEach((bag, i) => {
  const cert = bag.cert;
  const cn = (field) =>
    cert[field].attributes.find((a) => a.shortName === "CN")?.value || "(sem CN)";
  console.log(`\n--- Certificado #${i + 1} ---`);
  console.log("Assunto (CN):", cn("subject"));
  console.log("Emissor (CN):", cn("issuer"));
  console.log("Válido de:", cert.validity.notBefore.toISOString());
  console.log("Válido até:", cert.validity.notAfter.toISOString());
  console.log("Número de série:", cert.serialNumber);
  console.log("Algoritmo da chave pública:", cert.publicKey.n ? "RSA" : "outro (não-RSA)");
  if (chavePrivada && cert.publicKey.n) {
    const bateComAChavePrivada = cert.publicKey.n.equals(chavePrivada.n);
    console.log(
      "Essa chave pública bate com a chave privada extraída?",
      bateComAChavePrivada ? "SIM" : "NÃO — certificado e chave não são o par correto"
    );
  }
});

const agora = new Date();
const algumVencido = certList.some((bag) => bag.cert.validity.notAfter < agora);
const algumAindaNaoValido = certList.some((bag) => bag.cert.validity.notBefore > agora);
console.log("\n=== Resumo ===");
console.log("Total de certificados no arquivo:", certList.length);
console.log("Algum certificado já vencido?", algumVencido ? "SIM" : "não");
console.log("Algum certificado ainda não válido (data futura)?", algumAindaNaoValido ? "SIM" : "não");
