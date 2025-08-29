const WebSocket = require('ws'); 
const ws = new WebSocket('ws://localhost:3000'); 
const wrtc = require('wrtc');
ws.on('open' , () => {
console.log("sended")
ws.send(JSON.stringify({type : 'streamer_awake'}))
      
});

ws.on('message' , data => {
  const message = JSON.parse(data.toString());

  switch (message.type) {
    case "client_offers" : 
      console.log("offerstreameregeldi");
      




      break ; 
  }

})


