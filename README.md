# NFS-e em lote

Site interno pra baixar (em lote) as notas fiscais de serviço eletrônicas de
vários clientes, direto pela API Nacional (ADN) do governo.

## O que já está pronto

- Login simples por senha compartilhada (protege o site inteiro).
- Cadastro de clientes: só nome e CNPJ. **O certificado digital (.pfx) não
  é cadastrado nem guardado em lugar nenhum** — a pessoa anexa o arquivo e
  digita a senha dele na hora de cada busca, na própria tela do cliente. O
  servidor usa esse certificado só naquela requisição (mTLS contra o
  governo) e ele deixa de existir assim que a resposta é enviada — nunca é
  gravado em disco ou banco.
- Na tela de cada cliente: escolher **data inicial**, **data final** e o
  **tipo** (notas emitidas ou notas tomadas — uma opção por vez), depois
  clicar em **"Baixar XML"** ou **"Baixar PDF"**. O site autentica no
  governo com mTLS, filtra as notas do período/tipo pedidos, e devolve o
  arquivo.
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

1. **Caminhos exatos da API.** A documentação oficial (Swagger) só abre no
   navegador pra quem já tem um certificado digital válido, então não
   consegui abrir e confirmar cada rota. Os caminhos usados em `lib/nfse.js`
   (arquivo `PATHS`) foram montados com base na documentação técnica pública
   e em guias de quem já integrou. Antes de rodar com um cliente de
   verdade: peguem um certificado, abram
   `https://adn.producaorestrita.nfse.gov.br/contribuintes/docs/index.html`
   no navegador (ele vai pedir pra selecionar o certificado) e confirmem se
   os caminhos batem com o que está em `PATHS`. Se algo mudar, é só ajustar
   ali — o resto do código não muda.

2. **Formato exato da resposta do endpoint de NSU.** O código já trata os
   formatos mais prováveis (lista de documentos ou item único, XML já vindo
   junto ou precisando de uma segunda chamada), mas isso também só dá pra
   confirmar 100% testando com um certificado real em homologação.

3. **Busca por data.** Hoje é feita varrendo o NSU e filtrando pela data de
   emissão de cada nota (ver aviso em `lib/nfse.js`) — pode ser lento com
   muito histórico. Vale checar se existe uma rota oficial de busca por
   período já pronta.

4. **Nomes das tags no XML (`CAMPOS_XML` em `lib/nfse.js`).** É daí que
   vem os dados da planilha de retenções (valor do serviço, ISS, PIS,
   COFINS, CSLL, IR) e a classificação de "emitida" vs "tomada" (comparando
   o CNPJ do cliente com o `prestador`/`tomador` do XML). Os nomes usados
   são o layout mais comum da NFS-e Nacional, mas não foram testados contra
   um XML de verdade — depois que a busca funcionar, abram um XML baixado e
   confirmem se os nomes batem. Se algo vier em branco na planilha, é ali
   que se ajusta.

5. **Banco de dados.** Por padrão isso guarda os clientes num arquivo
   `data/clientes.json`. Ótimo pra testar rodando no seu computador. **Não
   funciona direito hospedado no Vercel** (o disco lá é temporário — os
   clientes cadastrados podem simplesmente sumir). Antes de colocar em
   produção, troquem `lib/db.js` por um banco hospedado (Vercel Postgres,
   Neon, Supabase e Turso têm plano gratuito de sobra pra esse volume). É a
   única peça que precisa trocar.

## Rodando localmente

```bash
npm install
cp .env.example .env
# defina uma senha em SITE_PASSWORD no .env
npm run dev
```

Abra `http://localhost:3000`. Comece cadastrando um cliente com um
certificado de **homologação** (NFSE_AMBIENTE=homologacao no `.env`) antes
de usar em produção de verdade.

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
  O site nunca guarda essa cópia.

## Deploy no Vercel

1. Troquem `lib/db.js` por um banco hospedado (ver item 3 acima).
2. Subam o projeto pro GitHub e conectem no Vercel.
3. Configurem as variáveis de ambiente no painel do Vercel: `SITE_PASSWORD`,
   `NFSE_AMBIENTE` (comecem com `homologacao`).
4. Testem tudo em homologação antes de trocar `NFSE_AMBIENTE` pra `producao`.

## Estrutura

```
app/
  login/            tela de login
  clientes/novo/    cadastro de cliente (nome + CNPJ, sem certificado)
  api/login/        verifica a senha
  api/clientes/     lista/cadastra clientes
  api/clientes/[id]/buscar/   recebe certificado+período+tipo, busca e devolve zip + planilha
lib/
  db.js       onde os clientes ficam salvos (trocar por banco real, ver acima)
  nfse.js     conversa com a API do governo (mTLS, período, classificação, zip, planilha)
```
