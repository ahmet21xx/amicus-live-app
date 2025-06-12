// HTML elementlerini seçiyoruz
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const findMatchBtn = document.getElementById('findMatchBtn');
const sendLikeBtn = document.getElementById('sendLikeBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const likeAnimation = document.getElementById('likeAnimation');

// Medya akışları ve bağlantı değişkenleri
let localStream;
let remoteStream;
let peerConnection;
let socket; // Socket.IO bağlantısı için

// Güncellenmiş STUN/TURN sunucuları
// TURN sunucusu, doğrudan bağlantı kurulamadığında medya trafiğini yönlendirir.
const iceServers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        // Ücretsiz bir TURN sunucusu örneği (test amaçlıdır, üretimde YETERLİ OLMAYABİLİR)
        {
            urls: "turn:openrelay.metered.ca:80",
            username: "openrelay.metered.ca",
            credential: "88888"
        },
        {
            urls: "turn:openrelay.metered.ca:443",
            username: "openrelay.metered.ca",
            credential: "88888"
        },
        {
            urls: "turn:openrelay.metered.ca:49152",
            username: "openrelay.metered.ca",
            credential: "88888"
        }
    ],
};

// Global değişkenler
let remotePeerId = null; // Eşleşilen kişinin socket ID'si

// Uygulama başlatıldığında çalışacak fonksiyon
async function init() {
    try {
        // Kullanıcının kamera ve mikrofonuna erişim istiyoruz
        // Yüksek çözünürlük ve daha iyi kare hızı için kısıtlamaları güncelleyelim
        const mediaConstraints = {
            video: {
                width: { ideal: 1280, max: 1920 }, // Görüntü genişliği: İdeal 1280px, maksimum 1920px
                height: { ideal: 720, max: 1080 }, // Görüntü yüksekliği: İdeal 720px, maksimum 1080px
                frameRate: { ideal: 30, max: 30 } // Kare hızı: İdeal 30fps
            },
            audio: true // Ses açık kalsın
        };
        localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
        localVideo.srcObject = localStream; // Kendi görüntümüzü ekranda gösteriyoruz

        // Socket.IO bağlantısını başlat
        // BURAYA KENDİ RENDER.COM URL'NİZİ YAPIŞTIRACAKSINIZ
        // Örnek: socket = io('https://amicus-backend.onrender.com/');
        socket = io('https://amicus-backend.onrender.com/'); // Şimdilik yerel adres, dağıtımda değişecek

        // Sunucudan gelen mesajları dinleme
        socket.on('connect', () => {
            console.log('Sunucuya bağlandı:', socket.id);
            // Bağlantı kurulduğunda hemen eşleşme aramayız, butona basılınca yaparız.
        });

        // 'matchFound' geldiğinde offer oluşturma rolü belirlenir
        socket.on('matchFound', async (data) => {
            console.log('Eşleşme bulundu! Karşı tarafın IDsi:', data.from, 'Başlatıcı (Initiator) mı:', data.isInitiator);
            remotePeerId = data.from; // Karşı tarafın ID'sini kaydet

            if (!peerConnection) { // Eğer henüz bir peerConnection yoksa oluştur
                createPeerConnection();
            }

            if (data.isInitiator) { // Eğer biz offer'ı başlatan taraf isek
                console.log('Offer oluşturuluyor...');
                const offer = await peerConnection.createOffer();
                await peerConnection.setLocalDescription(offer);
                socket.emit('offer', { to: data.from, offer: offer });
            }
            // Eğer isInitiator false ise, biz offer'ı karşı taraftan bekleyeceğiz (aşağıdaki 'offer' olayında).
        });

        // 'offer' olayı geldiğinde teklifi işleme ve cevap oluşturma
        socket.on('offer', async (data) => {
            console.log('Teklif alındı:', data);
            remotePeerId = data.from; // Karşı tarafın ID'sini kaydet
            if (!peerConnection) { // Eğer henüz bir peerConnection yoksa oluştur
                createPeerConnection();
            }
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            socket.emit('answer', { to: data.from, answer: answer });
        });

        socket.on('answer', async (data) => {
            console.log('Cevap alındı:', data);
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        });

        socket.on('candidate', async (data) => {
            // console.log('ICE adayı alındı:', data); // Çok fazla çıktı olabilir
            try {
                // Sadece bağlantı varsa adayı ekle
                if (peerConnection && peerConnection.remoteDescription) {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                }
            } catch (e) {
                console.error('ICE adayı eklenirken hata:', e);
            }
        });

        socket.on('userDisconnected', () => {
            console.log('Karşı taraf bağlantıyı kesti.');
            closePeerConnection();
            remoteVideo.srcObject = null;
            alert('Karşı taraf bağlantıyı kesti veya eşleşmeden ayrıldı.');
        });

        socket.on('noMatch', () => {
            alert('Şu anda müsait bir eşleşme bulunamadı, lütfen tekrar deneyin.');
            if (peerConnection) { // Eğer eşleşme bulunamadıysa bağlantıyı kapat
                closePeerConnection();
                remoteVideo.srcObject = null;
            }
        });

        // Kalp animasyonu alıcı
        socket.on('receiveLike', () => {
            console.log('Kalp alındı!');
            showLikeAnimation();
        });

    } catch (e) {
        console.error('Medya akışına erişilemedi:', e);
        alert('Kamera ve mikrofon erişimi gerekli! Lütfen izin verin.');
    }
}

