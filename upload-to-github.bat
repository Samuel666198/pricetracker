@echo off
echo ========================================
echo   商品价格追踪系统 - GitHub 上传脚本
echo ========================================
echo.

REM 检查当前目录
echo [1/5] 检查当前目录...
cd /d "%~dp0"
echo 目录: %CD%
echo.

REM 初始化 Git
echo [2/5] 初始化 Git 仓库...
git init
if %errorlevel% neq 0 (
    echo 错误: Git 初始化失败！
    pause
    exit /b 1
)
echo 成功初始化 Git 仓库
echo.

REM 添加文件
echo [3/5] 添加文件到 Git...
git add .
git commit -m "Initial commit: 商品价格追踪系统"
if %errorlevel% neq 0 (
    echo 警告: 可能已经提交过，继续...
)
echo.

REM 创建