const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'data', 'price_tracker.db');
const SETTINGS_PATH = path.join(__dirname, 'data', 'settings.json');

let db = null;
let dbInstance = null;

async function initDatabase() {
    const SQL = await initSqlJs();
    
    if (!fs.existsSync(path.dirname(DB_PATH))) {
        fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    }
    
    if (fs.existsSync(DB_PATH)) {
        const fileBuffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(fileBuffer);
    } else {
        db = new SQL.Database();
    }

    db.run(`
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            color TEXT DEFAULT '#667eea',
            sort_order INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT UNIQUE NOT NULL,
            title TEXT,
            image TEXT,
            original_price REAL,
            current_price REAL,
            lowest_price REAL,
            highest_price REAL,
            target_price REAL,
            monitor_interval INTEGER DEFAULT 3600000,
            is_active INTEGER DEFAULT 1,
            smart_mode INTEGER DEFAULT 1,
            category_id INTEGER DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_record_date TEXT DEFAULT NULL
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS price_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            price REAL NOT NULL,
            recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            record_date TEXT DEFAULT NULL,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        )
    `);

    db.run(`
        CREATE INDEX IF NOT EXISTS idx_price_history_product 
        ON price_history(product_id)
    `);
    
    db.run(`
        CREATE INDEX IF NOT EXISTS idx_price_history_time 
        ON price_history(recorded_at)
    `);
    
    db.run(`
        CREATE INDEX IF NOT EXISTS idx_products_category 
        ON products(category_id)
    `);
    
    db.run(`
        CREATE INDEX IF NOT EXISTS idx_products_smart 
        ON products(smart_mode)
    `);
    
    // Token使用记录表
    db.run(`
        CREATE TABLE IF NOT EXISTS token_usage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            tokens_used INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    db.run(`
        CREATE INDEX IF NOT EXISTS idx_token_usage_date 
        ON token_usage(date)
    `);
    
    // 数据库迁移：移除 UNIQUE 约束
    try {
        // 检查是否有 UNIQUE 约束需要移除
        const checkSql = `
            SELECT sql FROM sqlite_master 
            WHERE type='table' AND name='price_history'
        `;
        const result = queryAll(checkSql);
        
        if (result.length > 0 && result[0].sql && result[0].sql.includes('UNIQUE')) {
            console.log('[数据库] 检测到旧的 UNIQUE 约束，正在迁移...');
            
            // 1. 重命名旧表
            db.run('ALTER TABLE price_history RENAME TO price_history_old');
            
            // 2. 创建新表（没有 UNIQUE 约束）
            db.run(`
                CREATE TABLE price_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    product_id INTEGER NOT NULL,
                    price REAL NOT NULL,
                    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    record_date TEXT DEFAULT NULL,
                    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
                )
            `);
            
            // 3. 复制数据
            db.run(`
                INSERT INTO price_history (id, product_id, price, recorded_at, record_date)
                SELECT id, product_id, price, recorded_at, record_date FROM price_history_old
            `);
            
            // 4. 重建索引
            db.run(`
                CREATE INDEX idx_price_history_product 
                ON price_history(product_id)
            `);
            db.run(`
                CREATE INDEX idx_price_history_time 
                ON price_history(recorded_at)
            `);
            
            // 5. 删除旧表
            db.run('DROP TABLE price_history_old');
            
            console.log('[数据库] 迁移完成！');
            saveDatabase();
        }
    } catch (e) {
        console.warn('[数据库] 迁移警告:', e.message);
    }
    
    saveDatabase();
}

function saveDatabase() {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
}

function queryAll(sql, params = []) {
    const stmt = db.prepare(sql);
    if (params.length > 0) {
        stmt.bind(params);
    }
    
    const results = [];
    while (stmt.step()) {
        results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
}

function queryOne(sql, params = []) {
    const results = queryAll(sql, params);
    return results.length > 0 ? results[0] : null;
}

function run(sql, params = []) {
    db.run(sql, params);
    saveDatabase();
}

function getAllProducts() {
    return queryAll('SELECT * FROM products ORDER BY updated_at DESC');
}

function getProductById(id) {
    return queryOne('SELECT * FROM products WHERE id = ?', [id]);
}

function getProductByUrl(url) {
    return queryOne('SELECT * FROM products WHERE url = ?', [url]);
}

function addProduct(product) {
    const now = new Date().toISOString();
    run(`
        INSERT INTO products (url, title, image, original_price, current_price, lowest_price, highest_price, target_price, monitor_interval, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        product.url,
        product.title,
        product.image,
        product.original_price,
        product.current_price,
        product.lowest_price || product.current_price,
        product.highest_price || product.current_price,
        product.target_price || null,
        product.monitor_interval || 3600000,
        now,
        now
    ]);
    
    const result = queryOne('SELECT last_insert_rowid() as id');
    return result ? result.id : null;
}

