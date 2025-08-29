const WebSocket = require('ws'); 
const ws = new WebSocket('ws://localhost:3000'); 
const wrtc = require('wrtc');
ws.on('open' , () => {
console.log("sended")
ws.send(JSON.stringify({type : 'streamer_awake'}))});
let dc, pc;
ws.on('message', async data => {
    const message = JSON.parse(data.toString());
    console.log(message.type)
    if(message.type === 'clientoffers') {

        pc = new wrtc.RTCPeerConnection([{ iceServers: 'stun:stun.l.google.com:19302' }]);
        dc = pc.createDataChannel('server-to-browser');
        
        dc.onopen = () => {
           let count = 0; const interval = setInterval(() => { if (dc.readyState === 'open') {
             dc.send("Merhaba Browser! Mesaj #${++count} serverdan geliyorum."); }
               else { clearInterval(interval); } })};
        dc.onmessage = msg => console.log("dc.onmessage",msg.data);

        pc.onicecandidate = ({ candidate }) => {
          console.log("stream_candidate yollaniyor");
          ws.send(JSON.stringify({ type:'streamer_candidate', candidate }));
}
        (async () => {
            const offer = await pc.createOffer();
            console.log("offer" , offer);
            await pc.setLocalDescription(offer);
            ws.send(JSON.stringify({ type: 'stream_offer',  offer }));
        })();}
  
          else if (message.type === 'answer') {
            console.log("answerhascome")
            await pc.setRemoteDescription(message.answer);
          } 
          else if (message.type === 'client_candidate') {
            await pc.addIceCandidate(message.candidate);
            console.log("ICE candidate eklendi.");
    }
});


