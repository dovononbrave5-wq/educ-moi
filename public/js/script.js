const SAMPLE_RATE = 24000;

const boutonDemarrer = document.getElementById("btn-demarrer");
const boutonStoper = document.getElementById("btn-stoper");
const statut = document.getElementById("statut");
const zoneTranscription = document.getElementById("transcription");
const zoneRepetition = document.getElementById("repetition");

let socket = null;
let mediaRecorder = null;
let streamMicro = null;
let audioCtx = null;
let prochainTemps = 0; 
let timerMicro = null;
let reste = new Uint8Array(0); e

function jouerPCM(arrayBuffer) {
    let donnees = new Uint8Array(arrayBuffer);
    if (reste.length) {
        const fusion = new Uint8Array(reste.length + donnees.length);
        fusion.set(reste);
        fusion.set(donnees, reste.length);
        donnees = fusion;
        reste = new Uint8Array(0);
    }
    if (donnees.length % 2 === 1) {
        reste = donnees.slice(donnees.length - 1);
        donnees = donnees.slice(0, donnees.length - 1);
    }
    if (!donnees.length) return;

    const int16 = new Int16Array(donnees.buffer, donnees.byteOffset, donnees.length / 2);
    const float32 = Float32Array.from(int16, (v) => v / 32768);

    const buffer = audioCtx.createBuffer(1, float32.length, SAMPLE_RATE);
    buffer.copyToChannel(float32, 0);
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);

    prochainTemps = Math.max(prochainTemps, audioCtx.currentTime);
    source.start(prochainTemps);
    prochainTemps += buffer.duration;

    // Pendant que la voix parle, on coupe le micro pour ne pas s'entendre soi-meme
    couperMicro();
    clearTimeout(timerMicro);
    timerMicro = setTimeout(rallumerMicro,
        (prochainTemps - audioCtx.currentTime) * 1000 + 400);
}

function couperMicro() {
    if (streamMicro) streamMicro.getAudioTracks().forEach((t) => (t.enabled = false));
    statut.textContent = "Je répète...";
}
function rallumerMicro() {
    if (streamMicro) streamMicro.getAudioTracks().forEach((t) => (t.enabled = true));
    statut.textContent = "Je vous écoute...";
}

function recevoir(event) {
    if (typeof event.data !== "string") {   
        jouerPCM(event.data);
        return;
    }
    let message;
    try {
        message = JSON.parse(event.data);
    } catch (e) {
        return;
    }
    if (message.type === "texte") {
        zoneTranscription.textContent = message.texte;
    } else if (message.type === "repete") {
        zoneRepetition.textContent = message.texte;
    } else if (message.type === "erreur") {
        statut.textContent = message.message;
    }
}

boutonDemarrer.addEventListener("click", async () => {
    if (socket) return; // deja demarre

    audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
    await audioCtx.resume();
    prochainTemps = 0;

    try {
        streamMicro = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true }
        });
    } catch (erreur) {
        console.error("Accès au microphone refusé :", erreur);
        alert("Impossible d'accéder au microphone. Veuillez autoriser son utilisation.");
        audioCtx.close();
        return;
    }

    const protocole = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocole}//${location.host}`);
    socket.binaryType = "arraybuffer";
    socket.onmessage = recevoir;
    socket.onerror = () => (statut.textContent = "Erreur de connexion");
    socket.onclose = () => {
        if (socket === null) return; // fermeture voulue (bouton Arrêter)
        statut.textContent = "Connexion fermée";
        liberer();
    };
    socket.onopen = () => {
        mediaRecorder = new MediaRecorder(streamMicro);
        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0 && socket && socket.readyState === WebSocket.OPEN) {
                socket.send(e.data);
            }
        };
        mediaRecorder.start(250);
        Orb.connect(streamMicro);
        statut.textContent = "Je vous écoute...";
    };
});

function liberer() {
    clearTimeout(timerMicro);
    if (typeof Orb !== "undefined") Orb.disconnect();
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
    mediaRecorder = null;
    if (streamMicro) streamMicro.getTracks().forEach((t) => t.stop());
    streamMicro = null;
    if (audioCtx) audioCtx.close();
    audioCtx = null;
    socket = null;
    reste = new Uint8Array(0);
}

boutonStoper.addEventListener("click", () => {
    const s = socket;
    liberer();
    if (s && s.readyState <= WebSocket.OPEN) s.close();
    statut.textContent = "Arrêté";
});