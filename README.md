# iApura

Site pra baixar (em lote) as notas fiscais de serviço eletrônicas de
clientes do escritório, direto pela API Nacional (ADN) do governo.

## O que já está pronto

- Login simples por senha compartilhada (protege o site inteiro).
- **Sem banco de dados e sem cadastro de nada.** Não guardamos nome, CNPJ,
  certificado nem qualquer outro dado de cliente — o site não guarda
  estado nenhum entre uma visita e outra. Tudo é preenchido na hora: CNPJ,
  período, tipo, certificado e senha, numa única tela.
- Tela única: escolher **CNPJ**, **data inicial**, **data final** e o
  **tipo** (notas emitidas ou notas tomadas — uma opção por vez), anexar o
  certificado (`.pfx`) e a senha dele, e clicar em **"Baixar XML"** ou
  **"Baixar PDF"**. O site autentica no governo com mTLS usando esse
  certificado só naquela requisição — ele nunca é gravado em disco ou
  banco, é descartado assim que a resposta é enviada.
- Depois de qualquer um dos dois downloads, aparece o botão **"Baixar
  planilha de retenções"** — a planilha (.xlsx) já vem pronta na mesma
  resposta da busca (não precisa anexar o certificado de novo). Ela lista
  uma nota por linha com valor do serviço, ISS retido, PIS, COFINS, CSLL e
  IR, e o nome muda conforme o tipo escolhido (planilha de notas emitidas
  ou de notas tomadas).

## Como a busca por período funciona (e sua limitação atual)

A API nacional expõe as notas por um cursor (NSU) que avança, não por um
filtro de data pronto. Então, hoje, o código varre o NSU desde o começo e
filtra cada nota pela data real de emissão dentro do XML. Isso funciona,
mas pode ficar lento pra CNPJs com muito histórico. Se durante os testes em
homologação aparecer uma rota de busca por data já pronta na
documentação oficial, vale trocar por ela — é bem mais rápido. Ver aviso
detalhado no topo de `lib/nfse.js`.

## O que falta confirmar antes de usar de verdade (importante!)

1. ✅ **Caminhos exatos da API — confirmados em 2026-09-10.** Baixamos o
   Swagger oficial direto de
   `https://adn.producaorestrita.nfse.gov.br/contribuintes/docs/index.html`
   com um certificado real. A API só documenta dois caminhos, os dois sob
   `/contribuintes`: `GET /DFe/{NSU}?cnpjConsulta=...` (lote de documentos)
   e `GET /NFSe/{ChaveAcesso}/Eventos` (eventos de uma nota, não o XML dela).
   `lib/nfse.js` já foi ajustado pra isso. **Ainda não confirmado**: o
   caminho do DANFSe (PDF) não aparece nesse Swagger — o que está em `PATHS`
   é só um palpite. Se "Baixar PDF" falhar, é ali que precisa investigar.

2. ✅ **Formato da resposta do endpoint de NSU — confirmado.** Não é uma
   lista solta: é um objeto `{ StatusProcessamento, LoteDFe: [...], Erros:
   [...] }`, e os campos de cada item vêm em PascalCase (`NSU`,
   `ChaveAcesso`, `ArquivoXml`, `TipoDocumento`). `lib/nfse.js` já trata
   isso corretamente.

3. **Busca por data.** Hoje é feita varrendo o NSU e filtrando pela data de
   emissão de cada nota (ver aviso em `lib/nfse.js`) — pode ser lento com
   muito histórico. O Swagger oficial não mostra nenhuma rota de busca por
   período pronta, então por enquanto é assim mesmo.

4. **Nomes das tags no XML (`CAMPOS_XML` em `lib/nfse.js`).** É daí que
   vem os dados da planilha de retenções (valor do serviço, ISS, PIS,
   COFINS, CSLL, IR) e a classificação de "emitida" vs "tomada" (comparando
   o CNPJ digitado com o `prestador`/`tomador` do XML). Os nomes usados
   são o layout mais comum da NFS-e Nacional, mas não foram testados contra
   um XML de verdade — depois que a busca funcionar, abram um XML baixado e
   confirmem se os nomes batem. Se algo vier em branco na planilha, é ali
   que se ajusta.

## Rodando localmente

```bash
npm install
cp .env.example .env
# defina uma senha em SITE_PASSWORD no .env
npm run dev
```

Abra `http://localhost:3000`. Testem primeiro com um certificado de
**homologação** (`NFSE_AMBIENTE=homologacao` no `.env`, que já é o padrão)
antes de usar em produção de verdade.

## Como conseguir o certificado de cada cliente

- Cada empresa/cliente precisa ter um certificado digital ICP-Brasil do
  tipo A1 (arquivo `.pfx`) — não existe atalho por procuração eletrônica
  pra essa API nacional específica (confirmei isso, é diferente de alguns
  portais municipais antigos que aceitavam procuração).
- Empresas do Simples Nacional que nunca tiraram certificado talvez
  precisem tirar um só pra isso — geralmente já usam pra e-CAC, eSocial etc.
- O `.pfx` e a senha de cada cliente ficam guardados fora do site (com
  quem já cuida disso hoje, ex: pasta compartilhada com controle de
  acesso, cofre de senhas etc.) — quem for baixar as notas anexa o
  arquivo certo na hora, igual anexar um arquivo em qualquer formulário.
  O site nunca guarda essa cópia, nem sabe que ela existiu depois que a
  resposta é enviada.

## Deploy no Vercel

Como não tem banco de dados nem arquivo pra persistir, o deploy é direto:

1. Subam o projeto pro GitHub e conectem no Vercel.
2. Configurem as variáveis de ambiente no painel do Vercel: `SITE_PASSWORD`,
   `NFSE_AMBIENTE` (comecem com `homologacao`).
3. Testem tudo em homologação antes de trocar `NFSE_AMBIENTE` pra `producao`.

## Estrutura

```
app/
  login/            tela de login
  page.jsx           tela única (renderiza busca-notas.jsx)
  busca-notas.jsx     formulário: CNPJ, período, tipo, certificado, botões
  api/login/          verifica a senha
  api/buscar/         recebe certificado+CNPJ+período+tipo, busca e devolve zip + planilha
lib/
  nfse.js     conversa com a API do governo (mTLS, período, classificação, zip, planilha)
```
