// =====================================================================
//  SECURE STYLUS EXAM NOTEBOOK – CORE SCRIPT
//  Features:
//  - Stylus Pen (smooth, pressure-sensitive fountain pen lines)
//  - Hand Touch Recognition (Strict palm rejection: hand never draws ink;
//    hand tap reads words, or erases words in Eraser mode)
//  - Whole Word Eraser (tap or drag over any word to erase the entire word)
//  - Read Word (reads strictly isolated touched word, never whole page)
//  - Read Ans / Read Question (full speech synthesis)
//  - Round FAB key (1 tap -> word, 2 taps -> line, long-press -> ans)
//  - High-precision Google Digital Ink Engine + Isolated Tesseract fallback
//  - Encrypted offline exam storage (AES-256)
// =====================================================================

// ---------- Questions ----------
const questions = [
    { id: 'q1', text: "Q1: Write the name of your favorite fruit." },
    { id: 'q2', text: "Q2: What is the capital city of your country?" },
    { id: 'q3', text: "Q3: Write a short welcome message." }
];
let currentQuestionIndex = 0;

// ---------- Secure Storage ----------
const SECRET_KEY = "exam_secure_key_123";
let examData = { q1: [], q2: [], q3: [] };
let currentStrokes = []; // Array of { id, isEraser, points: [{x, y, p, t}] }
let strokeIdCounter = 1;

// ---------- DOM Elements ----------
const canvas          = document.getElementById('drawing-canvas');
const ctx             = canvas.getContext('2d');
const questionText    = document.getElementById('question-text');
const statusOverlay   = document.getElementById('status-overlay');
const nextBtn         = document.getElementById('next-btn');
const prevBtn         = document.getElementById('prev-btn');
const clearBtn        = document.getElementById('clear-btn');
const submitBtn       = document.getElementById('submit-btn');
const canvasContainer = document.getElementById('canvas-container');
const tamperAlert     = document.getElementById('tamper-alert');
const dismissTamperBtn= document.getElementById('dismiss-tamper-btn');

const penBtn          = document.getElementById('pen-btn');
const eraserBtn       = document.getElementById('eraser-btn');
const readWordBtn     = document.getElementById('read-word-btn');
const saveBtn         = document.getElementById('save-btn');
const readQBtn        = document.getElementById('read-q-btn');
const readABtn        = document.getElementById('read-a-btn');
const roundKey        = document.getElementById('round-key');
const orientationBtn  = document.getElementById('orientation-btn');
const lineToggleBtn   = document.getElementById('line-toggle-btn');
const appContainer    = document.querySelector('.app-container');

// ---------- Application State ----------
let activeTool = 'pen'; // 'pen' | 'eraser' | 'read'
let isDrawing = false;
let isErasing = false;
let isOCRBusy = false;
let isHandTouch = false;
let currentStrokeObj = null;
let lastDrawX = 0, lastDrawY = 0;
let lastKnownPoint = null;
let isPortraitSheet = true;
let lineOrientation = 'horizontal';

// Hand touch tracking for tap vs drag reading
let touchStartX = 0;
let touchStartY = 0;
let touchStartTime = 0;

// ---------- Web Audio API ----------
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function getAudioContext() {
    if (!audioCtx) {
        try { audioCtx = new AudioContextClass(); } catch (e) {}
    }
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
}

function playTone(freq, vol, dur, type = 'sine') {
    try {
        const actx = getAudioContext();
        if (!actx) return;
        const osc = actx.createOscillator();
        const gain = actx.createGain();
        osc.connect(gain);
        gain.connect(actx.destination);
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(vol, actx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
        osc.start();
        osc.stop(actx.currentTime + dur);
    } catch (e) {}
}

// ---------- Coordinate Helpers ----------
// Pixel-accurate coordinates relative to canvas bounding box
function getCanvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
}

// ---------- Canvas Resizing ----------
function resizeCanvas() {
    const rect = canvasContainer.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redrawStrokes();
}
window.addEventListener('resize', () => setTimeout(resizeCanvas, 60));

