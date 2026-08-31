# 阿里云 ECS 部署说明（Docker Compose）

适用于：CentOS 7+ / Ubuntu 20.04+ / Debian 11+

## 1. 环境准备

```bash
sudo apt-get update
sudo apt-get install -y curl ca-certificates git docker.io docker-compose-plugin
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker $USER
newgrp docker
```

如果你使用的是 CentOS/RHEL，可参考：

```bash
sudo yum install -y yum-utils
sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo yum install -y docker-ce docker-ce-cli containerd.io
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
newgrp docker
```

## 2. 下载项目

```bash
cd /opt
sudo git clone <你的项目地址> gpss
cd gpss/deployment/aliyun
```

## 3. 配置环境变量

复制示例文件：

```bash
cp .env.example .env
```

编辑 .env：

```bash
nano .env
```

必须修改：

```env
PUBLIC_URL=http://你的公网IP
DB_PASSWORD=你的数据库密码
MYSQL_ROOT_PASSWORD=你的root密码
JWT_SECRET=你的强随机密钥
```

示例：

```env
PUBLIC_URL=http://121.41.57.110
DB_NAME=gpss
DB_USER=gpss
DB_PASSWORD=Gpss@2026!Strong
MYSQL_ROOT_PASSWORD=Root@2026!Strong
JWT_SECRET=8cd83e4d6a9d3e2d0d8e28f3a8d4f0c2d1e6b8c2d4e7f9a1b3c5d6e7f8a9b0
JWT_EXPIRES_IN=7d
ENABLE_DEMO_LOGIN=false
HTTP_PORT=80
```

## 4. 启动服务

```bash
docker compose up -d --build
```

## 5. 查看状态

```bash
docker compose ps
docker compose logs -f app
```

## 6. 访问地址

浏览器访问：

```bash
http://你的公网IP/
```

默认管理员账号：

```text
用户名：admin
密码：首次启动脚本中生成的管理员密码
```

如果你使用的是本项目自带部署脚本，管理员初始密码会在安装时输出；如果使用本流程直接启动 docker compose，则需要在容器中手动初始化管理员。推荐执行：

```bash
docker compose exec app node dist/scripts/bootstrapAdmin.js
```

## 7. 常用命令

```bash
docker compose logs -f --tail 200

docker compose restart

docker compose down

docker compose up -d
```

## 8. 数据持久化

以下目录会保存在宿主机：

```bash
/opt/gpss/mysql
/opt/gpss/uploads
```

## 9. 生产建议

- 绑定安全组：开放 80/443 端口
- 建议在阿里云 ECS 上配置防火墙
- 如需 HTTPS，建议在 Nginx 前面接云盾/证书或直接扩展到 TLS 配置
- 生产环境请不要使用默认演示账号启用状态

## 10. 备份

```bash
mkdir -p /opt/gpss/backup
mysqldump -u gpss -p gpss > /opt/gpss/backup/gpss.sql
```