function updateProduct(id, updates) {
    const fields = [];
    const values = [];
    
    for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined && key !== 'id') {
            fields.push(`${key} = ?`);
            values.push(value);
        }
    }
    
    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);
    
    run(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`, values);
}

function updateProductPrice(id, price) {
    const product = getProductById(id);
    if (!product) return false;
    
    const lowest_price = Math.min(product.lowest_price || Infinity, price);
    const highest_price = Math.max(product.highest_price || 0, price);
    
    run(`
        UPDATE products 
        SET current_price = ?, lowest_price = ?, highest_price = ?, updated_at = ?
        WHERE id = ?
    `, [price, lowest_price, highest_price, new Date().toISOString(), id]);
    
    return true;
}

function deleteProduct(id) {
    run('DELETE FROM price_history WHERE product_id = ?', [id]);
    run('DELETE FROM products WHERE id = ?', [id]);
}

function clearPriceHistory(productId) {
    run('DELETE FROM price_history WHERE product_id = ?', [productId]);
}

function addPriceRecord(productId, price) {
    const now = new Date();
    const recordDate = now.toISOString().split('T')[0];
    
    console.log(`[价格记录] 开始处理 - 商品ID: ${productId}, 价格: ${price}, 日期: ${recordDate}`);
    
    const product = getProductById(productId);
    if (!product) {
        console.log(`[价格记录] 错误：商品不存在 - ID: ${productId}`);
        return false;
    }
    
    console.log(`[价格记录] 商品信息 - smart_mode: ${product.smart_mode}, last_record_date: ${product.last_record_date}`);
    
    if (product.smart_mode) {
        // 关键修复：当 last_record_date 为 NULL 时，不应该跳过，应该记录
        // 只有当 last_record_date 存在且等于今天时，才跳过
        if (product.last_record_date !== null && product.last_record_date !== undefined && product.last_record_date === recordDate) {
            console.log(`[价格记录] 智能模式已跳过，今日已记录: ${productId}, last_record_date: ${product.last_record_date}`);
            return false;
        } else {
            console.log(`[价格记录] 智能模式检查通过，允许记录 - last_record_date: ${product.last_record_date} vs ${recordDate}`);
        }
    }
    
    console.log(`[价格记录] 正在添加记录 - 商品ID: ${productId}, 价格: ${price}, 日期: ${recordDate}`);
    
    try {
        run(`
            INSERT INTO price_history (product_id, price, recorded_at, record_date)
            VALUES (?, ?, ?, ?)
        `, [productId, price, now.toISOString(), recordDate]);
        
        console.log(`[价格记录] INSERT 成功`);
        
        if (product.smart_mode) {
            run(`
                UPDATE products 
                SET last_record_date = ?, updated_at = ?
                WHERE id = ?
            `, [recordDate, now.toISOString(), productId]);
            
            console.log(`[价格记录] UPDATE last_record_date 成功: ${recordDate}`);
        }
        
        console.log(`[价格记录] 记录添加成功: ${productId}`);
        return true;
    } catch (error) {
        console.error(`[价格记录] 添加失败: ${productId}, 错误:`, error);
        return false;
    }
}

function addPriceHistory(productId, price, dateStr = null) {
    const now = new Date();
    const recordDate = dateStr || now.toISOString().split('T')[0];
    
    const product = getProductById(productId);
    if (!product) return false;
    
    const manualRecordDate = recordDate + '_' + now.getTime();
    
    run(`
        INSERT INTO price_history (product_id, price, recorded_at, record_date)
        VALUES (?, ?, ?, ?)
    `, [productId, price, now.toISOString(), manualRecordDate]);
    
    return true;
}

function getPriceHistory(productId, limit = 100) {
    return queryAll(`
        SELECT * FROM price_history 
        WHERE product_id = ? 
        ORDER BY recorded_at DESC 
        LIMIT ?
    `, [productId, limit]);
}

function getRecentPriceHistory(productId, days = 30) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    
    return queryAll(`
        SELECT * FROM price_history 
        WHERE product_id = ? 
        AND recorded_at >= ?
        ORDER BY recorded_at ASC
    `, [productId, date.toISOString()]);
}

function getPriceStats(productId, days = 30) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    
    const results = queryAll(`
        SELECT 
            MIN(price) as min_price,
            MAX(price) as max_price,
            AVG(price) as avg_price,
            COUNT(*) as count
        FROM price_history 
        WHERE product_id = ? 
        AND recorded_at >= ?
    `, [productId, date.toISOString()]);
    
    const stats = results[0] || { min_price: null, max_price: null, avg_price: null, count: 0 };
    
    const volatility = stats.max_price && stats.min_price 
        ? stats.max_price - stats.min_price 
        : null;
    
    const average = stats.avg_price || null;
    
    return {
        min_price: stats.min_price,
        max_price: stats.max_price,
        average: average,
        volatility: volatility,
        count: stats.count
    };
}

function deletePriceHistory(id) {
    run(`DELETE FROM price_history WHERE id = ?`, [id]);
    return true;
}

function updatePriceHistory(id, price) {
    run(`UPDATE price_history SET price = ? WHERE id = ?`, [price, id]);
    return true;
}

function getPriceHistoryById(id) {
    return queryOne(`SELECT * FROM price_history WHERE id = ?`, [id]);
}

function recalculateMinMaxPrice(productId) {
    const history = getPriceHistory(productId, 10000);
    if (history.length === 0) {
        run(`UPDATE products SET lowest_price = NULL, highest_price = NULL WHERE id = ?`, [productId]);
        return;
    }
    
    const prices = history.map(h => h.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    
    run(`UPDATE products SET lowest_price = ?, highest_price = ? WHERE id = ?`, [minPrice, maxPrice, productId]);
}

function validatePrice(productId, newPrice, threshold = 100) {
    const product = getProductById(productId);
    if (!product || !product.current_price) {
        return { valid: true, reason: null };
    }
    
    const currentPrice = product.current_price;
    const percentageChange = Math.abs((newPrice - currentPrice) / currentPrice) * 100;
    
    if (percentageChange > threshold) {
        return { 
            valid: false, 
            reason: `价格变化超过${threshold}%，当前价格: ¥${currentPrice}，新价格: ¥${newPrice}，变化: ${percentageChange.toFixed(1)}%` 
        };
    }
    
    return { valid: true, reason: null };
}

function exportAllData() {
    const products = getAllProducts();
    const categories = getAllCategories();
    const priceHistory = queryAll('SELECT * FROM price_history ORDER BY product_id, recorded_at');
    
    return {
        version: '1.0',
        exported_at: new Date().toISOString(),
        categories: categories,
        products: products,
        price_history: priceHistory
    };
}

function exportProducts(includeHistory = true) {
    const products = getAllProducts();
    let data = {
        version: '1.0',
        exported_at: new Date().toISOString(),
        products: products
    };
    
    if (includeHistory) {
        data.price_history = queryAll('SELECT * FROM price_history ORDER BY product_id, recorded_at');
    }
    
    return data;
}

function exportToCSV() {
    const products = getAllProducts();
    const headers = ['ID', '标题', '链接', '原价', '当前价', '最低价', '最高价', '目标价', '状态', '分类ID', '创建时间', '更新时间'];
    const rows = products.map(p => [
        p.id,
        `"${(p.title || '').replace(/"/g, '""')}"`,
        `"${(p.url || '').replace(/"/g, '""')}"`,
        p.original_price || '',
        p.current_price || '',
        p.lowest_price || '',
        p.highest_price || '',
        p.target_price || '',
        p.is_active ? '启用' : '禁用',
        p.category_id || '',
        p.created_at,
        p.updated_at
    ]);
    
    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

