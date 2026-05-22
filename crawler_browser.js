const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const COOKIES_DIR = path.join(__dirname, 'data', 'cookies');

if (!fs.existsSync(COOKIES_DIR)) {
    fs.mkdirSync(COOKIES_DIR, { recursive: true });
}

class BrowserCrawler {
    constructor() {
        this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    }

    getCookiesPath(url) {
        try {
            const urlObj = new URL(url);
            const hostname = urlObj.hostname.replace(/\./g, '_');
            return path.join(COOKIES_DIR, `${hostname}.json`);
        } catch {
            return path.join(COOKIES_DIR, 'default.json');
        }
    }

    async saveCookies(page, url) {
        try {
            const cookies = await page.cookies();
            const cookiesPath = this.getCookiesPath(url);
            fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
            console.log(`[Crawler] Cookies saved`);
        } catch (e) {
            console.error('[Crawler] Save cookies failed:', e.message);
        }
    }

    async loadCookies(url) {
        const cookiesPath = this.getCookiesPath(url);
        if (fs.existsSync(cookiesPath)) {
            try {
                const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
                return cookies;
            } catch {
                return null;
            }
        }
        return null;
    }

    async detectLoginOrCaptcha(page) {
        try {
            const pageUrl = page.url().toLowerCase();
            const pageContent = await page.content();
            const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');

            console.log(`[Crawler] Checking page: ${pageUrl.substring(0, 80)}...`);

            let needsLogin = false;
            let hasCaptcha = false;

            const loginKeywords = [
                '请登录', '请先登录', '登录后查看', '您未登录',
                'log in', 'sign in', 'please login', 'login required'
            ];
            
            for (const keyword of loginKeywords) {
                if (bodyText.toLowerCase().includes(keyword.toLowerCase())) {
                    needsLogin = true;
                    console.log(`[Crawler] Detected login keyword: ${keyword}`);
                    break;
                }
            }

            const loginUrlPatterns = ['/login', '/signin', '/passport', '/auth'];
            for (const pattern of loginUrlPatterns) {
                if (pageUrl.includes(pattern)) {
                    needsLogin = true;
                    console.log(`[Crawler] Detected login URL pattern: ${pattern}`);
                    break;
                }
            }

            const captchaKeywords = [
                '验证码', '请滑动验证', '验证', 'captcha', 'slider', 'verify'
            ];
            
            for (const keyword of captchaKeywords) {
                if (bodyText.toLowerCase().includes(keyword.toLowerCase())) {
                    hasCaptcha = true;
                    console.log(`[Crawler] Detected captcha keyword: ${keyword}`);
                    break;
                }
            }

            const hasCaptchaElement = await page.evaluate(() => {
                const captchaSelectors = [
                    '#nc_1_wrapper', '.nc_wrapper', '[id*="nc_"]',
                    '.geetest_widget', '.geetest_slider',
                    '[class*="captcha"]', '[id*="captcha"]',
                    '[class*="slider"]', '[class*="verify"]'
                ];
                
                for (const selector of captchaSelectors) {
                    if (document.querySelector(selector)) {
                        return true;
                    }
                }
                return false;
            }).catch(() => false);

            if (hasCaptchaElement) {
                hasCaptcha = true;
                console.log(`[Crawler] Detected captcha element`);
            }

            console.log(`[Crawler] Detection result - Login: ${needsLogin}, Captcha: ${hasCaptcha}`);
            
            return { needsLogin, hasCaptcha };
        } catch (e) {
            console.error('[Crawler] Detection error:', e.message);
            return { needsLogin: false, hasCaptcha: false };
        }
    }

