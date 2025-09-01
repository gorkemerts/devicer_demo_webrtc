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

// adb tcpip 5555
async function pullFileFromPhone(remotePath, localPath) {
    return new Promise((resolve, reject) => {
        // Hedef dizinin var olup olmadığını kontrol et, yoksa oluştur
        const dir = path.dirname(localPath);
        if (!fs.existsSync(dir)){
            fs.mkdirSync(dir, { recursive: true });
        }
        
        const pullProcess = spawn('adb', ['pull', remotePath, localPath]);
        
        pullProcess.on('close', (code) => {
            if (code === 0) {
                console.log(`Dosya çekildi: ${remotePath} -> ${localPath}`);
                resolve(localPath);
            } else {
                reject(new Error(`ADB pull işlemi ${code} koduyla başarısız oldu`));
            }
        });
        
        pullProcess.stderr.on('data', (data) => {
            console.error(`ADB pull hatası: ${data}`);
        });

        pullProcess.on('error', reject);
    });
}

// Telefon bilgilerini alma
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

// Telefondaki dosyaları listeleme
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

// Uygulama verilerini alma
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

// --- WebSocket ve WebRTC Mantığı ---

ws.on('open', () => {
    console.log("Sinyal sunucusuna bağlanıldı");
    ws.send(JSON.stringify({ type: 'streamer_awake' }));
});