function importData(data, options = {}) {
    const {
        overwrite = false,
        skipExisting = false
    } = options;
    
    const results = {
        imported: 0,
        skipped: 0,
        errors: 0,
        errorMessages: []
    };
    
    try {
        if (data.categories && Array.isArray(data.categories)) {
            data.categories.forEach(cat => {
                try {
                    const existing = queryOne('SELECT * FROM categories WHERE id = ?', [cat.id]);
                    if (existing && skipExisting) {
                        results.skipped++;
                        return;
                    }
                    
                    if (existing && overwrite) {
                        run(`
                            UPDATE categories SET name = ?, color = ?, sort_order = ?
                            WHERE id = ?
                        `, [cat.name, cat.color || '#667eea', cat.sort_order || 0, cat.id]);
                        results.imported++;
                    } else if (!existing) {
                        run(`
                            INSERT INTO categories (id, name, color, sort_order, created_at)
                            VALUES (?, ?, ?, ?, ?)
                        `, [cat.id, cat.name, cat.color || '#667eea', cat.sort_order || 0, cat.created_at]);
                        results.imported++;
                    } else {
                        results.skipped++;
                    }
                } catch (e) {
                    results.errors++;
                    results.errorMessages.push(`分类导入失败: ${cat.name} - ${e.message}`);
                }
            });
        }
        
        if (data.products && Array.isArray(data.products)) {
            data.products.forEach(prod => {
                try {
                    const existing = getProductByUrl(prod.url);
                    if (existing && skipExisting) {
                        results.skipped++;
                        return;
                    }
                    
                    if (existing && overwrite) {
                        updateProduct(existing.id, {
                            title: prod.title,
                            image: prod.image,
                            original_price: prod.original_price,
                            current_price: prod.current_price,
                            lowest_price: prod.lowest_price,
                            highest_price: prod.highest_price,
                            target_price: prod.target_price,
                            monitor_interval: prod.monitor_interval,
                            is_active: prod.is_active,
                            smart_mode: prod.smart_mode,
                            category_id: prod.category_id
                        });
                        results.imported++;
                    } else if (!existing) {
                        run(`
                            INSERT INTO products (id, url, title, image, original_price, current_price, 
                                lowest_price, highest_price, target_price, monitor_interval, is_active, 
                                smart_mode, category_id, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `, [
                            prod.id, prod.url, prod.title, prod.image, prod.original_price,
                            prod.current_price, prod.lowest_price, prod.highest_price, prod.target_price,
                            prod.monitor_interval, prod.is_active, prod.smart_mode, prod.category_id,
                            prod.created_at, prod.updated_at
                        ]);
                        results.imported++;
                    } else {
                        results.skipped++;
                    }
                } catch (e) {
                    results.errors++;
                    results.errorMessages.push(`产品导入失败: ${prod.title || prod.url} - ${e.message}`);
                }
            });
        }
        
        if (data.price_history && Array.isArray(data.price_history)) {
            data.price_history.forEach(history => {
                try {
                    const existing = queryOne('SELECT * FROM price_history WHERE id = ?', [history.id]);
                    if (existing && skipExisting) {
                        return;
                    }
                    
                    if (existing && overwrite) {
                        run(`
                            UPDATE price_history SET price = ?, recorded_at = ?, record_date = ?
                            WHERE id = ?
                        `, [history.price, history.recorded_at, history.record_date, history.id]);
                    } else if (!existing) {
                        run(`
                            INSERT INTO price_history (id, product_id, price, recorded_at, record_date)
                            VALUES (?, ?, ?, ?, ?)
                        `, [history.id, history.product_id, history.price, history.recorded_at, history.record_date]);
                    }
                } catch (e) {
                }
            });
        }
        
        return results;
    } catch (e) {
        results.errors++;
        results.errorMessages.push(`导入失败: ${e.message}`);
        return results;
    }
}

