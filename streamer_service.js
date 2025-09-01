const WebSocket = require('ws');
const wrtc = require('wrtc');
const { spawn } = require('child_process');

const SIGNALING_SERVER_URL = 'ws://localhost:3000';
const ws = new WebSocket(SIGNALING_SERVER_URL);

let pc, dc;
let activeFfmpegProcess = null;
let activeAdbProcess = null;

ws.on('open', () => {
    console.log("Connected to signaling server");
    ws.send(JSON.stringify({ type: 'streamer_awake' }));
});

ws.on('message', async (data) => {
    const message = JSON.parse(data.toString());
    console.log("Signal message:", message.type);

    if (message.type === 'clientoffers') {
        pc = new wrtc.RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        dc = pc.createDataChannel('server-to-browser');

        dc.onopen = () => {
            console.log("DataChannel open, starting ADB + FFmpeg stream...");

            // 1️⃣ ADB screenrecord process
            activeAdbProcess = spawn('adb', [
                'shell', 'screenrecord', '--output-format=h264', '--bit-rate 4000000' ,'-'
            ]);

            activeAdbProcess.stderr.on('data', data => {
                console.log(`ADB log: ${data}`);
            });

            activeAdbProcess.on('close', () => {
                console.log("ADB screenrecord closed");
                activeAdbProcess = null;
            });

            activeAdbProcess.on('error', err => {
                console.error("ADB error:", err);
            });

        // 2️⃣ FFmpeg process: H.264 -> MJPEG -> DataChannel
        const ffmpeg = spawn('ffmpeg', [
    '-f', 'h264',          // Explicitly state input format is H.264
    '-i', 'pipe:0',        // stdin'den al
    '-f', 'image2pipe',    // stdout pipe
    '-c:v', 'mjpeg',       // MJPEG formatı
    '-q:v', '5',           // kalite
    'pipe:1'
]);

            activeFfmpegProcess = ffmpeg;

            // pipe adb stdout -> ffmpeg stdin
            activeAdbProcess.stdout.pipe(ffmpeg.stdin);

            let jpegBuffer = Buffer.alloc(0);

            ffmpeg.stdout.on('data', (chunk) => {
                jpegBuffer = Buffer.concat([jpegBuffer, chunk]);

                let start_index = 0;
                while (true) {
                    const start = jpegBuffer.indexOf(Buffer.from([0xFF, 0xD8]), start_index);
                    if (start === -1) { // No start of frame found from current start_index
                        break;
                    }

                    const end = jpegBuffer.indexOf(Buffer.from([0xFF, 0xD9]), start + 2);
                    if (end === -1) { // Start found, but no end yet (partial frame)
                        // Keep this chunk in buffer, wait for more data
                        break;
                    }

                    // Full JPEG frame found
                    const jpeg_data = jpegBuffer.slice(start, end + 2);
                    if (dc.readyState === 'open') {
                        dc.send(jpeg_data);
                    }
                    start_index = end + 2; // Move past this frame
                }
                // Keep any remaining partial data at the beginning of the buffer
                jpegBuffer = jpegBuffer.slice(start_index);
            });

            ffmpeg.stderr.on('data', data => {
                console.log(`FFmpeg log: ${data}`);
            });

            ffmpeg.on('close', () => {
                console.log("FFmpeg closed");
                if (activeFfmpegProcess === ffmpeg) activeFfmpegProcess = null;
            });

            ffmpeg.on('error', (err) => {
                console.error("FFmpeg error:", err);
                if (activeFfmpegProcess === ffmpeg) activeFfmpegProcess = null;
            });
        };

        dc.onmessage = (msg) => console.log("DataChannel message from client:", msg.data);

        pc.onicecandidate = ({ candidate }) => {
            if (candidate) {
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

// process exit cleanup
process.on('exit', () => {
    if (activeFfmpegProcess) activeFfmpegProcess.kill('SIGINT');
    if (activeAdbProcess) activeAdbProcess.kill('SIGINT');
});
