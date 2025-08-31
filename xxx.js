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
            console.log("DataChannel open, starting emulator stream...");
            startEmulatorStream();
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

function startEmulatorStream() {
    // YÖNTEM 1: Belirli bir pencereyi yakalama (pencere başlığına göre)
    // Bu yöntem emülatör penceresini otomatik bulur
    const ffmpegArgsWindowCapture = [
        '-f', 'gdigrab',                    // Windows için pencere yakalama
        '-i', 'title=BlueStacks',           // Emülatör pencere başlığı (örnekte BlueStacks)
        '-vf', 'fps=30,scale=720:1280',     // FPS ve boyut ayarı
        '-q:v', '5',                        // Kalite
        '-f', 'image2pipe',
        '-c:v', 'mjpeg',
        '-'
    ];
    
    // YÖNTEM 2: Koordinat bazlı ekran yakalama
    const ffmpegArgsScreenRegion = [
        '-f', 'gdigrab',
        '-offset_x', '100',                 // X koordinatı
        '-offset_y', '100',                 // Y koordinatı  
        '-video_size', '720x1280',          // Yakalama boyutu
        '-i', 'desktop',                    // Masaüstünü yakala
        '-vf', 'fps=30',
        '-q:v', '5',
        '-f', 'image2pipe',
        '-c:v', 'mjpeg',
        '-'
    ];
    
    // YÖNTEM 3: NDI kaynağı yakalama (emülatör NDI destekliyorsa)
    const ffmpegArgsNDI = [
        '-f', 'libndi_newtek',
        '-i', 'EMULATOR_NDI_SOURCE',        // NDI kaynak adı
        '-vf', 'fps=30',
        '-q:v', '5',
        '-f', 'image2pipe',
        '-c:v', 'mjpeg',
        '-'
    ];
    
    // YÖNTEM 4: V4L2 (Linux) - Android emülatör için
    const ffmpegArgsV4L2 = [
        '-f', 'v4l2',
        '-i', '/dev/video0',                // Video cihaz yolu
        '-vf', 'fps=30',
        '-q:v', '5',
        '-f', 'image2pipe',
        '-c:v', 'mjpeg',
        '-'
    ];
    
    // YÖNTEM 5: DirectShow video cihazı (Windows)
    const ffmpegArgsDirectShow = [
        '-f', 'dshow',
        '-i', 'video=Android Emulator Virtual Camera',  // Emülatör sanal kamerası
        '-vf', 'fps=30',
        '-q:v', '5',
        '-f', 'image2pipe',
        '-c:v', 'mjpeg',
        '-'
    ];
    
    // Varsayılan olarak pencere yakalama kullan
    let selectedArgs = ffmpegArgsWindowCapture;
    
    // Emülatör tipine göre seçim yapabilirsiniz
    const emulatorType = process.env.EMULATOR_TYPE || 'bluestacks';
    
    switch(emulatorType.toLowerCase()) {
        case 'bluestacks':
            selectedArgs = ffmpegArgsWindowCapture;
            selectedArgs[3] = 'title=BlueStacks';
            break;
        case 'nox':
            selectedArgs = ffmpegArgsWindowCapture;
            selectedArgs[3] = 'title=NoxPlayer';
            break;
        case 'memu':
            selectedArgs = ffmpegArgsWindowCapture;
            selectedArgs[3] = 'title=MEmu';
            break;
        case 'ldplayer':
            selectedArgs = ffmpegArgsWindowCapture;
            selectedArgs[3] = 'title=LDPlayer';
            break;
        case 'android_studio':
            selectedArgs = ffmpegArgsWindowCapture;
            // Android Studio emülatörü için farklı pencere başlık formatları
            selectedArgs[3] = 'title=Pixel_3a_API_30';  // AVD adınıza göre değişir
            break;
        case 'screen_region':
            selectedArgs = ffmpegArgsScreenRegion;
            break;
        default:
            console.log("Using default window capture for BlueStacks");
    }
    
    console.log("Starting FFmpeg with args:", selectedArgs);
    const ffmpeg = spawn('ffmpeg', selectedArgs);
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
            
            if (dc && dc.readyState === 'open') {
                try {
                    dc.send(jpeg_data);
                } catch (error) {
                    console.error('Error sending frame:', error);
                }
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
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down...');
    if (activeFfmpegProcess) {
        activeFfmpegProcess.kill('SIGTERM');
    }
    if (ws.readyState === WebSocket.OPEN) {
        ws.close();
    }
    process.exit(0);
});

// Environment variables kullanım örneği:
// EMULATOR_TYPE=bluestacks node streamer.js
// EMULATOR_TYPE=screen_region node streamer.js