function toggleProductActive(id) {
    const product = getProductById(id);
    if (!product) return false;
    
    const newStatus = product.is_active ? 0 : 1;
    run(`
        UPDATE products 
        SET is_active = ?, updated_at = ?
        WHERE id = ?
    `, [newStatus, new Date().toISOString(), id]);
    
    return true;
}

function getActiveProducts() {
    return queryAll('SELECT * FROM products WHERE is_active = 1');
}

function getProductsForUpdate() {
    const products = queryAll('SELECT * FROM products WHERE is_active = 1');
    const now = Date.now();
    
    return products.filter(product => {
        const updatedAt = new Date(product.updated_at).getTime();
        const interval = product.monitor_interval || 3600000;
        return (now - updatedAt) >= interval;
    });
}

function getAllCategories() {
    return queryAll('SELECT * FROM categories ORDER BY sort_order ASC, id ASC');
}

function getCategoryById(id) {
    return queryOne('SELECT * FROM categories WHERE id = ?', [id]);
}

function addCategory(name, color = '#667eea') {
    const sortOrder = queryAll('SELECT MAX(sort_order) as max FROM categories')[0]?.max || 0;
    run(`
        INSERT INTO categories (name, color, sort_order)
        VALUES (?, ?, ?)
    `, [name, color, sortOrder + 1]);
    
    const result = queryOne('SELECT last_insert_rowid() as id');
    return result ? result.id : null;
}

