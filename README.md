# 🧬 Biology Symbol Conversion Agent (BSCA)

[![Live Demo](https://img.shields.io/badge/demo-live-green?style=flat-square)](https://your-username.github.io/biology-symbol-agent/)
[![Backend](https://img.shields.io/badge/backend-render-blue?style=flat-square)](https://render.com)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

> **[🚀 Live Demo](https://your-username.github.io/biology-symbol-agent/)** — 立即体验！

通过大模型识别基因符号（Gene Symbol）的别名（Aliases），在基因列表中智能匹配，解决因命名不一致导致的搜索失败问题。

## ✨ 功能特性

- 🔍 **智能基因搜索** — 输入任意基因别名，自动匹配官方 Symbol
- 🧬 **基因组上下文可视化** — 显示基因在染色体上的位置和邻居基因
- 🔗 **功能关联推荐** — 基于 PPI/通路数据推荐相关基因
- 📊 **多数据集覆盖率分析** — 检测基因在不同数据集中的覆盖情况
- 📁 **批量基因上传** — 支持 CSV/TSV/TXT 文件批量处理
- 📤 **别名批量生成** — 一键生成基因别名 CSV

## 架构概览

```
用户输入 Gene Symbol
        │
        ▼
┌─────────────┐
│  React 前端  │  输入框 + 结果展示 + 可视化
└──────┬──────┘
       │ POST /api/search
       ▼
┌─────────────┐
│  Flask      │
│  后端服务    │
└──┬──────┬───┘
   │      │
   ▼      ▼
┌─────┐ ┌──────────┐
│LLM  │ │ 基因列表  │
│API  │ │ (CSV)    │
└──┬──┘ └────┬─────┘
   │         │
   ▼         │
 Aliases ────┘
   │
   ▼
 匹配结果返回前端
```

## 项目结构

```
biology-symbol-agent/
├── .github/workflows/
│   └── deploy.yml           # GitHub Actions 自动部署
├── backend/
│   ├── main.py              # Flask 入口
│   ├── requirements.txt     # Python 依赖
│   ├── .env.example         # 环境变量模板
│   ├── render.yaml          # Render 部署配置
│   ├── data/                # 数据集文件
│   ├── routers/
│   │   └── search.py        # API 路由
│   └── services/
│       ├── llm_service.py   # LLM 调用服务
│       └── ...
└── frontend/
    ├── package.json
    ├── vite.config.js
    └── src/
        ├── App.jsx
        └── App.css
```

## 🚀 部署指南

### 方式一：使用 GitHub Pages + Render（推荐）

#### 1. Fork 本仓库

#### 2. 部署后端到 Render

1. 登录 [Render](https://render.com)
2. 点击 **New** → **Blueprint**
3. 连接你的 GitHub 仓库
4. Render 会自动检测 `render.yaml` 并创建服务
5. 在 Render Dashboard 设置环境变量：
   - `ARK_API_KEY` — 你的火山引擎 API Key
   - `ARK_MODEL_ID` — 模型接入点 ID（可选，默认 glm-4）
6. 部署完成后获得后端 URL，如 `https://bsca-backend.onrender.com`

#### 3. 配置前端

1. 在 GitHub 仓库设置中，进入 **Settings** → **Secrets and variables** → **Actions**
2. 添加 Repository secret：
   - `API_BASE_URL` = 你的 Render 后端 URL（如 `https://bsca-backend.onrender.com/api`）
3. 进入 **Settings** → **Pages**
4. Source 选择 **GitHub Actions**

#### 4. 触发部署

推送代码到 `main` 分支，或手动触发 GitHub Actions workflow。

### 方式二：本地开发

#### 后端启动

```bash
cd backend

# 创建虚拟环境（推荐）
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 安装依赖
pip install -r requirements.txt

# 配置环境变量
cp .env.example .env
# 编辑 .env，填入你的 ARK_API_KEY

# 启动后端服务
python main.py
```

后端启动后可访问：
- API 文档：http://localhost:8000/docs
- 健康检查：http://localhost:8000/health

#### 前端启动

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

前端启动后访问：http://localhost:3000

## 🔑 获取 API Key

1. 注册 [火山引擎](https://www.volcengine.com/) 账号
2. 进入 [API Key 管理](https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey) 页面
3. 点击「创建 API Key」
4. 将 API Key 填入后端 `.env` 文件的 `ARK_API_KEY` 字段
5. 在 [开通管理](https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement) 页面开通对应模型

## 📚 API 接口

### POST /api/search

搜索基因符号，返回别名和匹配结果。

**请求体：**
```json
{
  "gene_symbol": "P53"
}
```

**响应：**
```json
{
  "query": "P53",
  "aliases": ["TP53", "P53", "tumor protein p53"],
  "matches": [...],
  "total_matches": 1
}
```

### POST /api/upload-genes

上传基因列表文件（CSV/TSV/TXT）。

### GET /api/download-aliases

下载生成的别名 CSV。

## 🛠 技术栈

- **前端**: React 18 + Vite + CSS
- **后端**: Python + Flask + Gunicorn
- **LLM**: 豆包大模型 / GLM-4（火山引擎 Ark API）
- **部署**: GitHub Pages + Render

## 📄 License

MIT License
