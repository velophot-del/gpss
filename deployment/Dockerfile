FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app/server

COPY app/server/package.json app/server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY app/server/dist ./dist
COPY app/dist /app/dist

RUN mkdir -p /data/uploads \
    && chown -R node:node /app /data/uploads

USER node
EXPOSE 3011

CMD ["node", "dist/index.js"]