// PeerConnection oluşturma ve olay dinleyicilerini ayarlama
function createPeerConnection() {
    peerConnection = new RTCPeerConnection(iceServers);

    // Kendi medya akışımızı PeerConnection'a ekliyoruz
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    // Karşı taraftan gelen medya akışını dinleme
    peerConnection.ontrack = (event) => {
        if (remoteVideo.srcObject !== event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
            remoteStream = event.streams[0];
            console.log('Uzak video akışı eklendi.');
        }
    };

    // ICE adayları oluşturulduğunda sunucuya gönderme
    peerConnection.onicecandidate = (event) => {
        if (event.candidate && remotePeerId) { // Sadece geçerli aday ve eşleşilen kişi varsa gönder
            // console.log('ICE adayı gönderiliyor:', event.candidate); // Çok fazla çıktı olabilir
            socket.emit('candidate', {
                to: remotePeerId, // Karşı tarafın socket ID'si
                candidate: event.candidate,
            });
        }
    };

    // Bağlantı durumu değiştiğinde
    peerConnection.onconnectionstatechange = (event) => {
        console.log('PeerConnection durumu:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
            console.log('Bağlantı koptu veya başarısız oldu.');
            closePeerConnection();
            remoteVideo.srcObject = null;
        } else if (peerConnection.connectionState === 'connected') {
            console.log('Bağlantı başarıyla kuruldu!');
        }
    };
}

// PeerConnection'ı kapatma fonksiyonu
function closePeerConnection() {
    if (peerConnection) {
        console.log('PeerConnection kapatılıyor.');
        peerConnection.ontrack = null;
        peerConnection.onicecandidate = null;
        peerConnection.onconnectionstatechange = null;
        peerConnection.close();
        peerConnection = null;
        remotePeerId = null; // Bağlantı kesilince uzak ID'yi sıfırla
    }
    // Remote videoyu da sıfırlayalım
    remoteVideo.srcObject = null;
}

// Tuş olay dinleyicileri

// Yeni Eşleşme Bul tuşu
findMatchBtn.addEventListener('click', async () => {
    // Mevcut bağlantıyı kapat
    if (peerConnection) {
        closePeerConnection();
        remoteVideo.srcObject = null;
    }

    console.log('Yeni eşleşme aranıyor...');
    socket.emit('findMatch'); // Sunucuya eşleşme talebi gönder
});

// Like Yollama tuşu
sendLikeBtn.addEventListener('click', () => {
    if (remotePeerId) { // Sadece eşleşme varsa kalp yolla
        socket.emit('sendLike', { to: remotePeerId });
        showLikeAnimation(); // Kendi ekranımızda da animasyonu göster
    } else {
        alert('Eşleşme yok, kalp yollanamaz.');
    }
});

// Kalp animasyonunu gösterme fonksiyonu
function showLikeAnimation() {
    likeAnimation.style.animation = 'none'; // Animasyonu sıfırla
    likeAnimation.offsetHeight; // Reflow'u tetikle (animasyonu yeniden başlatmak için gerekli)
    likeAnimation.style.animation = 'likePop 1.5s forwards'; // Animasyonu başlat
}

// Eşleşmeden Ayrıl tuşu
disconnectBtn.addEventListener('click', () => {
    if (socket && remotePeerId) {
        socket.emit('disconnectMatch', { to: remotePeerId });
        console.log('Eşleşmeden ayrılma talebi gönderildi.');
    }
    closePeerConnection();
    remoteVideo.srcObject = null;
    alert('Eşleşmeden ayrıldınız.');
});

// Sayfa yüklendiğinde başlat
init();