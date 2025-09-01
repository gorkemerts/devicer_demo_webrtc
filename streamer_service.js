const WebSocket = require('ws');
const wrtc = require('wrtc');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const SIGNALING_SERVER_URL = 'ws://localhost:3000';
const ws = new WebSocket(SIGNALING_SERVER_URL);

let pc, dc;
let activeFfmpegProcess = null;
let activeAdbProcess = null;

// Telefon verilerini çekmek için yeni fonksiyonlar
async function pullFileFromPhone(remotePath, localPath) {
    return new Promise((resolve, reject) => {
        const pullProcess = spawn('adb', ['pull', remotePath, localPath]);
        
        pullProcess.on('close', (code) => {
            if (code === 0) {
                console.log(`File pulled: ${remotePath} -> ${localPath}`);
                resolve(localPath);
            } else {
                reject(new Error(`ADB pull failed with code ${code}`));
            }
        });
        
        pullProcess.on('error', reject);
    });
}

async function getPhoneInfo() {
    return new Promise((resolve, reject) => {
        const infoProcess = spawn('adb', ['shell', 'getprop']);
        let output = '';
        
        infoProcess.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        infoProcess.on('close', () => {
            const info = {};
            const lines = output.split('\n');
            lines.forEach(line => {
                const match = line.match(/\[(.*?)\]: \[(.*?)\]/);
                if (match) {
                    info[match[1]] = match[2];
                }
            });
            resolve(info);
        });
        
        infoProcess.on('error', reject);
    });
}

async function listPhoneFiles(directory) {
    return new Promise((resolve, reject) => {
        const listProcess = spawn('adb', ['shell', 'ls', '-la', directory]);
        let output = '';
        
        listProcess.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        listProcess.on('close', () => {
            resolve(output.split('\n').filter(line => line.trim()));
        });
        
        listProcess.on('error', reject);
    });
}

async function getAppData(packageName) {
    return new Promise((resolve, reject) => {
        const dataProcess = spawn('adb', ['shell', 'dumpsys', 'package', packageName]);
        let output = '';
        
        dataProcess.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        dataProcess.on('close', () => {
            resolve(output);
        });
        
        dataProcess.on('error', reject);
    });
}

// Toplu dosya transferi
async function pullMultipleFiles(fileList, localDir) {
    const results = [];
    
    for (const remotePath of fileList) {
        try {
            const fileName = path.basename(remotePath);
            const localPath = path.join(localDir, fileName);
            await pullFileFromPhone(remotePath, localPath);
            results.push({ success: true, file: remotePath, localPath });
        } catch (error) {
            results.push({ success: false, file: remotePath, error: error.message });
        }
    }
    
    return results;
}

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

        dc.onopen = async () => {
            console.log("DataChannel open, starting ADB + FFmpeg stream...");

            // Telefon bilgilerini al ve gönder
            try {
                const phoneInfo = await getPhoneInfo();
                dc.send(JSON.stringify({
                    type: 'phone_info',
                    data: {
                        model: phoneInfo['ro.product.model'],
                        brand: phoneInfo['ro.product.brand'],
                        version: phoneInfo['ro.build.version.release'],
                        sdk: phoneInfo['ro.build.version.sdk']
                    }
                }));
            } catch (error) {
                console.error("Phone info error:", error);
            }

            // 1️⃣ ADB screenrecord process
            activeAdbProcess = spawn('adb', [
                'shell', 'screenrecord', '--output-format=h264', '--bit-rate 4000000', '-'
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
                '-f', 'h264',          
                '-i', 'pipe:0',        
                '-f', 'image2pipe',    
                '-c:v', 'mjpeg',       
                '-q:v', '5',           
                'pipe:1'
            ]);

            activeFfmpegProcess = ffmpeg;
            activeAdbProcess.stdout.pipe(ffmpeg.stdin);

            let jpegBuffer = Buffer.alloc(0);

            ffmpeg.stdout.on('data', (chunk) => {
                jpegBuffer = Buffer.concat([jpegBuffer, chunk]);

                let start_index = 0;
                while (true) {
                    const start = jpegBuffer.indexOf(Buffer.from([0xFF, 0xD8]), start_index);
                    if (start === -1) break;

                    const end = jpegBuffer.indexOf(Buffer.from([0xFF, 0xD9]), start + 2);
                    if (end === -1) break;

                    const jpeg_data = jpegBuffer.slice(start, end + 2);
                    if (dc.readyState === 'open') {
                        dc.send(jpeg_data);
                    }
                    start_index = end + 2;
                }
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

        // DataChannel'dan gelen komutları işle
        dc.onmessage = async (msg) => {
            console.log("DataChannel message from client:", msg.data);
            
            try {
                const command = JSON.parse(msg.data);
                
                switch (command.type) {
                    case 'pull_file':
                        const result = await pullFileFromPhone(command.remotePath, command.localPath);
                        dc.send(JSON.stringify({
                            type: 'file_pulled',
                            success: true,
                            localPath: result
                        }));
                        break;
                        
                    case 'list_files':
                        const files = await listPhoneFiles(command.directory || '/sdcard/');
                        dc.send(JSON.stringify({
                            type: 'file_list',
                            files: files
                        }));
                        break;
                        
                    case 'get_app_data':
                        const appData = await getAppData(command.packageName);
                        dc.send(JSON.stringify({
                            type: 'app_data',
                            data: appData
                        }));
                        break;
                        
                    case 'pull_multiple':
                        const transferResults = await pullMultipleFiles(
                            command.fileList, 
                            command.localDir || './downloads'
                        );
                        dc.send(JSON.stringify({
                            type: 'bulk_transfer_complete',
                            results: transferResults
                        }));
                        break;
                }
            } catch (error) {
                dc.send(JSON.stringify({
                    type: 'error',
                    message: error.message
                }));
            }
        };

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

// Cleanup fonksiyonu
function cleanup() {
    if (activeFfmpegProcess) {
        activeFfmpegProcess.kill('SIGINT');
        activeFfmpegProcess = null;
    }
    if (activeAdbProcess) {
        activeAdbProcess.kill('SIGINT');
        activeAdbProcess = null;
    }
}

process.on('exit', cleanup);
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);