// ---------- Tamper Detection ----------
window.addEventListener('visibilitychange', () => {
    if (document.hidden && tamperAlert) {
        tamperAlert.classList.remove('hidden');
    }
});
if (dismissTamperBtn) {
    dismissTamperBtn.addEventListener('click', () => {
        tamperAlert.classList.add('hidden');
    });
}

// ---------- Initialization ----------
function init() {
    loadExamData();
    resizeCanvas();
    updateQuestion();
    setActiveTool('pen');
}

function updateQuestion() {
    const q = questions[currentQuestionIndex];
    if (questionText) questionText.textContent = q.text;
    const rawStrokes = examData[q.id] || [];
    currentStrokes = rawStrokes.map(s => {
        if (Array.isArray(s)) return { id: ++strokeIdCounter, isEraser: false, points: s };
        return {
            id: s.id || ++strokeIdCounter,
            isEraser: !!s.isEraser,
            points: s.points || []
        };
    });
    redrawStrokes();
}

// ---------- Encrypted Local Storage ----------
function saveExamData() {
    examData[questions[currentQuestionIndex].id] = currentStrokes;
    try {
        const jsonStr = JSON.stringify(examData);
        const encrypted = CryptoJS.AES.encrypt(jsonStr, SECRET_KEY).toString();
        localStorage.setItem('exam_secure_data', encrypted);
    } catch (e) {
        console.error("Storage error:", e);
    }
}

function loadExamData() {
    const encrypted = localStorage.getItem('exam_secure_data');
    if (!encrypted) return;
    try {
        const bytes = CryptoJS.AES.decrypt(encrypted, SECRET_KEY);
        const decrypted = bytes.toString(CryptoJS.enc.Utf8);
        if (decrypted) examData = JSON.parse(decrypted);
    } catch (e) {
        console.error("Failed to decrypt exam data:", e);
    }
}

// ---------- Canvas Rendering ----------
function redrawStrokes() {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    for (const stroke of currentStrokes) {
        if (stroke.isEraser) continue;
        const pts = stroke.points;
        if (!pts || pts.length === 0) continue;

        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = '#1a1a2e';
        ctx.fillStyle = '#1a1a2e';
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (pts.length === 1) {
            ctx.beginPath();
            ctx.arc(pts[0].x, pts[0].y, 1.2, 0, Math.PI * 2);
            ctx.fill();
            continue;
        }

        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length - 1; i++) {
            const midX = (pts[i].x + pts[i + 1].x) / 2;
            const midY = (pts[i].y + pts[i + 1].y) / 2;
            ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
        }
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        ctx.stroke();
    }
}

// ---------- Geometric Helpers ----------
function getStrokeBounds(stroke) {
    const pts = stroke.points || [];
    if (pts.length === 0) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    return {
        minX, maxX, minY, maxY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY),
        centerX: (minX + maxX) / 2,
        centerY: (minY + maxY) / 2
    };
}

function distToStroke(x, y, stroke) {
    const pts = stroke.points || [];
    if (pts.length === 0) return Infinity;
    const b = getStrokeBounds(stroke);
    if (!b) return Infinity;

    // Fast bounding box proximity check (within 60px)
    if (x >= b.minX - 60 && x <= b.maxX + 60 && y >= b.minY - 60 && y <= b.maxY + 60) {
        let minDist = Infinity;
        for (let i = 0; i < pts.length; i++) {
            const d = Math.hypot(pts[i].x - x, pts[i].y - y);
            if (d < minDist) minDist = d;
        }
        return minDist;
    }

    const dx = Math.max(b.minX - x, 0, x - b.maxX);
    const dy = Math.max(b.minY - y, 0, y - b.maxY);
    return Math.hypot(dx, dy);
}

