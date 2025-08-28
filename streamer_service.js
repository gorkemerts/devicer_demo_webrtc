const WebSocket = require("ws"); 
const SIGNALING_SERVER_URL = 'ws://localhost:3000';
const signalization_server_socket = new WebSocket(SIGNALING_SERVER_URL);

signalization_server_socket.onopen = () => {
    console.log("connected signalization server");
    signalization_server_socket.send(JSON.stringify({ type: "identify_streamer", port: "ws://localhost:3001" }));
};
signalization_server_socket.on('message', (rawMessage) => {
    const message = JSON.parse(rawMessage.toString());
    console.log('offer request arrived to stream server:', message.type);
    if (message.type === "viewer_wants_to_connect") {
        console.log("offer req arrives to streamer --> returning answer");
        signalization_server_socket.send(JSON.stringify({ type: "answer", payload: "3001" }));
    }
});

/// p2p connecction + ice + stun 



signalization_server_socket.on('error', (error) => {
    console.error('websocket err => signalization <-> streamer', error);
});

signalization_server_socket.on('close', () => {
    console.log('lost connection with signalization');
});







console.log(`Streamer WebSocket sunucusu 3001 portunda dinliyor.`);