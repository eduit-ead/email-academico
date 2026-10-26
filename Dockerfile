# Playwright npm 1.64.1 = package-lock; browsers na imagem oficial (mesma tag).
FROM mcr.microsoft.com/playwright:v1.64.1-noble

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY consultar-email.mjs ./

ENV CONTAINER=1
ENV HEADLESS=true
ENV CONSULTA_TIMEOUT_MS=120000

# Validação EasyPanel: ocioso até consulta manual no terminal (não roda node na subida).
CMD ["sleep", "infinity"]
