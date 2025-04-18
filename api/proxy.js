// node-fetch'i Vercel ortamında kullanmak için import ediyoruz
// Vercel genellikle kendi fetch implementasyonunu sağlar ama node-fetch daha tutarlı olabilir.
// Eğer Vercel'in yerleşik fetch'i yeterliyse bu satır kaldırılabilir ve package.json'dan da silinebilir.
// Şimdilik node-fetch ile devam edelim.
const fetch = require('node-fetch');

module.exports = async (req, res) => {
    // CORS Ayarları - Sadece belirli bir domainden gelen isteklere izin ver
    // Firebase projenizin URL'sini buraya yazın (Örn: https://habercim-yeni.web.app)
    // Şimdilik '*' kullanarak tüm domainlere izin verelim, dağıtımdan önce güncellenmeli!
    // VEYA daha güvenlisi, Vercel proje ayarlarından izin verilen domainleri yönetmek.
    res.setHeader('Access-Control-Allow-Origin', '*'); // DİKKAT: Dağıtımdan önce kısıtlayın!
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Tarayıcıların CORS öncesi gönderdiği OPTIONS isteğini handle et
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // İstekten 'url' parametresini al
    const { url } = req.query;

    // URL parametresi yoksa hata döndür
    if (!url) {
        res.status(400).json({ error: 'URL parametresi eksik.' });
        return; // Fonksiyonun devam etmesini engelle
    }

    // URL'nin geçerli bir HTTP/HTTPS URL olup olmadığını kontrol et (basit kontrol)
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        res.status(400).json({ error: 'Geçersiz URL formatı.' });
        return;
    }

    try {
        // Belirtilen URL'den RSS beslemesini fetch ile çek
        const response = await fetch(decodeURIComponent(url), { // URL decode edilebilir
            headers: {
                // Bazı RSS sağlayıcıları User-Agent isteyebilir
                'User-Agent': 'Habercim RSS Reader (Vercel Proxy)',
                'Accept': 'application/rss+xml, application/xml, text/xml', // Kabul edilen tipler
            },
            // Zaman aşımı ekleyebiliriz (örneğin 10 saniye)
            timeout: 10000,
        });

        // Yanıt başarılı değilse (2xx dışında bir status kodu varsa) hata fırlat
        if (!response.ok) {
            // Daha detaylı hata mesajı
            const errorText = await response.text().catch(() => 'Detay alınamadı');
            console.error(`Proxy Hata: ${response.status} ${response.statusText} - URL: ${url} - Detay: ${errorText}`);
            throw new Error(`Kaynak sunucu hatası: ${response.status} ${response.statusText}`);
        }

        // Yanıt içeriğini text olarak al
        const feedText = await response.text();

        // Yanıtın Content-Type başlığını orijinal kaynaktan almaya çalışalım, yoksa XML varsayalım
        const contentType = response.headers.get('content-type') || 'application/xml; charset=utf-8';

        // Başarılı yanıtı istemciye gönder
        res.setHeader('Content-Type', contentType);
        // Cache kontrolü ekleyebiliriz (örneğin 5 dakika)
        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
        res.status(200).send(feedText);

    } catch (error) {
        // Hata oluşursa logla ve istemciye 500 hatası gönder
        console.error(`Proxy Yakalama Hatası - URL: ${url}`, error);
        res.status(500).json({
            error: 'RSS beslemesi alınırken bir hata oluştu.',
            details: error.message
        });
    }
};
