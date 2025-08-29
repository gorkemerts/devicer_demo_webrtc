const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const wrtc = require('wrtc');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ port : "3000"});
let streamer_ws = null ; 
let viever_ws = null ; 
// public klasörünü servis et
app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', ws => {

    ws.on('message' , data => {
        const message = JSON.parse(data.toString());
        console.log("ws_message: ", message);
        switch (message.type) {
            case "streamer_awake" : 
              console.log(message)
                streamer_ws = ws ;
                ws.send(JSON.stringify({type : "streamer connected to main"})); 
                break ; 
            case 'client_offers' :
                console.log(message) ; 
                console.log("mesaj streamere iletiliyor") ; 
                streamer_ws.send(JSON.stringify({type : "clientoffers"}));
                break ; 
            case "streamer_candidate" : 
                console.log("streamer_candidate_has_come");
                viever_ws.send(JSON.stringify(message));
            case 'client_awake' : 
                viever_ws = ws ; 
                break;
            case 'client_candidate': 
                streamer_ws.send(message);
                break ;
            case 'stream_offer' : 
                console.log("streamoffersended");
                viever_ws.send(JSON.stringify(message)); 
                break ; 
            case 'answer' : 
                streamer_ws.send(JSON.stringify(message)) ; 
                break ; 
            }          
             
}) 
});

server.listen(8080, () => {
  console.log("HTTP + WebSocket server running on http://localhost:8080");
});