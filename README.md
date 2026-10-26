# CouplePlay 💞

Uzak mesafe ilişkisi yürüten çiftler için gerçek zamanlı, birlikte oynanan aktiviteler.
*Real-time activities for long-distance couples to play together.* (English below.)

## Aktiviteler

| | Aktivite | Nasıl oynanır |
|---|---|---|
| 🧩 | **Yapboz** | Kendi fotoğrafınızı (ya da hazır resimlerden birini) 12'den ~200 parçaya kadar bölün. Parçalar tahtanın iki yanında durur; ikiniz aynı anda sürükleyip yerlerine yerleştirirsiniz. Fotoğrafın oranı korunur (dikey fotoğraflar da olur). Çok parçalı yapbozlar için yakınlaştırma (tekerlek / iki parmak) ve boş alanı sürükleyerek kaydırma var. |
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

### Yayına alma (deploy)

Uygulama WebSocket kullanan tek bir Node.js sunucusudur. GitHub Pages gibi statik barındırma yetmez; sürekli çalışan
bir Node.js sunucusu gerekir. Odalar bellekte tutulduğu için **tek bir sunucu (instance) çalıştırın**: birden fazla
kopyaya ölçeklenirse eşler farklı kopyalara düşüp birbirini göremez.

#### Render ile (önerilen, en kolay)

Depoda hazır bir `render.yaml` var (Render Blueprint).

1. [render.com](https://render.com)'da GitHub hesabınızla oturum açın.
2. **New → Blueprint** seçin, `couple-play` deposunu ve yayınlamak istediğiniz dalı seçin.
3. Render `ADMIN_PASSWORD` değerini sorar: `/admin` sayfası için bir şifre yazın.
4. **Apply** deyin. Birkaç dakika sonra site `https://couple-play-xxxx.onrender.com` gibi bir adreste açılır.
   Bundan sonra o dala her `git push` yaptığınızda site kendiliğinden güncellenir.

Blueprint, yüklenen fotoğrafların kaybolmaması için 1 GB'lık kalıcı bir disk (`/var/data`) ekler. Kalıcı disk
yalnızca ücretli planlarda (Starter) var. Sadece denemek isterseniz `render.yaml`'da `plan: free` yapıp `disk`
bölümünü silebilirsiniz; o zaman:
- yüklenen fotoğraflar her yeniden başlatmada/deploy'da silinir,
- site 15 dakika kullanılmayınca uyur, ilk açılış yarım dakika kadar sürebilir ve açık odalar kapanır.

Güncel fiyatlar için Render'ın fiyat sayfasına bakın.

#### Docker ile (Railway, Fly.io, kendi sunucunuz…)

Depodaki `Dockerfile` her container servisinde çalışır. Ayarlamanız gerekenler:
- `ADMIN_PASSWORD` ortam değişkeni,
- `/data` klasörüne bağlı kalıcı bir volume (fotoğraflar oraya kaydedilir),
- dışarıya açılan port: `3000` (ya da servisin verdiği `PORT`).

```bash
docker build -t couple-play .
docker run -p 3000:3000 -e ADMIN_PASSWORD=sifreniz -v couple-play-data:/data couple-play
```

#### Kendi alan adınız

Render, Railway ve Fly.io'da ayarlardan özel alan adı (ör. `bizimoyunlar.com`) ekleyebilir, DNS kaydını
girdikten sonra HTTPS sertifikasını otomatik alabilirsiniz.

### Fotoğraf kütüphanesi (`/admin`)

Sitenin `/admin` sayfasından fotoğraf yükleyebilirsiniz. Birden fazla fotoğrafı sürükleyip bırakın, her birinin
boyama önizlemesine bakın, Türkçe/İngilizce başlık verin ve yükleyin. Yüklenen fotoğraflar tüm odalarda Yapboz ve
Sayılarla Boyama'nın resim listesinde otomatik olarak en başta çıkar; aynı sayfadan silinebilir.

| Ortam değişkeni | Açıklama |
|---|---|
| `ADMIN_PASSWORD` | `/admin` sayfasının şifresi. Ayarlanmazsa yükleme kapalıdır. |
| `DATA_DIR` | Yüklenen fotoğrafların saklandığı klasör (varsayılan: `./data`). |
| `PORT` | Sunucu portu (varsayılan: 3000). |

> ⚠️ Birçok barındırma servisinde (ör. Render'ın ücretsiz planı) disk her yeniden dağıtımda sıfırlanır. Fotoğrafların
> kalıcı olması için kalıcı bir disk/volume bağlayın (Render Disk, Railway Volume, Fly Volume) ve `DATA_DIR`'i o
> klasöre ayarlayın.

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
eşe gönderilir, böylece ikiniz de birebir aynı bölgeleri görürsünüz. Resim listesi `/api/photos`'tan gelir:
`/admin` ile yüklenenler (`DATA_DIR`) ve depoyla gelen hazır fotoğraflar (`public/img/photos/`, kaynakları
`CREDITS.md` dosyasında, CC0 / kamu malı).

Sürükle-bırak türü oyunlar için `server/activities/drag.js` ve `public/js/lib/dragboard.js` hazır kullanılabilir.

---

## English

**Activities:** Jigsaw (split your own photo or a bundled one into 12 to ~200 pieces, keeping its proportions; pieces start
around the board and both partners drag them in at once; zoom and pan for big puzzles), Paint by Numbers (any photo, yours or a bundled one, is turned into numbered regions like a real paint-by-number kit; bucket or brush, zoom, progress check),
Lego (snap bricks onto a blueprint), Guess It (Wordle-style: guess the word or number your partner picked, in
simultaneous rounds) and Bluetooth (both type a word until you type the same one). The UI is available in Turkish and
English; you can see your partner's cursor and send floating emoji reactions.

**Run:** `npm install && npm start`, then open http://localhost:3000, create a room and send the link to your partner.
`npm test` runs the test suite. Deploy anywhere that runs a long-lived Node.js process with WebSockets
(Render, Railway, Fly.io, a VPS…). Rooms are kept in memory.

**Photo library:** set `ADMIN_PASSWORD` and open `/admin` to upload photos (drag & drop, several at once, with a
paint-by-number preview and TR/EN titles). They show up automatically in the Jigsaw and Paint pickers for every room.
Uploads are stored in `DATA_DIR` (default `./data`); on hosts with ephemeral disks, mount a persistent volume there.

**Deploy:** on Render, use *New → Blueprint* with this repo (`render.yaml` sets up the service, a 1 GB disk for
uploads and asks for `ADMIN_PASSWORD`). Anywhere else, use the `Dockerfile` and mount a volume at `/data`.
Run a single instance: rooms live in memory.

**Adding an activity:** see "Yeni aktivite eklemek" above: one server module, one client module and two i18n strings.
