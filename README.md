# 视觉传达设计学院 · 毕业设计管理系统

山东工艺美术学院视觉传达设计学院毕业设计管理系统（GPSS）

## 系统架构

```
┌─────────────────┐         ┌─────────────────┐
│   Frontend      │  API    │   Backend       │
│  (Vue 3 + Vite) │ ──────> │ (Express + TS)  │
│  :5173          │         │  :3001           │
└─────────────────┘         └────────┬────────┘
                                    │
                             ┌──────▼──────┐
                             │   MySQL 8.0   │
                             │   gpss_db     │
                             └───────────────┘
```

## 功能模块

| 角色 | 功能 |
|------|------|
| **管理员** | 周期管理、用户管理、数据统计、调整审批 |
| **教师** | 课题发布/编辑、选题审核、结果查看 |
| **学生** | 课题浏览、选课申请、档案管理、调整申请 |

## 快速开始

### 前置条件

- Node.js >= 18
- MySQL >= 8.0
- npm 或 pnpm

### 1. 安装依赖

```bash
# 前端 + 后端依赖（按 lockfile 安装）
npm ci
cd server && npm ci && cd ..
```

### 2. 配置数据库

编辑 `server/.env`，修改数据库配置：

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=你的MySQL密码
DB_NAME=gpss_verify_20260823
HOST=127.0.0.1
FRONTEND_URL=http://127.0.0.1:3001
```

### 3. 初始化数据库

```bash
cd server
npm run db:init   # 创建数据库和表结构
npm run db:seed   # 导入种子数据（含演示账号）
cd ..
```

### 4. 本机生产式启动

首次部署前，启动现有 MySQL、初始化隔离测试库、导入一次演示数据并构建：

```bash
brew services run mysql
cd server && npm run db:init && npm run db:seed && cd ..
npm run build:all
```

之后使用一键启动脚本：
```bash
./start.sh
```

系统仅监听本机地址：`http://127.0.0.1:3001`。按 `Ctrl+C` 停止应用服务；MySQL 保持运行。更新代码后，先重新执行 `npm run build:all`。

**开发模式（可选）**

终端1 - 后端：
```bash
cd server && npm run dev
# 运行在 http://localhost:3001
```

终端2 - 前端：
```bash
npm run dev
# 运行在 http://localhost:5173
```

## 演示账号

| 角色 | 用户名 | 密码 |
|------|--------|------|
| 管理员 | `admin` | `123456` |
| 教师（陈教授） | `chen` | `123456` |
| 教师（林副教授） | `lin` | `123456` |
| 学生（张艺） | `zhangyi` | `123456` |

## 项目结构

```
.
├── client/                  # 前端项目 (Vue 3)
│   ├── src/
│   │   ├── api/             # API 封装层
│   │   ├── stores/          # Pinia 数据状态管理
│   │   ├── views/           # 页面组件
│   │   ├── types/           # TypeScript 类型定义
│   │   ├── data/            # 模拟数据（已迁移到后端）
│   │   └── styles/          # 全局样式
│   └── vite.config.ts       # Vite 配置（含代理）
│
├── server/                  # 后端项目 (Express)
│   ├── src/
│   │   ├── config/          # 数据库配置
│   │   ├── middleware/      # 中间件（JWT 认证）
│   │   ├── routes/          # API 路由
│   │   │   ├── auth.ts      # 登录认证
│   │   │   ├── users.ts     # 用户信息
│   │   │   ├── topics.ts    # 课题 CRUD
│   │   │   ├── applications.ts  # 申请/调整
│   │   │   ├── cycles.ts    # 周期管理
│   │   │   ├── statistics.ts    # 统计分析
│   │   │   └── students.ts  # 学生档案
│   │   ├── utils/           # 工具函数
│   │   ├── scripts/         # 数据库脚本
│   │   │   ├── initDb.ts    # 建表
│   │   │   └── seed.ts      # 种子数据
│   │   └── index.ts         # 入口文件
│   └── .env                 # 环境变量
│
├── start.sh                 # 一键启动脚本
├── .gitignore
└── README.md
```

## API 接口列表

### 认证
- `POST /api/auth/login` - 登录
- `GET /api/auth/me` - 当前登录用户

### 用户
- `GET /api/users/me` - 用户详情
- `PUT /api/users/password` - 修改密码

### 课题
- `GET /api/topics` - 课题列表（学生浏览）
- `GET /api/topics/:id` - 课题详情
- `POST /api/topics` - 教师创建课题
- `PUT /api/topics/:id` - 编辑课题
- `DELETE /api/topics/:id` - 删除课题
- `GET /api/topics/teacher/mine` - 我的课题

### 申请
- `POST /api/applications` - 提交选课申请
- `GET /api/applications` - 申请列表
- `PUT /api/applications/:id` - 教师审批
- `DELETE /api/applications/:id` - 撤销申请
- `POST /api/applications/adjustments` - 提交调整

### 统计
- `GET /api/statistics/overview` - 概览统计
- `GET /api/statistics/topics` - 课题统计

### 其他
- `GET /api/cycles` - 周期列表
- `GET /api/cycles/active` - 当前期期
- `GET /api/students/profile` - 学生档案

## 部署指南

### 生产环境部署

1. **构建前端**
```bash
npm run build
# 产物在 dist/ 目录
```

2. **构建后端**
```bash
cd server && npm run build
# 产物在 dist/ 目录
```

3. **Nginx 配置示例**
```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 前端静态文件
    location / {
        root /path/to/dist;
        try_files $uri $uri/ /index.html;
    }

    # API 反向代理
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

4. 使用 PM2 管理 Node 进程
```bash
npm install -g pm2
pm2 start dist/index.js --name gpss-api
pm2 save
pm2 startup
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | Vue 3 + TypeScript |
| UI 组件库 | Element Plus |
| 状态管理 | Pinia |
| 构建工具 | Vite 5 |
| HTTP 客户端 | Axios |
| 后端框架 | Express + TypeScript |
| 数据库 | MySQL 8.0 |
| ORM | mysql2 (原生查询) |
| 认证 | JWT (jsonwebtoken) |
| 密码加密 | bcryptjs |

## License

MIT
