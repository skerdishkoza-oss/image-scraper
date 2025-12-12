const express = require('express');
const puppeteer = require('puppeteer');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Update CORS for production
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST']
}));

app.use(express.json());
app.use(express.static('public'));

// Add timeout protection
app.use((req, res, next) => {
  res.setTimeout(120000); // 2 minutes timeout
  next();
});

let browser = null;

async function getBrowser() {
  if (!browser) {
    const isProduction = process.env.NODE_ENV === 'production';
    
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: isProduction 
        ? process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable'
        : puppeteer.executablePath(),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--single-process'
      ]
    });
  }
  return browser;
}

async function extractImagesFromPage(page, url) {
  return await page.evaluate((pageUrl) => {
    const imageSet = new Map();
    const baseUrl = new URL(pageUrl);

    function resolveUrl(src) {
      if (!src || src.startsWith('data:')) return src;
      try {
        if (src.startsWith('http')) return src;
        if (src.startsWith('//')) return 'https:' + src;
        if (src.startsWith('/')) return baseUrl.origin + src;
        return new URL(src, pageUrl).href;
      } catch (e) {
        return src;
      }
    }

    // Extract all <img> elements
    document.querySelectorAll('img').forEach(img => {
      const sources = [
        img.src,
        img.dataset.src,
        img.dataset.lazySrc,
        img.dataset.original,
        img.dataset.lazyOriginal,
        img.getAttribute('data-src'),
        img.getAttribute('data-lazy-src'),
        img.currentSrc
      ].filter(Boolean);

      if (img.srcset) {
        img.srcset.split(',').forEach(srcsetItem => {
          const src = srcsetItem.trim().split(' ')[0];
          if (src) sources.push(src);
        });
      }

      sources.forEach(src => {
        const fullUrl = resolveUrl(src);
        if (fullUrl && !imageSet.has(fullUrl)) {
          const rect = img.getBoundingClientRect();
          imageSet.set(fullUrl, {
            url: fullUrl,
            width: img.naturalWidth || img.width || Math.round(rect.width) || 'Natural',
            height: img.naturalHeight || img.height || Math.round(rect.height) || 'Natural',
            alt: img.alt || img.title || 'No alt text',
            type: 'img'
          });
        }
      });
    });

    // Extract <source> elements
    document.querySelectorAll('source').forEach(source => {
      const srcset = source.srcset || source.src;
      if (srcset) {
        srcset.split(',').forEach(srcsetItem => {
          const src = srcsetItem.trim().split(' ')[0];
          const fullUrl = resolveUrl(src);
          if (fullUrl && !imageSet.has(fullUrl)) {
            imageSet.set(fullUrl, {
              url: fullUrl,
              width: 'Natural',
              height: 'Natural',
              alt: 'Picture/video source',
              type: 'source'
            });
          }
        });
      }
    });

    // Extract background images
    document.querySelectorAll('*').forEach(elem => {
      const style = window.getComputedStyle(elem);
      const bgImage = style.backgroundImage;

      if (bgImage && bgImage !== 'none') {
        const matches = bgImage.matchAll(/url\(['"]?([^'")]+)['"]?\)/g);
        for (const match of matches) {
          const fullUrl = resolveUrl(match[1]);
          if (fullUrl && !imageSet.has(fullUrl)) {
            const rect = elem.getBoundingClientRect();
            imageSet.set(fullUrl, {
              url: fullUrl,
              width: Math.round(rect.width) || 'Natural',
              height: Math.round(rect.height) || 'Natural',
              alt: elem.getAttribute('aria-label') || 'Background image',
              type: 'background'
            });
          }
        }
      }
    });

    // Extract SVG <image> elements
    document.querySelectorAll('image').forEach(img => {
      const href = img.href.baseVal || img.getAttribute('xlink:href') || img.getAttribute('href');
      if (href) {
        const fullUrl = resolveUrl(href);
        if (fullUrl && !imageSet.has(fullUrl)) {
          imageSet.set(fullUrl, {
            url: fullUrl,
            width: img.width.baseVal.value || 'Natural',
            height: img.height.baseVal.value || 'Natural',
            alt: 'SVG image',
            type: 'svg'
          });
        }
      }
    });

    return Array.from(imageSet.values()).map(img => ({
      ...img,
      width: img.width === 'Natural' ? 'Natural' : img.width + 'px',
      height: img.height === 'Natural' ? 'Natural' : img.height + 'px'
    }));
  }, url);
}

