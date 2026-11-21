require("dotenv").config();
const WebSocket = require("ws");
const http = require("http");
const express = require("express");
const path = require("path");

const PORT = process.env.PORT || 3000;
const CLE = process.env.DEEPGRAM_API_KEY;
const BASE = process.env.DG_BASE || "wss://api.deepgram.com";
if (!CLE) {
    console.error("DEEPGRAM_API_KEY manquante dans le fichier .env");
    process.exit(1);
}
// Voix -> texte
const URL_STT =
    `${BASE}/v1/listen?model=nova-2&language=fr` +
    `&interim_results=true&smart_format=true&endpointing=700&utterance_end_ms=1000`;
// Texte -> voix
const URL_TTS = `${BASE}/v2/speak?model=flux-benoit-fr&encoding=linear16`;

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, "public")));

function ouvrirDeepgram(url) {
    return new WebSocket(url, { headers: { Authorization: `Token ${CLE}` } });
}

function envoyerJSON(ws, objet) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(objet));
}

wss.on("connection", (client) => {
    const stt = ouvrirDeepgram(URL_STT);   // ecoute
    const tts = ouvrirDeepgram(URL_TTS);   // parle
    const fileAudio = [];                  // audio du micro en attente de stt
    const fileTextes = [];                 // textes en attente de tts
    let phrase = "";                       // segments definitifs de la phrase en cours

    // ---- Texte -> voix ----
    function parler(texte) {
        tts.send(JSON.stringify({ type: "Speak", text: texte }));
        tts.send(JSON.stringify({ type: "Flush" }));
    }

    // Une phrase est finie : on la repete
    function repeterPhrase() {
        const texte = phrase.trim();
        phrase = "";
        if (!texte) return;
        envoyerJSON(client, { type: "repete", texte });
        if (tts.readyState === WebSocket.OPEN) parler(texte);
        else fileTextes.push(texte);
    }

    tts.on("open", () => {
        console.log("TTS pret");
        while (fileTextes.length) parler(fileTextes.shift());
    });
    tts.on("message", (data, isBinary) => {
        if (isBinary) {
            if (client.readyState === WebSocket.OPEN) client.send(data, { binary: true });
        } else {
            console.log("TTS :", data.toString());
        }
    });
    tts.on("error", (e) => {
        console.log("Erreur TTS :", e.message);
        envoyerJSON(client, { type: "erreur", message: "Erreur synthese vocale : " + e.message });
    });

    // ---- Voix -> texte ----
    client.on("message", (data, isBinary) => {
        if (!isBinary) return;             // le navigateur n'envoie que de l'audio
        if (stt.readyState === WebSocket.OPEN) stt.send(data);
        else fileAudio.push(data);
    });

    stt.on("open", () => {
        console.log("STT pret");
        while (fileAudio.length) stt.send(fileAudio.shift());
    });
    stt.on("message", (data) => {
        let r;
        try {
            r = JSON.parse(data.toString());
        } catch (e) {
            console.log("Message STT invalide :", e.message);
            return;
        }
        if (r.type === "UtteranceEnd") {   // filet de securite : silence long
            repeterPhrase();
            return;
        }
        const texte = r.channel?.alternatives?.[0]?.transcript;
        if (!texte) return;
        if (r.is_final) phrase += texte + " ";
        envoyerJSON(client, {
            type: "texte",
            texte: r.is_final ? phrase.trim() : (phrase + texte).trim(),
            statut: r.is_final ? "definitif" : "provisoire"
        });
        if (r.speech_final) repeterPhrase(); // fin de phrase detectee
    });
    stt.on("error", (e) => {
        console.log("Erreur STT :", e.message);
        envoyerJSON(client, { type: "erreur", message: "Erreur transcription : " + e.message });
    });

    // ---- Garder les connexions en vie ----
    const keepAlive = setInterval(() => {
        if (stt.readyState === WebSocket.OPEN) stt.send(JSON.stringify({ type: "KeepAlive" }));
        if (tts.readyState === WebSocket.OPEN) tts.ping();
    }, 8000);

    // ---- Fermeture ----
    function toutFermer() {
        clearInterval(keepAlive);
        fileAudio.length = 0;
        fileTextes.length = 0;
        stt.close();
        tts.close();
    }
    client.on("close", toutFermer);
    stt.on("close", () => { if (client.readyState === WebSocket.OPEN) client.close(); });
    tts.on("close", () => { if (client.readyState === WebSocket.OPEN) client.close(); });
});

server.listen(PORT, () => {
    console.log(`Serveur lance sur http://localhost:${PORT}`);
});