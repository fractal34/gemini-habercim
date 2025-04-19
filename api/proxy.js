// api/proxy.js (Daha agresif başlık temizleme denemesi)

const fetch = require('node-fetch');
const { URL } = require('url');

// Kaldırılacak veya değiştirilecek başlıklar (küçük harfle)
// X-Frame-Options ve Content-Security-Policy özel olarak ele alınacak
const BLOCKED_HEADERS = [
    // 'content-security-policy', // Özel olarak ele alınacak
    // 'x-frame-options', // Özel olarak ele alınacak
    'strict-transport-security', // Bunu kaldırmak genellikle önerilmez ama deneyelim
    'content-encoding',
    'transfer-encoding',
    'referrer-policy', // Bunu da kaldıralım
    'expect-ct',
    'feature-policy',
    'permissions-policy',
    'cross-origin-embedder-policy',
    'cross-origin-opener-policy',
    'cross-origin-resource-policy'
];

module.exports = async (req, res) => {
    // CORS Ayarları (Geliştirme için *, dağıtımda kısıtla!)
    // ÖNEMLİ: Dağıtımdan önce Firebase URL'niz ile değiştirin!
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const targetUrl = req.query.url;

    if (!targetUrl) {
        return res.status(400).json({ error: 'URL parametresi eksik.' });
    }

    let decodedUrl;
    try {
        decodedUrl = decodeURIComponent(targetUrl);
        new URL(decodedUrl);
    } catch (error) {
        return res.status(400).json({ error: 'Geçersiz URL formatı.' });
    }

    console.log(`[PROXY START] Requesting: ${decodedUrl}`);

    try {
        const targetResponse = await fetch(decodedUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36', // Daha yaygın bir User-Agent
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9,tr;q=0.8', // Dil tercihi ekleyelim
                'Referer': 'https://www.google.com/' // Sahte bir referer gönderelim
            },
            redirect: 'follow',
            timeout: 15000,
        });

        console.log(`[PROXY FETCHED] Status: ${targetResponse.status} for ${decodedUrl}`);

        console.log('[PROXY TARGET HEADERS RECEIVED]');
        const receivedHeaders = {};
         targetResponse.headers.forEach((value, name) => {
            console.log(`  ${name}: ${value}`);
            receivedHeaders[name.toLowerCase()] = value;
        });

        if (!targetResponse.ok) {
            const errorText = await targetResponse.text().catch(() => 'Detay alınamadı');
            console.error(`[PROXY ERROR] Non-OK status: ${targetResponse.status} ${targetResponse.statusText} - URL: ${decodedUrl} - Body: ${errorText.substring(0, 200)}`);
            return res.status(targetResponse.status).json({
                error: `Kaynak sunucu hatası: ${targetResponse.status} ${targetResponse.statusText}`,
                details: errorText.substring(0, 500)
            });
        }

        const bodyBuffer = await targetResponse.buffer();

        console.log('[PROXY FILTERING/SENDING HEADERS]');
        // Önce tüm başlıkları temizleyelim (Vercel bazılarını otomatik ekleyebilir)
        // res.removeHeader('X-Frame-Options'); // Bu yöntem Vercel'de olmayabilir
        // res.removeHeader('Content-Security-Policy');

        // Content-Type'ı ayarla
        let finalContentType = receivedHeaders['content-type'] || 'application/octet-stream';
        res.setHeader('Content-Type', finalContentType);
        console.log(`  SENT -> Content-Type: ${finalContentType}`);

        // Diğer başlıkları filtreleyerek ayarla
        targetResponse.headers.forEach((value, name) => {
            const lowerCaseName = name.toLowerCase();

            // Engellenenler listesindeyse veya özel olarak ele alınacaksa atla
            if (BLOCKED_HEADERS.includes(lowerCaseName) ||
                lowerCaseName === 'x-frame-options' ||
                lowerCaseName === 'content-security-policy') {
                console.log(`  REMOVED -> ${name}: ${value}`);
            }
            // Content-Type zaten ayarlandı, tekrar ayarlama
            else if (lowerCaseName === 'content-type') {
                // pass
            }
            // Set-Cookie özel durumu
            else if (lowerCaseName === 'set-cookie') {
                 res.setHeader(name, value); // Tekrar deneyelim
                 console.log(`  SENT -> ${name}: ${value.substring(0,50)}...`);
            }
            // Diğer tüm başlıkları gönder
            else {
                res.setHeader(name, value);
                console.log(`  SENT -> ${name}: ${value}`);
            }
        });

        // X-Frame-Options ve CSP'yi kesin olarak kaldırdığımızdan emin olalım
        // (Vercel'in bunları otomatik eklemediğini varsayıyoruz)
        // Eğer Vercel bunları ekliyorsa, vercel.json içinde headers kısmından override etmek gerekebilir.

        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate'); // Cache'lemeyi tamamen engelle
        console.log('  SENT -> Cache-Control: no-store...');

        console.log(`[PROXY SUCCESS] Sending ${bodyBuffer.length} bytes for ${decodedUrl}`);
        res.status(targetResponse.status).send(bodyBuffer);

    } catch (error) {
        console.error(`[PROXY CRITICAL ERROR] URL: ${decodedUrl}`, error);
        res.status(500).json({
            error: 'Proxy sunucusunda bir hata oluştu.',
            details: error.message
        });
    }
};