app.post('/api/scrape', async (req, res) => {
  let desktopPage = null;
  let mobilePage = null;

  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    console.log(`\n🔍 Scraping: ${url}\n`);

    const browser = await getBrowser();
    const allImages = new Map();

    // ========== DESKTOP VIEWPORT ==========
    console.log('📱 Scraping DESKTOP viewport (1920x1080)...');
    desktopPage = await browser.newPage();
    await desktopPage.setViewport({ width: 1920, height: 1080 });
    await desktopPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    await desktopPage.goto(url, {
      waitUntil: ['networkidle0', 'domcontentloaded'],
      timeout: 30000
    });

    await desktopPage.waitForTimeout(2000);

    // Scroll desktop
    await desktopPage.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          if(totalHeight >= scrollHeight){
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });

    const desktopImages = await extractImagesFromPage(desktopPage, url);
    desktopImages.forEach(img => allImages.set(img.url, img));
    console.log(`✅ Desktop: Found ${desktopImages.length} images`);
    await desktopPage.close();

    // ========== MOBILE VIEWPORT ==========
    console.log('\n📱 Scraping MOBILE viewport (375x812)...');
    mobilePage = await browser.newPage();
    await mobilePage.setViewport({ width: 375, height: 812 });
    await mobilePage.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1');

    await mobilePage.goto(url, {
      waitUntil: ['networkidle0', 'domcontentloaded'],
      timeout: 30000
    });

    await mobilePage.waitForTimeout(2000);

    // Scroll mobile
    await mobilePage.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          if(totalHeight >= scrollHeight){
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });

    const mobileImages = await extractImagesFromPage(mobilePage, url);
    let newMobileImages = 0;
    mobileImages.forEach(img => {
      if (!allImages.has(img.url)) {
        allImages.set(img.url, img);
        newMobileImages++;
      }
    });
    console.log(`✅ Mobile: Found ${mobileImages.length} images (${newMobileImages} new)`);
    await mobilePage.close();

    const images = Array.from(allImages.values());
    console.log(`\n🎯 Total unique images: ${images.length}\n`);

    // Get file sizes with detailed logging
    const imagesWithSizes = await Promise.all(
      images.map(async (img, index) => {
        try {
          let sizeInBytes = 0;

          // Handle data URIs
          if (img.url.startsWith('data:')) {
            const base64Match = img.url.match(/^data:([^;]+);base64,(.+)$/);
            if (base64Match) {
              const base64Data = base64Match[2];
              sizeInBytes = Math.ceil((base64Data.length * 3) / 4);
            } else {
              const dataMatch = img.url.match(/^data:([^,]+),(.+)$/);
              if (dataMatch) {
                sizeInBytes = decodeURIComponent(dataMatch[2]).length;
              }
            }
          } else {
            // Try HEAD first
            try {
              const response = await axios.head(img.url, {
                timeout: 10000,
                maxRedirects: 5,
                validateStatus: (status) => status < 500,
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                  'Accept': 'image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                  'Accept-Language': 'en-US,en;q=0.9',
                  'Cache-Control': 'no-cache',
                  'Referer': url
                }
              });

              if (response.status === 200 && response.headers['content-length']) {
                sizeInBytes = parseInt(response.headers['content-length']);
                console.log(`✓ [${index + 1}] HEAD ${sizeInBytes} bytes - ${img.url.substring(0, 80)}...`);
              } else {
                throw new Error(`HEAD returned status ${response.status}`);
              }
            } catch (headError) {
              // Fallback to GET
              const response = await axios.get(img.url, {
                timeout: 15000,
                maxRedirects: 5,
                responseType: 'arraybuffer',
                validateStatus: (status) => status < 500,
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                  'Accept': 'image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                  'Accept-Language': 'en-US,en;q=0.9',
                  'Cache-Control': 'no-cache',
                  'Referer': url
                }
              });

              if (response.status === 200) {
                sizeInBytes = response.data.byteLength;
                console.log(`✓ [${index + 1}] GET ${sizeInBytes} bytes - ${img.url.substring(0, 80)}...`);
              }
            }
          }

          if (sizeInBytes === 0) {
            return { ...img, fileSize: 'Unknown', fileSizeBytes: 0 };
          }

          const sizeInKB = (sizeInBytes / 1024).toFixed(2);
          const sizeInMB = (sizeInBytes / (1024 * 1024)).toFixed(2);

          return {
            ...img,
            fileSize: sizeInBytes > 1024 * 1024 ? `${sizeInMB} MB` : `${sizeInKB} KB`,
            fileSizeBytes: sizeInBytes
          };
        } catch (error) {
          console.log(`✗ [${index + 1}] FAILED: ${error.message} - ${img.url.substring(0, 80)}...`);
          return { ...img, fileSize: 'Unknown', fileSizeBytes: 0 };
        }
      })
    );

    const successCount = imagesWithSizes.filter(img => img.fileSizeBytes > 0).length;
    console.log(`\n📊 Results: ${successCount}/${images.length} images sized successfully\n`);

    res.json({ images: imagesWithSizes, count: imagesWithSizes.length });

  } catch (error) {
    console.error('❌ Scraping error:', error.message);
    if (desktopPage) await desktopPage.close();
    if (mobilePage) await mobilePage.close();
    res.status(500).json({ error: 'Failed to scrape images: ' + error.message });
  }
});

// Cleanup on exit
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing browser...');
  if (browser) await browser.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, closing browser...');
  if (browser) await browser.close();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`Environment: ${NODE_ENV}`);
  console.log(`Using Puppeteer with DUAL viewport scraping (Desktop + Mobile)`);
});