// ---------------------------------------------------------------------
//  PRECISION WORD ISOLATION
//  Finds all strokes belonging to the word touched at (touchX, touchY).
// ---------------------------------------------------------------------
function getWordStrokesAt(touchX, touchY, maxTouchDist = 70) {
    const visible = currentStrokes.filter(s => !s.isEraser && s.points && s.points.length > 0);
    if (visible.length === 0) return null;

    // 1. Find the stroke closest to touch point
    let closestStroke = null;
    let closestDist = Infinity;
    for (const s of visible) {
        const d = distToStroke(touchX, touchY, s);
        if (d < closestDist) {
            closestDist = d;
            closestStroke = s;
        }
    }

    if (!closestStroke || closestDist > maxTouchDist) return null;

    const targetBounds = getStrokeBounds(closestStroke);
    const wordSet = new Set([closestStroke]);

    if (targetBounds) {
        // 2. Identify candidate strokes on the same text line
        const sameLineStrokes = visible.filter(s => {
            const b = getStrokeBounds(s);
            if (!b) return false;
            const centerDiff = Math.abs(b.centerY - targetBounds.centerY);
            const overlapY = Math.max(0, Math.min(b.maxY, targetBounds.maxY) - Math.max(b.minY, targetBounds.minY));
            return centerDiff <= 35 || overlapY > 0;
        });

        // 3. Cluster strokes belonging to this specific word (horizontal gap <= 35px)
        let expanded = true;
        while (expanded) {
            expanded = false;
            for (const candidate of sameLineStrokes) {
                if (wordSet.has(candidate)) continue;
                const candB = getStrokeBounds(candidate);
                if (!candB) continue;

                for (const member of wordSet) {
                    const memB = getStrokeBounds(member);
                    if (!memB) continue;

                    const horizGap = Math.max(0, Math.max(candB.minX - memB.maxX, memB.minX - candB.maxX));
                    const vertDiff = Math.abs(candB.centerY - memB.centerY);

                    if (horizGap <= 35 && vertDiff <= 35) {
                        wordSet.add(candidate);
                        expanded = true;
                        break;
                    }
                }
            }
        }
    }

    const matchedStrokes = Array.from(wordSet);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    matchedStrokes.forEach(s => {
        const b = getStrokeBounds(s);
        if (b.minX < minX) minX = b.minX;
        if (b.maxX > maxX) maxX = b.maxX;
        if (b.minY < minY) minY = b.minY;
        if (b.maxY > maxY) maxY = b.maxY;
    });

    return {
        strokes: matchedStrokes,
        bounds: {
            minX, maxX, minY, maxY,
            width: Math.max(10, maxX - minX),
            height: Math.max(10, maxY - minY)
        }
    };
}

// ---------------------------------------------------------------------
//  WHOLE WORD ERASER
//  Touching or dragging over ANY stroke of a word erases the ENTIRE word!
// ---------------------------------------------------------------------
function eraseWordAt(touchX, touchY) {
    if (!currentStrokes || currentStrokes.length === 0) return false;

    const wordInfo = getWordStrokesAt(touchX, touchY, 70);
    if (!wordInfo || wordInfo.strokes.length === 0) return false;

    const toRemoveIds = new Set(wordInfo.strokes.map(s => s.id));
    const initialCount = currentStrokes.length;
    currentStrokes = currentStrokes.filter(s => !toRemoveIds.has(s.id));

    if (currentStrokes.length < initialCount) {
        saveExamData();
        redrawStrokes();

        if (navigator.vibrate) navigator.vibrate([20, 20]);
        playTone(300, 0.08, 0.05, 'triangle');

        showStatus("Word erased", 600);
        return true;
    }
    return false;
}

// ---------- Status Overlay Helper ----------
let statusTimer = null;
function showStatus(text, duration = 1200) {
    if (statusTimer) clearTimeout(statusTimer);
    statusOverlay.textContent = text;
    statusOverlay.classList.remove('hidden');
    if (duration > 0) {
        statusTimer = setTimeout(() => {
            statusOverlay.classList.add('hidden');
        }, duration);
    }
}

// ---------- Tool Switching ----------
function setActiveTool(tool) {
    activeTool = tool;
    if (penBtn) penBtn.classList.toggle('active-tool', tool === 'pen');
    if (eraserBtn) eraserBtn.classList.toggle('active-tool', tool === 'eraser');
    if (readWordBtn) readWordBtn.classList.toggle('active-tool', tool === 'read');

    if (canvasContainer) {
        canvasContainer.classList.toggle('eraser-active', tool === 'eraser');
    }

    if (tool === 'eraser') {
        canvas.style.cursor = 'cell';
        showStatus("Eraser active: Touch any word to erase it", 1200);
    } else if (tool === 'read') {
        canvas.style.cursor = 'help';
        showStatus("Read active: Touch any word to hear it", 1200);
    } else {
        canvas.style.cursor = 'crosshair';
    }
}

