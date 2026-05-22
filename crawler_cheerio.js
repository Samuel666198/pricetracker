const cheerio = require('cheerio');
const fetch = require('node-fetch');

class PriceCrawler {
    constructor() {
        this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        this.timeout = 10000;
        this.cheerio = cheerio;
    }

    async fetchPage(url) {
        const response = await fetch(url, {
            headers: {
                'User-Agent': this.userAgent,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            },
            timeout: this.timeout
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        return await response.text();
    }

    async crawl(input) {
        try {
            let url = input;
            let title = '';
            
            const extracted = this.extractUrlAndTitle(input);
            if (extracted.url) {
                url = extracted.url;
                title = extracted.title;
            }
            
            url = this.normalizeUrl(url);
            
            url = await this.resolveShortUrl(url);
            
            const html = await this.fetchPage(url);
            const $ = this.cheerio.load(html);
            
            const platform = this.detectPlatform(url);
            let productInfo;
            
            switch (platform) {
                case 'jd':
                    productInfo = this.parseJD($);
                    break;
                case 'taobao':
                case 'tmall':
                    productInfo = this.parseTaobao($);
                    break;
                case 'pdd':
                    productInfo = this.parsePdd($);
                    break;
                default:
                    productInfo = this.parseGeneric($);
            }
            
            if (title && productInfo.title === '未知商品') {
                productInfo.title = title;
            }
            
            productInfo.url = url;
            productInfo.platform = platform;
            
            return {
                success: true,
                data: productInfo
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    extractUrlAndTitle(input) {
        const result = { url: '', title: '' };
        
        const tbShortUrlMatch = input.match(/https?:\/\/(?:e\.tb\.cn|m\.tb\.cn|ulink\.taobao\.com|uland\.taobao\.com)[^\s]*/);
        if (tbShortUrlMatch) {
            result.url = tbShortUrlMatch[0];
            result.title = input.replace(tbShortUrlMatch[0], '').replace(/【|】|[「」『』]|"/g, '').trim();
            return result;
        }
        
        const jdShortMatch = input.match(/https?:\/\/(?:u\.jd\.com|bean\.jd\.com|m\.jd\.com)[^\s]*/);
        if (jdShortMatch) {
            result.url = jdShortMatch[0];
            return result;
        }
        
        const pddShortMatch = input.match(/https?:\/\/(?:you\.pinduoduo\.com|m\.pinduoduo\.com)[^\s]*/);
        if (pddShortMatch) {
            result.url = pddShortMatch[0];
            return result;
        }
        
        const directUrlMatch = input.match(/https?:\/\/[^\s]+/);
        if (directUrlMatch) {
            result.url = directUrlMatch[0];
            return result;
        }
        
        result.url = input;
        return result;
    }

    async resolveShortUrl(url) {
        if (!url.includes('e.tb.cn') && !url.includes('m.tb.cn') && 
            !url.includes('ulink.taobao.com') && !url.includes('uland.taobao.com')) {
            return url;
        }
        
        try {
            const response = await fetch(url, {
                method: 'HEAD',
                redirect: 'follow',
                timeout: this.timeout
            });
            
            if (response.url && response.url !== url) {
                return response.url;
            }
            
            return url;
        } catch (error) {
            return url;
        }
    }

    normalizeUrl(url) {
        if (!url) return url;
        
        url = url.trim();
        
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }
        
        try {
            const urlObj = new URL(url);
            if (!urlObj.hostname) {
                throw new Error('Invalid hostname');
            }
        } catch (e) {
            if (url.includes('jd.com') || url.includes('taobao.com') || 
                url.includes('tmall.com') || url.includes('pinduoduo.com') ||
                url.includes('pdd')) {
                const cleanUrl = url.replace(/^(https?:\/\/)?/, 'https://');
                try {
                    new URL(cleanUrl);
                    return cleanUrl;
                } catch {}
            }
            throw new Error('Invalid URL format');
        }
        
        return url;
    }

    detectPlatform(url) {
        if (url.includes('jd.com') || url.includes('jd.hk')) {
            return 'jd';
        } else if (url.includes('taobao.com')) {
            return 'taobao';
        } else if (url.includes('tmall.com')) {
            return 'tmall';
        } else if (url.includes('pinduoduo.com') || url.includes('pdd')) {
            return 'pdd';
        }
        return 'generic';
    }

    parseJD($) {
        const title = 
            $('h1.product-intro__head-name').text().trim() ||
            $('[class*="product-intro"] h1').text().trim() ||
            $('div.sku-name').text().trim() ||
            $('h1').text().trim() ||
            $('title').text().trim();

        let currentPrice = this.extractPrice($('[class*="price"]').first().text()) ||
                          this.extractPrice($('[class*="productPrice"]').text()) ||
                          this.extractPrice($('[itemprop="price"]').attr('content')) ||
                          this.extractPrice($('[class*="price-jd"]').text());

        let originalPrice = this.extractPrice($('[class*="original"]').text()) ||
                           this.extractPrice($('[class*="market"]').text()) ||
                           this.extractPrice($('[class*="origin"]').text());

        const image = 
            $('[class*="product-intro"] img').attr('src') ||
            $('[class*="spec-items"] img').first().attr('src') ||
            $('[class*="main-img"]').attr('src') ||
            $('img[data-src]').first().attr('data-src') ||
            $('img').first().attr('src');

        if (!originalPrice && currentPrice) {
            originalPrice = currentPrice * 1.2;
        }

        return {
            title: title || '未知商品',
            current_price: currentPrice || 0,
            original_price: originalPrice || currentPrice,
            image: image || ''
        };
    }

    parseTaobao($) {
        const title = 
            $('h1[data-title]').attr('data-title') ||
            $('div[class*="tb-title"] h3').text().trim() ||
            $('h1[class*="title"]').text().trim() ||
            $('[class*="productTitle"]').text().trim() ||
            $('title').text().trim();

        let currentPrice = this.extractPrice($('[class*="price"]').first().text()) ||
                          this.extractPrice($('[class*="price-origin"]').text()) ||
                          this.extractPrice($('[itemprop="price"]').attr('content')) ||
                          this.extractPrice($('#J_StrPriceModBox .tm-price').text());

        let originalPrice = this.extractPrice($('[class*="original"]').text()) ||
                           this.extractPrice($('[class*="origin"]').text()) ||
                           this.extractPrice($('#J_StrPriceModBox .tm-yen').text());

        const image = 
            $('[class*="main-img"] img').attr('src') ||
            $('[class*="tb-thumb"] img').first().attr('src') ||
            $('[class*="product-img"] img').attr('src') ||
            $('img').first().attr('src');

        if (!originalPrice && currentPrice) {
            originalPrice = currentPrice * 1.15;
        }

        return {
            title: title || '未知商品',
            current_price: currentPrice || 0,
            original_price: originalPrice || currentPrice,
            image: image || ''
        };
    }

    parsePdd($) {
        const title = 
            $('[class*="goods-title"]').text().trim() ||
            $('[class*="product-title"]').text().trim() ||
            $('h1').text().trim() ||
            $('title').text().trim();

        let currentPrice = this.extractPrice($('[class*="price"]').first().text()) ||
                          this.extractPrice($('[class*="price-view"]').text()) ||
                          this.extractPrice($('[class*="product-price"]').text());

        let originalPrice = this.extractPrice($('[class*="original-price"]').text()) ||
                           this.extractPrice($('[class*="market-price"]').text());

        const image = 
            $('[class*="goods-img"] img').attr('src') ||
            $('[class*="product-img"] img').attr('src') ||
            $('[class*="swiper"] img').first().attr('src') ||
            $('img').first().attr('src');

        if (!originalPrice && currentPrice) {
            originalPrice = currentPrice * 1.2;
        }

        return {
            title: title || '未知商品',
            current_price: currentPrice || 0,
            original_price: originalPrice || currentPrice,
            image: image || ''
        };
    }

    parseGeneric($) {
        const title = 
            $('h1').first().text().trim() ||
            $('[class*="product"] [class*="title"]').first().text().trim() ||
            $('[class*="product"] h2').first().text().trim() ||
            $('title').text().trim();

        let price = this.extractPrice($('[class*="price"]').first().text()) ||
                   this.extractPrice($('[itemprop="price"]').attr('content')) ||
                   this.extractPrice($('[class*="amount"]').text()) ||
                   this.extractPrice($('span[class*="price"]').first().text()) ||
                   this.extractPrice($('div[class*="price"]').first().text());

        const image = 
            $('[class*="product"] img').first().attr('src') ||
            $('[class*="main"] img').first().attr('src') ||
            $('[class*="gallery"] img').first().attr('src') ||
            $('[itemprop="image"]').attr('content') ||
            $('img').first().attr('src');

        return {
            title: title || '未知商品',
            current_price: price || 0,
            original_price: price || 0,
            image: image || ''
        };
    }

    extractPrice(text) {
        if (!text) return 0;
        const match = text.match(/[\d,]+\.?\d*/);
        if (match) {
            return parseFloat(match[0].replace(/,/g, ''));
        }
        return 0;
    }

    filterInvalidPrice(price, product) {
        if (!price || price <= 0) {
            return false;
        }
        
        if (product.original_price && product.original_price > 0) {
            const ratio = price / product.original_price;
            if (ratio < 0.1 || ratio > 5) {
                return false;
            }
        }
        
        return true;
    }

    isValidProduct(product) {
        return (
            product.title && 
            product.title !== '未知商品' &&
            product.current_price > 0
        );
    }
}

module.exports = new PriceCrawler();
