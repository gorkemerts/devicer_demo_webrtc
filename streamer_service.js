const WebSocket = require('ws'); 
const wrtc = require('wrtc');
const { spawn } = require('child_process');

const SIGNALING_SERVER_URL = 'ws://localhost:3000';
const ws = new WebSocket(SIGNALING_SERVER_URL);

let pc, dc;
let activeFfmpegProcess = null;

ws.on('open', () => {
    console.log("Connected to signaling server");
    ws.send(JSON.stringify({ type: 'streamer_awake' }));
});

ws.on('message', async (data) => {
    const message = JSON.parse(data.toString());
    console.log("Signal message:", message.type);

    if (message.type === 'clientoffers') {
        pc = new wrtc.RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });

        dc = pc.createDataChannel('server-to-browser');

        dc.onopen = () => {
            console.log("DataChannel open, starting FFmpeg stream...");

            // start emulator with theese command => emulator -avd Medium_Phone_API_36.0 -gpu swiftshader_indirect
                const ffmpegArgs = [
                '-f', 'gdigrab',
                '-framerate', '60',
                '-offset_x', '0',      
                '-offset_y', '0',
                '-video_size', '412x916', 
                '-i', 'title=Android Emulator - Medium_Phone_API_36.0:5554', 
                '-r', '30',
                '-f', 'image2pipe',
                '-c:v', 'mjpeg',
                '-'
                ];


            const ffmpeg = spawn('ffmpeg', ffmpegArgs);
            activeFfmpegProcess = ffmpeg;
            let jpegBuffer = Buffer.alloc(0);

            ffmpeg.stdout.on('data', (chunk) => {
                jpegBuffer = Buffer.concat([jpegBuffer, chunk]);

                let start_index = 0;
                while (true) {
                    const jpeg_start_marker = Buffer.from([0xFF, 0xD8]);
                    const jpeg_end_marker = Buffer.from([0xFF, 0xD9]);
                    const start = jpegBuffer.indexOf(jpeg_start_marker, start_index);
                    const end = jpegBuffer.indexOf(jpeg_end_marker, start + 2);
                    if (start === -1 || end === -1) break;

                    const jpeg_data = jpegBuffer.slice(start, end + 2);
                    if (dc.readyState === 'open') {
                        dc.send(jpeg_data);
                    }
                    start_index = end + 2;
                }
                jpegBuffer = jpegBuffer.slice(start_index);
            });

            ffmpeg.stderr.on('data', (data) => {
                console.error('FFmpeg stderr:', data.toString());
            });

            ffmpeg.on('close', (code) => {
                console.log('FFmpeg closed with code', code);
                if (activeFfmpegProcess === ffmpeg) activeFfmpegProcess = null;
            });

            ffmpeg.on('error', (err) => {
                console.error('FFmpeg error:', err);
                if (activeFfmpegProcess === ffmpeg) activeFfmpegProcess = null;
            });
        };

        dc.onmessage = (msg) => console.log('DC message from client:', msg.data);

        pc.onicecandidate = ({ candidate }) => {
            if (candidate) {
                console.log("Sending streamer candidate to signaling server");
                ws.send(JSON.stringify({ type: 'streamer_candidate', candidate }));
            }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        ws.send(JSON.stringify({ type: 'stream_offer', offer }));
    }

    else if (message.type === 'answer') {
        await pc.setRemoteDescription(message.answer);
        console.log("Answer received and set");
    }

    else if (message.type === 'client_candidate') {
        await pc.addIceCandidate(message.candidate);
        console.log("ICE candidate added from client");
    }
});