    async waitForUserAction(page, url) {
        console.log('[Crawler] ========================================');
        console.log('[Crawler] 请在弹出的浏览器窗口中完成以下操作：');
        console.log('[Crawler] 1. 登录账号（如果需要）');
        console.log('[Crawler] 2. 完成验证码验证（如果需要）');
        console.log('[Crawler] 3. 确保能看到商品页面和价格');
        console.log('[Crawler]');
        console.log('[Crawler] 操作完成后，请按 Ctrl+C 继续...');
        console.log('[Crawler] ========================================');

        let lastCheck = Date.now();
        const checkInterval = 2000;

        while (true) {
            try {
                if (Date.now() - lastCheck > checkInterval) {
                    lastCheck = Date.now();
                    
                    const detection = await this.detectLoginOrCaptcha(page);
                    
                    if (!detection.needsLogin && !detection.hasCaptcha) {
                        const testData = await this.extractProductInfo(page);
                        if (testData.current_price > 0 || testData.title !== 'Unknown Product') {
                            console.log('[Crawler] 检测完成，页面已正常！');
                            return true;
                        }
                    }
                }

                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (e) {
                console.error('[Crawler] Waiting error:', e.message);
            }
        }
    }

    async crawl(url, options = {}) {
        const { headless = true, allowInteractive = true } = options;
        
        let browser = null;
        let page = null;

        try {
            console.log(`[Crawler] Starting: ${url}`);
            
            browser = await puppeteer.launch({
                headless: headless,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-blink-features=AutomationControlled'
                ]
            });

            page = await browser.newPage();
            await page.setUserAgent(this.userAgent);
            await page.setViewport({ width: 1280, height: 800 });
            
            const cookies = await this.loadCookies(url);
            if (cookies && cookies.length > 0) {
                await page.setCookie(...cookies);
                console.log('[Crawler] Loaded saved cookies');
            }
            
            await page.goto(url, { 
                waitUntil: 'networkidle2',
                timeout: 60000 
            });
            
            await page.waitForTimeout(3000);

            const initialDetection = await this.detectLoginOrCaptcha(page);

            if (initialDetection.needsLogin || initialDetection.hasCaptcha) {
                if (allowInteractive) {
                    console.log('[Crawler] 检测到需要登录或验证码，切换到交互模式...');
                    
                    await this.saveCookies(page, url);
                    
                    await page.close();
                    await browser.close();

                    console.log('[Crawler] 正在打开交互式浏览器...');
                    const interactiveBrowser = await puppeteer.launch({
                        headless: false,
                        args: [
                            '--no-sandbox',
                            '--disable-setuid-sandbox',
                            '--disable-dev-shm-usage',
                            '--disable-blink-features=AutomationControlled'
                        ]
                    });

                    const interactivePage = await interactiveBrowser.newPage();
                    await interactivePage.setUserAgent(this.userAgent);
                    await interactivePage.setViewport({ width: 1280, height: 800 });

                    const savedCookies = await this.loadCookies(url);
                    if (savedCookies && savedCookies.length > 0) {
                        await interactivePage.setCookie(...savedCookies);
                    }

                    await interactivePage.goto(url, {
                        waitUntil: 'networkidle2',
                        timeout: 60000
                    });

                    await this.waitForUserAction(interactivePage, url);

                    await this.saveCookies(interactivePage, url);

                    const productInfo = await this.extractProductInfo(interactivePage);

                    await interactiveBrowser.close();

                    console.log(`[Crawler] Extracted:`, {
                        title: productInfo.title,
                        price: productInfo.current_price,
                        image: productInfo.image ? productInfo.image.substring(0, 50) + '...' : ''
                    });

                    if (productInfo.current_price <= 0) {
                        console.warn('[Crawler] Warning: No valid price extracted');
                    }

                    if (productInfo.title === 'Unknown Product') {
                        console.warn('[Crawler] Warning: Failed to extract product title');
                    }

                    return {
                        success: true,
                        data: productInfo,
                        browserUsed: true,
                        wasInteractive: true
                    };
                } else {
                    console.log('[Crawler] 检测到需要登录或验证码，但交互模式被禁用');
                    return {
                        success: false,
                        error: '需要登录或验证码',
                        needsLogin: initialDetection.needsLogin,
                        hasCaptcha: initialDetection.hasCaptcha
                    };
                }
            }

            const productInfo = await this.extractProductInfo(page);
            await this.saveCookies(page, url);
            
            console.log(`[Crawler] Extracted:`, {
                title: productInfo.title,
                price: productInfo.current_price,
                image: productInfo.image ? productInfo.image.substring(0, 50) + '...' : ''
            });
            
            if (productInfo.current_price <= 0) {
                console.warn('[Crawler] Warning: No valid price extracted');
            }
            
            if (productInfo.title === 'Unknown Product') {
                console.warn('[Crawler] Warning: Failed to extract product title');
            }
            
            return {
                success: true,
                data: productInfo,
                browserUsed: true,
                wasInteractive: false
            };
            
        } catch (error) {
            console.error('[Crawler] Error:', error.message);
            return {
                success: false,
                error: error.message
            };
        } finally {
            if (page) {
                try {
                    await page.close();
                } catch {}
            }
            if (browser) {
                try {
                    await browser.close();
                } catch {}
            }
        }
    }

