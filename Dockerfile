# Playwright npm 1.64.1 = package-lock; browsers na imagem oficial (mesma tag).
FROM mcr.microsoft.com/playwright:v1.64.1-noble

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends xvfb \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY consultar-email.mjs ./
COPY lib ./lib/
COPY scripts/consultar-xvfb.sh ./scripts/consultar-xvfb.sh
RUN chmod +x /app/scripts/consultar-xvfb.sh

ENV CONTAINER=1
ENV HEADLESS=false
ENV CONSULTA_TIMEOUT_MS=120000

# Validação EasyPanel: ocioso até consulta manual no terminal (não roda node na subida).
CMD ["sleep", "infinity"]
