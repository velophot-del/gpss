FROM node:24-bookworm-slim

WORKDIR /app

# 安装前端和后端依赖
COPY package.json ./
COPY package-lock.json* ./
COPY server/package.json ./server/
COPY server/package-lock.json* ./server/

RUN npm install --no-fund --no-audit
RUN cd server && npm install --no-fund --no-audit

# 拷贝源码
COPY . .

# 构建前端和后端
RUN npm run build
RUN cd server && npm run build

# 运行时目录
RUN mkdir -p /data/uploads && chown -R node:node /app /data/uploads
COPY deployment/aliyun/entrypoint.sh /entrypoint.sh
RUN chmod 755 /entrypoint.sh
USER node

EXPOSE 3011

ENTRYPOINT ["/entrypoint.sh"]
