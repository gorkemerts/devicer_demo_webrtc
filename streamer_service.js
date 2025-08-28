const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const wrtc = require('wrtc');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// public klasörünü servis et
app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', ws => {
  console.log("Browser connected via WebSocket");

  const pc = new wrtc.RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });

  // DataChannel oluştur
  const dc = pc.createDataChannel('server-to-browser');
  dc.onopen = () => {
    console.log("DataChannel açık!");
    dc.send("Merhaba Browser! Node.js'ten geliyorum.");
  };
  dc.onmessage = msg => console.log("Browser'dan gelen mesaj:", msg.data);

  // ICE candidate geldiğinde WebSocket ile gönder
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) ws.send(JSON.stringify({ type: 'candidate', candidate }));
  };

  // Browser'dan gelen mesajları handle et
  ws.on('message', async message => {
    const data = JSON.parse(message);

    if (data.type === 'answer') {
      await pc.setRemoteDescription(data.answer);
      console.log("Answer set edildi.");
    } else if (data.type === 'candidate') {
      await pc.addIceCandidate(data.candidate);
      console.log("ICE candidate eklendi.");
    }
  });

  // Offer oluştur ve WebSocket ile gönder
  (async () => {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.send(JSON.stringify({ type: 'offer', offer }));
    console.log("Offer gönderildi.");
  })();
});

// server start
server.listen(8080, () => {
  console.log("HTTP + WebSocket server running on http://localhost:8080");
});
