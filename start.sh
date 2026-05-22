#!/bin/bash
echo "========================================"
echo "      商品价格追踪系统 - 一键启动"
echo "========================================"
echo ""

if [ ! -d "node_modules" ]; then
    echo "[初始化] 检测到首次运行，正在安装依赖..."
    echo ""
    npm install
    if [ $? -ne 0 ]; then
        echo ""
        echo "[错误] 依赖安装失败，请检查网络连接"
        exit 1
    fi
    echo ""
    echo "[成功] 依赖安装完成"
    echo ""
fi

echo "[启动] 正在启动服务器..."
echo ""
echo "访问地址: http://localhost:3000"
echo ""
echo "按 Ctrl+C 停止服务"
echo ""

node server.js