if (penBtn) penBtn.addEventListener('click', () => setActiveTool('pen'));
if (eraserBtn) eraserBtn.addEventListener('click', () => setActiveTool('eraser'));
if (readWordBtn) readWordBtn.addEventListener('click', () => setActiveTool('read'));

// ---------- Utility Buttons ----------
if (saveBtn) {
    saveBtn.addEventListener('click', () => {
        saveExamData();
        showStatus("Saved securely", 1200);
        playTone(520, 0.05, 0.08, 'sine');
    });
}

if (clearBtn) {
    clearBtn.addEventListener('click', () => {
        if (currentStrokes.length === 0) return;
        if (confirm("Clear all handwriting on this page?")) {
            currentStrokes = [];
            saveExamData();
            redrawStrokes();
            showStatus("Page cleared", 1000);
        }
    });
}

if (readQBtn) {
    readQBtn.addEventListener('click', () => {
        speak(questions[currentQuestionIndex].text);
    });
}

if (readABtn) {
    readABtn.addEventListener('click', () => {
        readAllStrokes();
    });
}

// Navigation
if (nextBtn) {
    nextBtn.addEventListener('click', () => {
        saveExamData();
        currentQuestionIndex = (currentQuestionIndex + 1) % questions.length;
        updateQuestion();
    });
}
if (prevBtn) {
    prevBtn.addEventListener('click', () => {
        saveExamData();
        currentQuestionIndex = (currentQuestionIndex - 1 + questions.length) % questions.length;
        updateQuestion();
    });
}
if (submitBtn) {
    submitBtn.addEventListener('click', () => {
        saveExamData();
        alert("Exam encrypted and submitted securely!");
        localStorage.removeItem('exam_secure_data');
        location.reload();
    });
}

// Sheet & Line Toggles
if (orientationBtn) {
    orientationBtn.addEventListener('click', () => {
        isPortraitSheet = !isPortraitSheet;
        if (isPortraitSheet) {
            appContainer.classList.add('portrait-sheet');
            appContainer.classList.remove('landscape-sheet');
            orientationBtn.textContent = 'Portrait Sheet';
        } else {
            appContainer.classList.remove('portrait-sheet');
            appContainer.classList.add('landscape-sheet');
            orientationBtn.textContent = 'Landscape Sheet';
        }
        setTimeout(resizeCanvas, 60);
    });
}

if (lineToggleBtn) {
    lineToggleBtn.addEventListener('click', () => {
        if (lineOrientation === 'horizontal') {
            lineOrientation = 'vertical';
            canvasContainer.classList.remove('ruled-horizontal');
            canvasContainer.classList.add('ruled-vertical');
            lineToggleBtn.textContent = 'Lines: Vert';
        } else {
            lineOrientation = 'horizontal';
            canvasContainer.classList.remove('ruled-vertical');
            canvasContainer.classList.add('ruled-horizontal');
            lineToggleBtn.textContent = 'Lines: Horiz';
        }
    });
}

// ---------- Round Key FAB Logic ----------
let roundKeyTapCount = 0;
let roundKeyTapTimer = null;
let roundKeyLongPressTimer = null;
let roundKeyFiredLongPress = false;

if (roundKey) {
    roundKey.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        roundKeyFiredLongPress = false;
        roundKeyLongPressTimer = setTimeout(() => {
            roundKeyFiredLongPress = true;
            roundKeyTapCount = 0;
            readAllStrokes(); // Long press -> entire answer
        }, 650);
    });

    roundKey.addEventListener('pointerup', (e) => {
        e.preventDefault();
        clearTimeout(roundKeyLongPressTimer);
        if (!roundKeyFiredLongPress) {
            roundKeyTapCount++;
            if (roundKeyTapCount === 1) {
                roundKeyTapTimer = setTimeout(() => {
                    if (roundKeyTapCount === 1) {
                        readLastWord(); // 1 tap -> last word
                    }
                    roundKeyTapCount = 0;
                }, 300);
            } else if (roundKeyTapCount === 2) {
                clearTimeout(roundKeyTapTimer);
                readCurrentLine(); // 2 taps -> current line
                roundKeyTapCount = 0;
            }
        }
    });
}

