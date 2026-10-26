# Consulta de e-mail acadêmico (teste local)

Protótipo mínimo com **Node.js + Playwright** que abre o Chrome instalado no Windows, preenche o CPF na página oficial da Cruzeiro do Sul e mostra no terminal o que a interface exibir.

## Pré-requisitos

- Node.js 20+ (você tem v24)
- Google Chrome instalado

## Instalação (uma vez)

No PowerShell, na pasta do projeto:

```powershell
cd "c:\Users\Fabio Villas Boas\DEV\teste-email-cruzeiro"
npm install
```

## Executar uma consulta

```powershell
npm run consultar
```

1. Digite o CPF quando o terminal pedir (não ficará salvo no código).
2. O Chrome abrirá com perfil isolado em `.chrome-profile-test`.
3. O script preenche o CPF e clica em **Continuar**.
4. O resultado aparece no terminal; o navegador permanece aberto para você conferir.
5. Pressione **Enter** no terminal quando quiser encerrar o script (a janela do Chrome fecha).

## Significado dos status

| Status no terminal | Significado |
|--------------------|-------------|
| `e-mail encontrado` | E-mail acadêmico identificado na página (ou na resposta da API). |
| `cadastro ainda indisponível` | Mensagem da página menciona cadastro indisponível. |
| `CPF não localizado` | Texto do tipo “Não localizamos os dados informados”. |
| `bloqueio ou CAPTCHA` | Desafio reCAPTCHA visível ou resposta da API com erro de reCAPTCHA/bloqueio — **sem novas tentativas automáticas**. |

## Observações

- Uma execução = **uma** consulta.
- Não há contorno de reCAPTCHA nem reutilização de tokens de API.
- Se o resultado no terminal não bater com a tela, use o navegador como referência e envie um print para ajustarmos os textos detectados.

## Docker / EasyPanel (validação em Linux)

- **Imagem:** `mcr.microsoft.com/playwright:v1.64.1-noble`
- **Playwright npm:** `1.64.1` (`package-lock.json` — alinhado à tag da imagem)

### Comando inicial no EasyPanel

Configure o **comando de start** do serviço (ou use o `CMD` do Dockerfile):

```text
sleep infinity
```

Diretório de trabalho: `/app`. O container fica **ocioso** (sem navegador, sem consulta na subida) para você abrir o **terminal** do serviço.

### Uma consulta manual (no terminal do container)

```bash
printf '%s\n' 'CPF_DO_ALUNO' | node consultar-email.mjs
```

Saída: uma linha JSON; o processo `node` termina e o navegador fecha. O container continua rodando (`sleep infinity`).

Variáveis opcionais no serviço:

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `HEADLESS` | `true` | Navegador sem interface |
| `CONSULTA_TIMEOUT_MS` | `120000` | Timeout Playwright |
| `CONTAINER` | `1` | Chromium empacotado (Linux) |

Build local (quando houver Docker):

```bash
docker build -t consulta-email-cruzeiro .
docker run -d --name consulta-email-validacao consulta-email-cruzeiro
docker exec -it consulta-email-validacao bash -lc "printf '%s\n' 'CPF_DO_ALUNO' | node consultar-email.mjs"
```
