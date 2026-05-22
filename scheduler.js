const db = require('./database');
const crawler = require('./crawler');

class MonitorScheduler {
    constructor() {
        this.isRunning = false;
        this.checkInterval = 60000;
        this.alerts = [];
    }

    start() {
        if (this.isRunning) {
            console.log('[调度器] 调度器已在运行中');
            return;
        }

        this.isRunning = true;
        console.log('[调度器] 价格监控调度器已启动');
        
        this.runSchedule();
        
        setInterval(() => {
            this.runSchedule();
        }, this.checkInterval);
    }

    stop() {
        this.isRunning = false;
        console.log('[调度器] 价格监控调度器已停止');
    }

    async runSchedule() {
        if (!this.isRunning) return;

        try {
            const products = db.getProductsForUpdate();
            
            if (products.length === 0) {
                return;
            }

            console.log(`[调度器] 发现 ${products.length} 个商品需要更新`);

            for (const product of products) {
                await this.updateProductPrice(product);
                await this.sleep(2000);
            }

            console.log(`[调度器] 本次更新完成`);
        } catch (error) {
            console.error('[调度器] 更新出错:', error);
        }
    }

    async updateProductPrice(product) {
        try {
            const result = await crawler.crawl(product.url);
            
            if (!result.success || !crawler.isValidProduct(result.data)) {
                console.log(`[调度器] 抓取失败: ${product.title}`);
                return;
            }

            const newPrice = result.data.current_price;
            const oldPrice = product.current_price;
            
            db.updateProductPrice(product.id, newPrice);
            db.addPriceRecord(product.id, newPrice);

            const updatedProduct = db.getProductById(product.id);

            const priceChange = this.calculatePriceChange(oldPrice, newPrice);
            console.log(`[调度器] ${product.title}: ¥${oldPrice} -> ¥${newPrice} (${priceChange})`);

            if (updatedProduct.target_price && newPrice <= updatedProduct.target_price) {
                this.addAlert({
                    type: 'target_price',
                    productId: product.id,
                    productTitle: product.title,
                    message: `${product.title} 价格已跌破目标价！当前价格 ¥${newPrice}，目标价 ¥${updatedProduct.target_price}`,
                    price: newPrice,
                    targetPrice: updatedProduct.target_price
                });
            } else if (newPrice < updatedProduct.lowest_price) {
                this.addAlert({
                    type: 'lowest_price',
                    productId: product.id,
                    productTitle: product.title,
                    message: `${product.title} 发现新历史最低价！当前价格 ¥${newPrice}`,
                    price: newPrice
                });
            } else if (newPrice < oldPrice) {
                this.addAlert({
                    type: 'price_drop',
                    productId: product.id,
                    productTitle: product.title,
                    message: `${product.title} 价格下降！¥${oldPrice} -> ¥${newPrice}`,
                    price: newPrice,
                    oldPrice: oldPrice
                });
            }

        } catch (error) {
            console.error(`[调度器] 更新商品失败: ${product.title}`, error);
        }
    }

    calculatePriceChange(oldPrice, newPrice) {
        if (!oldPrice || oldPrice === 0) return 'N/A';
        const change = ((newPrice - oldPrice) / oldPrice * 100).toFixed(1);
        return change > 0 ? `+${change}%` : `${change}%`;
    }

    addAlert(alert) {
        alert.id = Date.now();
        alert.timestamp = new Date().toISOString();
        this.alerts.unshift(alert);
        
        if (this.alerts.length > 100) {
            this.alerts = this.alerts.slice(0, 100);
        }

        console.log(`[提醒] ${alert.message}`);
    }

    getAlerts() {
        return this.alerts;
    }

    getUnreadAlerts() {
        return this.alerts.filter(a => !a.read);
    }

    markAlertRead(alertId) {
        const alert = this.alerts.find(a => a.id === alertId);
        if (alert) {
            alert.read = true;
        }
    }

    clearAlerts() {
        this.alerts = [];
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = new MonitorScheduler();
