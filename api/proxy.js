// api/proxy.js (Daha detaylı loglama ile)

const fetch = require('node-fetch');
const { URL } = require('url');

// Kaldırılacak veya değiştirilecek başlıklar (küçük harfle)
const BLOCKED_HEADERS = [
    'content-security-policy',
    'x-frame-options',
    // 'strict-transport-security',
    'content-encoding',
    'transfer-encoding'
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

    console.log(`[PROXY START] Requesting: ${decodedUrl}`); // Loglama: Başlangıç

    try {
        const targetResponse = await fetch(decodedUrl, {
            headers: {
                'User-Agent': 'Habercim RSS Reader (Vercel Proxy)',
                'Accept': req.headers.accept || '*/*',
            },
            redirect: 'follow', // Yönlendirmeleri takip etmeye devam edelim
            timeout: 15000,
        });

        console.log(`[PROXY FETCHED] Status: ${targetResponse.status} for ${decodedUrl}`); // Loglama: Hedef Durum Kodu

        // Loglama: Hedef Sunucudan Alınan Tüm Başlıklar
        console.log('[PROXY TARGET HEADERS RECEIVED]');
        const receivedHeaders = {};
         targetResponse.headers.forEach((value, name) => {
            console.log(`  ${name}: ${value}`);
            receivedHeaders[name.toLowerCase()] = value; // Kolay kontrol için küçük harfle sakla
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

        // Başlıkları Filtrele ve İstemciye Gönderilecekleri Hazırla
        console.log('[PROXY FILTERING/SENDING HEADERS]');
        let finalContentType = receivedHeaders['content-type'] || 'application/octet-stream';
        res.setHeader('Content-Type', finalContentType);
        console.log(`  SENT -> Content-Type: ${finalContentType}`);

        targetResponse.headers.forEach((value, name) => {
            const lowerCaseName = name.toLowerCase();
            // Content-Type'ı tekrar ayarlama ve engellenenleri atla
            if (lowerCaseName !== 'content-type' && !BLOCKED_HEADERS.includes(lowerCaseName)) {
                // Set-Cookie özel durumu
                if (lowerCaseName === 'set-cookie') {
                    // Vercel genellikle tek setHeader ile birden fazla cookie'yi handle edemez,
                    // bu yüzden gelen her cookie için ayrı setHeader çağrısı yapmalıyız.
                    // Ancak node-fetch'in headers objesi bunu birleştirebilir. Tekrar deneyelim.
                    // Eğer cookie'ler çalışmazsa, burayı `res.appendHeader` veya benzeri bir yöntemle değiştirmek gerekebilir.
                     res.setHeader(name, value); // Tekrar deneyelim
                     console.log(`  SENT -> ${name}: ${value.substring(0,50)}...`);
                } else {
                    res.setHeader(name, value);
                    console.log(`  SENT -> ${name}: ${value}`);
                }
            } else if (BLOCKED_HEADERS.includes(lowerCaseName)) {
                 console.log(`  REMOVED -> ${name}: ${value}`);
            }
        });

        res.setHeader('Cache-Control', 'public, max-age=60');
        console.log('  SENT -> Cache-Control: public, max-age=60');

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
