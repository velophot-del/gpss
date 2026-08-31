# 原生 Linux 部署

适用于不允许Docker的校内服务器，支持Ubuntu/Debian和Alibaba Cloud Linux/CentOS系。

## 前提

- Node.js 24、npm
- MySQL 8.0以上
- Nginx、systemd、curl、openssl
- 服务器可访问npm软件源

运行预检：

```bash
./native/preflight.sh
```

## 准备数据库

使用MySQL管理员执行，密码替换为随机强密码：

```sql
CREATE DATABASE gpss CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'gpss'@'127.0.0.1' IDENTIFIED BY '随机强密码';
GRANT ALL PRIVILEGES ON gpss.* TO 'gpss'@'127.0.0.1';
FLUSH PRIVILEGES;
```

## 安装

```bash
sudo DB_HOST=127.0.0.1 DB_NAME=gpss DB_USER=gpss ./native/install.sh
```

脚本会询问访问地址、数据库密码，安装到：

- 程序：`/opt/gpss`
- 环境配置：`/etc/gpss/gpss.env`
- 上传文件：`/var/lib/gpss/uploads`
- systemd服务：`gpss.service`

## 检查

```bash
systemctl status gpss
journalctl -u gpss -f
nginx -t
curl http://127.0.0.1:3011/api/health
```

应用只监听 `127.0.0.1:3011`，外部访问由Nginx提供。若服务器已有默认站点或其他80端口业务，应由管理员调整Nginx虚拟主机，安装脚本不会删除已有配置。
