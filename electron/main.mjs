import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  STATUS,
  buildResult,
  validateCpfInput,
  openBrowserSession,
  runConsultation,
  isGoogleChromeInstalled,
  mockUiResult,
} from '../lib/consulta-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isSimularUi = process.env.ELECTRON_SIMULAR_UI === '1';

let mainWindow = null;
let consultaEmAndamento = false;

function getChromeProfileDir() {
  return path.join(app.getPath('userData'), 'chrome-profile-app');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 640,
    minWidth: 440,
    minHeight: 520,
    title: 'Consulta de e-mail acadêmico',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('chrome-instalado', () => isGoogleChromeInstalled());

ipcMain.handle('modo-simulacao-ui', () => isSimularUi);

ipcMain.handle('simular-resultado', (_event, status) => {
  if (!isSimularUi) return null;
  return mockUiResult(status);
});

ipcMain.handle('consultar', async (_event, cpfRaw) => {
  if (consultaEmAndamento) {
    return buildResult({
      status: STATUS.ERROR,
      email: null,
      mensagem: 'Já existe uma consulta em andamento. Aguarde a conclusão.',
    });
  }

  if (!isGoogleChromeInstalled()) {
    return buildResult({
      status: STATUS.ERROR,
      email: null,
      mensagem:
        'Google Chrome não encontrado. Instale o Chrome em https://www.google.com/chrome/ e tente novamente.',
    });
  }

  let cpf;
  try {
    cpf = validateCpfInput(cpfRaw);
  } catch (err) {
    return buildResult({
      status: STATUS.ERROR,
      email: null,
      mensagem: err.message ?? String(err),
    });
  }

  consultaEmAndamento = true;
  let session = null;

  try {
    session = await openBrowserSession({
      profileDir: getChromeProfileDir(),
      headless: false,
      container: false,
    });
    const result = await runConsultation(session, cpf);
    return buildResult(result);
  } catch (err) {
    return buildResult({
      status: STATUS.ERROR,
      email: null,
      mensagem: err.message ?? String(err),
    });
  } finally {
    if (session) {
      await session.close();
    }
    consultaEmAndamento = false;
  }
});
