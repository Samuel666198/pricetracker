# 商品价格追踪系统

一个功能完整的商品价格追踪和分析系统，支持多种电商平台，集成了本地 AI 分析功能。

## 功能特性

- 🛒 **商品管理** - 添加、编辑、删除商品，支持分类管理
- 🔄 **价格监控** - 定期刷新商品价格，智能模式节省资源
- 📊 **数据可视化** - 价格历史图表，趋势分析
- 🤖 **AI 分析** - 集成 Ollama 本地 AI，提供购买建议和预警
- 📈 **报告管理** - 保存和管理分析报告
- 📉 **Token 使用追踪** - 显示 AI Token 消耗统计
- ⚙️ **系统设置** - 丰富的配置选项

## 技术栈

- **后端** - Node.js + Express
- **前端** - 原生 HTML/CSS/JavaScript
- **数据库** - SQLite
- **AI 引擎** - Ollama 本地部署
- **图表库** - Chart.js

## 快速开始

### 前置要求

- Node.js (v14+)
- Ollama (可选，用于 AI 功能)

### 安装和运行

```bash
# 安装依赖
npm install

# 启动服务器
npm start
# 或使用 Windows 批处理
simple-start.bat
```

然后访问 http://localhost:3000

## 项目结构

```
price/
├── public/           # 前端文件
│   └── index.html
├── crawler*.js       # 爬虫相关模块
├── database.js       # 数据库操作
├── routes.js         # API 路由
├── scheduler.js      # 定时任务
├── server.js         # 服务器入口
└── data/             # 数据存储目录
```

## AI 设置

在设置页面配置 Ollama：
1. 启用 AI 分析功能
2. 配置 Ollama 服务地址（默认 http://localhost:11434）
3. 选择 AI 模型（如 llama3.2）
4. 设置每日 Token 使用限制

## 许可证

MIT License
