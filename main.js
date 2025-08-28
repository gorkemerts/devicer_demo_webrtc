const { WebSocketServer } = require('ws');
const express = require("express");
const path = require("path");

const SIGNALIZATION_PORT = 3000;
const HTTP_PORT = 8080;

const wss = new WebSocketServer({ port: SIGNALIZATION_PORT });
const app = express();

let streamer = null; // Bağlı olan streamer WebSocket nesnesi
let viewer = null;   // Bağlı olan viewer WebSocket nesnesi

// Client HTML dosyasını sunmak için HTTP sunucusu
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'client.html'));
});

app.listen(HTTP_PORT, () => {
    console.log(`HTTP server => http://localhost:${HTTP_PORT}`);
});
console.log(`Signalization server => ws://localhost:${SIGNALIZATION_PORT}`);

wss.on('connection', (ws, req) => {
    console.log(`Yeni bağlantı: ${req.socket.remoteAddress}`);

    ws.on('message', (rawMessage) => {
        const message = JSON.parse(rawMessage.toString());
        console.log(`Mesaj alındı (${req.socket.remoteAddress}): ${message.type}`);

        switch (message.type) {
            case "client_awake":
                console.log("Client socket awake.");
                // Eğer streamer bağlıysa, client'a bilgi verebilirsiniz (isteğe bağlı)
                // if (streamer) {
                //     ws.send(JSON.stringify({ type: "streamer_available", status: "online" }));
                // }
                break;

            case 'identify_streamer':
                console.log(`-- Streamer registered from ${req.socket.remoteAddress}`);
                streamer = ws; // Streamer'ı kaydet
                // Bu streamer'a özel bir ID atayabilir veya birden fazla streamer desteği ekleyebilirsiniz.
                break;

            case 'request_stream':
                console.log(`Client (${req.socket.remoteAddress}) requested stream.`);
                viewer = ws; // Viewer'ı kaydet
                if (streamer && streamer.readyState === streamer.OPEN) {
                    // Streamer'a, bir client'ın bağlantı kurmak istediğini bildir
                    streamer.send(JSON.stringify({ type: 'viewer_wants_to_connect' }));
                } else {
                    console.log("Streamer is offline or not registered.");
                    // Client'a streamer'ın offline olduğunu bildirebilirsiniz
                    viewer.send(JSON.stringify({ type: "streamer_unavailable", message: "Streamer is currently offline." }));
                }
                break;

            case 'streamer_ready': // Streamer'dan gelen onay mesajını client'a ilet
                console.log(`Streamer (${req.socket.remoteAddress}) is ready, forwarding to viewer.`);
                if (viewer && viewer.readyState === viewer.OPEN) {
                    viewer.send(JSON.stringify({
                        type: 'streamer_ready',
                        port: message.port // Streamer'ın port bilgisini client'a ilet (bu durumda aslında WebRTC P2P kurulacağı için port sadece bilgi amaçlı)
                    }));
                }
                break;

            case 'offer': // WebRTC offer, client'tan streamer'a
                console.log(`WebRTC offer received from client (${req.socket.remoteAddress}), forwarding to streamer.`);
                if (streamer && streamer.readyState === streamer.OPEN) {
                    streamer.send(JSON.stringify({
                        type: 'offer',
                        offer: message.offer
                    }));
                } else {
                    console.log('Streamer not available to receive offer.');
                    if (viewer && viewer.readyState === viewer.OPEN) {
                        viewer.send(JSON.stringify({ type: "error", message: "Streamer is not available to receive offer." }));
                    }
                }
                break;

            case 'webrtc-answer': // WebRTC answer, streamer'dan client'a
                console.log(`WebRTC answer received from streamer (${req.socket.remoteAddress}), forwarding to client.`);
                if (viewer && viewer.readyState === viewer.OPEN) {
                    viewer.send(JSON.stringify({
                        type: 'webrtc-answer',
                        answer: message.answer
                    }));
                } else {
                    console.log('Client not available to receive answer.');
                    if (streamer && streamer.readyState === streamer.OPEN) {
                        streamer.send(JSON.stringify({ type: "error", message: "Client is not available to receive answer." }));
                    }
                }
                break;

            case 'ice-candidate': // ICE adayı, her iki yönde de iletilebilir
                console.log(`ICE candidate received from ${req.socket.remoteAddress}, forwarding...`);
                if (ws === viewer && streamer && streamer.readyState === streamer.OPEN) {
                    // Client'tan streamer'a
                    streamer.send(JSON.stringify({
                        type: 'ice-candidate',
                        candidate: message.candidate
                    }));
                } else if (ws === streamer && viewer && viewer.readyState === viewer.OPEN) {
                    // Streamer'dan client'a
                    viewer.send(JSON.stringify({
                        type: 'ice-candidate',
                        candidate: message.candidate
                    }));
                } else {
                    console.warn(`ICE candidate received but no suitable peer to forward to. From: ${req.socket.remoteAddress}`);
                }
                break;

            // 'video-frame' tipi artık WebRTC Data Channel üzerinden doğrudan iletilecek.
            // Sinyalleşme sunucusunun bu mesajı görmemesi gerekiyor.
            case 'video-frame':
                console.warn(`Sinyalleşme sunucusuna 'video-frame' mesajı geldi. Bu mesaj WebRTC Data Channel üzerinden doğrudan iletilmeliydi. Yoksayılıyor.`);
                break;

            default:
                console.log(`Bilinmeyen mesaj tipi: ${message.type} from ${req.socket.remoteAddress}`);
                break;
        }
    });

    ws.on('close', () => {
        console.log(`Bağlantı kesildi: ${req.socket.remoteAddress}`);
        if (ws === streamer) {
            console.log('Streamer bağlantısı kesildi.');
            streamer = null;
            // Streamer offline olduğunda client'a bilgi gönderebiliriz
            if (viewer && viewer.readyState === viewer.OPEN) {
                viewer.send(JSON.stringify({ type: "streamer_offline", message: "Streamer disconnected." }));
            }
        }
        if (ws === viewer) {
            console.log('Viewer bağlantısı kesildi.');
            viewer = null;
            // Viewer offline olduğunda streamer'a bilgi gönderebiliriz (isteğe bağlı)
            // if (streamer && streamer.readyState === streamer.OPEN) {
            //     streamer.send(JSON.stringify({ type: "viewer_disconnected", message: "Viewer disconnected." }));
            // }
        }
    });

    ws.on('error', (error) => {
        console.error(`WebSocket hata (${req.socket.remoteAddress}):`, error.message);
    });
});