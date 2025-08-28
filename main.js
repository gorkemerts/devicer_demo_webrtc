
const { WebSocketServer } = require('ws');
const signalizaton_port = 3000;
const streamer_port = 3001 ;
const wss = new WebSocketServer({ port: signalizaton_port });
const express = require("express")
const path = require("path")
let streamer =  null;
let viewer = null;
const app = express();
const HTTP_PORT = 8080;
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'client.html'));
});
app.listen(HTTP_PORT, () => {
    console.log(`HTTP server => http://localhost:${HTTP_PORT}`);
});
console.log(`signalization server => ws://localhost:${signalizaton_port} `);
wss.on('connection', (ws,req) => {
    ws.on('message', (rawMessage) => {
        const message = JSON.parse(rawMessage.toString());
        console.log('Mesaj alındı:', message.type);
        switch (message.type) {
            case "client_awake" : 
                console.log("client socket done") ; 
                break ; 
            case 'answer' : 
                viewer.send(JSON.stringify({type : "answer" , port : 3001})) ; 
                break ; 
            case 'identify_streamer':
                console.log('--streamer server is live');
                ws.send(JSON.stringify({payload : "deneme"}))
                streamer = ws;
                break;
            case 'request_stream':
                console.log('client sends an offer for tunneling');
                viewer = ws;
                if (streamer && streamer.readyState === streamer.OPEN) {
                    streamer.send(JSON.stringify({ type: 'viewer_wants_to_connect', method : "videogonder"}));
                }
                else { 
                    console.log("streamer sunucu offline")
                }
                break;
        }
    });
    ws.on('close', () => {
        console.log('a client disconnected');
        if (ws === streamer) streamer = null;
        if (ws === viewer) viewer = null;
    });
});

