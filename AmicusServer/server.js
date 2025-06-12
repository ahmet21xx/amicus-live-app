// Gerekli kütüphaneleri içe aktarıyoruz
const express = require('express'); // Web sunucusu için Express
const http = require('http');     // HTTP sunucusu oluşturmak için
const socketIo = require('socket.io'); // Gerçek zamanlı iletişim için Socket.IO
const path = require('path');     // Dosya yolları ile çalışmak için

const app = express();
const server = http.createServer(app); // Express uygulamasını HTTP sunucusu olarak kullanıyoruz
// Socket.IO sunucusunu HTTP sunucumuza bağlıyoruz
const io = new socketIo.Server(server, {
    cors: { // CORS ayarları: Frontend uygulamamızın farklı bir kaynaktan bağlanmasına izin veriyoruz
        origin: "*", // Tüm kaynaklardan gelen bağlantılara izin ver (geliştirme için iyi, üretimde kısıtla!)
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000; // Sunucunun çalışacağı port, varsayılan 3000

// ====================================================================================================
// Sunucu Tarafı Eşleşme Mantığı
// ====================================================================================================

// Bekleyen kullanıcıları tutacak dizi
// Bu, eşleşmek için bekleyen kullanıcıların Socket ID'lerini tutar
let waitingUsers = [];
// Eşleşmiş kullanıcıları tutacak harita
// Key: Socket ID, Value: Eşleştiği kişinin Socket ID'si
let matchedUsers = new Map();

io.on('connection', (socket) => {
    console.log(`Yeni bir kullanıcı bağlandı: ${socket.id}`);

    // Kullanıcı eşleşme aradığında
    socket.on('findMatch', () => {
        console.log(`${socket.id} eşleşme arıyor.`);

        // Eğer bekleyen bir kullanıcı varsa, eşleştir
        if (waitingUsers.length > 0) {
            const partnerId = waitingUsers.shift(); // Bekleyen ilk kullanıcıyı al
            const partnerSocket = io.sockets.sockets.get(partnerId);

            // Partnerin bağlı olup olmadığını ve kendisi olmadığını kontrol et
            if (partnerSocket && partnerSocket.connected && partnerId !== socket.id) {
                // Her iki taraf için de eşleşmeyi kaydet
                matchedUsers.set(socket.id, partnerId);
                matchedUsers.set(partnerId, socket.id);

                console.log(`Eşleşme bulundu: ${socket.id} ile ${partnerId}`);

                // Eşleşen taraflara haber ver
                // İlk eşleşmeyi talep eden taraf (socket.id) offer'ı başlatan kişi olarak işaretlenir.
                socket.emit('matchFound', { from: partnerId, isInitiator: true });
                partnerSocket.emit('matchFound', { from: socket.id, isInitiator: false });

            } else {
                // Partner çevrimdışıysa veya kendisiyle eşleşme durumu varsa, mevcut kullanıcıyı tekrar bekleme listesine ekle
                if (partnerSocket && !partnerSocket.connected) {
                    console.log(`${partnerId} çevrimdışı. ${socket.id} beklemede.`);
                } else if (partnerId === socket.id) {
                    console.log(`Kullanıcı ${socket.id} kendisiyle eşleşmeye çalıştı, tekrar bekleme listesine eklendi.`);
                }
                waitingUsers.push(socket.id); // Tekrar bekleme listesine ekle
            }
        } else {
            // Kimse beklemiyorsa, mevcut kullanıcıyı bekleme listesine ekle
            waitingUsers.push(socket.id);
            console.log(`${socket.id} bekleme listesine eklendi.`);
            socket.emit('noMatch'); // Eşleşme bulunamadı mesajı
        }
    });

    // WebRTC sinyalleşme mesajları
    // 'offer' (teklif): Bir kullanıcı diğerine bağlantı teklif ederken gönderir
    socket.on('offer', (data) => {
        // Teklifi alıp belirlenen 'to' ID'ye iletiyoruz
        const targetSocket = io.sockets.sockets.get(data.to);
        if (targetSocket) {
            console.log(`Offer (${socket.id} -> ${data.to})`);
            targetSocket.emit('offer', { from: socket.id, offer: data.offer });
        }
    });

    // 'answer' (cevap): Teklifi alan kullanıcı geri cevap verirken gönderir
    socket.on('answer', (data) => {
        // Cevabı alıp belirlenen 'to' ID'ye iletiyoruz
        const targetSocket = io.sockets.sockets.get(data.to);
        if (targetSocket) {
            console.log(`Answer (${socket.id} -> ${data.to})`);
            targetSocket.emit('answer', { from: socket.id, answer: data.answer });
        }
    });

    // 'candidate' (ICE Adayı): Ağ bağlantı bilgilerini iletmek için kullanılır
    socket.on('candidate', (data) => {
        // ICE adayını alıp belirlenen 'to' ID'ye iletiyoruz
        const targetSocket = io.sockets.sockets.get(data.to);
        if (targetSocket) {
            // console.log(`Candidate (${socket.id} -> ${data.to})`); // Çok fazla çıktı olabilir
            targetSocket.emit('candidate', { from: socket.id, candidate: data.candidate });
        }
    });

    // 'sendLike' (Kalp Gönderme): Kullanıcı birine kalp gönderdiğinde
    socket.on('sendLike', (data) => {
        const targetSocket = io.sockets.sockets.get(data.to);
        if (targetSocket) {
            console.log(`${socket.id} ${data.to} kişisine kalp gönderdi.`);
            targetSocket.emit('receiveLike'); // Karşı tarafa kalp aldığını bildir
        }
    });

    // 'disconnectMatch' (Eşleşmeden Ayrılma): Kullanıcı eşleşmeyi sonlandırdığında
    socket.on('disconnectMatch', (data) => {
        const partnerId = data.to;
        const partnerSocket = io.sockets.sockets.get(partnerId);

        if (partnerSocket) {
            partnerSocket.emit('userDisconnected'); // Karşı tarafa bağlantının kesildiğini bildir
            console.log(`${socket.id} eşleşmeden ayrıldı, ${partnerId} bilgilendirildi.`);
        }
        // Her iki tarafı da eşleşmiş listesinden çıkar
        matchedUsers.delete(socket.id);
        matchedUsers.delete(partnerId);
    });

    // Kullanıcı bağlantısı kesildiğinde
    socket.on('disconnect', () => {
        console.log(`Kullanıcı bağlantısı kesildi: ${socket.id}`);

        // Eğer kullanıcı bekleme listesindeyse, listeden çıkar
        waitingUsers = waitingUsers.filter(id => id !== socket.id);

        // Eğer kullanıcı eşleşmişse, eşleştiği kişiye haber ver ve eşleşmeyi kaldır
        const partnerId = matchedUsers.get(socket.id);
        if (partnerId) {
            const partnerSocket = io.sockets.sockets.get(partnerId);
            if (partnerSocket) {
                partnerSocket.emit('userDisconnected');
            }
            matchedUsers.delete(socket.id);
            matchedUsers.delete(partnerId);
            console.log(`${socket.id} bağlantısı kesildi, eşleşmesi ${partnerId} ile kaldırıldı.`);
        }
    });
});

// ====================================================================================================
// Statik Dosyaları Servis Etme (Frontend'i sunmak için)
// ====================================================================================================

// Frontend uygulamasının (AmicusUygulamasi) bulunduğu yolu belirliyoruz.
// Bu, server.js dosyasının bulunduğu klasörün bir üstündeki 'AmicusUygulamasi' klasörünü işaret eder.
const frontendPath = path.join(__dirname, '..', 'AmicusUygulamasi');
console.log('Frontend Dosya Yolu Kontrolü:', frontendPath); // Konsolda bu yolu görelim.

// Express'e, bu yoldaki dosyaları (HTML, CSS, JS, resimler vb.) doğrudan tarayıcıya sunmasını söyleyin.
app.use(express.static(frontendPath));

// Ana URL'ye (/) gelen tüm GET isteklerini 'index.html' dosyasına yönlendir.
// Bu, 'Cannot GET /' hatasını kesin olarak çözmeli ve uygulamanın görünmesini sağlamalıdır.
app.get('/', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
});

// Sunucuyu belirtilen PORT'ta başlat
server.listen(PORT, () => {
    console.log(`Sunucu http://localhost:${PORT} adresinde çalışıyor.`);
});