ws.on('message', async (data) => {
    const message = JSON.parse(data.toString());
    console.log("Sinyal mesajı alındı:", message.type);

    if (message.type === 'clientoffers') {
        pc = new wrtc.RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        dc = pc.createDataChannel('server-to-browser');

                  dc.onopen = async () => {
            console.log("DataChannel açıldı, en kararlı yöntemle akış başlatılıyor (screenrecord + TCP)...");

            const runCommand = (command, args) => {
                return new Promise((resolve, reject) => {
                    const process = spawn(command, args);
                    let stderr = '';
                    process.stderr.on('data', (data) => stderr += data.toString());
                    process.on('close', (code) => {
                        if (code === 0) resolve();
                        else reject(new Error(`Komut '${command} ${args.join(' ')}' ${code} koduyla başarısız oldu. Hata: ${stderr}`));
                    });
                    process.on('error', (err) => reject(err));
                });
            };

            try {
                // Değişkenler
                const LOCAL_TCP_PORT = 54321;
                const DEVICE_TCP_PORT = 12345; // screenrecord için farklı bir port kullanalım

                console.log("Adım 1: Telefon bilgileri gönderiliyor...");
                await getPhoneInfo().then(phoneInfo => dc.send(JSON.stringify({ type: 'phone_info', data: phoneInfo })));

                console.log("Adım 2: ADB TCP tüneli kuruluyor...");
                await runCommand('adb', ['forward', '--remove-all']);
                await runCommand('adb', ['forward', `tcp:${LOCAL_TCP_PORT}`, `tcp:${DEVICE_TCP_PORT}`]);

                console.log("Adım 3: Telefonda 'screenrecord' ve 'netcat' başlatılıyor...");
                // netcat (nc), screenrecord'un çıktısını bir TCP portuna yönlendirir.
                // Bu komutun çalışması için telefonda 'nc' komutunun olması gerekir. Çoğu telefonda bulunur.
                const shellCommand = `screenrecord --output-format=h264 --size=720x1280 --bit-rate=2000000 - | nc -l -p ${DEVICE_TCP_PORT}`;
                activeAdbProcess = spawn('adb', ['shell', shellCommand]);
                
                activeAdbProcess.stderr.on('data', data => console.error(`[ADB SHELL HATA]: ${data.toString()}`));
                activeAdbProcess.on('close', code => {
                    console.log(`ADB shell işlemi sonlandı, kod: ${code}`);
                    cleanup();
                });
                    let brightnessToggle = false; 
                       triggerInterval = setInterval(() => {
                console.log('auto trigger'); // Hata ayıklama için

                spawn('adb', ['shell', 'input', 'swipe', '0', '0', '1', '1', '100']);
                
                // Bir sonraki sefer için durumu tersine çevir
                brightnessToggle = !brightnessToggle; 
            }, 1000); // 1 saniye (1000ms) daha güvenli bir aralıktır.
                setTimeout(() => {
                    console.log("Adım 4: FFmpeg başlatılıyor...");
                    
                    activeFfmpegProcess = spawn('ffmpeg', [
                        // Giriş formatını net olarak belirtiyoruz, çünkü screenrecord'un çıktısı güvenilirdir.
                        '-f', 'h264',
                        '-i', `tcp://127.0.0.1:${LOCAL_TCP_PORT}`,
                        '-f', 'mjpeg',
                        '-q:v', '3',
                        '-pix_fmt', 'yuvj420p',
                        'pipe:1'
                    ]);
                    
                    let jpegBuffer = Buffer.alloc(0);
                    const DELIMITER = '|||JPEG_END|||';
                    activeFfmpegProcess.stdout.on('data', (chunk) => {
                        jpegBuffer = Buffer.concat([jpegBuffer, chunk]);
                        let startIndex = 0;
                        while (true) {
                            const start = jpegBuffer.indexOf(Buffer.from([0xFF, 0xD8]), startIndex);
                            if (start === -1) break;
                            const end = jpegBuffer.indexOf(Buffer.from([0xFF, 0xD9]), start + 2);
                            if (end === -1) break;
                            const jpegData = jpegBuffer.slice(start, end + 2);
                            if (dc.readyState === 'open') {
                                dc.send(jpegData);
                                dc.send(DELIMITER);
                            }
                            startIndex = end + 2;
                        }
                        jpegBuffer = jpegBuffer.slice(startIndex);
                    });

                    activeFfmpegProcess.stderr.on('data', data => console.log(`[FFMPEG LOG]: ${data}`));
                    activeFfmpegProcess.on('close', code => {
                        console.log(`FFmpeg işlemi sonlandı, kod: ${code}`);
                    });

                }, 2000);

            } catch (error) {
                console.error("Akış başlatma sırasında kritik bir hata oluştu:", error.message);
                cleanup();
            }
        };

        // DataChannel'dan gelen komutları işle
        dc.onmessage = async (msg) => {
            console.log("İstemciden DataChannel mesajı:", msg.data);
            
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
                console.error("Komut işlenirken hata:", error.message);
                dc.send(JSON.stringify({
                    type: 'error',
                    message: error.message
                }));
            }
        };

        dc.onclose = () => {
            console.log("DataChannel kapandı.");
            cleanup();
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
        if(pc) {
            await pc.setRemoteDescription(message.answer);
            console.log("Answer alındı ve ayarlandı");
        }
    }

    else if (message.type === 'client_candidate') {
        if(pc) {
            await pc.addIceCandidate(message.candidate);
            console.log("İstemciden ICE adayı eklendi");
        }
    }
});

ws.on('close', () => {
    console.log("Sinyal sunucusuyla bağlantı kesildi.");
    cleanup();
});

// Temizleme fonksiyonu
function cleanup() {
    console.log("Temizleme işlemi başlatılıyor...");

    // YENİ VE EN ÖNEMLİ EKLEME: TETİKLEYİCİYİ DURDUR
    if (triggerInterval) {
        clearInterval(triggerInterval); // Başlatılan interval'ı durdur
        triggerInterval = null;         // Değişkeni temizle
        console.log("Ekran tazeleme tetikleyicisi durduruldu.");
    }
    
    spawn('adb', ['forward', '--remove', 'tcp:54321']);
    console.log("ADB TCP yönlendirmesi kaldırıldı.");

    if (dc) {
        dc.close();
        dc = null;
    }
    if (pc) {
        pc.close();
        pc = null;
    }
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
process.on('SIGTERM', cleanup); // kill