    async extractProductInfo(page) {
        const result = await page.evaluate(() => {
            function extractPrice(text) {
                if (!text) return 0;
                const matches = text.match(/[\d,]+\.?\d*/g);
                if (!matches) return 0;
                
                for (const match of matches) {
                    const cleaned = match.replace(/,/g, '');
                    const num = parseFloat(cleaned);
                    if (num > 0 && num < 10000000) {
                        return num;
                    }
                }
                return 0;
            }
            
            let currentPrice = 0;
            let title = '';
            let image = '';
            let originalPrice = 0;
            
            const priceSelectors = [
                '[class*="price"]',
                '[itemprop="price"]',
                '[data-price]',
                '#price',
                '.price',
                '.product-price',
                '.current-price',
                '.tm-price',
                '.tb-price',
                'span[class*="price"]',
                'em[class*="price"]'
            ];
            
            for (const selector of priceSelectors) {
                if (currentPrice > 0) break;
                
                const elements = document.querySelectorAll(selector);
                for (const el of elements) {
                    const text = el.innerText || el.textContent || '';
                    const hasPriceSymbol = text.includes('¥') || text.includes('$') || text.includes('€') || text.includes('£');
                    
                    if (hasPriceSymbol || (text.length < 20 && text.match(/\d/))) {
                        const price = extractPrice(text);
                        if (price > 0 && price < 1000000) {
                            currentPrice = price;
                            break;
                        }
                    }
                }
            }
            
            if (!currentPrice) {
                const allText = document.body.innerText;
                const priceRegex = /(?:¥|￥|\$|€|£|price:|Price:)?\s*([\d,]+\.?\d*)/ig;
                let match;
                const foundPrices = [];
                
                while ((match = priceRegex.exec(allText)) !== null) {
                    const price = extractPrice(match[1]);
                    if (price > 0 && price < 1000000) {
                        foundPrices.push(price);
                    }
                }
                
                if (foundPrices.length > 0) {
                    const sortedPrices = [...new Set(foundPrices)].sort((a, b) => a - b);
                    currentPrice = sortedPrices[0];
                }
            }
            
            const titleSelectors = [
                'h1',
                'h1[class*="title"]',
                'h1[class*="name"]',
                '[class*="product-title"]',
                '[class*="product-name"]',
                '[class*="goods-title"]',
                '[class*="goods-name"]',
                '[itemprop="name"]',
                '[data-title]',
                '.title',
                '.name'
            ];
            
            for (const selector of titleSelectors) {
                if (title) break;
                
                const elements = document.querySelectorAll(selector);
                for (const el of elements) {
                    const text = (el.innerText || el.textContent || '').trim();
                    if (text && text.length > 5 && text.length < 200 && 
                        !text.match(/¥|\$|€|£|price|Price|价格/) &&
                        !/^\d+$/.test(text)) {
                        title = text;
                        break;
                    }
                }
            }
            
            if (!title) {
                const metaTitle = document.querySelector('meta[property="og:title"]');
                if (metaTitle) {
                    const content = metaTitle.getAttribute('content');
                    if (content && content.length > 5 && content.length < 200) {
                        title = content;
                    }
                }
            }
            
            if (!title && document.title) {
                const docTitle = document.title;
                const separators = [' | ', ' - ', ' _ ', ' — ', ' · '];
                for (const sep of separators) {
                    if (docTitle.includes(sep)) {
                        const possibleTitle = docTitle.split(sep)[0].trim();
                        if (possibleTitle.length > 5 && possibleTitle.length < 200) {
                            title = possibleTitle;
                            break;
                        }
                    }
                }
                if (!title && docTitle.length > 5 && docTitle.length < 200) {
                    title = docTitle;
                }
            }
            
            const imgSelectors = [
                'img[class*="main"]',
                'img[id*="main"]',
                '.product-image img',
                '[class*="image"] img',
                'img[itemprop="image"]'
            ];
            
            for (const selector of imgSelectors) {
                const el = document.querySelector(selector);
                if (el && el.src && el.src.startsWith('http') && !el.src.includes('data:image')) {
                    image = el.src;
                    break;
                }
            }
            
            if (!image) {
                const img = document.querySelector('img');
                if (img && img.src && img.src.startsWith('http')) {
                    image = img.src;
                }
            }
            
            originalPrice = currentPrice;
            
            return {
                title: title || 'Unknown Product',
                current_price: currentPrice || 0,
                original_price: originalPrice || currentPrice,
                image: image || ''
            };
        });
        
        console.log(`[Crawler] Final extracted data:`, {
            title: result.title,
            current_price: result.current_price,
            image: result.image ? result.image.substring(0, 50) + '...' : ''
        });
        
        return result;
    }
}

module.exports = new BrowserCrawler();
