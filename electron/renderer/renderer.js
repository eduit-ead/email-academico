const cpfInput = document.getElementById('cpf');
const btnConsultar = document.getElementById('btnConsultar');
const statusLinha = document.getElementById('statusLinha');
const painelResultado = document.getElementById('painelResultado');
const resultadoTitulo = document.getElementById('resultadoTitulo');
const resultadoMensagem = document.getElementById('resultadoMensagem');
const emailBloco = document.getElementById('emailBloco');
const emailValor = document.getElementById('emailValor');
const btnCopiar = document.getElementById('btnCopiar');
const chromeAviso = document.getElementById('chromeAviso');
const painelSimulacao = document.getElementById('painelSimulacao');

const titulos = {
  encontrado: 'E-mail encontrado',
  nao_localizado: 'Não localizado',
  bloqueado: 'Bloqueio ou CAPTCHA',
  erro: 'Erro na consulta',
};

function aplicarResultado(payload) {
  painelResultado.hidden = false;
  painelResultado.className = `card resultado ${payload.status}`;
  resultadoTitulo.textContent = titulos[payload.status] ?? 'Resultado';
  resultadoMensagem.textContent = payload.mensagem ?? '';

  if (payload.status === 'encontrado' && payload.email) {
    emailBloco.hidden = false;
    emailValor.textContent = payload.email;
  } else {
    emailBloco.hidden = true;
    emailValor.textContent = '';
  }
}

function setConsultando(ativo) {
  btnConsultar.disabled = ativo;
  cpfInput.disabled = ativo;
  statusLinha.classList.toggle('loading', ativo);
  statusLinha.textContent = ativo ? 'Consulta em andamento… Aguarde o navegador.' : '';
}

btnConsultar.addEventListener('click', async () => {
  setConsultando(true);
  painelResultado.hidden = true;
  try {
    const payload = await window.consultaApi.consultar(cpfInput.value);
    aplicarResultado(payload);
  } catch {
    aplicarResultado({
      status: 'erro',
      email: null,
      mensagem: 'Falha ao comunicar com o aplicativo.',
    });
  } finally {
    setConsultando(false);
  }
});

btnCopiar.addEventListener('click', async () => {
  const texto = emailValor.textContent;
  if (!texto) return;
  try {
    await navigator.clipboard.writeText(texto);
    statusLinha.textContent = 'E-mail copiado.';
    statusLinha.classList.remove('loading');
  } catch {
    statusLinha.textContent = 'Não foi possível copiar automaticamente.';
  }
});

async function init() {
  const chromeOk = await window.consultaApi.chromeInstalado();
  chromeAviso.hidden = chromeOk;
  if (!chromeOk) btnConsultar.disabled = true;

  const sim = await window.consultaApi.modoSimulacaoUi();
  if (sim) {
    painelSimulacao.hidden = false;
    painelSimulacao.querySelectorAll('[data-sim]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const payload = await window.consultaApi.simularResultado(btn.dataset.sim);
        if (payload) aplicarResultado(payload);
      });
    });
  }
}

init();
