# Docker 快速部署

## 前提

- Linux `amd64` 或 `arm64`
- Docker Engine 和 Docker Compose 插件
- 首次部署可访问 Docker Hub
- 至少 2 GB 内存、10 GB 可用磁盘

## 安装

```bash
./deploy.sh install
```

脚本会生成权限为600的 `.env.deploy`，其中保存数据库密码和JWT密钥；不会保存管理员初始密码。默认访问地址取服务器第一个非回环IP，如需指定：

```bash
PUBLIC_URL=http://10.0.0.10 ./deploy.sh install
```

阿里云安全组或校内防火墙只开放80端口；不要开放3011和3306。应用与MySQL仅在Docker内部网络通信。

## HTTPS

1. 将域名证书保存为 `certs/fullchain.pem` 和 `certs/privkey.pem`。
2. 复制 `nginx/https.conf.example` 为 `nginx/https.conf`，把 `YOUR_DOMAIN` 替换为真实域名。
3. 将 `.env.deploy` 的 `PUBLIC_URL` 改为 `https://真实域名`。
4. 启动：

```bash
docker compose --env-file .env.deploy -f compose.yaml -f compose.https.yaml up -d
./deploy.sh doctor
```

安全组仅开放80和443。

## 运维

```bash
./deploy.sh status
./deploy.sh logs
./deploy.sh restart
./deploy.sh doctor
./deploy.sh down
```

禁止执行 `docker compose down -v`，该命令会删除数据库与上传文件卷。
