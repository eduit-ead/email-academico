import { chromium } from 'playwright';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PAGE_URL =
  'https://sso.cruzeirodosul.edu.br/recover-email?origin=https:%2F%2Fnovoportal.cruzeirodosul.edu.br&empresa=unicid';
const PROFILE_DIR = path.join(__dirname, '.chrome-profile-test');
const RECOVER_API_FRAGMENT = '/entry/orchestrator/email/v3/recover';

const STATUS = {
  FOUND: 'encontrado',
  NOT_FOUND: 'nao_localizado',
  BLOCKED: 'bloqueado',
  ERROR: 'erro',
};

const stdinIsPiped = !input.isTTY;

function resolveHeadless() {
  const value = process.env.HEADLESS;
  if (value === undefined || value === '') {
    return stdinIsPiped;
  }
  return value === '1' || value.toLowerCase() === 'true';
}

function resolveTimeoutMs() {
  const parsed = Number(process.env.CONSULTA_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120_000;
}

function useWindowsChromeProfile() {
  return process.platform === 'win32' && process.env.CONTAINER !== '1';
}

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

function onlyDigits(value) {
  return value.replace(/\D/g, '');
}

function extractEmails(text) {
  const matches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
  return matches ? [...new Set(matches)] : [];
}

function isNoiseEmail(email) {
  const lower = email.toLowerCase();
  return (
    lower.includes('example.com') ||
    lower.startsWith('noreply@') ||
    lower === 'app@cruzeirodosul.edu.br'
  );
}

function pickAcademicEmail(text) {
  const emails = extractEmails(text).filter((e) => !isNoiseEmail(e));
  const preferred = emails.filter((e) =>
    /@([a-z0-9-]+\.)*(unicid|cruzeirodosul|cruzeirodosuleducacional)\.[a-z]{2,}$/i.test(e),
  );
  if (preferred.length > 0) return preferred[0];
  if (emails.length === 1) return emails[0];
  return emails.find((e) => !/^(info|contato|suporte)@/i.test(e)) ?? null;
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

  const cpf = onlyDigits(raw);
  if (cpf.length !== 11) {
    throw new Error('CPF inválido: informe exatamente 11 dígitos.');
  }
  return cpf;
}

function warnIfContainerNeedsDisplay(headless) {
  if (process.env.CONTAINER === '1' && !headless && !process.env.DISPLAY) {
    console.error(
      'AVISO: HEADLESS=false sem DISPLAY. No container Linux use: printf ... | /app/scripts/consultar-xvfb.sh',
    );
  }
}

async function launchBrowser() {
  const headless = resolveHeadless();
  const timeoutMs = resolveTimeoutMs();
  warnIfContainerNeedsDisplay(headless);

  if (useWindowsChromeProfile()) {
    const context = await chromium.launchPersistentContext(PROFILE_DIR, {
      channel: 'chrome',
      headless,
      viewport: headless ? { width: 1280, height: 720 } : null,
      locale: 'pt-BR',
      args: headless ? [] : ['--start-maximized'],
    });
    context.setDefaultTimeout(timeoutMs);
    return {
      context,
      async close() {
        await context.close();
      },
    };
  }

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    locale: 'pt-BR',
    viewport: { width: 1280, height: 720 },
  });
  context.setDefaultTimeout(timeoutMs);

  return {
    context,
    async close() {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}

async function hasVisibleRecaptchaChallenge(page) {
  const challenge = page.locator(
    'iframe[title*="challenge" i], iframe[src*="recaptcha/api2/bframe" i]',
  );
  return (await challenge.count()) > 0;
}

function apiIndicatesBlock(payload, status) {
  const blob = JSON.stringify(payload ?? {}).toLowerCase();
  if (blob.includes('recaptchalowscore') || blob.includes('recaptcha')) return true;
  if (status === 403 || status === 429) return true;
  return false;
}

export function truncateVisibleText(text, maxLen = 2000) {
  const normalized = (text ?? '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLen) {
    return normalized;
  }
  return `${normalized.slice(0, maxLen)}…`;
}

export function isLikelyErrorPage({ title = '', httpStatus, visibleText = '' }) {
  const blob = `${title}\n${visibleText}`.toLowerCase();
  if (typeof httpStatus === 'number' && httpStatus >= 400) {
    return true;
  }
  if (blob.includes('página não encontrada') || blob.includes('pagina nao encontrada')) {
    return true;
  }
  if ((blob.includes('oops') || blob.includes('opss')) && blob.includes('encontrada')) {
    return true;
  }
  if (blob.includes('access denied') || blob.includes('forbidden')) {
    return true;
  }
  return false;
}

export function buildPageDiagnostics({ url, title, httpStatus, visibleText }) {
  return {
    url: url ?? '',
    title: title ?? '',
    httpStatus: httpStatus ?? null,
    visibleText: truncateVisibleText(visibleText),
  };
}

export function logPageDiagnostics(diagnostics) {
  console.error('[diagnostico-pagina]');
  console.error(`url: ${diagnostics.url}`);
  console.error(`titulo: ${diagnostics.title}`);
  console.error(
    `http: ${diagnostics.httpStatus === null ? 'desconhecido' : diagnostics.httpStatus}`,
  );
  console.error(`texto_visivel: ${diagnostics.visibleText}`);
}

export async function gatherPageDiagnostics(page, navigationResponse) {
  return buildPageDiagnostics({
    url: page.url(),
    title: await page.title().catch(() => ''),
    httpStatus: navigationResponse?.status?.() ?? navigationResponse?.status ?? null,
    visibleText: await page.locator('body').innerText().catch(() => ''),
  });
}

export function classifyFromText(bodyText) {
  const normalized = bodyText.replace(/\s+/g, ' ').trim();
  const lower = normalized.toLowerCase();

  if (lower.includes('não localizamos') || lower.includes('nao localizamos')) {
    return {
      status: STATUS.NOT_FOUND,
      email: null,
      mensagem: 'Não localizamos os dados informados.',
    };
  }

  if (
    lower.includes('muitas tentativas') ||
    lower.includes('bloqueado') ||
    lower.includes('tente novamente mais tarde')
  ) {
    return {
      status: STATUS.BLOCKED,
      email: null,
      mensagem: 'A página indicou bloqueio ou limite de tentativas.',
    };
  }

  const email = pickAcademicEmail(normalized);
  if (email) {
    return {
      status: STATUS.FOUND,
      email,
      mensagem: 'E-mail acadêmico exibido na página.',
    };
  }

  if (lower.includes('indisponível') || lower.includes('indisponivel')) {
    const line =
      normalized.match(/[^.!?]*indispon[ií]vel[^.!?]*/i)?.[0]?.trim() ??
      'Mensagem de indisponibilidade na página.';
    return {
      status: STATUS.ERROR,
      email: null,
      mensagem: line,
    };
  }

  return null;
}

export function buildResult({ status, email = null, mensagem, consultado_em }) {
  return {
    status,
    email: email ?? null,
    consultado_em: consultado_em ?? new Date().toISOString(),
    mensagem,
  };
}

function emitResult(result) {
  const payload = buildResult(result);
  console.log(JSON.stringify(payload));
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
      const sample = buildResult({ ...classified, consultado_em: fixedAt });
      console.log(`OK [${name}]`, JSON.stringify(sample));
    }
  }

  const apiBlock = apiIndicatesBlock({ code: 'RecaptchaLowScoreException' }, 403);
  if (!apiBlock) {
    failed += 1;
    console.error('FALHA [api recaptcha]');
  } else {
    console.log('OK [api recaptcha]');
  }

  const longText = 'x'.repeat(2500);
  const truncated = truncateVisibleText(longText);
  if (truncated.length !== 2001 || !truncated.endsWith('…')) {
    failed += 1;
    console.error('FALHA [truncate texto]');
  } else {
    console.log('OK [truncate texto]');
  }

  const errorPage = isLikelyErrorPage({
    title: 'Opss, página não encontrada!',
    httpStatus: 404,
    visibleText: 'Por favor, entre em contato com o administrador',
  });
  if (!errorPage) {
    failed += 1;
    console.error('FALHA [pagina erro]');
  } else {
    console.log('OK [pagina erro]');
  }

  const recoverPage = isLikelyErrorPage({
    title: 'Recuperar e-mail | Cruzeiro do Sul Educacional',
    httpStatus: 200,
    visibleText: 'Insira seu CPF',
  });
  if (recoverPage) {
    failed += 1;
    console.error('FALHA [pagina recuperacao]');
  } else {
    console.log('OK [pagina recuperacao]');
  }

  const forbidden = isLikelyErrorPage({ title: '', httpStatus: 403, visibleText: '' });
  if (!forbidden) {
    failed += 1;
    console.error('FALHA [http 403]');
  } else {
    console.log('OK [http 403]');
  }

  process.exit(failed > 0 ? 1 : 0);
}

