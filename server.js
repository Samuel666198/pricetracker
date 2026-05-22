const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

let routes, scheduler, db;

let resourceMonitorInterval = null;
let isResourceLimited = false;

function startResourceMonitor() {
    if (resourceMonitorInterval) {
        clearInterval(resourceMonitorInterval);
    }
    
    resourceMonitorInterval = setInterval(() => {
        try {
            const settings = db.getSettings();
            const memoryUsage = process.memoryUsage();
            const memoryRSSMB = Math.round(memoryUsage.rss / 1024 / 1024 * 100) / 100;
            
            if (settings.memory_limit_mb > 0 && memoryRSSMB > settings.memory_limit_mb) {
                console.warn(`[资源限制] 内存使用超过限制: ${memoryRSSMB}MB > ${settings.memory_limit_mb}MB`);
                if (global.gc) {
                    console.log('[资源限制] 尝试运行垃圾回收...');
                    global.gc();
                }
            }
            
        } catch (error) {
            console.error('[资源监控] 错误:', error.message);
        }
    }, 5000);
}

function stopResourceMonitor() {
    if (resourceMonitorInterval) {
        clearInterval(resourceMonitorInterval);
        resourceMonitorInterval = null;
    }
}

function getResourceLimits() {
    if (!db) return null;
    const settings = db.getSettings();
    return {
        memoryLimitMB: settings.memory_limit_mb || 0,
        cpuLimitPercent: settings.cpu_limit_percent || 0
    };
}

async function startServer() {
    db = require('./database');
    await db.initDatabase();
    
    routes = require('./routes');
    app.use('/', routes);
    
    scheduler = require('./scheduler');
    
    function logRequest(req, res, next) {
        const start = Date.now();
        res.on('finish', () => {
            const duration = Date.now() - start;
            console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
        });
        next();
    }
    
    app.use(logRequest);
    
    app.use((err, req, res, next) => {
        console.error('[错误]', err);
        res.status(500).json({
            success: false,
            error: '服务器内部错误'
        });
    });
    
    app.listen(PORT, () => {
        console.log('========================================');
        console.log('  商品价格追踪系统已启动');
        console.log(`  访问地址: http://localhost:${PORT}`);
        console.log('========================================');
        
        scheduler.start();
        startResourceMonitor();
    });
}

process.on('SIGINT', () => {
    console.log('\n正在关闭服务器...');
    if (scheduler) scheduler.stop();
    stopResourceMonitor();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n正在关闭服务器...');
    if (scheduler) scheduler.stop();
    stopResourceMonitor();
    process.exit(0);
});

startServer().catch(err => {
    console.error('启动服务器失败:', err);
    process.exit(1);
});

module.exports = {
    getResourceLimits
};
