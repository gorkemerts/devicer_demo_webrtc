const WebSocket = require("ws");
// wrtc'yi yükleyerek tarayıcı WebRTC API'lerini Node.js ortamında kullanıyoruz.
const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } = require('wrtc');

const SIGNALING_SERVER_URL = 'ws://localhost:3000'; // Sinyalleşme sunucunuzun adresi
let peerConnection = null;
let dataChannel = null;
const signalization_server_socket = new WebSocket(SIGNALING_SERVER_URL);

// ICE configuration for localhost (no STUN/TURN needed for direct local connections)
// Gerçek dünyada TURN sunucusu eklemeniz gerekebilir.
const iceConfig = {
    iceServers: [] // { urls: 'stun:stun.l.google.com:19302' } gibi STUN sunucuları eklenebilir
};

// PeerConnection oluşturma ve olay dinleyicilerini ayarlama
function createPeerConnection() {
    peerConnection = new RTCPeerConnection(iceConfig);
    console.log("STREAMER: PeerConnection created.");

    // ICE adayı olayını dinle, adayı sinyalleşme sunucusuna gönder
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log('STREAMER: ICE candidate found:', event.candidate.candidate);
            if (signalization_server_socket.readyState === WebSocket.OPEN) {
                signalization_server_socket.send(JSON.stringify({
                    type: 'ice-candidate',
                    candidate: event.candidate
                }));
            }
        } else {
            console.log('STREAMER: All ICE candidates gathered');
        }
    };

    // ICE bağlantı durumu değişimlerini izle
    peerConnection.oniceconnectionstatechange = () => {
        console.log('STREAMER: ICE Connection State:', peerConnection.iceConnectionState);
        if (peerConnection.iceConnectionState === 'connected' || peerConnection.iceConnectionState === 'completed') {
            console.log('STREAMER: ICE connection established successfully!');
            // Bağlantı kurulduğunda Data Channel'ı kontrol et
            if (dataChannel && dataChannel.readyState === 'open') {
                console.log('STREAMER: Data channel already open or opened shortly after ICE connection.');
                startVideoStream(); // Video akışını başlat
            }
        }
    };

    // Sinyalleşme durumu değişimlerini izle
    peerConnection.onsignalingstatechange = () => {
        console.log('STREAMER: Signaling State:', peerConnection.signalingState);
    };

    // Data Channel oluştur (Burada oluşturulması doğru, client ondatachannel ile alacak)
    dataChannel = peerConnection.createDataChannel('videoStream', {
        ordered: true // Mesajların sırasıyla gelmesini sağlar
    });

    dataChannel.onopen = () => {
        console.log('STREAMER: Data channel opened - Starting video stream');
        startVideoStream();
    };

    dataChannel.onerror = (error) => {
        console.error('STREAMER: Data channel error:', error);
    };

    dataChannel.onclose = () => {
        console.log('STREAMER: Data channel closed');
        stopVideoStream();
    };

    return peerConnection;
}

// Video akışını simüle etme
let streamInterval = null;
function startVideoStream() {
    if (streamInterval) { // Zaten çalışıyorsa tekrar başlatma
        console.log('STREAMER: Video stream already running.');
        return;
    }
    console.log('STREAMER: Starting video stream via WebRTC Data Channel...');
    let frameCounter = 0;

    streamInterval = setInterval(() => {
        if (dataChannel && dataChannel.readyState === 'open') {
            const frameData = {
                type: 'frame',
                timestamp: Date.now(),
                frameNumber: frameCounter++,
                data: generateMockVideoFrame()
            };

            try {
                // Buffer olarak göndermek daha performanslı olabilir
                // Veya Base64 string olarak göndermeye devam edebiliriz.
                // Şimdilik string olarak devam edelim, client'ın da ona göre işlemesi gerekecek.
                dataChannel.send(JSON.stringify(frameData));
                // console.log(`STREAMER: Sent frame ${frameData.frameNumber} via WebRTC Data Channel ✓`);
            } catch (error) {
                console.error('STREAMER: Error sending frame via Data Channel:', error);
            }
        } else {
            // console.log('STREAMER: Data channel not ready, state:', dataChannel ? dataChannel.readyState : 'null');
        }
    }, 100); // Yaklaşık 10 FPS
}