async function runConsultation(session, cpf) {
  const { context } = session;
  const page = context.pages()[0] ?? (await context.newPage());
  const timeoutMs = resolveTimeoutMs();

  let apiPayload = null;
  let apiStatus = null;

  page.on('response', async (response) => {
    if (!response.url().includes(RECOVER_API_FRAGMENT)) return;
    apiStatus = response.status();
    try {
      apiPayload = await response.json();
    } catch {
      apiPayload = { raw: await response.text().catch(() => '') };
    }
  });

  let navigationResponse = null;
  try {
    navigationResponse = await page.goto(PAGE_URL, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
  } catch {
    const diagnostics = await gatherPageDiagnostics(page, navigationResponse);
    logPageDiagnostics(diagnostics);
    return {
      status: STATUS.ERROR,
      email: null,
      mensagem: 'Falha ao carregar a página de recuperação.',
    };
  }

  const initialDiagnostics = await gatherPageDiagnostics(page, navigationResponse);
  if (isLikelyErrorPage(initialDiagnostics)) {
    logPageDiagnostics(initialDiagnostics);
    return {
      status: STATUS.ERROR,
      email: null,
      mensagem: 'Página de erro detectada antes do formulário de CPF.',
    };
  }

  const cpfField = page.locator('input#cpf-field');
  try {
    await cpfField.waitFor({ state: 'visible', timeout: timeoutMs });
  } catch {
    const diagnostics = await gatherPageDiagnostics(page, navigationResponse);
    logPageDiagnostics(diagnostics);
    return {
      status: STATUS.ERROR,
      email: null,
      mensagem: 'Campo CPF não encontrado na página de recuperação.',
    };
  }
  await cpfField.fill(cpf);

  const continueBtn = page.getByRole('button', { name: 'Continuar' });
  await continueBtn.click();

  await page
    .waitForFunction(
      () => {
        const body = document.body?.innerText ?? '';
        const hasMessage =
          /localizamos|indispon[ií]vel|@/i.test(body) &&
          !document.querySelector('input#cpf-field');
        const stillOnForm = document.querySelector('input#cpf-field');
        return hasMessage || !stillOnForm;
      },
      { timeout: timeoutMs },
    )
    .catch(() => {});

  await page.waitForTimeout(1500);

  if (await hasVisibleRecaptchaChallenge(page)) {
    return {
      status: STATUS.BLOCKED,
      email: null,
      mensagem: 'Desafio reCAPTCHA visível detectado após enviar o CPF.',
    };
  }

  if (apiIndicatesBlock(apiPayload, apiStatus)) {
    const detail =
      typeof apiPayload === 'object' && apiPayload !== null
        ? JSON.stringify(apiPayload)
        : String(apiPayload);
    return {
      status: STATUS.BLOCKED,
      email: null,
      mensagem: `Resposta da API indicou bloqueio/reCAPTCHA (HTTP ${apiStatus}): ${detail}`,
    };
  }

  const bodyText = await page.locator('body').innerText();
  let result = classifyFromText(bodyText);

  if (!result && apiPayload && typeof apiPayload === 'object') {
    const emailFromApi =
      apiPayload.email ??
      apiPayload.mail ??
      apiPayload.academicEmail ??
      apiPayload.data?.email;
    if (emailFromApi) {
      result = {
        status: STATUS.FOUND,
        email: String(emailFromApi),
        mensagem: 'E-mail retornado na resposta da consulta.',
      };
    } else if (apiIndicatesBlock(apiPayload, apiStatus)) {
      result = {
        status: STATUS.BLOCKED,
        email: null,
        mensagem: 'API retornou erro relacionado a reCAPTCHA ou bloqueio.',
      };
    }
  }

  if (!result) {
    result = {
      status: STATUS.ERROR,
      email: null,
      mensagem:
        'Não foi possível classificar a resposta automaticamente. Confira o texto exibido no navegador.',
    };
  }

  return result;
}

async function main() {
  let session = null;
  let result;

  try {
    const cpf = await readCpf();

    if (!stdinIsPiped) {
      console.error(
        useWindowsChromeProfile()
          ? '\nAbrindo Google Chrome (perfil de teste em .chrome-profile-test)...'
          : '\nAbrindo navegador para consulta...',
      );
    }

    session = await launchBrowser();
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
    if (result) {
      emitResult(result);
    }
    if (stdinIsPiped) {
      if (session) {
        await session.close();
      }
    } else {
      await waitForUserClose(session);
    }
  }
}

async function waitForUserClose(session) {
  if (!session) {
    return;
  }

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

if (process.argv.includes('--simular')) {
  runSimulations();
} else {
  main();
}
