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
        // Google'ın genel STUN sunucuları (genellikle yeterlidir)
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },

        // Alternatif ücretsiz TURN sunucusu (test amaçlı, dikkatli kullanın)
        // Bu hizmetler değişebilir veya limitli olabilir.
        // Kendi ücretli TURN sunucunuzu veya deneme anahtarınızı kullanmak en iyisidir.
        {
            urls: 'turn:global.relay.metered.ca:443?transport=tcp', // Farklı bir metered adresi
            username: 'YOUR_API_KEY_HERE', // Eğer metered.ca'dan ücretsiz deneme aldıysan, buraya API anahtarını yapıştır.
            credential: 'YOUR_API_SECRET_HERE' // Eğer metered.ca'dan ücretsiz deneme aldıysan, buraya API sırrını yapıştır.
        },
        // Eğer yukarıdaki metered TURN sunucusu sorun çıkarırsa, aşağıdaki test sunucusunu deneyebiliriz:
        // {
        //     urls: 'turn:numb.viagenie.ca',
        //     username: 'testuser',
        //     credential: 'testpassword'
        // }
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
        // BURAYA KENDİ RENDER.COM BACKEND URL'Nİ YAPIŞTIRACAKSIN
        // Örnek: socket = io('https://amicus-backend-abcdef.onrender.com/');
        socket = io('https://amicus-backend.onrender.com/'); // Kendi Render URL'ni buraya yapıştır ve sonuna "/" koymayı unutma!

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

        // 'offer'