// ---------------------------------------------------------------------
//  POINTER EVENTS (Stylus Inking, Palm Rejection, Hand Touch Reading)
// ---------------------------------------------------------------------

canvas.addEventListener('pointerdown', (e) => {
    const pt = getCanvasPoint(e);
    const isStylusEraser = (e.pointerType === 'pen' && (e.buttons === 32 || e.button === 5));
    const isEraserMode = (activeTool === 'eraser' || isStylusEraser);

    // 1. ERASER MODE:
    // Both hand touch and stylus erase the whole word
    if (isEraserMode) {
        isErasing = true;
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
        eraseWordAt(pt.x, pt.y);
        e.preventDefault();
        return;
    }

    // 2. HAND / FINGER TOUCH (pointerType === 'touch'):
    // Strict Palm Rejection: Hand touch NEVER draws ink!
    // Hand touch is recognized for reading words on tap or drag.
    if (e.pointerType === 'touch') {
        isHandTouch = true;
        touchStartX = pt.x;
        touchStartY = pt.y;
        touchStartTime = Date.now();
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
        e.preventDefault();
        return;
    }

    // 3. READ TOOL (Stylus or Mouse):
    if (activeTool === 'read') {
        readWordAt(pt.x, pt.y);
        e.preventDefault();
        return;
    }

    // 4. PEN INKING (Only Stylus 'pen' or Desktop 'mouse'):
    if (activeTool === 'pen' && (e.pointerType === 'pen' || e.pointerType === 'mouse')) {
        isDrawing = true;
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
        currentStrokeObj = {
            id: ++strokeIdCounter,
            isEraser: false,
            points: [{ x: pt.x, y: pt.y, p: e.pressure || 0.5, t: Date.now() }]
        };
        lastDrawX = pt.x;
        lastDrawY = pt.y;

        ctx.globalCompositeOperation = 'source-over';
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#1a1a2e';
        ctx.fillStyle = '#1a1a2e';

        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 1.1, 0, Math.PI * 2);
        ctx.fill();

        if (navigator.vibrate) navigator.vibrate(5);
        e.preventDefault();
    }
});

canvas.addEventListener('pointermove', (e) => {
    const pt = getCanvasPoint(e);

    // Boundary Alert
    const margin = 28;
    if (pt.x < margin || pt.x > canvas.offsetWidth - margin ||
        pt.y < margin || pt.y > canvas.offsetHeight - margin) {
        canvasContainer.classList.add('boundary-warning');
        if ((isDrawing || isErasing) && navigator.vibrate) navigator.vibrate(40);
    } else {
        canvasContainer.classList.remove('boundary-warning');
    }

    // Hover guidance for resume point (Stylus)
    if (!isDrawing && !isErasing && e.pointerType === 'pen' && lastKnownPoint) {
        const dist = Math.hypot(pt.x - lastKnownPoint.x, pt.y - lastKnownPoint.y);
        if (dist < 45) {
            playTone(450 + (45 - dist) * 8, 0.03, 0.02, 'sine');
        }
    }

    // ERASER SWIPE / DRAG:
    const isStylusEraser = (e.pointerType === 'pen' && (e.buttons === 32 || e.button === 5));
    if (isErasing || ((activeTool === 'eraser' || isStylusEraser) && (e.buttons >= 1 || e.pressure > 0))) {
        eraseWordAt(pt.x, pt.y);
        e.preventDefault();
        return;
    }

    // HAND TOUCH: Hand never draws ink. Ignore move (or palm resting)
    if (e.pointerType === 'touch' || isHandTouch) {
        e.preventDefault();
        return;
    }

    // PEN INKING (Stylus / Mouse):
    if (!isDrawing || !currentStrokeObj) return;

    ctx.globalCompositeOperation = 'source-over';
    const penWidth = (e.pressure && e.pressure > 0 && e.pressure < 1)
        ? (1.8 + e.pressure * 1.4)
        : 2.2;
    ctx.lineWidth = penWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1a1a2e';

    currentStrokeObj.points.push({
        x: pt.x,
        y: pt.y,
        p: e.pressure || 0.5,
        t: Date.now()
    });

    const pts = currentStrokeObj.points;
    if (pts.length >= 3) {
        const p0 = pts[pts.length - 2];
        const p1 = pts[pts.length - 1];
        const midX = (p0.x + p1.x) / 2;
        const midY = (p0.y + p1.y) / 2;
        ctx.beginPath();
        ctx.moveTo(lastDrawX, lastDrawY);
        ctx.quadraticCurveTo(p0.x, p0.y, midX, midY);
        ctx.stroke();
        lastDrawX = midX;
        lastDrawY = midY;
    } else {
        ctx.beginPath();
        ctx.moveTo(lastDrawX, lastDrawY);
        ctx.lineTo(pt.x, pt.y);
        ctx.stroke();
        lastDrawX = pt.x;
        lastDrawY = pt.y;
    }
    e.preventDefault();
});

