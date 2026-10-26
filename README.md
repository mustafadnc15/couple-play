# CouplePlay 💞

Uzak mesafe ilişkisi yürüten çiftler için gerçek zamanlı, birlikte oynanan aktiviteler.
*Real-time activities for long-distance couples to play together.* (English below.)

## Aktiviteler

| | Aktivite | Nasıl oynanır |
|---|---|---|
| 🧩 | **Yapboz** | Parçalar ekranın kenarlarında durur; ikiniz aynı anda sürükleyip ortadaki yerlerine yerleştirirsiniz. Hazır resimlerden birini ya da kendi fotoğrafınızı seçin (12 / 24 / 48 parça). |
| 🎨 | **Sayılarla Boyama** | Herhangi bir fotoğraf (kendi fotoğraflarınız ya da hazır olanlar) gerçek boyama kitleri gibi numaralı bölgelere çevrilir. Paletten o numaranın rengini seçip kova ya da fırçayla birlikte boyarsınız. Doğru boyanan bölgenin numarası kaybolur; tablo %100 olunca kutlama başlar. Yakınlaştırma, kaydırma ve örnek resim var; 3 zorluk seviyesi (8/12/16 renk). |
| 🧱 | **Lego** | Yapboz gibi ama tuğlalarla: kenarlardaki lego tuğlalarını plan üzerindeki aynı boy ve renkteki yerlere oturtun (kalp, ev, çiçek, roket). |
| 🔤 | **Bil Bakalım** | Wordle gibi. Herkes eşi için gizli bir kelime ya da sayı seçer, sonra turlar halinde aynı anda tahmin edilir. Doğru yerdeki harf/basamak yeşil, başka yerde olan sarı, olmayan gri. |
| 🔵 | **Bluetooth** | İkiniz aynı anda bir kelime yazarsınız; kelimeler birlikte açılır. Aynı kelimeyi yazana kadar turlar devam eder (kullanılan kelime tekrar kullanılamaz). |

Ayrıca: TR/EN dil seçeneği, eşinizin imlecini canlı görme, ekranda uçuşan emoji tepkileri, telefon ve bilgisayar desteği.
Kayıt yok: oda oluşturun, bağlantıyı eşinize gönderin.

## Çalıştırma

Node.js 18+ gerekir.

```bash
npm install
npm start          # http://localhost:3000
npm run dev        # dosya değişince yeniden başlar
npm test
```

Port `PORT` ortam değişkeniyle değiştirilebilir.

### Yayına alma

Uygulama WebSocket kullanan tek bir Node.js sunucusudur; Render, Railway, Fly.io gibi Node çalıştıran herhangi bir
yerde `npm install && npm start` ile çalışır. (GitHub Pages/statik hosting yeterli değildir, çünkü gerçek zamanlı
senkronizasyon için sunucu gerekir.) Odalar bellekte tutulur: sunucu yeniden başlarsa açık odalar sıfırlanır,
6 saat kullanılmayan odalar otomatik silinir.

## Teknoloji

- **Sunucu:** Node.js, Express, Socket.IO. Oyun durumu sunucuda tutulur (otoriter); örneğin Bil Bakalım'da eşin
  gizli kelimesi oyun bitene kadar istemciye hiç gönderilmez.
- **İstemci:** Derleme adımı olmayan saf JavaScript (ES modülleri) + Canvas. Yapboz parçaları, lego tuğlaları, boyama
  şablonları ve hazır resimler kodla çizilir; harici görsel dosyası yoktur.

```
server/
  index.js            Express + Socket.IO
  rooms.js            odalar, oyuncular, olay yönlendirme
  activities/         her aktivitenin sunucu mantığı (puzzle, paint, lego, guess, bluetooth)
public/
  index.html, css/style.css
  js/app.js           arayüz kabuğu (ana sayfa, lobi, aktivite görünümü)
  js/i18n.js          TR/EN metinler
  js/lib/             dragboard (ortak sürükle-bırak tuvali), art (hazır resimler), ui yardımcıları
  js/activities/      her aktivitenin istemci tarafı
test/                 oyun mantığı birim testleri + iki istemcili Socket.IO testi
```

### Yeni aktivite eklemek

1. `server/activities/<id>.js`: `{ id, create(options, info), actions: { ad(state, data, ctx) }, view?, onLeave? }`
   dışa aktarın ve `server/activities/index.js` listesine ekleyin. `ctx` ile `emitAll`, `emitOthers`, `reply`, `sync`
   çağrılabilir.
2. `public/js/activities/<id>.js`: `{ id, icon, accent, renderOptions?, mount(root, api) }` dışa aktarın ve
   `public/js/activities/index.js` listesine ekleyin. `mount`, `onState`, `onEvent`, `onCursor`, `destroy` içeren bir
   nesne döndürür.
3. `public/js/i18n.js` içine `act.<id>` ve `act.<id>.desc` metinlerini (TR ve EN) ekleyin.

### Boyama resimleri

Fotoğraf, oyunu başlatan kişinin tarayıcısında boyama şablonuna çevrilir (`public/js/lib/pbn.js`: Lab renk
uzayında k-means ile renk azaltma, gürültü temizleme, küçük bölgeleri komşularıyla birleştirme) ve sunucu üzerinden
eşe gönderilir, böylece ikiniz de birebir aynı bölgeleri görürsünüz. Hazır fotoğraf eklemek için resmi
`public/img/paint/` klasörüne koyup `index.json` listesine yazmanız yeterli. Mevcut fotoğrafların kaynakları
`public/img/paint/CREDITS.md` dosyasında (CC0 / kamu malı).

Sürükle-bırak türü oyunlar için `server/activities/drag.js` ve `public/js/lib/dragboard.js` hazır kullanılabilir.

---

## English

**Activities:** Jigsaw (pieces start around the edges, both partners drag them into the board at once; built-in
pictures or your own photo), Paint by Numbers (any photo, yours or a bundled one, is turned into numbered regions like a real paint-by-number kit; bucket or brush, zoom, progress check),
Lego (snap bricks onto a blueprint), Guess It (Wordle-style: guess the word or number your partner picked, in
simultaneous rounds) and Bluetooth (both type a word until you type the same one). The UI is available in Turkish and
English; you can see your partner's cursor and send floating emoji reactions.

**Run:** `npm install && npm start`, then open http://localhost:3000, create a room and send the link to your partner.
`npm test` runs the test suite. Deploy anywhere that runs a long-lived Node.js process with WebSockets
(Render, Railway, Fly.io, a VPS…). Rooms are kept in memory.

**Adding an activity:** see "Yeni aktivite eklemek" above: one server module, one client module and two i18n strings.
