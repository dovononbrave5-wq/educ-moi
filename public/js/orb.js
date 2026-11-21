
(function () {
    const canvas = document.getElementById('orb');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const TAU = Math.PI * 2;
    const BIN_LOW = 2, BIN_HIGH = 42, NB = BIN_HIGH - BIN_LOW + 1; // plage de fréquences : la voix
    const levels = new Float32Array(BIN_HIGH + 1);
    const calm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    function rand(a, b) { return a + Math.random() * (b - a); }
    function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
    function randomBand() { return BIN_LOW + Math.floor(Math.pow(Math.random(), 1.6) * NB); }

    const nodes = [], edges = [];
    (function () {
        const t = (1 + Math.sqrt(5)) / 2;
        const verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
                       [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
        let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4],
                     [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8],
                     [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
        const cache = {};
        function mid(a, b) {
            const k = a < b ? a + '_' + b : b + '_' + a;
            if (cache[k] !== undefined) return cache[k];
            verts.push(norm([(verts[a][0] + verts[b][0]) / 2, (verts[a][1] + verts[b][1]) / 2, (verts[a][2] + verts[b][2]) / 2]));
            return (cache[k] = verts.length - 1);
        }
        const next = [];
        faces.forEach(function (f) {
            const a = mid(f[0], f[1]), b = mid(f[1], f[2]), c = mid(f[2], f[0]);
            next.push([f[0], a, c], [f[1], b, a], [f[2], c, b], [a, b, c]);
        });
        faces = next;
        const seen = {};
        faces.forEach(function (f) {
            [[f[0], f[1]], [f[1], f[2]], [f[2], f[0]]].forEach(function (e) {
                const lo = Math.min(e[0], e[1]), hi = Math.max(e[0], e[1]), k = lo + '_' + hi;
                if (!seen[k]) { seen[k] = 1; edges.push([lo, hi]); }
            });
        });
        verts.forEach(function (v) {
            const j = norm([v[0] + rand(-0.13, 0.13), v[1] + rand(-0.13, 0.13), v[2] + rand(-0.13, 0.13)]);
            const rad = 1 + rand(-0.04, 0.04);
            nodes.push({ x: j[0] * rad, y: j[1] * rad, z: j[2] * rad, band: randomBand(),
                         big: Math.random() < 0.2, seed: Math.random() });
        });
    })();

    // ---------- 2. Coquille de points fins (milieu) ----------
    const golden = Math.PI * (3 - Math.sqrt(5));
    const SHELL = 1300, shell = [];
    for (let i = 0; i < SHELL; i++) {
        const y = -1 + (2 * i) / (SHELL - 1), ring = Math.sqrt(1 - y * y), th = golden * i;
        shell.push({ x: Math.cos(th) * ring, y: y, z: Math.sin(th) * ring, band: randomBand(), seed: Math.random() });
    }

    // ---------- 3. Noyau : amas de petites perles brillantes ----------
    const CORE = 230, core = [];
    for (let i = 0; i < CORE; i++) {
        const y = -1 + (2 * i) / (CORE - 1), ring = Math.sqrt(1 - y * y), th = golden * i * 1.7;
        const rad = 0.8 + Math.random() * 0.3;
        core.push({ x: Math.cos(th) * ring * rad, y: y * rad, z: Math.sin(th) * ring * rad, s: 0.4 + Math.random() * 1.1, seed: Math.random() });
    }

    // ---------- 4. Particules qui flottent autour ----------
    const DUST = 110, dust = [];
    for (let i = 0; i < DUST; i++) {
        dust.push({ th: rand(0, TAU), ph: Math.acos(rand(-1, 1)), r: rand(1.08, 1.42),
                    sp: rand(0.3, 1.2) * (Math.random() < 0.5 ? -1 : 1), s: rand(0.5, 1.8),
                    f: rand(0.6, 2), seed: Math.random(), band: randomBand() });
    }

    // Petite pastille lumineuse pré-dessinée (beaucoup plus rapide qu'un flou à chaque point)
    function makeGlow(size) {
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const g = c.getContext('2d');
        const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        gr.addColorStop(0, 'rgba(255,255,255,1)');
        gr.addColorStop(0.18, 'rgba(170,235,255,0.95)');
        gr.addColorStop(0.45, 'rgba(40,160,255,0.35)');
        gr.addColorStop(1, 'rgba(0,80,255,0)');
        g.fillStyle = gr;
        g.fillRect(0, 0, size, size);
        return c;
    }
    const glow = makeGlow(64);

    let audioCtx = null, source = null, analyser = null, freq = null;
    let width = 1, height = 1, dpr = 1;
    let rotA = 0, rotB = 0, tiltX = 0, tiltY = 0, targetX = 0, targetY = 0;
    let energy = 0, bass = 0, ext = 0;

    function resize() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        const rect = canvas.getBoundingClientRect();
        width = canvas.width = Math.max(1, Math.round(rect.width * dpr));
        height = canvas.height = Math.max(1, Math.round(rect.height * dpr));
    }
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(canvas);
    else window.addEventListener('resize', resize);
    resize();

    // Interactif : la sphère s'incline vers le curseur / le doigt.
    window.addEventListener('pointermove', function (e) {
        targetY = (e.clientX / window.innerWidth - 0.5) * 1.2;
        targetX = (e.clientY / window.innerHeight - 0.5) * 0.8;
    });

    function connect(stream) {
        disconnect();
        const AC = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AC();
        if (audioCtx.resume) audioCtx.resume();
        source = audioCtx.createMediaStreamSource(stream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.5;
        source.connect(analyser);            // pas relié aux haut-parleurs : pas d'écho
        freq = new Uint8Array(analyser.frequencyBinCount);
    }

    function disconnect() {
        if (source) source.disconnect();
        if (audioCtx) audioCtx.close();
        audioCtx = source = analyser = freq = null;
    }

    function pulse(v) { ext = Math.max(ext, Math.min(1, v || 0)); }

    function readAudio() {
        if (analyser) analyser.getByteFrequencyData(freq);
        ext *= 0.9;
        let sum = 0, bs = 0;
        for (let b = BIN_LOW; b <= BIN_HIGH; b++) {
            let target = analyser ? Math.min(1, (freq[b] / 255) * 1.5) : 0;
            const e = ext * (1 - ((b - BIN_LOW) / NB) * 0.5);
            if (e > target) target = e;
            // attaque rapide, retombée douce : la sphère "claque" puis se calme
            levels[b] += (target - levels[b]) * (target > levels[b] ? 0.55 : 0.1);
            sum += levels[b];
            if (b < BIN_LOW + 9) bs += levels[b];
        }
        energy = sum / NB;
        bass = bs / 9;
    }

    // Projection 3D -> écran (rotation autour de Y, inclinaison X, légère perspective)
    let px = 0, py = 0, pz = 0, pp = 1;
    function project(x, y, z, cosA, sinA, cosX, sinX, cx, cy, R) {
        const x1 = x * cosA + z * sinA;
        const z1 = -x * sinA + z * cosA;
        const y2 = y * cosX - z1 * sinX;
        const z2 = y * sinX + z1 * cosX;
        pp = 1 / (1 - z2 * 0.18);
        px = cx + x1 * R * pp;
        py = cy + y2 * R * pp;
        pz = z2;
    }

    const nx = new Float32Array(nodes.length), ny = new Float32Array(nodes.length);
    const nd = new Float32Array(nodes.length), nl = new Float32Array(nodes.length);

    function draw(time) {
        const t = time * 0.001;
        readAudio();

        tiltX += (targetX - tiltX) * 0.05;
        tiltY += (targetY - tiltY) * 0.05;
        const speed = (calm ? 0.0004 : 0.002) + energy * (calm ? 0.004 : 0.026);
        rotA += speed;
        rotB -= speed * 1.6;

        const cx = width / 2, cy = height / 2;
        const R = Math.min(width, height) * 0.32 * (1 + energy * 0.06);
        const cosX = Math.cos(tiltX + 0.25), sinX = Math.sin(tiltX + 0.25);
        const cosA = Math.cos(rotA + tiltY), sinA = Math.sin(rotA + tiltY);
        const cosB = Math.cos(rotB + tiltY), sinB = Math.sin(rotB + tiltY);

        ctx.globalCompositeOperation = 'source-over';
        ctx.clearRect(0, 0, width, height);

        // Voile sombre + halo sur le bord de la sphère
        const hg = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.1);
        hg.addColorStop(0, 'rgba(8,30,60,0)');
        hg.addColorStop(0.7, 'rgba(10,45,85,0.28)');
        hg.addColorStop(0.92, 'rgba(25,100,160,' + (0.35 + energy * 0.35).toFixed(2) + ')');
        hg.addColorStop(1, 'rgba(20,90,170,0)');
        ctx.fillStyle = hg;
        ctx.beginPath();
        ctx.arc(cx, cy, R * 1.1, 0, TAU);
        ctx.fill();

        ctx.globalCompositeOperation = 'lighter';   // les éléments qui se croisent brillent

        // Lueur du noyau (grossit avec les graves)
        const gr = R * (0.55 + bass * 0.35);
        const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, gr);
        cg.addColorStop(0, 'rgba(130,235,255,' + (0.5 + bass * 0.45).toFixed(2) + ')');
        cg.addColorStop(0.35, 'rgba(30,130,255,' + (0.22 + bass * 0.25).toFixed(2) + ')');
        cg.addColorStop(1, 'rgba(0,60,200,0)');
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.arc(cx, cy, gr, 0, TAU);
        ctx.fill();

        // Coquille de points fins
        const SR = 0.5 * (1 + energy * 0.08);
        for (let i = 0; i < SHELL; i++) {
            const p = shell[i], lv = levels[p.band];
            const r = SR * (1 + lv * 0.12 * (0.5 + 0.5 * Math.sin(t * 2 + p.seed * TAU)));
            project(p.x * r, p.y * r, p.z * r, cosB, sinB, cosX, sinX, cx, cy, R);
            const depth = Math.max(0, Math.min(1, (pz / r + 1) / 2));
            const alpha = Math.min(1, 0.22 + 0.55 * depth + lv * 0.5);
            const s = (1.0 + lv * 1.3) * dpr * pp;
            ctx.fillStyle = 'rgba(90,200,255,' + alpha.toFixed(2) + ')';
            ctx.fillRect(px - s / 2, py - s / 2, s, s);
        }

        // Sommets du maillage (positions projetées)
        for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i], lv = levels[n.band];
            const r = 1 + 0.015 * Math.sin(t * 0.9 + n.seed * TAU) + lv * 0.14 * (0.5 + 0.5 * Math.sin(t * 2.2 + n.seed * TAU));
            project(n.x * r, n.y * r, n.z * r, cosA, sinA, cosX, sinX, cx, cy, R);
            nx[i] = px; ny[i] = py;
            nd[i] = Math.max(0, Math.min(1, (pz / r + 1) / 2));
            nl[i] = lv;
        }

        // Arêtes du maillage
        ctx.lineCap = 'round';
        for (let i = 0; i < edges.length; i++) {
            const a = edges[i][0], b = edges[i][1];
            const depth = (nd[a] + nd[b]) / 2, lv = (nl[a] + nl[b]) / 2;
            const alpha = Math.min(1, (0.3 + 0.5 * depth) * (0.8 + lv * 1.4) + lv * 0.2);
            ctx.strokeStyle = 'rgba(70,200,255,' + alpha.toFixed(2) + ')';
            ctx.lineWidth = (0.9 + depth * 0.5 + lv * 0.9) * dpr;
            ctx.beginPath();
            ctx.moveTo(nx[a], ny[a]);
            ctx.lineTo(nx[b], ny[b]);
            ctx.stroke();
        }

        // Sommets lumineux
        for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            const size = ((n.big ? 22 : 10) + nl[i] * 16) * dpr * (0.6 + nd[i] * 0.6);
            ctx.globalAlpha = Math.min(1, 0.35 + 0.65 * nd[i] + nl[i] * 0.3);
            ctx.drawImage(glow, nx[i] - size / 2, ny[i] - size / 2, size, size);
        }

        // Noyau
        const CR = 0.17 * (1 + bass * 0.55);
        for (let i = 0; i < CORE; i++) {
            const p = core[i];
            const wob = 1 + 0.06 * Math.sin(t * 3 + p.seed * TAU);
            project(p.x * CR * wob, p.y * CR * wob, p.z * CR * wob, cosA * 1.0, sinA, cosX, sinX, cx, cy, R);
            const depth = Math.max(0, Math.min(1, (pz / CR + 1) / 2));
            const size = (4.5 + p.s * 4) * dpr * pp * (1 + bass * 0.7);
            ctx.globalAlpha = Math.min(1, 0.4 + 0.5 * depth + bass * 0.2);
            ctx.drawImage(glow, px - size / 2, py - size / 2, size, size);
        }

        // Particules autour
        for (let i = 0; i < DUST; i++) {
            const d = dust[i];
            d.th += d.sp * 0.0008 * (1 + energy * 6);
            const r = d.r * (1 + energy * 0.12 + levels[d.band] * 0.15);
            const sp = Math.sin(d.ph);
            project(Math.cos(d.th) * sp * r, Math.cos(d.ph) * r, Math.sin(d.th) * sp * r, cosA, sinA, cosX, sinX, cx, cy, R);
            const tw = 0.5 + 0.5 * Math.sin(t * d.f + d.seed * TAU);
            const size = (4 + d.s * 3) * dpr * pp;
            ctx.globalAlpha = 0.2 + 0.5 * tw + levels[d.band] * 0.3;
            ctx.drawImage(glow, px - size / 2, py - size / 2, size, size);
        }

        ctx.globalAlpha = 1;
        requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);

    window.Orb = { connect: connect, disconnect: disconnect, pulse: pulse };
})();