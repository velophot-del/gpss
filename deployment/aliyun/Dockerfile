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

# 独立使用完整提交哈希生成标识，避免等长、同时间文件的上下文缓存。
ARG GPSS_BUILD_COMMIT
RUN if [ -n "$GPSS_BUILD_COMMIT" ]; then printf '%s\n' "$GPSS_BUILD_COMMIT" > /app/DEPLOY_COMMIT; fi

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
