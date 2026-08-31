# GPSS 校内与阿里云部署包

版本：V1.2

本包默认使用 Docker Compose 部署，兼容 `linux/amd64` 与 `linux/arm64`。首次部署需要访问 Docker Hub；包内不含测试数据库、演示账号、本机密钥和测试附件。

## Docker 快速开始

```bash
tar -xzf GPSS_20260823_V1.2_linux_multiarch.tar.gz
cd GPSS_20260823_V1.2_linux_multiarch
./deploy.sh install
```

安装完成后，终端会显示访问地址和一次性的管理员初始密码。首次登录后立即修改密码。

常用命令：

```bash
./deploy.sh status
./deploy.sh logs
./deploy.sh doctor
./deploy.sh backup
./deploy.sh restart
./deploy.sh down
```

`down` 只停止容器，不删除数据库和上传文件。详细说明见 `docs/`。

## 原生 Linux

服务器不能使用 Docker 时，先阅读 `docs/原生Linux部署.md`，完成 Node.js、MySQL 和 Nginx 准备后运行：

```bash
sudo ./native/install.sh
```

## 文件完整性

```bash
sha256sum -c MANIFEST.sha256
```
