// api/proxy.js

const fetch = require('node-fetch');
const { URL } = require('url'); // URL işlemek için

// Kaldırılacak veya değiştirilecek başlıklar (küçük harfle)
const BLOCKED_HEADERS = [
    'content-security-policy',
    'x-frame-options',
    // 'strict-transport-security', // HSTS'yi kaldırmak genellikle iyi bir fikir değildir
    'content-encoding', // Sıkıştırmayı proxy'nin tekrar yapması gerekebilir, şimdilik kaldıralım
    'transfer-encoding' // Chunked gibi kodlamalar sorun çıkarabilir
];

module.exports = async (req, res) => {
    // CORS Ayarları (Geliştirme için *, dağıtımda kısıtla!)
    // ÖNEMLİ: Dağıtımdan önce Firebase URL'niz ile değiştirin!
    // Örn: res.setHeader('Access-Control-Allow-Origin', 'https://habercim-yeni.web.app');
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
        // URL geçerliliğini kontrol et
        new URL(decodedUrl);
    } catch (error) {
        return res.status(400).json({ error: 'Geçersiz URL formatı.' });
    }

    try {
        console.log(`Proxying request for: ${decodedUrl}`); // Loglama
        const targetResponse = await fetch(decodedUrl, {
            headers: {
                'User-Agent': 'Habercim RSS Reader (Vercel Proxy)',
                'Accept': req.headers.accept || '*/*', // İstemcinin accept başlığını ilet
                // Diğer gerekli başlıkları da iletebiliriz (örn: Accept-Language)
            },
            redirect: 'follow', // Yönlendirmeleri takip et
            timeout: 15000, // Zaman aşımını biraz artıralım (15 saniye)
        });

        if (!targetResponse.ok) {
            const errorText = await targetResponse.text().catch(() => 'Detay alınamadı');
            console.error(`Proxy Hata: ${targetResponse.status} ${targetResponse.statusText} - URL: ${decodedUrl} - Detay: ${errorText}`);
            // Hata durumunda istemciye daha anlamlı bir yanıt dönelim
            return res.status(targetResponse.status).json({
                error: `Kaynak sunucu hatası: ${targetResponse.status} ${targetResponse.statusText}`,
                details: errorText.substring(0, 500) // Çok uzun olmasın
            });
        }

        // Yanıt içeriğini buffer olarak alalım (binary veriler için daha iyi)
        const bodyBuffer = await targetResponse.buffer();

        // Orijinal başlıklardan filtrelenmiş yeni başlıklar oluştur
        const responseHeaders = {};
        targetResponse.headers.forEach((value, name) => {
            const lowerCaseName = name.toLowerCase();
            if (!BLOCKED_HEADERS.includes(lowerCaseName)) {
                // 'set-cookie' başlığı birden fazla olabilir, dizi olarak sakla
                if (lowerCaseName === 'set-cookie') {
                    if (!responseHeaders[name]) {
                        responseHeaders[name] = [];
                    }
                    responseHeaders[name].push(value);
                } else {
                    responseHeaders[name] = value;
                }
            } else {
                console.log(`Removing blocked header: ${name}`); // Loglama
            }
        });

        // Content-Type başlığını mutlaka ayarlayalım
        const contentType = targetResponse.headers.get('content-type') || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);

        // Diğer filtrelenmiş başlıkları ayarla
        for (const name in responseHeaders) {
            // 'set-cookie' başlıklarını ayrı ayrı ayarla
            if (name.toLowerCase() === 'set-cookie') {
                 // Vercel'de set-cookie başlığını doğrudan ayarlamak yerine dizi olarak göndermek gerekebilir
                 // Ancak genellikle tek tek setHeader ile çalışır. Sorun olursa burayı kontrol et.
                responseHeaders[name].forEach(cookie => {
                    res.setHeader('Set-Cookie', cookie);
                });
            } else {
                res.setHeader(name, responseHeaders[name]);
            }
        }

        // Cache kontrolü (kısa süreli)
        res.setHeader('Cache-Control', 'public, max-age=60'); // 1 dakika cache

        // Yanıtı gönder
        res.status(targetResponse.status).send(bodyBuffer);

    } catch (error) {
        console.error(`Proxy Yakalama Hatası - URL: ${decodedUrl}`, error);
        res.status(500).json({
            error: 'Proxy sunucusunda bir hata oluştu.',
            details: error.message
        });
    }
};
