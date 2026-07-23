FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV NTOX_DIR=/data

RUN addgroup -S ntox && adduser -S ntox -G ntox && \
    mkdir -p /data /workspace && chown -R ntox:ntox /data /workspace

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY dist/ ./dist/
COPY skills/ ./skills/
COPY web/ ./web/
COPY install.sh install.ps1 ./

RUN chown -R ntox:ntox /app

USER ntox

EXPOSE 3000

VOLUME ["/data", "/workspace"]

HEALTHCHECK --interval=30s --timeout=5s CMD node -e "process.exit(0)"

ENTRYPOINT ["node", "dist/index.js"]
CMD ["gateway"]