canvas.addEventListener('pointerup', (e) => {
    const pt = getCanvasPoint(e);

    // 1. ERASER FINISH:
    if (isErasing || activeTool === 'eraser') {
        eraseWordAt(pt.x, pt.y);
        isErasing = false;
        try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
        e.preventDefault();
        return;
    }

    // 2. HAND TOUCH FINISH (Recognized for reading words):
    if (e.pointerType === 'touch' || isHandTouch) {
        isHandTouch = false;
        try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}

        const moveDist = Math.hypot(pt.x - touchStartX, pt.y - touchStartY);
        if (moveDist < 25) {
            // Stationary hand tap -> read touched word!
            readWordAt(touchStartX, touchStartY);
        } else {
            // Hand drag across area -> read selected area!
            readSelectionStrokes(touchStartX, touchStartY, pt.x, pt.y);
        }
        e.preventDefault();
        return;
    }

    // 3. PEN INKING FINISH:
    if (isDrawing && currentStrokeObj && currentStrokeObj.points.length > 0) {
        isDrawing = false;
        try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
        currentStrokes.push(currentStrokeObj);
        lastKnownPoint = currentStrokeObj.points[currentStrokeObj.points.length - 1];
        saveExamData();
        currentStrokeObj = null;
        return;
    }
});

canvas.addEventListener('pointercancel', (e) => {
    isDrawing = false;
    isErasing = false;
    isHandTouch = false;
    currentStrokeObj = null;
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
});

// ---------------------------------------------------------------------
//  HANDWRITING RECOGNITION ENGINES
// ---------------------------------------------------------------------