function updateCategory(id, updates) {
    const fields = [];
    const values = [];
    
    for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined && key !== 'id') {
            fields.push(`${key} = ?`);
            values.push(value);
        }
    }
    
    values.push(id);
    
    run(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`, values);
}

function deleteCategory(id) {
    run('UPDATE products SET category_id = NULL WHERE category_id = ?', [id]);
    run('DELETE FROM categories WHERE id = ?', [id]);
}

function getProductsByCategory(categoryId) {
    if (categoryId === null) {
        return queryAll('SELECT * FROM products WHERE category_id IS NULL ORDER BY updated_at DESC');
    }
    return queryAll('SELECT * FROM products WHERE category_id = ? ORDER BY updated_at DESC', [categoryId]);
}

let cachedSettings = null;

const defaultSettings = {
    default_smart_mode: true,
    default_interval: 3600000,
    price_threshold: 100,
    memory_limit_mb: 512,
    cpu_limit_percent: 50,
    wait_time: 5,
    cookie_auto_save: true,
    alert_price: true,
    alert_target: true,
    data_retention_days: 90,
    headless_mode: true,
    ollama_enabled: false,
    ollama_host: 'http://localhost:11434',
    ollama_model: 'llama3.2',
    daily_token_limit: 5000
};

function loadSettingsFromFile() {
    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            const content = fs.readFileSync(SETTINGS_PATH, 'utf8');
            const savedSettings = JSON.parse(content);
            return { ...defaultSettings, ...savedSettings };
        }
    } catch (e) {
        console.error('加载设置文件失败:', e);
    }
    return { ...defaultSettings };
}

function saveSettingsToFile(settings) {
    try {
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
    } catch (e) {
        console.error('保存设置文件失败:', e);
    }
}

function getSettings() {
    if (cachedSettings) {
        return cachedSettings;
    }
    
    cachedSettings = loadSettingsFromFile();
    return cachedSettings;
}

function updateSettings(updates) {
    const settings = getSettings();
    
    if (updates.smart_mode !== undefined) {
        settings.default_smart_mode = updates.smart_mode;
    }
    if (updates.interval !== undefined) {
        settings.default_interval = updates.interval;
    }
    if (updates.retention !== undefined) {
        settings.data_retention_days = updates.retention;
    }
    if (updates.price_threshold !== undefined) {
        settings.price_threshold = updates.price_threshold;
    }
    if (updates.memory_limit_mb !== undefined) {
        settings.memory_limit_mb = updates.memory_limit_mb;
    }
    if (updates.cpu_limit_percent !== undefined) {
        settings.cpu_limit_percent = updates.cpu_limit_percent;
    }
    if (updates.wait_time !== undefined) {
        settings.wait_time = updates.wait_time;
    }
    if (updates.cookie_auto_save !== undefined) {
        settings.cookie_auto_save = updates.cookie_auto_save;
    }
    if (updates.alert_price !== undefined) {
        settings.alert_price = updates.alert_price;
    }
    if (updates.alert_target !== undefined) {
        settings.alert_target = updates.alert_target;
    }
    if (updates.headless_mode !== undefined) {
        settings.headless_mode = updates.headless_mode;
    }
    if (updates.ollama_enabled !== undefined) {
        settings.ollama_enabled = updates.ollama_enabled;
    }
    if (updates.ollama_host !== undefined) {
        settings.ollama_host = updates.ollama_host;
    }
    if (updates.ollama_model !== undefined) {
        settings.ollama_model = updates.ollama_model;
    }
    if (updates.daily_token_limit !== undefined) {
        settings.daily_token_limit = updates.daily_token_limit;
    }
    if (updates.ai_show_thinking !== undefined) {
        settings.ai_show_thinking = updates.ai_show_thinking;
    }
    if (updates.ai_enable_markdown !== undefined) {
        settings.ai_enable_markdown = updates.ai_enable_markdown;
    }
    if (updates.ai_enable_local_data !== undefined) {
        settings.ai_enable_local_data = updates.ai_enable_local_data;
    }
    if (updates.ai_system_prompt !== undefined) {
        settings.ai_system_prompt = updates.ai_system_prompt;
    }
    if (updates.ai_ollama_style !== undefined) {
        settings.ai_ollama_style = updates.ai_ollama_style;
    }
    
    cachedSettings = settings;
    saveSettingsToFile(settings);
    return true;
}

function getTokenUsage(date) {
    const results = queryAll(`
        SELECT COALESCE(SUM(tokens_used), 0) as total 
        FROM token_usage 
        WHERE date = ?
    `, [date]);
    return results[0]?.total || 0;
}

function recordTokenUsage(date, tokens) {
    run(`
        INSERT INTO token_usage (date, tokens_used)
        VALUES (?, ?)
    `, [date, tokens]);
}

module.exports = {
    initDatabase,
    getAllProducts,
    getProductById,
    getProductByUrl,
    addProduct,
    updateProduct,
    updateProductPrice,
    deleteProduct,
    clearPriceHistory,
    addPriceRecord,
    addPriceHistory,
    getPriceHistory,
    getRecentPriceHistory,
    getPriceStats,
    toggleProductActive,
    getActiveProducts,
    getProductsForUpdate,
    getAllCategories,
    getCategoryById,
    addCategory,
    updateCategory,
    deleteCategory,
    getProductsByCategory,
    getSettings,
    updateSettings,
    deletePriceHistory,
    updatePriceHistory,
    getPriceHistoryById,
    recalculateMinMaxPrice,
    validatePrice,
    exportAllData,
    exportProducts,
    exportToCSV,
    importData,
    getTokenUsage,
    recordTokenUsage
};
