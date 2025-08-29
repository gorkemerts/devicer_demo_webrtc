const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const wrtc = require('wrtc');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ port : "3000"});
let streamer_ws = null ; 
// public klasörünü servis et
app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', ws => {

    ws.on('message' , data => {
        const message = JSON.parse(data.toString());

        switch (message.type) {
            case "streamer_awake" : 
              console.log(message)
                streamer_ws = ws ;
                ws.send(JSON.stringify({type : "streamer connected to main"})); 
                break ; 
            case 'client_offers' :
                console.log(message) ; 
                console.log("mesag streamere iletiliyor") ; 
                streamer_ws.send(JSON.stringify({type : "client_offers"}));
                break ; 
            case 'client_awake' : 
                console.log(message);
                break;

            }          
             
})


    
  const pc = new wrtc.RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });

  // DataChannel oluştur
  const dc = pc.createDataChannel('server-to-browser');
  
  dc.onopen = () => {
    console.log("DataChannel açık!");

    // Her saniye mesaj gönder
    let count = 0;
    const interval = setInterval(() => {
      if (dc.readyState === 'open') {
        dc.send(`Merhaba Browser! Mesaj #${++count} Node.js'ten geliyorum.`);
      } else {
        clearInterval(interval); 
      }
    }, );
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
    } else if (data.type === 'candidate') {
        console.log("mine",data.candidate);
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

server.listen(8080, () => {
  console.log("HTTP + WebSocket server running on http://localhost:8080");
});