// 1. Google Digital Ink API (High Precision Online Recognizer)
async function googleInkRecognize(strokes) {
    if (!strokes || strokes.length === 0) return null;

    const ink = [];
    let baseTime = null;

    for (const stroke of strokes) {
        if (stroke.isEraser) continue;
        const pts = stroke.points || [];
        if (pts.length === 0) continue;

        if (baseTime === null && pts[0].t) baseTime = pts[0].t;
        const xs = [];
        const ys = [];
        const ts = [];

        pts.forEach((p, idx) => {
            xs.push(Math.round(p.x));
            ys.push(Math.round(p.y));
            ts.push(p.t && baseTime ? Math.max(0, p.t - baseTime) : idx * 25);
        });

        if (xs.length > 0) ink.push([xs, ys, ts]);
    }

    if (ink.length === 0) return null;

    const requestBody = {
        app_version: 0.4,
        api_level: "533.0",
        device: "desktop",
        input_type: "0",
        options: "enable_pre_space",
        requests: [{
            writer_id: "stylus-notebook",
            ink: ink,
            language: "en"
        }]
    };

    try {
        const response = await fetch("https://inputtools.google.com/request?itc=en-t-i0-handwrit&app=translate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) return null;
        const data = await response.json();

        if (data && data[0] === "SUCCESS" && data[1] && data[1][0] && data[1][0][1]) {
            const candidates = data[1][0][1];
            if (candidates && candidates.length > 0) {
                return candidates[0]; // Best recognized match
            }
        }
    } catch (e) {
        console.warn("Google Ink API call failed:", e);
    }
    return null;
}

// 2. Offline Tesseract Cropped Recognizer (Fallback)
async function tesseractRecognize(strokes, bounds, isSingleWord) {
    if (!strokes || strokes.length === 0) return "";
    const pad = 35;
    const b = bounds || {
        minX: Math.min(...strokes.flatMap(s => (s.points || []).map(p => p.x))),
        maxX: Math.max(...strokes.flatMap(s => (s.points || []).map(p => p.x))),
        minY: Math.min(...strokes.flatMap(s => (s.points || []).map(p => p.y))),
        maxY: Math.max(...strokes.flatMap(s => (s.points || []).map(p => p.y)))
    };

    const cropW = Math.max(30, (b.maxX - b.minX) + pad * 2);
    const cropH = Math.max(30, (b.maxY - b.minY) + pad * 2);
    const scale = 2.5;

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = Math.round(cropW * scale);
    cropCanvas.height = Math.round(cropH * scale);
    const cctx = cropCanvas.getContext('2d');

    cctx.fillStyle = '#ffffff';
    cctx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);

    cctx.lineWidth = 5 * scale;
    cctx.lineCap = 'round';
    cctx.lineJoin = 'round';
    cctx.strokeStyle = '#000000';

    for (const stroke of strokes) {
        if (stroke.isEraser) continue;
        const pts = stroke.points || [];
        if (pts.length === 0) continue;

        cctx.beginPath();
        cctx.moveTo((pts[0].x - b.minX + pad) * scale, (pts[0].y - b.minY + pad) * scale);
        for (let i = 1; i < pts.length; i++) {
            cctx.lineTo((pts[i].x - b.minX + pad) * scale, (pts[i].y - b.minY + pad) * scale);
        }
        cctx.stroke();
    }

    try {
        const dataUrl = cropCanvas.toDataURL('image/png');
        const result = await Tesseract.recognize(dataUrl, 'eng', {
            tessedit_pageseg_mode: isSingleWord ? '8' : '7'
        });
        return result.data.text.trim();
    } catch (e) {
        console.error("Tesseract error:", e);
        return "";
    }
}

// Master Recognizer: Tries Google Ink first, then isolated Tesseract
async function recognizeStrokes(strokes, bounds, isSingleWord = false) {
    let text = await googleInkRecognize(strokes);
    if (!text || text.trim().length === 0) {
        text = await tesseractRecognize(strokes, bounds, isSingleWord);
    }
    if (!text) return "";
    text = text.trim();
    if (isSingleWord && text.length > 0) {
        // Strictly return only the single touched word
        text = text.split(/\s+/)[0];
    }
    return text;
}

// ---------------------------------------------------------------------
//  AUDIO READING FUNCTIONS
// ---------------------------------------------------------------------

// 1. Read ONLY the touched word (strictly isolated!)
async function readWordAt(touchX, touchY) {
    if (isOCRBusy) return;

    const wordInfo = getWordStrokesAt(touchX, touchY, 70);
    if (!wordInfo || wordInfo.strokes.length === 0) {
        showStatus("No word found at touch point", 1200);
        return;
    }

    isOCRBusy = true;
    showStatus("Recognizing word...", 0);

    try {
        // Send ONLY the strokes of this single isolated word!
        const recognized = await recognizeStrokes(wordInfo.strokes, wordInfo.bounds, true);

        if (recognized && recognized.length > 0) {
            showStatus(`"${recognized}"`, 0);
            speak(recognized);
        } else {
            showStatus("Could not recognize word", 1400);
        }
    } catch (err) {
        console.error("Read word error:", err);
        showStatus("Error reading word", 1200);
    } finally {
        isOCRBusy = false;
    }
}

// 2. Read Dragged Area Selection
async function readSelectionStrokes(x1, y1, x2, y2) {
    if (isOCRBusy) return;
    const minX = Math.min(x1, x2) - 15;
    const maxX = Math.max(x1, x2) + 15;
    const minY = Math.min(y1, y2) - 20;
    const maxY = Math.max(y1, y2) + 20;

    const visible = currentStrokes.filter(s => !s.isEraser && s.points && s.points.length > 0);
    const selected = visible.filter(s => {
        const b = getStrokeBounds(s);
        return b && b.centerX >= minX && b.centerX <= maxX && b.centerY >= minY && b.centerY <= maxY;
    });

    if (selected.length === 0) {
        showStatus("No text in selected area", 1200);
        return;
    }

    isOCRBusy = true;
    showStatus("Reading selection...", 0);

    try {
        const text = await recognizeStrokes(selected, null, false);
        if (text && text.length > 0) {
            showStatus(`"${text}"`, 0);
            speak(text);
        } else {
            showStatus("Could not recognize text", 1400);
        }
    } finally {
        isOCRBusy = false;
    }
}

