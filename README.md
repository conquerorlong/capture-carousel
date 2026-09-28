# Capture Carousel — kesintisiz Instagram carousel editörü ve serbest pano

Kaydırdıkça devam eden carousel'ler tasarlamak ve fikirleri sonsuz bir panoda toplamak için ücretsiz web uygulaması (PWA).
Capture Studio (@capturestudiocomtr), AjansMerter (@ajansmerter) ve @segnante tarafından ücretsiz sunulur.

Yayın adresi: https://conquerorlong.github.io/capture-carousel/
Mac'te tarayıcıda, iPhone/Android'de Safari/Chrome'da çalışır; ana ekrana eklenince uygulama gibi açılır
ve internetsiz de çalışır.

- Derleme adımı yok: saf HTML + CSS + JavaScript modülleri.
- Fotoğraflar, videolar ve projeler **yalnızca cihazda** (IndexedDB) saklanır; sunucuya hiçbir şey gönderilmez.
  Bu yüzden Mac'te yapılan proje telefonda görünmez (her cihazın kendi listesi vardır).
- Yazı tipleri `fonts/` klasöründen yüklenir (SIL Open Font License); Google'a istek gitmez. Analitik/çerez yok.

## Yerelde çalıştırma

```bash
python3 -m http.server 8790
```

Sonra `http://localhost:8790` adresini aç.

## Yayına alma (cPanel)

1. cPanel'de bir alt alan adı aç (ör. `carousel.ajansmerter.com`) ve SSL'in açık olduğundan emin ol
   (ana ekrana ekleme ve paylaşım menüsü **HTTPS** ister).
2. Bu klasördeki şu dosyaları alt alan adının kök klasörüne yükle:
   `index.html`, `manifest.webmanifest`, `sw.js`, `css/`, `js/`, `icons/`
3. iPhone'da Safari ile aç → Paylaş → **Ana Ekrana Ekle**.

Güncelleme: değişen dosyaları aynı yere yeniden yükle. `sw.js` dosyaları her açılışta sunucuya sorar,
yeni sürüm bir sonraki açılışta gelir.

## Dosyalar

| Dosya | Görev |
|---|---|
| `js/app.js` | Ekranlar, paneller, içe/dışa aktarma, geçmiş (geri al) |
| `js/stage.js` | Tuval: kaydırma/yakınlaştırma, seçim, taşıma, büyütme, kırpma, döndürme, hizalama |
| `js/render.js` | Çizim çekirdeği — editör ve dışa aktarma aynı fonksiyonu kullanır |
| `js/templates.js` | Hazır şablonlar |
| `js/store.js` | IndexedDB kayıt |
| `js/zip.js` | Kütüphanesiz ZIP üretici |
| `js/video.js` | Video yükleme ve slaytı MP4 olarak kaydetme (en fazla 2 video, 30 sn) |
| `fonts/` | Yerel yazı tipleri (latin + latin-ext) |
