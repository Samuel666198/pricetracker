const express = require('express');
const router = express.Router();
const db = require('./database');
const crawler = require('./crawler_browser');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const REPORTS_DIR = path.join(__dirname, 'data', 'reports');
if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

router.get('/api/system/resource-usage', (req, res) => {
    try {
        const memoryUsage = process.memoryUsage();
        const settings = db.getSettings();
        
        const rssMB = Math.round(memoryUsage.rss / 1024 / 1024 * 100) / 100;
        const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024 * 100) / 100;
        const heapTotalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024 * 100) / 100;
        const externalMB = Math.round(memoryUsage.external / 1024 / 1024 * 100) / 100;
        
        const cpuUsage = process.cpuUsage();
        const cpuPercent = cpuUsage.user / 1000000 / (process.uptime() || 1);
        
        res.json({
            success: true,
            data: {
                memory: {
                    rss: rssMB,
                    heapUsed: heapUsedMB,
                    heapTotal: heapTotalMB,
                    external: externalMB
                },
                cpu: {
                    user: Math.round(cpuUsage.user / 1000000 * 100) / 100,
                    system: Math.round(cpuUsage.system / 1000000 * 100) / 100
                },
                limits: {
                    memoryLimitMB: settings.memory_limit_mb || 0,
                    cpuLimitPercent: settings.cpu_limit_percent || 0
                },
                uptime: process.uptime(),
                pid: process.pid
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.get('/api/products', (req, res) => {
    try {
        const products = db.getAllProducts();
        res.json({
            success: true,
            data: products
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.get('/api/products/category/:categoryId?', (req, res) => {
    try {
        const categoryId = req.params.categoryId === 'null' ? null : parseInt(req.params.categoryId) || null;
        const products = db.getProductsByCategory(categoryId);
        res.json({
            success: true,
            data: products
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.get('/api/products/:id', (req, res) => {
    try {
        const product = db.getProductById(req.params.id);
        if (!product) {
            return res.status(404).json({
                success: false,
                error: '商品不存在'
            });
        }
        res.json({
            success: true,
            data: product
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.post('/api/products', async (req, res) => {
    try {
        const { url, monitor_interval, target_price, title: manualTitle, category_id, smart_mode } = req.body;
        
        if (!url) {
            return res.status(400).json({
                success: false,
                error: '请提供商品链接'
            });
        }

        const normalizedUrl = url.startsWith('http') ? url : 'https://' + url;
        
        const existingProduct = db.getProductByUrl(normalizedUrl);
        if (existingProduct) {
            return res.status(409).json({
                success: false,
                error: '该商品链接已在监控列表中'
            });
        }

        const settings = db.getSettings();
        const result = await crawler.crawl(url, { headless: settings.headless_mode });
        
        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: `抓取失败: ${result.error}`
            });
        }
        
        let productData = {
            url: normalizedUrl,
            title: manualTitle || '未获取到标题',
            image: '',
            original_price: 0,
            current_price: 0,
            lowest_price: 0,
            highest_price: 0,
            target_price: target_price || null,
            monitor_interval: monitor_interval || 3600000,
            category_id: category_id || null,
            smart_mode: smart_mode !== undefined ? smart_mode : 1
        };
        
        if (result.data.title && result.data.title !== 'Unknown Product') {
            productData.title = result.data.title;
        }
        if (result.data.image) {
            productData.image = result.data.image;
        }
        if (result.data.current_price > 0) {
            productData.current_price = result.data.current_price;
            productData.lowest_price = result.data.current_price;
            productData.highest_price = result.data.current_price;
            productData.original_price = result.data.original_price || result.data.current_price;
        }
        
        if (manualTitle && productData.title === '未获取到标题') {
            productData.title = manualTitle;
        }

        const productId = db.addProduct(productData);
        
        console.log(`[添加商品] 商品已创建 - ID: ${productId}, 价格: ${productData.current_price}, 智能模式: ${productData.smart_mode}`);
        
        if (productId) {
            console.log(`[添加商品] 开始记录初始价格历史 - ID: ${productId}, 价格: ${productData.current_price}`);
            
            if (productData.current_price > 0) {
                try {
                    const recordResult = db.addPriceRecord(productId, productData.current_price);
                    console.log(`[添加商品] 初始价格记录结果: ${recordResult}`);
                    
                    if (!recordResult) {
                        console.log(`[添加商品] 警告：价格历史记录失败，需要检查智能模式设置`);
                    } else {
                        console.log(`[添加商品] 价格历史记录成功`);
                        
                        const history = db.getPriceHistory(productId, 5);
                        console.log(`[添加商品] 验证：最近5条价格记录数量: ${history.length}`);
                    }
                } catch (error) {
                    console.error(`[添加商品] 记录价格历史时发生错误:`, error);
                }
            } else {
                console.log(`[添加商品] 跳过价格记录：价格为 0`);
            }
        } else {
            console.error(`[添加商品] 错误：无法获取商品ID`);
        }

        const product = db.getProductById(productId);
        
        const message = productData.current_price > 0 
            ? '商品已添加到监控列表' 
            : '商品已添加（价格需手动刷新获取）';
        
        res.json({
            success: true,
            data: product,
            message: message,
            warning: productData.current_price === 0 ? '无法自动抓取价格，请稍后手动刷新' : null
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.put('/api/products/:id', (req, res) => {
    try {
        const { title, price, monitor_interval, target_price, category_id, smart_mode } = req.body;
        const updates = {};
        
        if (title !== undefined) {
            updates.title = title || null;
        }
        
        if (monitor_interval !== undefined) {
            updates.monitor_interval = monitor_interval;
        }
        
        if (target_price !== undefined) {
            updates.target_price = target_price || null;
        }
        
        if (category_id !== undefined) {
            updates.category_id = category_id;
        }
        
        if (smart_mode !== undefined) {
            updates.smart_mode = smart_mode;
        }

        if (price !== undefined && price !== null) {
            const product = db.getProductById(req.params.id);
            if (product) {
                updates.current_price = price;
                
                if (product.lowest_price === null || price < product.lowest_price) {
                    updates.lowest_price = price;
                }
                if (product.highest_price === null || price > product.highest_price) {
                    updates.highest_price = price;
                }
                
                const dateStr = new Date().toISOString().split('T')[0];
                db.addPriceHistory(req.params.id, price, dateStr);
            }
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({
                success: false,
                error: '没有提供要更新的字段'
            });
        }

        db.updateProduct(req.params.id, updates);
        const product = db.getProductById(req.params.id);
        
        res.json({
            success: true,
            data: product,
            message: '商品信息已更新'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.delete('/api/products/:id', (req, res) => {
    try {
        const product = db.getProductById(req.params.id);
        if (!product) {
            return res.status(404).json({
                success: false,
                error: '商品不存在'
            });
        }

        db.deleteProduct(req.params.id);
        
        res.json({
            success: true,
            message: '商品已删除'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.post('/api/products/:id/refresh', async (req, res) => {
    try {
        const product = db.getProductById(req.params.id);
        if (!product) {
            return res.status(404).json({
                success: false,
                error: '商品不存在'
            });
        }

        const settings = db.getSettings();
        const result = await crawler.crawl(product.url, { headless: settings.headless_mode });
        
        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: `抓取失败: ${result.error}`
            });
        }

        if (!result.data) {
            return res.status(500).json({
                success: false,
                error: '无法获取商品信息'
            });
        }
        
        const newPrice = result.data.current_price;
        
        console.log(`[刷新API] 商品ID: ${req.params.id}, 爬取到的价格: ${newPrice}, 当前价格: ${product.current_price}`);
        
        let alert = null;
        let priceValid = true;
        let priceSkipped = false;
        
        if (newPrice > 0 && product.current_price > 0) {
            const threshold = settings.price_threshold || 100;
            console.log(`[刷新API] 开始价格验证 - 阈值: ${threshold}%`);
            const validation = db.validatePrice(req.params.id, newPrice, threshold);
            
            if (!validation.valid) {
                priceValid = false;
                priceSkipped = true;
                alert = {
                    type: 'price_validation',
                    message: `价格异常: ${validation.reason}，已跳过记录`
                };
                console.log(`[刷新API] ${validation.reason}`);
            }
        }
        
        if (priceValid && newPrice > 0) {
            console.log(`[刷新API] 价格有效，正在更新商品和记录价格`);
            
            // 只有当爬虫提取到有效的标题且不是默认值时才更新
            if (result.data.title && 
                result.data.title !== 'Unknown Product' && 
                result.data.title !== '未知商品' &&
                result.data.title.trim().length > 2) {
                console.log(`[刷新API] 更新标题: ${result.data.title}`);
                db.updateProduct(req.params.id, {
                    title: result.data.title
                });
            }
            
            db.updateProductPrice(req.params.id, newPrice);
            const recordResult = db.addPriceRecord(req.params.id, newPrice);
            
            console.log(`[刷新API] 价格记录结果: ${recordResult}`);

            const updatedProduct = db.getProductById(req.params.id);
            
            if (updatedProduct.target_price && newPrice <= updatedProduct.target_price) {
                alert = {
                    type: 'target_price',
                    message: `价格已跌破目标价！当前价格 ¥${newPrice} <= 目标价 ¥${updatedProduct.target_price}`
                };
            } else if (newPrice < updatedProduct.lowest_price) {
                alert = {
                    type: 'lowest_price',
                    message: `发现新历史最低价！当前价格 ¥${newPrice}`
                };
            }

            res.json({
                success: true,
                data: updatedProduct,
                alert: alert,
                priceSkipped: priceSkipped,
                message: priceSkipped ? '价格异常已跳过' : '价格已刷新'
            });
        } else {
            const message = priceSkipped 
                ? '价格异常，已跳过记录' 
                : (newPrice <= 0 ? '未获取到有效价格' : '价格刷新异常');
            
            console.log(`[刷新API] 未记录价格 - 原因: ${message}`);
            
            res.json({
                success: true,
                data: product,
                alert: alert,
                priceSkipped: priceSkipped,
                message: message
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.get('/api/products/:id/history', (req, res) => {
    try {
        const product = db.getProductById(req.params.id);
        if (!product) {
            return res.status(404).json({
                success: false,
                error: '商品不存在'
            });
        }

        const limit = parseInt(req.query.limit) || 100;
        const history = db.getPriceHistory(req.params.id, limit);
        
        res.json({
            success: true,
            data: history
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.get('/api/products/:id/chart', (req, res) => {
    try {
        const product = db.getProductById(req.params.id);
        if (!product) {
            return res.status(404).json({
                success: false,
                error: '商品不存在'
            });
        }

        const daysParam = req.query.days;
        let history;
        
        if (daysParam === 'all') {
            history = db.getPriceHistory(req.params.id, 10000);
        } else if (daysParam === 'today') {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            history = db.getPriceHistory(req.params.id, 1000);
            history = history.filter(h => {
                const recordDate = new Date(h.recorded_at);
                return recordDate >= today;
            });
        } else {
            const days = parseInt(daysParam) || 30;
            history = db.getRecentPriceHistory(req.params.id, days);
        }
        
        const stats = null;
        
        res.json({
            success: true,
            data: {
                history: history,
                stats: stats,
                product: {
                    title: product.title,
                    current_price: product.current_price,
                    lowest_price: product.lowest_price,
                    highest_price: product.highest_price,
                    target_price: product.target_price
                }
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.delete('/api/products/:id/history', (req, res) => {
    try {
        const product = db.getProductById(req.params.id);
        if (!product) {
            return res.status(404).json({
                success: false,
                error: '商品不存在'
            });
        }

        db.clearPriceHistory(req.params.id);
        
        res.json({
            success: true,
            message: '价格历史已清空'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.delete('/api/products/:productId/history/:historyId', (req, res) => {
    try {
        const { productId, historyId } = req.params;
        const product = db.getProductById(productId);
        if (!product) {
            return res.status(404).json({
                success: false,
                error: '商品不存在'
            });
        }

        const history = db.getPriceHistoryById(historyId);
        if (!history) {
            return res.status(404).json({
                success: false,
                error: '价格记录不存在'
            });
        }

        const wasMin = history.price === product.lowest_price;
        const wasMax = history.price === product.highest_price;

        db.deletePriceHistory(historyId);
        
        if (wasMin || wasMax) {
            db.recalculateMinMaxPrice(productId);
        }
        
        res.json({
            success: true,
            message: '价格记录已删除'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.put('/api/products/:productId/history/:historyId', (req, res) => {
    try {
        const { productId, historyId } = req.params;
        const { price } = req.body;
        
        const product = db.getProductById(productId);
        if (!product) {
            return res.status(404).json({
                success: false,
                error: '商品不存在'
            });
        }

        if (price === undefined || price === null) {
            return res.status(400).json({
                success: false,
                error: '请提供价格'
            });
        }

        db.updatePriceHistory(historyId, price);
        
        res.json({
            success: true,
            message: '价格记录已更新'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.post('/api/products/:id/toggle', (req, res) => {
    try {
        const product = db.getProductById(req.params.id);
        if (!product) {
            return res.status(404).json({
                success: false,
                error: '商品不存在'
            });
        }

        db.toggleProductActive(req.params.id);
        const updatedProduct = db.getProductById(req.params.id);
        
        res.json({
            success: true,
            data: updatedProduct,
            message: updatedProduct.is_active ? '监控已恢复' : '监控已暂停'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.get('/api/products/:id/export', (req, res) => {
    try {
        const product = db.getProductById(req.params.id);
        if (!product) {
            return res.status(404).json({
                success: false,
                error: '商品不存在'
            });
        }

        const history = db.getPriceHistory(req.params.id, 10000);
        
        let csv = 'ID,价格,记录时间\n';
        history.reverse().forEach(record => {
            csv += `${record.id},${record.price},${record.recorded_at}\n`;
        });

        const filename = `price_history_${product.id}_${Date.now()}.csv`;
        const filepath = path.join(__dirname, 'data', filename);
        
        fs.writeFileSync(filepath, csv, 'utf8');
        
        res.download(filepath, filename, (err) => {
            if (err) {
                console.error('Download error:', err);
            }
            setTimeout(() => {
                if (fs.existsSync(filepath)) {
                    fs.unlinkSync(filepath);
                }
            }, 5000);
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.get('/api/stats', (req, res) => {
    try {
        const products = db.getAllProducts();
        
        let totalProducts = products.length;
        let activeProducts = products.filter(p => p.is_active).length;
        let lowestPriceProducts = products.filter(p => 
            p.current_price && p.current_price <= p.lowest_price
        ).length;
        
        res.json({
            success: true,
            data: {
                total: totalProducts,
                active: activeProducts,
                paused: totalProducts - activeProducts,
                atLowest: lowestPriceProducts
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.get('/api/categories', (req, res) => {
    try {
        const categories = db.getAllCategories();
        res.json({
            success: true,
            data: categories
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.post('/api/categories', (req, res) => {
    try {
        const { name, color } = req.body;
        if (!name) {
            return res.status(400).json({
                success: false,
                error: '请提供分类名称'
            });
        }
        const categoryId = db.addCategory(name, color || '#667eea');
        const category = db.getCategoryById(categoryId);
        res.json({
            success: true,
            data: category,
            message: '分类已创建'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.put('/api/categories/:id', (req, res) => {
    try {
        const { name, color, sort_order } = req.body;
        const updates = {};
        if (name !== undefined) updates.name = name;
        if (color !== undefined) updates.color = color;
        if (sort_order !== undefined) updates.sort_order = sort_order;
        
        if (Object.keys(updates).length === 0) {
            return res.status(400).json({
                success: false,
                error: '没有提供要更新的字段'
            });
        }
        
        db.updateCategory(req.params.id, updates);
        const category = db.getCategoryById(req.params.id);
        
        res.json({
            success: true,
            data: category,
            message: '分类已更新'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.delete('/api/categories/:id', (req, res) => {
    try {
        db.deleteCategory(req.params.id);
        res.json({
            success: true,
            message: '分类已删除'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.get('/api/settings', (req, res) => {
    try {
        const settings = db.getSettings();
        res.json({
            success: true,
            data: settings
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.put('/api/settings', (req, res) => {
    try {
        const updates = req.body;
        db.updateSettings(updates);
        res.json({
            success: true,
            message: '设置已保存'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

let previousCpuUsage = process.cpuUsage();
let previousCpuTime = Date.now();
let previousCpuTimes = null;

let resourceWarningShown = {
    memory: false,
    cpu: false
};

router.get('/api/system-stats', (req, res) => {
    try {
        const pid = process.pid;
        const memoryUsage = process.memoryUsage();
        const currentCpuUsage = process.cpuUsage(previousCpuUsage);
        const currentTime = Date.now();
        const timeDelta = currentTime - previousCpuTime;
        
        const memoryRSSMB = Math.round(memoryUsage.rss / 1024 / 1024 * 100) / 100;
        const totalMemoryMB = Math.round(os.totalmem() / 1024 / 1024 * 100) / 100;
        const usedMemoryMB = Math.round((os.totalmem() - os.freemem()) / 1024 / 1024 * 100) / 100;
        
        const cpus = os.cpus();
        
        let processCpuPercent = 0;
        if (timeDelta > 0) {
            const cpuUsageMs = currentCpuUsage.user + currentCpuUsage.system;
            processCpuPercent = Math.round((cpuUsageMs / 1000 / timeDelta) * 100);
        }
        
        let systemCpuPercent = 0;
        if (previousCpuTimes) {
            let totalDiff = 0;
            let idleDiff = 0;
            cpus.forEach((cpu, i) => {
                const prev = previousCpuTimes[i];
                const prevTotal = prev.user + prev.nice + prev.sys + prev.idle;
                const currTotal = cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle;
                totalDiff += currTotal - prevTotal;
                idleDiff += cpu.times.idle - prev.idle;
            });
            if (totalDiff > 0) {
                systemCpuPercent = Math.round(((totalDiff - idleDiff) / totalDiff) * 100);
            }
        }
        previousCpuTimes = cpus.map(cpu => ({ ...cpu.times }));
        
        previousCpuUsage = process.cpuUsage();
        previousCpuTime = currentTime;
        
        const uptimeSeconds = process.uptime();
        const uptimeMinutes = Math.floor(uptimeSeconds / 60);
        const uptimeHours = Math.floor(uptimeMinutes / 60);
        
        const productCount = db.getAllProducts().length;
        const activeCount = db.getAllProducts().filter(p => p.is_active).length;
        
        const settings = db.getSettings();
        
        const memoryExceeded = settings.memory_limit_mb > 0 && memoryRSSMB > settings.memory_limit_mb;
        const cpuExceeded = settings.cpu_limit_percent > 0 && processCpuPercent > settings.cpu_limit_percent;
        
        let warnings = [];
        if (memoryExceeded && !resourceWarningShown.memory) {
            warnings.push(`内存超过限制: ${memoryRSSMB}MB > ${settings.memory_limit_mb}MB`);
            resourceWarningShown.memory = true;
            if (global.gc) {
                global.gc();
            }
        } else if (!memoryExceeded) {
            resourceWarningShown.memory = false;
        }
        
        if (cpuExceeded && !resourceWarningShown.cpu) {
            warnings.push(`CPU超过限制: ${processCpuPercent}% > ${settings.cpu_limit_percent}%`);
            resourceWarningShown.cpu = true;
        } else if (!cpuExceeded) {
            resourceWarningShown.cpu = false;
        }
        
        res.json({
            success: true,
            data: {
                pid: pid,
                memory: {
                    process_used: memoryRSSMB,
                    system_used: usedMemoryMB,
                    system_free: Math.round((os.freemem() / 1024 / 1024 * 100)) / 100,
                    total: totalMemoryMB,
                    percent: Math.round((usedMemoryMB / totalMemoryMB) * 100),
                    limit: settings.memory_limit_mb || 0,
                    exceeded: memoryExceeded
                },
                cpu: {
                    process_percent: Math.min(100, Math.max(0, processCpuPercent)),
                    system_percent: Math.min(100, Math.max(0, systemCpuPercent)),
                    cores: cpus.length,
                    limit: settings.cpu_limit_percent || 0,
                    exceeded: cpuExceeded
                },
                uptime: {
                    seconds: uptimeSeconds,
                    minutes: uptimeMinutes,
                    hours: uptimeHours,
                    formatted: `${uptimeHours}小时${uptimeMinutes % 60}分钟`
                },
                products: {
                    total: productCount,
                    active: activeCount
                },
                warnings: warnings
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.get('/api/export/json', (req, res) => {
    try {
        const data = db.exportAllData();
        res.json({
            success: true,
            data: data
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.get('/api/export/csv', (req, res) => {
    try {
        const csv = db.exportToCSV();
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=products.csv');
        res.send('\ufeff' + csv);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.post('/api/import', (req, res) => {
    try {
        const data = req.body;
        const { overwrite = false, skipExisting = true } = req.query;
        
        const results = db.importData(data, {
            overwrite: overwrite === 'true',
            skipExisting: skipExisting !== 'false'
        });
        
        res.json({
            success: true,
            results: results
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

async function callOllamaStream(prompt, model = 'llama3.2', host = 'http://localhost:11434', onChunk, onThinking, onStats) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({
            model: model,
            prompt: prompt,
            stream: true,
            options: {
                temperature: 0.7
            }
        });
        
        const url = new URL(`${host}/api/generate`);
        let fullText = '';
        let thinkingBuffer = '';
        let inThinking = false;
        let stats = null;
        let isResolved = false;
        let startTime = Date.now();
        
        console.log('[Ollama] Starting call with model:', model);
        
        const req = http.request(
            {
                hostname: url.hostname,
                port: url.port || 11434,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data)
                }
            },
            (res) => {
                res.on('data', (chunk) => {
                    try {
                        const lines = chunk.toString().split('\n').filter(line => line.trim());
                        lines.forEach(line => {
                            try {
                                const parsed = JSON.parse(line);
                                console.log('[Ollama] Received:', { 
                                    done: !!parsed.done, 
                                    has_response: !!parsed.response,
                                    has_eval_count: typeof parsed.eval_count !== 'undefined',
                                    has_prompt_eval_count: typeof parsed.prompt_eval_count !== 'undefined'
                                });
                                
                                if (parsed.response) {
                                    const cleanText = cleanTextContent(parsed.response);
                                    
                                    for (let i = 0; i < cleanText.length; i++) {
                                        const char = cleanText[i];
                                        const twoChar = cleanText.substring(i, i + 8);
                                        const threeChar = cleanText.substring(i, i + 9);
                                        
                                        if (threeChar === '<think>') {
                                            inThinking = true;
                                            thinkingBuffer = '';
                                            i += 8;
                                            continue;
                                        }
                                        
                                        if (twoChar === '</t') {
                                            const nextFour = cleanText.substring(i, i + 5);
                                            if (nextFour === '</t>') {
                                                inThinking = false;
                                                i += 4;
                                                if (onThinking && thinkingBuffer.trim()) {
                                                    onThinking(thinkingBuffer.trim());
                                                }
                                                thinkingBuffer = '';
                                                continue;
                                            }
                                        }
                                        
                                        if (inThinking) {
                                            thinkingBuffer += char;
                                        }
                                    }
                                    
                                    if (!inThinking) {
                                        fullText += cleanText;
                                        if (onChunk) {
                                            onChunk(cleanText);
                                        }
                                    }
                                }
                                if (parsed.done && !isResolved) {
                                    const endTime = Date.now();
                                    const duration = endTime - startTime;
                                    
                                    stats = {
                                        eval_count: parsed.eval_count || parsed.completion_tokens || 0,
                                        prompt_eval_count: parsed.prompt_eval_count || parsed.prompt_tokens || 0,
                                        total_duration: parsed.total_duration || (duration * 1000000),
                                        eval_duration: parsed.eval_duration || 0,
                                        prompt_eval_duration: parsed.prompt_eval_duration || 0
                                    };
                                    
                                    console.log('[Ollama] Done with stats:', stats);
                                    
                                    if (onStats) {
                                        onStats(stats);
                                    }
                                    
                                    isResolved = true;
                                    resolve({ text: fullText, stats: stats });
                                }
                            } catch (e) {
                                console.log('[Ollama] Parse error:', e);
                            }
                        });
                    } catch (e) {
                        console.log('[Ollama] Chunk error:', e);
                    }
                });
                
                res.on('end', () => {
                    if (!isResolved) {
                        const endTime = Date.now();
                        const duration = endTime - startTime;
                        
                        stats = {
                            eval_count: Math.floor(fullText.length / 4),
                            prompt_eval_count: Math.floor(prompt.length / 4),
                            total_duration: duration * 1000000,
                            eval_duration: 0,
                            prompt_eval_duration: 0
                        };
                        
                        console.log('[Ollama] Stream ended, using estimated stats:', stats);
                        
                        if (onStats) {
                            onStats(stats);
                        }
                        
                        isResolved = true;
                        resolve({ text: fullText, stats: stats });
                    }
                });
            }
        );
        
        req.on('error', (error) => {
            if (!isResolved) {
                isResolved = true;
                reject(error);
            }
        });
        
        req.write(data);
        req.end();
    });
}

function cleanTextContent(text) {
    return text
        .replace(/\*\*/g, '')
        .replace(/\*/g, '')
        .replace(/`/g, '')
        .replace(/###/g, '')
        .replace(/-+/g, '\n')
        .replace(/\n\s*\n/g, '\n\n');
}

async function checkOllamaStatus(host = 'http://localhost:11434') {
    return new Promise((resolve) => {
        const url = new URL(`${host}/api/tags`);
        const req = http.request(
            {
                hostname: url.hostname,
                port: url.port || 11434,
                path: url.pathname,
                method: 'GET',
                timeout: 5000
            },
            (res) => {
                resolve(res.statusCode === 200);
            }
        );
        
        req.on('error', () => {
            resolve(false);
        });
        
        req.on('timeout', () => {
            req.destroy();
            resolve(false);
        });
        
        req.end();
    });
}

function saveReport(title, content) {
    const id = Date.now().toString(36) + Math.random().toString(36).substr(2);
    const report = {
        id: id,
        title: title || `分析报告_${new Date().toLocaleString('zh-CN')}`,
        content: content,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    
    const fileName = `${id}.json`;
    const filePath = path.join(REPORTS_DIR, fileName);
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf-8');
    
    return report;
}

function getReports() {
    const files = fs.readdirSync(REPORTS_DIR).filter(f => f.endsWith('.json'));
    const reports = files.map(file => {
        const filePath = path.join(REPORTS_DIR, file);
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(content);
        } catch (e) {
            return null;
        }
    }).filter(r => r !== null);
    
    return reports.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getReport(id) {
    const filePath = path.join(REPORTS_DIR, `${id}.json`);
    if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
    return null;
}

function updateReport(id, updates) {
    const filePath = path.join(REPORTS_DIR, `${id}.json`);
    if (fs.existsSync(filePath)) {
        const report = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        Object.assign(report, updates, { updatedAt: new Date().toISOString() });
        fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf-8');
        return report;
    }
    return null;
}

function deleteReport(id) {
    const filePath = path.join(REPORTS_DIR, `${id}.json`);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return true;
    }
    return false;
}

async function chatWithAI(messages, settings, onChunk, onThinking, onStats) {
    const systemPrompt = `你是一位专业的商品价格分析师。你的主要职责是：
1. 分析商品价格趋势和市场动态
2. 提供购买建议和价格预警
3. 生成详细的分析报告
4. 回答用户关于商品价格的问题

你的回答应该：
- 专业、准确、有条理
- 使用中文回复
- 可以使用Markdown格式来组织内容（标题用#, 列表用-, 加粗用**）
- 保持简洁易懂`;

    let fullText = '';
    let stats = null;
    const prompt = buildPromptFromMessages(messages, settings);
    
    const result = await callOllamaStream(
        prompt,
        settings.ollama_model,
        settings.ollama_host,
        (chunk) => {
            fullText += chunk;
            if (onChunk) {
                onChunk(chunk);
            }
        },
        (thinking) => {
            if (onThinking) {
                onThinking(thinking);
            }
        },
        (tokenStats) => {
            stats = tokenStats;
            if (onStats) {
                onStats(tokenStats);
            }
        }
    );
    
    return { text: fullText, stats: stats };
}

function buildPromptFromMessages(messages, settings) {
    let prompt = '';
    
    const currentTime = new Date().toLocaleString('zh-CN', { 
        timeZone: 'Asia/Hong_Kong',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    
    const systemPrompt = settings.system_prompt || `你是一位专业的商品价格分析师。你的主要职责是：
1. 分析商品价格趋势和市场动态
2. 提供购买建议和价格预警
3. 生成详细的分析报告
4. 回答用户关于商品价格的问题

【当前时间权限】
当前时间是：${currentTime}
你可以使用时间信息来分析价格趋势、判断最佳购买时机等。

你的回答应该：
- 专业、准确、有条理
- 使用中文回复
- 可以使用Markdown格式来组织内容（标题用#, 列表用-, 加粗用**）
- 保持简洁易懂`;
    
    prompt += systemPrompt + '\n\n';
    
    if (settings.enable_local_data !== false) {
        const localData = buildLocalProductsInfo();
        prompt += `【本地商品价格数据】\n你可以分析以下本地商品价格数据：\n${localData}\n\n`;
    }

    for (let msg of messages) {
        if (msg.role === 'user') {
            prompt += `用户：${msg.content}\n\n`;
        } else if (msg.role === 'assistant') {
            prompt += `AI：${msg.content}\n\n`;
        }
    }
    return prompt;
}

function buildLocalProductsInfo() {
    try {
        const products = db.getAllProducts();
        if (!products || products.length === 0) {
            return '暂无商品数据';
        }
        
        let info = '';
        products.forEach((p, index) => {
            const history = db.getPriceHistory(p.id, 30);
            const recentPrices = history.slice(-7).map(h => `${new Date(h.recorded_at).toLocaleDateString()}: ¥${h.price}`).join(', ');
            
            info += `
商品${index + 1}: ${p.title}
- 当前价格: ¥${p.current_price}
- 历史最低: ¥${p.lowest_price}
- 历史最高: ¥${p.highest_price}
- 目标价: ${p.target_price ? '¥' + p.target_price : '未设置'}
- 最近价格: ${recentPrices || '无'}
`;
        });
        
        return info;
    } catch (error) {
        console.error('获取商品信息失败:', error);
        return '获取商品数据失败';
    }
}

const https = require('https');

async function searchWeb(query) {
    return new Promise((resolve) => {
        const url = new URL(`https://www.baidu.com/s?wd=${encodeURIComponent(query)}`);
        
        const options = {
            hostname: url.hostname,
            port: 443,
            path: url.pathname + url.search,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        };
        
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => {
                body += chunk;
            });
            res.on('end', () => {
                try {
                    const results = extractSearchResults(body);
                    resolve(results);
                } catch (error) {
                    resolve('搜索失败');
                }
            });
        });
        
        req.on('error', () => {
            resolve('网络请求失败');
        });
        
        req.setTimeout(10000, () => {
            req.destroy();
            resolve('搜索超时');
        });
        
        req.end();
    });
}

function extractSearchResults(html) {
    const results = [];
    const regex = /<h3[^>]*class="[^"]*t"[^>]*>.*?<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>.*?<\/h3>.*?<span[^>]*class="[^"]*c-abstract"[^>]*>([^<]*)/g;
    let match;
    let count = 0;
    
    while ((match = regex.exec(html)) !== null && count < 5) {
        results.push({
            title: match[2].replace(/<[^>]*>/g, ''),
            url: match[1],
            desc: match[3].replace(/<[^>]*>/g, '').substring(0, 200)
        });
        count++;
    }
    
    return results.length > 0 ? results : '未找到相关结果';
}

function buildFullAnalysisPrompt() {
    const products = db.getAllProducts();
    let productsInfo = '';
    products.forEach((p, index) => {
        const history = db.getPriceHistory(p.id, 30);
        const priceHistory = history.map(h => `${new Date(h.recorded_at).toLocaleDateString()}: ¥${h.price}`).join('\n');
        
        productsInfo += `
商品 ${index + 1}:
- 标题: ${p.title}
- 当前价格: ¥${p.current_price}
- 最低价格: ¥${p.lowest_price}
- 最高价格: ¥${p.highest_price}
- 目标价格: ${p.target_price ? '¥' + p.target_price : '未设置'}
- 价格历史（最近30天）:
${priceHistory || '无历史数据'}
`;
    });

    return `请基于以下商品价格数据，提供一份完整的分析报告：

${productsInfo}

请提供以下分析：
1. 总体市场趋势概述
2. 每个商品的价格波动分析
3. 购买建议（何时购买最划算）
4. 价格预警建议
5. 其他洞察

请用中文回答，格式清晰易读。不要使用Markdown格式，直接用普通文本，换行分隔。`;
}

async function getOllamaModels(host = 'http://localhost:11434') {
    return new Promise((resolve) => {
        const url = new URL(`${host}/api/tags`);
        const req = http.request(
            {
                hostname: url.hostname,
                port: url.port || 11434,
                path: url.pathname,
                method: 'GET',
                timeout: 10000
            },
            (res) => {
                let body = '';
                res.on('data', (chunk) => {
                    body += chunk;
                });
                res.on('end', () => {
                    try {
                        const result = JSON.parse(body);
                        resolve(result.models || []);
                    } catch (e) {
                        resolve([]);
                    }
                });
            }
        );
        
        req.on('error', () => {
            resolve([]);
        });
        
        req.on('timeout', () => {
            req.destroy();
            resolve([]);
        });
        
        req.end();
    });
}

router.get('/api/ai/models', async (req, res) => {
    try {
        const settings = db.getSettings();
        const models = await getOllamaModels(settings.ollama_host);
        
        res.json({
            success: true,
            data: {
                models: models.map(m => ({
                    name: m.name,
                    model: m.name,
                    modified_at: m.modified_at,
                    size: m.size,
                    digest: m.digest
                })),
                host: settings.ollama_host
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.get('/api/ai/status', async (req, res) => {
    try {
        const settings = db.getSettings();
        const isEnabled = settings.ollama_enabled || false;
        let isConnected = false;
        let models = [];
        
        if (isEnabled) {
            isConnected = await checkOllamaStatus(settings.ollama_host);
            if (isConnected) {
                models = await getOllamaModels(settings.ollama_host);
            }
        }
        
        res.json({
            success: true,
            data: {
                enabled: isEnabled,
                connected: isConnected,
                host: settings.ollama_host,
                model: settings.ollama_model,
                available_models: models.map(m => m.name)
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.post('/api/ai/analyze', async (req, res) => {
    try {
        const settings = db.getSettings();
        
        if (!settings.ollama_enabled) {
            return res.status(400).json({
                success: false,
                error: 'AI 功能未启用'
            });
        }
        
        const prompt = buildFullAnalysisPrompt();
        
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        let fullText = '';
        let isFinished = false;
        
        try {
            await callOllamaStream(
                prompt,
                settings.ollama_model,
                settings.ollama_host,
                (chunk) => {
                    if (!isFinished) {
                        fullText += chunk;
                        res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
                    }
                }
            );
            
            const report = saveReport(`分析报告_${new Date().toLocaleString('zh-CN')}`, fullText);
            isFinished = true;
            res.write(`data: ${JSON.stringify({ type: 'done', report: report })}\n\n`);
            res.end();
        } catch (streamError) {
            console.error('流式输出失败:', streamError);
            if (!isFinished) {
                isFinished = true;
                const report = saveReport(`分析报告_${new Date().toLocaleString('zh-CN')}`, fullText || '分析过程中出现错误');
                res.write(`data: ${JSON.stringify({ type: 'done', report: report, error: streamError.message })}\n\n`);
                res.end();
            }
        }
    } catch (error) {
        console.error('AI 分析失败:', error);
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                error: 'AI 分析失败: ' + error.message
            });
        } else {
            res.end();
        }
    }
});

router.post('/api/ai/chat', async (req, res) => {
    try {
        const baseSettings = db.getSettings();
        const { messages, saveAsReport = false, enableSearch = false, enableLocalData = true, systemPrompt = '' } = req.body;
        
        const settings = {
            ...baseSettings,
            enable_local_data: enableLocalData,
            system_prompt: systemPrompt
        };
        
        if (!settings.ollama_enabled) {
            return res.status(400).json({
                success: false,
                error: 'AI 功能未启用'
            });
        }
        
        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({
                success: false,
                error: '无效的消息格式'
            });
        }
        
        const dailyLimit = settings.daily_token_limit || 5000;
        const todayUsage = getTodayTokenUsage();
        
        if (dailyLimit > 0 && todayUsage >= dailyLimit) {
            return res.status(400).json({
                success: false,
                error: `今日Token使用已达上限 (${todayUsage}/${dailyLimit})，请明天再试`
            });
        }
        
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        let fullText = '';
        let isFinished = false;
        let totalTokensUsed = 0;
        
        try {
            let processedMessages = [...messages];
            
            if (enableSearch) {
                const lastUserMsg = messages.filter(m => m.role === 'user').pop();
                if (lastUserMsg) {
                    res.write(`data: ${JSON.stringify({ type: 'thinking', content: '正在联网搜索...' })}\n\n`);
                    
                    const searchResults = await searchWeb(lastUserMsg.content);
                    const searchContext = buildSearchContext(searchResults);
                    
                    processedMessages = [
                        ...messages.slice(0, -1),
                        {
                            role: 'user',
                            content: lastUserMsg.content + '\n\n【联网搜索结果】\n' + searchContext
                        }
                    ];
                    
                    res.write(`data: ${JSON.stringify({ type: 'thinking', content: '搜索完成，正在分析...' })}\n\n`);
                }
            }
            
            let stats = null;
            const chatResult = await chatWithAI(
                processedMessages,
                settings,
                (chunk) => {
                    if (!isFinished) {
                        fullText += chunk;
                        res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
                    }
                },
                (thinking) => {
                    if (!isFinished) {
                        res.write(`data: ${JSON.stringify({ type: 'thinking', content: thinking })}\n\n`);
                    }
                },
                (tokenStats) => {
                    stats = tokenStats;
                }
            );
            
            stats = chatResult.stats || stats;
            fullText = chatResult.text || fullText;
            
            console.log('[AI Chat] Stats received:', stats);
            
            if (stats) {
                totalTokensUsed = (stats.prompt_eval_count || 0) + (stats.eval_count || 0);
                recordTokenUsage(totalTokensUsed);
            }
            
            let report = null;
            if (saveAsReport) {
                report = saveReport(
                    `对话报告_${new Date().toLocaleString('zh-CN')}`,
                    fullText
                );
            }
            
            isFinished = true;
            console.log('[AI Chat] Sending done with stats:', stats);
            res.write(`data: ${JSON.stringify({ type: 'done', report: report, stats: stats })}\n\n`);
            res.end();
        } catch (streamError) {
            console.error('流式输出失败:', streamError);
            if (!isFinished) {
                isFinished = true;
                res.write(`data: ${JSON.stringify({ type: 'error', error: streamError.message })}\n\n`);
                res.end();
            }
        }
    } catch (error) {
        console.error('AI 聊天失败:', error);
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                error: 'AI 聊天失败: ' + error.message
            });
        } else {
            res.end();
        }
    }
});

function getTodayTokenUsage() {
    try {
        const today = new Date().toISOString().split('T')[0];
        const usage = db.getTokenUsage(today);
        return usage || 0;
    } catch (e) {
        return 0;
    }
}

function recordTokenUsage(tokens) {
    try {
        const today = new Date().toISOString().split('T')[0];
        db.recordTokenUsage(today, tokens);
    } catch (e) {
        console.error('记录Token使用失败:', e);
    }
}

router.get('/api/ai/token-usage', (req, res) => {
    try {
        const settings = db.getSettings();
        const dailyLimit = settings.daily_token_limit || 5000;
        const todayUsage = getTodayTokenUsage();
        
        res.json({
            success: true,
            data: {
                todayUsage,
                dailyLimit,
                remaining: Math.max(0, dailyLimit - todayUsage),
                percentage: dailyLimit > 0 ? (todayUsage / dailyLimit * 100).toFixed(1) : 0
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

function buildSearchContext(results) {
    if (typeof results === 'string') {
        return results;
    }
    
    let context = '';
    if (Array.isArray(results)) {
        results.forEach((r, i) => {
            context += `\n结果${i + 1}: ${r.title}\n`;
            context += `摘要: ${r.desc}\n`;
            context += `链接: ${r.url}\n`;
        });
    }
    return context;
}

router.post('/api/ai/search', async (req, res) => {
    try {
        const { query } = req.body;
        
        if (!query) {
            return res.status(400).json({
                success: false,
                error: '请提供搜索关键词'
            });
        }
        
        const results = await searchWeb(query);
        
        res.json({
            success: true,
            data: results
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: '搜索失败: ' + error.message
        });
    }
});

router.get('/api/reports', (req, res) => {
    try {
        const reports = getReports();
        res.json({
            success: true,
            data: reports
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.get('/api/reports/:id', (req, res) => {
    try {
        const report = getReport(req.params.id);
        if (!report) {
            return res.status(404).json({
                success: false,
                error: '报告不存在'
            });
        }
        res.json({
            success: true,
            data: report
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.put('/api/reports/:id', (req, res) => {
    try {
        const { title } = req.body;
        const report = updateReport(req.params.id, { title });
        if (!report) {
            return res.status(404).json({
                success: false,
                error: '报告不存在'
            });
        }
        res.json({
            success: true,
            data: report
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.delete('/api/reports/:id', (req, res) => {
    try {
        const deleted = deleteReport(req.params.id);
        if (!deleted) {
            return res.status(404).json({
                success: false,
                error: '报告不存在'
            });
        }
        res.json({
            success: true
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