function stopVideoStream() {
    if (streamInterval) {
        clearInterval(streamInterval);
        streamInterval = null;
        console.log('STREAMER: Video stream stopped');
    }
}

// Sahte video kareleri oluşturma (SVG olarak)
function generateMockVideoFrame() {
    const colors = ['red', 'green', 'blue', 'yellow', 'orange', 'purple', 'cyan', 'magenta'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const time = new Date().toLocaleTimeString();

    const svg = `<svg width="320" height="240" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="${color}"/>
        <text x="50%" y="50%" text-anchor="middle" fill="white" font-size="24" font-weight="bold">
            FRAME ${Date.now() % 1000} - ${time}
        </text>
        <text x="50%" y="70%" text-anchor="middle" fill="white" font-size="16">
            WebRTC Data Channel
        </text>
    </svg>`;

    return Buffer.from(svg).toString('base64');
}

// Sinyalleşme sunucusuna bağlantı açıldığında
signalization_server_socket.onopen = () => {
    console.log("STREAMER: Connected to signalization server");
    // Kendimizi streamer olarak tanıtıyoruz
    signalization_server_socket.send(JSON.stringify({ type: "identify_streamer", port: "3001" })); // Port bilgisi sadece bir tanımlayıcı
};

// Sinyalleşme sunucusundan mesaj geldiğinde
signalization_server_socket.on('message', async (rawMessage) => {
    const message = JSON.parse(rawMessage.toString());
    console.log('STREAMER: Received message type:', message.type);

    switch (message.type) {
        case 'viewer_wants_to_connect':
            console.log("STREAMER: Viewer wants to connect - Initializing WebRTC peer connection.");
            // PeerConnection'ı oluştur ve Data Channel'ı kur
            createPeerConnection();
            // Client'a hazır olduğumuza dair sinyal gönder, bu `answer` mesajı WebRTC answer'ı değil,
            // sadece sinyal sunucusu üzerinden bir onay mesajı.
            // Client bu mesajı aldığında kendi WebRTC PeerConnection'ını başlatıp bir offer gönderecek.
            signalization_server_socket.send(JSON.stringify({
                type: "streamer_ready",
                port: "3001" // Bu bilgi client için faydalı olabilir, örneğin bir kullanıcı arayüzünde göstermek için.
            }));
            break;

        case 'offer':
            console.log('STREAMER: Received WebRTC offer from client.');
            if (peerConnection) {
                try {
                    // Client'tan gelen offer'ı remoteDescription olarak ayarla
                    await peerConnection.setRemoteDescription(new RTCSessionDescription(message.offer));
                    console.log('STREAMER: Remote description (offer) set, creating answer.');

                    // Kendi answer'ımızı oluştur
                    const answer = await peerConnection.createAnswer();
                    console.log('STREAMER: Answer created.');

                    // Kendi answer'ımızı localDescription olarak ayarla
                    await peerConnection.setLocalDescription(answer);
                    console.log('STREAMER: Local description (answer) set, sending answer to client.');

                    // Oluşturulan answer'ı sinyalleşme sunucusu aracılığıyla client'a gönder
                    signalization_server_socket.send(JSON.stringify({
                        type: 'webrtc-answer',
                        answer: peerConnection.localDescription
                    }));
                    console.log('STREAMER: WebRTC answer sent.');

                } catch (error) {
                    console.error('STREAMER: Error handling offer:', error);
                }
            } else {
                console.error('STREAMER: PeerConnection not initialized when offer received.');
            }
            break;

        case 'ice-candidate':
            if (peerConnection && message.candidate) {
                console.log('STREAMER: Received ICE candidate from client.');
                try {
                    // Client'tan gelen ICE adayını PeerConnection'a ekle
                    await peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
                    console.log('STREAMER: ICE candidate added successfully.');
                } catch (error) {
                    console.error('STREAMER: Error adding ICE candidate:', error);
                }
            }
            break;

        default:
            console.log('STREAMER: Unknown message type received:', message.type);
            break;
    }
});

// Hata durumları
signalization_server_socket.on('error', (error) => {
    console.error('STREAMER: WebSocket error => signalization <-> streamer:', error);
});

// Bağlantı kapandığında
signalization_server_socket.on('close', () => {
    console.log('STREAMER: Lost connection with signalization server');
    stopVideoStream();
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
});

console.log(`Streamer service starting - connecting to signalization server...`);