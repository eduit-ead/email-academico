import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  STATUS,
  buildResult,
  classifyFromText,
  truncateVisibleText,
  isLikelyErrorPage,
  validateCpfInput,
  resolveHeadlessFromEnv,
  openBrowserSession,
  runConsultation,
  apiIndicatesBlockForTests,
} from './lib/consulta-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(__dirname, '.chrome-profile-test');
const stdinIsPiped = !input.isTTY;

function readAllStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    input.setEncoding('utf8');
    input.on('data', (chunk) => {
      data += chunk;
    });
    input.on('end', () => resolve(data.trim()));
    input.on('error', reject);
  });
}

async function readCpf() {
  let raw;
  if (stdinIsPiped) {
    raw = await readAllStdin();
  } else {
    const rl = readline.createInterface({ input, output });
    try {
      raw = await rl.question('Digite o CPF (somente números ou com pontuação): ');
    } finally {
      rl.close();
    }
  }
  return validateCpfInput(raw);
}

function emitResult(result) {
  console.log(JSON.stringify(buildResult(result)));
}

function runSimulations() {
  const fixedAt = '2026-03-26T12:00:00.000Z';
  const cases = [
    {
      name: 'encontrado',
      body: 'Seu e-mail acadêmico é aluno.exemplo@cs.unicid.edu.br',
      expect: { status: STATUS.FOUND, email: 'aluno.exemplo@cs.unicid.edu.br' },
    },
    {
      name: 'nao_localizado',
      body: 'Não localizamos os dados informados. Tente novamente.',
      expect: { status: STATUS.NOT_FOUND, email: null },
    },
    {
      name: 'bloqueado (texto)',
      body: 'Muitas tentativas. Tente novamente mais tarde.',
      expect: { status: STATUS.BLOCKED, email: null },
    },
    {
      name: 'indisponivel como erro',
      body: 'Cadastro temporariamente indisponível para consulta.',
      expect: { status: STATUS.ERROR, email: null },
    },
  ];

  let failed = 0;
  for (const { name, body, expect } of cases) {
    const classified = classifyFromText(body);
    const ok =
      classified?.status === expect.status &&
      (classified.email ?? null) === expect.email;
    if (!ok) {
      failed += 1;
      console.error(`FALHA [${name}]:`, classified);
    } else {
      console.log(`OK [${name}]`, JSON.stringify(buildResult({ ...classified, consultado_em: fixedAt })));
    }
  }

  if (!apiIndicatesBlockForTests({ code: 'RecaptchaLowScoreException' }, 403)) {
    failed += 1;
    console.error('FALHA [api recaptcha]');
  } else {
    console.log('OK [api recaptcha]');
  }

  const truncated = truncateVisibleText('x'.repeat(2500));
  if (truncated.length !== 2001 || !truncated.endsWith('…')) {
    failed += 1;
    console.error('FALHA [truncate texto]');
  } else {
    console.log('OK [truncate texto]');
  }

  if (
    !isLikelyErrorPage({
      title: 'Opss, página não encontrada!',
      httpStatus: 404,
      visibleText: 'Por favor, entre em contato com o administrador',
    })
  ) {
    failed += 1;
    console.error('FALHA [pagina erro]');
  } else {
    console.log('OK [pagina erro]');
  }

  if (
    isLikelyErrorPage({
      title: 'Recuperar e-mail | Cruzeiro do Sul Educacional',
      httpStatus: 200,
      visibleText: 'Insira seu CPF',
    })
  ) {
    failed += 1;
    console.error('FALHA [pagina recuperacao]');
  } else {
    console.log('OK [pagina recuperacao]');
  }

  if (!isLikelyErrorPage({ title: '', httpStatus: 403, visibleText: '' })) {
    failed += 1;
    console.error('FALHA [http 403]');
  } else {
    console.log('OK [http 403]');
  }

  process.exit(failed > 0 ? 1 : 0);
}

async function waitForUserClose(session) {
  if (!session) return;
  console.error(
    'Navegador aberto para conferência. Feche a janela do Chrome ou pressione Enter aqui.',
  );
  const rl = readline.createInterface({ input, output });
  try {
    await rl.question('');
  } finally {
    rl.close();
  }
  await session.close();
}

async function main() {
  let session = null;
  let result;

  try {
    const cpf = await readCpf();
    if (!stdinIsPiped) {
      console.error('\nAbrindo Google Chrome (perfil de teste em .chrome-profile-test)...');
    }
    session = await openBrowserSession({
      profileDir: PROFILE_DIR,
      headless: resolveHeadlessFromEnv(stdinIsPiped),
      container: process.env.CONTAINER === '1',
    });
    result = await runConsultation(session, cpf);
  } catch (err) {
    result = {
      status: STATUS.ERROR,
      email: null,
      mensagem: err.message ?? String(err),
    };
    if (!stdinIsPiped) {
      console.error('\nFalha durante a automação. O navegador permanece aberto para você inspecionar.');
    }
    process.exitCode = 1;
  } finally {
    if (result) emitResult(result);
    if (stdinIsPiped) {
      if (session) await session.close();
    } else {
      await waitForUserClose(session);
    }
  }
}

export {
  STATUS,
  buildResult,
  classifyFromText,
  truncateVisibleText,
  isLikelyErrorPage,
  buildPageDiagnostics,
  logPageDiagnostics,
  gatherPageDiagnostics,
} from './lib/consulta-core.mjs';

if (process.argv.includes('--simular')) {
  runSimulations();
} else {
  main();
}