// 3. Read Last Written Word (FAB 1 Tap)
async function readLastWord() {
    if (isOCRBusy) return;
    const visible = currentStrokes.filter(s => !s.isEraser && s.points && s.points.length > 0);
    if (visible.length === 0) {
        showStatus("Nothing written on page", 1200);
        return;
    }

    const lastStroke = visible[visible.length - 1];
    const b = getStrokeBounds(lastStroke);
    if (!b) return;

    readWordAt(b.centerX, b.centerY);
}

// 4. Read Current Text Line (FAB 2 Taps)
async function readCurrentLine() {
    if (isOCRBusy) return;
    const visible = currentStrokes.filter(s => !s.isEraser && s.points && s.points.length > 0);
    if (visible.length === 0) {
        showStatus("Nothing written on page", 1200);
        return;
    }

    let maxCenterY = -Infinity;
    visible.forEach(s => {
        const b = getStrokeBounds(s);
        if (b && b.centerY > maxCenterY) maxCenterY = b.centerY;
    });

    const lineStrokes = visible.filter(s => {
        const b = getStrokeBounds(s);
        return b && Math.abs(b.centerY - maxCenterY) <= 30;
    });

    lineStrokes.sort((a, b) => getStrokeBounds(a).minX - getStrokeBounds(b).minX);

    isOCRBusy = true;
    showStatus("Reading current line...", 0);

    try {
        const text = await recognizeStrokes(lineStrokes, null, false);
        if (text && text.length > 0) {
            showStatus(`"${text}"`, 0);
            speak(text);
        } else {
            showStatus("No text recognized", 1400);
        }
    } finally {
        isOCRBusy = false;
    }
}

// 5. Read Entire Answer (FAB Long Press or "Read Ans" button)
async function readAllStrokes() {
    if (isOCRBusy) return;
    const visible = currentStrokes.filter(s => !s.isEraser && s.points && s.points.length > 0);
    if (visible.length === 0) {
        showStatus("Nothing written on page", 1200);
        return;
    }

    isOCRBusy = true;
    showStatus("Reading full answer...", 0);

    // Group into natural lines sorted top to bottom, then left to right
    const lines = [];
    const sortedByY = [...visible].sort((a, b) => getStrokeBounds(a).centerY - getStrokeBounds(b).centerY);

    for (const stroke of sortedByY) {
        const b = getStrokeBounds(stroke);
        let addedToLine = false;
        for (const line of lines) {
            if (Math.abs(line.centerY - b.centerY) <= 30) {
                line.strokes.push(stroke);
                addedToLine = true;
                break;
            }
        }
        if (!addedToLine) {
            lines.push({ centerY: b.centerY, strokes: [stroke] });
        }
    }

    const orderedStrokes = [];
    for (const line of lines) {
        line.strokes.sort((a, b) => getStrokeBounds(a).minX - getStrokeBounds(b).minX);
        orderedStrokes.push(...line.strokes);
    }

    try {
        const text = await recognizeStrokes(orderedStrokes, null, false);
        if (text && text.length > 0) {
            showStatus(`"${text}"`, 0);
            speak(text);
        } else {
            showStatus("No text recognized", 1400);
        }
    } finally {
        isOCRBusy = false;
    }
}

// ---------- Text-To-Speech ----------
function speak(text) {
    if (!('speechSynthesis' in window)) {
        alert("Text-to-Speech is not supported in this browser.");
        return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.95;
    utterance.pitch = 1.0;

    utterance.onend = () => {
        statusOverlay.classList.add('hidden');
    };
    utterance.onerror = () => {
        statusOverlay.classList.add('hidden');
    };

    window.speechSynthesis.speak(utterance);
}

// ---------- Launch ----------
init();
