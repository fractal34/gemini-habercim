document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elementleri ---
    const categoryMenu = document.getElementById('category-menu');
    const newsList = document.getElementById('news-list');
    const newsDetailFrame = document.getElementById('news-iframe');
    const clockElement = document.getElementById('clock');
    const loadingMessage = document.querySelector('.loading-message');

    // --- Sabitler ve Ayarlar ---
    const PROXY_URL = '/api/proxy?url='; // Vercel proxy endpoint'i
    const CATEGORIES = {
        'Son Dakika': { url: 'https://www.milliyet.com.tr/rss/rssnew/sondakikarss.xml', color: '#ff0000' },
        'Gündem': { url: 'https://www.milliyet.com.tr/rss/rssnew/gundem.xml', color: '#0000ff' },
        'Spor': { url: 'http://www.hurriyet.com.tr/rss/spor', color: '#008000' },
        'Magazin': { url: 'https://www.milliyet.com.tr/rss/rssnew/magazinrss.xml', color: '#800080' },
        'Politika': { url: 'https://www.milliyet.com.tr/rss/rssnew/siyasetrss.xml', color: '#333333' }, // Koyu Gri
        'Dünya': { url: 'https://www.milliyet.com.tr/rss/rssnew/dunyarss.xml', color: '#ffa500' },
        'Ekonomi': { url: 'https://www.milliyet.com.tr/rss/rssnew/ekonomi.xml', color: '#20B2AA' } // LightSeaGreen gibi bir renk
    };
    const DEFAULT_CATEGORY = 'Son Dakika';
    let activeCategories = [DEFAULT_CATEGORY]; // Başlangıçta aktif olan kategori
    let allNewsItems = []; // Tüm haberleri saklamak için dizi

    // --- Fonksiyonlar ---

    // Saat Güncelleme Fonksiyonu
    function updateClock() {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        clockElement.textContent = `${hours}:${minutes}`;
    }

    // Kategori Düğmelerini Oluşturma
    function createCategoryButtons() {
        categoryMenu.innerHTML = ''; // Önce temizle
        Object.keys(CATEGORIES).forEach(categoryName => {
            const button = document.createElement('button');
            button.classList.add('category-btn');
            button.dataset.category = categoryName;
            button.textContent = categoryName.toUpperCase();
            if (activeCategories.includes(categoryName)) {
                button.classList.add('active');
                // Aktif düğme stilini CSS'den alacak, ancak istersen buradan da renk atayabilirsin
                // button.style.backgroundColor = CATEGORIES[categoryName].color;
                // button.style.color = '#fff'; // Veya kontrast renge göre ayarla
            }
            button.addEventListener('click', handleCategoryClick);
            categoryMenu.appendChild(button);
        });
    }

    // Kategori Tıklama Olay Yöneticisi
    function handleCategoryClick(event) {
        const clickedCategory = event.target.dataset.category;

        // Çoklu seçim mantığı: Tıklanan kategori zaten aktifse kaldır, değilse ekle
        const index = activeCategories.indexOf(clickedCategory);
        if (index > -1) {
            // Eğer tek aktif kategori ise kaldırma
            if (activeCategories.length > 1) {
                activeCategories.splice(index, 1);
            }
        } else {
            activeCategories.push(clickedCategory);
        }

        // Eğer hiç kategori kalmadıysa varsayılana dön
        if (activeCategories.length === 0) {
            activeCategories.push(DEFAULT_CATEGORY);
        }

        // Düğmelerin görünümünü güncelle
        updateCategoryButtons();
        // Haber listesini filtrele
        displayNews();
    }

    // Kategori Düğmelerinin Aktif/Pasif Durumunu Güncelle
    function updateCategoryButtons() {
        const buttons = categoryMenu.querySelectorAll('.category-btn');
        buttons.forEach(button => {
            if (activeCategories.includes(button.dataset.category)) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        });
    }

    // RSS Beslemesini Çekme ve Ayrıştırma
    async function fetchAndParseRSS(categoryName) {
        const feedInfo = CATEGORIES[categoryName];
        if (!feedInfo) return []; // Kategori bulunamazsa boş dizi dön

        const urlToFetch = PROXY_URL + encodeURIComponent(feedInfo.url);
        console.log(`Fetching ${categoryName} from: ${feedInfo.url}`); // Debug için

        try {
            const response = await fetch(urlToFetch);
            if (!response.ok) {
                console.error(`Proxy error for ${categoryName}: ${response.status} ${response.statusText}`);
                const errorData = await response.json().catch(() => ({}));
                console.error("Proxy error details:", errorData);
                return []; // Hata durumunda boş dizi dön
            }
            const xmlText = await response.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, "text/xml");

            // Hata kontrolü (XML parse hatası)
            const parseError = xmlDoc.querySelector("parsererror");
            if (parseError) {
                console.error(`XML Parse Error for ${categoryName}:`, parseError.textContent);
                return [];
            }

            const items = xmlDoc.querySelectorAll("item");
            const news = [];
            items.forEach(item => {
                const title = item.querySelector("title")?.textContent || 'Başlık Yok';
                const link = item.querySelector("link")?.textContent || '#';
                const pubDateStr = item.querySelector("pubDate")?.textContent;
                const description = item.querySelector("description")?.textContent || '';
                // Resmi description içinden veya enclosure'dan almaya çalışalım
                let imageUrl = extractImageUrl(description) || item.querySelector("enclosure")?.getAttribute("url") || item.querySelector("media\\:content, content")?.getAttribute("url") || null;

                // Tarihi formatla
                const pubDate = pubDateStr ? new Date(pubDateStr) : new Date();
                const formattedDate = formatDate(pubDate);

                news.push({
                    title,
                    link,
                    pubDate: formattedDate, // Formatlanmış tarih
                    rawDate: pubDate, // Sıralama için ham tarih
                    description, // Ham açıklama (belki ileride kullanılır)
                    imageUrl,
                    category: categoryName,
                    color: feedInfo.color // Kategori rengini ekle
                });
            });
            console.log(`Fetched ${news.length} items for ${categoryName}`); // Debug
            return news;
        } catch (error) {
            console.error(`Error fetching or parsing RSS for ${categoryName}:`, error);
            return []; // Hata durumunda boş dizi dön
        }
    }

    // Description içinden resim URL'si çıkarma (basit regex)
    function extractImageUrl(description) {
        if (!description) return null;
        const imgTagMatch = description.match(/<img[^>]+src="([^">]+)"/);
        return imgTagMatch ? imgTagMatch[1] : null;
    }

    // Tarihi DD.MM.YYYY - HH:MM formatına çevirme
    function formatDate(date) {
        if (!(date instanceof Date) || isNaN(date)) {
            return "Tarih Yok";
        }
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0'); // Aylar 0'dan başlar
        const year = date.getFullYear();
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${day}.${month}.${year} - ${hours}:${minutes}`;
    }

    // Tüm Haberleri Getirme
    async function fetchAllNews() {
        loadingMessage.style.display = 'block'; // Yükleniyor mesajını göster
        newsList.innerHTML = ''; // Listeyi temizle
        allNewsItems = []; // Önceki haberleri temizle

        const fetchPromises = Object.keys(CATEGORIES).map(categoryName => fetchAndParseRSS(categoryName));
        const results = await Promise.all(fetchPromises);

        // Sonuçları tek bir diziye birleştir
        results.forEach(newsArray => {
            allNewsItems = allNewsItems.concat(newsArray);
        });

        // Haberleri tarihe göre en yeniden eskiye sırala
        allNewsItems.sort((a, b) => b.rawDate - a.rawDate);

        loadingMessage.style.display = 'none'; // Yükleniyor mesajını gizle
        displayNews(); // Haberleri göster
    }

    // Haberleri Filtreleyip Gösterme
    function displayNews() {
        newsList.innerHTML = ''; // Listeyi temizle

        const filteredNews = allNewsItems.filter(item => activeCategories.includes(item.category));

        if (filteredNews.length === 0) {
            newsList.innerHTML = '<p class="loading-message">Seçili kategorilerde haber bulunamadı.</p>';
            return;
        }

        filteredNews.forEach(item => {
            const newsItemElement = document.createElement('article');
            newsItemElement.classList.add('news-item');
            newsItemElement.dataset.link = item.link; // Tıklama için linki sakla

            // Resim Alanı
            const imageContainer = document.createElement('div');
            imageContainer.classList.add('news-image-container');
            if (item.imageUrl) {
                const img = document.createElement('img');
                img.src = item.imageUrl;
                img.alt = item.title;
                img.classList.add('news-image');
                img.onerror = () => { // Resim yüklenemezse placeholder göster
                    imageContainer.innerHTML = '<span style="font-size:12px; color:#999;">Resim Yok</span>';
                };
                imageContainer.appendChild(img);
            } else {
                imageContainer.innerHTML = '<span style="font-size:12px; color:#999;">Resim Yok</span>'; // Resim yoksa
            }

            // İçerik Alanı (Başlık ve Tarih)
            const contentElement = document.createElement('div');
            contentElement.classList.add('news-content');
            contentElement.style.backgroundColor = item.color; // Kategori rengini arka plan yap

            // Başlık
            const titleElement = document.createElement('h3');
            titleElement.classList.add('news-title');
            titleElement.textContent = item.title;
            // Başlık rengini arka plana göre ayarla (basit kontrast)
            titleElement.style.color = isColorDark(item.color) ? '#fff' : '#333';

            // Tarih
            const dateElement = document.createElement('span');
            dateElement.classList.add('news-date');
            dateElement.textContent = item.pubDate;
            // Tarih arka planını biraz daha koyu yapalım
            dateElement.style.backgroundColor = darkenColor(item.color, 20);
            dateElement.style.color = '#fff'; // Tarih rengi genellikle beyaz

            contentElement.appendChild(titleElement);
            contentElement.appendChild(dateElement);

            newsItemElement.appendChild(imageContainer);
            newsItemElement.appendChild(contentElement);

            // Tıklama Olayı
            newsItemElement.addEventListener('click', () => {
                const newsUrl = item.link;
                console.log(`Clicked news item. URL: ${newsUrl}`); // Debug

                // iframe'in src'sini güncelle
                // Milliyet linkleri için proxy kullan, diğerleri için doğrudan link
                if (newsUrl && newsUrl.startsWith('https://www.milliyet.com.tr')) {
                    const proxyUrl = `/api/proxy?url=${encodeURIComponent(newsUrl)}`;
                    console.log(`Using proxy for Milliyet: ${proxyUrl}`); // Debug
                    newsDetailFrame.src = proxyUrl;
                } else if (newsUrl) {
                    console.log(`Using direct link for: ${newsUrl}`); // Debug
                    newsDetailFrame.src = newsUrl;
                } else {
                    console.log("No valid URL found for this item.");
                    newsDetailFrame.src = 'about:blank'; // Geçerli URL yoksa boş sayfa
                }

                // İsteğe bağlı: Tıklanan öğeyi vurgula
                document.querySelectorAll('.news-item.selected').forEach(el => el.classList.remove('selected'));
                newsItemElement.classList.add('selected');
            });

            newsList.appendChild(newsItemElement);
        });
    }

    // Renk koyu mu açık mı kontrolü (basit)
    function isColorDark(hexColor) {
        if (!hexColor) return false;
        const color = hexColor.substring(1); // # işaretini kaldır
        const r = parseInt(color.substring(0, 2), 16);
        const g = parseInt(color.substring(2, 4), 16);
        const b = parseInt(color.substring(4, 6), 16);
        // Parlaklık formülü (basit)
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        return brightness < 128; // Eşik değeri (ayarlanabilir)
    }

    // Rengi koyulaştırma fonksiyonu
    function darkenColor(hexColor, percent) {
        if (!hexColor) return '#555'; // Varsayılan koyu renk
        let color = hexColor.substring(1);
        let num = parseInt(color, 16),
            amt = Math.round(2.55 * percent),
            R = (num >> 16) - amt,
            G = (num >> 8 & 0x00FF) - amt,
            B = (num & 0x0000FF) - amt;
        R = R < 0 ? 0 : R;
        G = G < 0 ? 0 : G;
        B = B < 0 ? 0 : B;
        return "#" + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
    }


    // --- Başlangıç ---
    function init() {
        updateClock(); // Saati ilk kez ayarla
        setInterval(updateClock, 60000); // Her dakika güncelle
        createCategoryButtons(); // Kategori düğmelerini oluştur
        fetchAllNews(); // Tüm haberleri çek ve göster
    }

    init(); // Uygulamayı başlat
});
