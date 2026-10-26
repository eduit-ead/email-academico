import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

export const PAGE_URL =
  'https://sso.cruzeirodosul.edu.br/recover-email?origin=https:%2F%2Fnovoportal.cruzeirodosul.edu.br&empresa=unicid';
export const RECOVER_API_FRAGMENT = '/entry/orchestrator/email/v3/recover';

export const STATUS = {
  FOUND: 'encontrado',
  NOT_FOUND: 'nao_localizado',
  BLOCKED: 'bloqueado',
  ERROR: 'erro',
};

export function onlyDigits(value) {
  return value.replace(/\D/g, '');
}

export function validateCpfInput(raw) {
  const cpf = onlyDigits(raw ?? '');
  if (cpf.length !== 11) {
    throw new Error('CPF inválido: informe exatamente 11 dígitos.');
  }
  return cpf;
}

export function resolveHeadlessFromEnv(stdinIsPiped) {
  const value = process.env.HEADLESS;
  if (value === undefined || value === '') {
    return stdinIsPiped;
  }
  return value === '1' || value.toLowerCase() === 'true';
}

export function resolveTimeoutMs() {
  const parsed = Number(process.env.CONSULTA_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120_000;
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

export function getWindowsChromePaths() {
  const localAppData = process.env.LOCALAPPDATA ?? '';
  return [
    path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
}

export function isGoogleChromeInstalled() {
  if (process.platform !== 'win32') {
    return true;
  }
  return getWindowsChromePaths().some((chromePath) => fs.existsSync(chromePath));
}

function warnIfContainerNeedsDisplay(headless) {
  if (process.env.CONTAINER === '1' && !headless && !process.env.DISPLAY) {
    console.error(
      'AVISO: HEADLESS=false sem DISPLAY. No container Linux use: printf ... | /app/scripts/consultar-xvfb.sh',
    );
  }
}

export async function openBrowserSession({ profileDir, headless, container = false }) {
  const timeoutMs = resolveTimeoutMs();
  warnIfContainerNeedsDisplay(headless);

  const useWindowsChrome = process.platform === 'win32' && !container;

  if (useWindowsChrome) {
    const context = await chromium.launchPersistentContext(profileDir, {
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

export async function runConsultation(session, cpf) {
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

export function apiIndicatesBlockForTests(payload, status) {
  return apiIndicatesBlock(payload, status);
}

export function mockUiResult(statusKey) {
  const fixedAt = '2026-03-26T12:00:00.000Z';
  const samples = {
    encontrado: buildResult({
      status: STATUS.FOUND,
      email: 'aluno.exemplo@cs.unicid.edu.br',
      mensagem: 'E-mail acadêmico exibido na página.',
      consultado_em: fixedAt,
    }),
    nao_localizado: buildResult({
      status: STATUS.NOT_FOUND,
      email: null,
      mensagem: 'Não localizamos os dados informados.',
      consultado_em: fixedAt,
    }),
    bloqueado: buildResult({
      status: STATUS.BLOCKED,
      email: null,
      mensagem: 'Desafio reCAPTCHA visível detectado após enviar o CPF.',
      consultado_em: fixedAt,
    }),
    erro: buildResult({
      status: STATUS.ERROR,
      email: null,
      mensagem: 'Campo CPF não encontrado na página de recuperação.',
      consultado_em: fixedAt,
    }),
  };
  return samples[statusKey] ?? null;
}
