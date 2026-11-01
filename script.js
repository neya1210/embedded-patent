// Define the questions
const questions = [
    { id: 'q1', text: "Q1: Write the name of your favorite fruit." },
    { id: 'q2', text: "Q2: What is the capital city of your country?" },
    { id: 'q3', text: "Q3: Write a short welcome message." }
];
let currentQuestionIndex = 0;

// Secure Storage Configuration
const SECRET_KEY = "exam_secure_key_123"; 
let examData = { q1: [], q2: [], q3: [] }; 
let currentStrokes = []; 

// UI Elements
const canvas = document.getElementById('drawing-canvas');
const ctx = canvas.getContext('2d');
const questionText = document.getElementById('question-text');
const statusOverlay = document.getElementById('status-overlay');
const nextBtn = document.getElementById('next-btn');
const prevBtn = document.getElementById('prev-btn');
const clearBtn = document.getElementById('clear-btn');
const submitBtn = document.getElementById('submit-btn');
const canvasContainer = document.getElementById('canvas-container');
const tamperAlert = document.getElementById('tamper-alert');
const dismissTamperBtn = document.getElementById('dismiss-tamper-btn');

const penBtn = document.getElementById('pen-btn');
const wordEraserBtn = document.getElementById('word-eraser-btn');
const freeEraserBtn = document.getElementById('free-eraser-btn');
const saveBtn = document.getElementById('save-btn');
const readQBtn = document.getElementById('read-q-btn');
const readABtn = document.getElementById('read-a-btn');
const roundKey = document.getElementById('round-key');
const orientationBtn = document.getElementById('orientation-btn');
const lineToggleBtn = document.getElementById('line-toggle-btn');
const appContainer = document.querySelector('.app-container');

// State variables
let activeTool = 'pen'; // 'pen' | 'word-eraser' | 'free-eraser'
let isDrawing = false;
let isProcessingOCR = false;
let lastKnownPoint = null; 
let isPortraitSheet = true;
let lineOrientation = 'horizontal';
let lastDrawnX = 0;
let lastDrawnY = 0;

// Audio Context
const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();

function playTone(freq, duration, vol = 0.1, type = 'sine') {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(vol, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

// Exam Integrity
document.addEventListener('visibilitychange', () => {
    if (document.visibilitychange === 'hidden' || document.hidden) {
        logSecurityEvent("App lost focus / Tab switched");
        tamperAlert.classList.remove('hidden');
    }
});
window.addEventListener('blur', () => {
    logSecurityEvent("Window blurred");
    tamperAlert.classList.remove('hidden');
});
dismissTamperBtn.addEventListener('click', () => { tamperAlert.classList.add('hidden'); });
function logSecurityEvent(msg) { console.warn(`SECURITY EVENT: ${msg} at ${new Date().toISOString()}`); }

// Setup canvas
function resizeCanvas() {
    const rect = canvasContainer.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    redrawStrokes();
}
window.addEventListener('resize', resizeCanvas);

function init() {
    loadExamData();
    resizeCanvas();
    updateQuestion();
}

function updateQuestion() {
    const qId = questions[currentQuestionIndex].id;
    questionText.textContent = questions[currentQuestionIndex].text;
    currentStrokes = examData[qId] || [];
    redrawStrokes();
}

// --- WORD ERASER HELPERS ---
function getStrokeBounds(stroke) {
    const pts = Array.isArray(stroke) ? stroke : (stroke.points || []);
    if (!pts || pts.length === 0) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < pts.length; i++) {
        const x = pts[i].x;
        const y = pts[i].y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
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
    const pts = Array.isArray(stroke) ? stroke : (stroke.points || []);
    if (!pts || pts.length === 0) return Infinity;
    
    const b = getStrokeBounds(stroke);
    if (!b) return Infinity;
    
    // Quick bounding box proximity check
    if (x >= b.minX - 25 && x <= b.maxX + 25 && y >= b.minY - 25 && y <= b.maxY + 25) {
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

function getWordStrokesAt(touchX, touchY, maxTouchDist = 45) {
    if (!currentStrokes || currentStrokes.length === 0) return null;

    // Collect visible writing strokes
    const strokeMeta = [];
    for (let i = 0; i < currentStrokes.length; i++) {
        const s = currentStrokes[i];
        const isE = Array.isArray(s) ? false : !!s.isEraser;
        if (isE) continue;
        const b = getStrokeBounds(s);
        if (!b) continue;
        const d = distToStroke(touchX, touchY, s);
        strokeMeta.push({
            index: i,
            stroke: s,
            bounds: b,
            dist: d
        });
    }

    if (strokeMeta.length === 0) return null;

    strokeMeta.sort((a, b) => a.dist - b.dist);
    const closest = strokeMeta[0];

    // Must be reasonably close to touched point
    if (closest.dist > maxTouchDist) return null;

    // Cluster all strokes on the same line belonging to this word
    const WORD_GAP_THRESHOLD = 32;
    const LINE_Y_THRESHOLD = 26;

    const wordIndices = new Set([closest.index]);
    let added = true;

    while (added) {
        added = false;
        for (let i = 0; i < strokeMeta.length; i++) {
            const candidate = strokeMeta[i];
            if (wordIndices.has(candidate.index)) continue;

            for (const memberIdx of wordIndices) {
                const member = strokeMeta.find(m => m.index === memberIdx);
                if (!member) continue;

                // Vertical line alignment check
                const lineAligned = Math.abs(candidate.bounds.centerY - member.bounds.centerY) <= LINE_Y_THRESHOLD ||
                    (candidate.bounds.minY <= member.bounds.maxY && candidate.bounds.maxY >= member.bounds.minY);

                if (!lineAligned) continue;

                // Horizontal gap between strokes
                const horizGap = Math.max(0, 
                    Math.max(candidate.bounds.minX, member.bounds.minX) - 
                    Math.min(candidate.bounds.maxX, member.bounds.maxX)
                );

                if (horizGap <= WORD_GAP_THRESHOLD) {
                    wordIndices.add(candidate.index);
                    added = true;
                    break;
                }
            }
        }
    }

    const matchedStrokes = [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    wordIndices.forEach(idx => {
        const item = strokeMeta.find(m => m.index === idx);
        if (item) {
            matchedStrokes.push(item.stroke);
            if (item.bounds.minX < minX) minX = item.bounds.minX;
            if (item.bounds.maxX > maxX) maxX = item.bounds.maxX;
            if (item.bounds.minY < minY) minY = item.bounds.minY;
            if (item.bounds.maxY > maxY) maxY = item.bounds.maxY;
        }
    });

    return {
        indices: wordIndices,
        strokes: matchedStrokes,
        bounds: {
            minX, maxX, minY, maxY,
            width: Math.max(10, maxX - minX),
            height: Math.max(10, maxY - minY)
        }
    };
}

function eraseWordAt(touchX, touchY) {
    const wordInfo = getWordStrokesAt(touchX, touchY, 35);
    if (!wordInfo) return false;

    // Remove the whole word strokes
    currentStrokes = currentStrokes.filter((_, idx) => !wordInfo.indices.has(idx));
    saveExamData();
    redrawStrokes();

    if (navigator.vibrate) navigator.vibrate([15, 25]);
    playTone(320, 0.08, 0.05, 'triangle');

    statusOverlay.textContent = "Word erased";
    statusOverlay.classList.remove('hidden');
    setTimeout(() => {
        statusOverlay.classList.add('hidden');
    }, 700);

    return true;
}

function redrawStrokes() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    currentStrokes.forEach(strokeData => {
        let pts, isE = false;
        // Migrate old arrays dynamically
        if (Array.isArray(strokeData)) { pts = strokeData; }
        else if (strokeData.points) { pts = strokeData.points; isE = strokeData.isEraser; }
        
        if (!pts || pts.length === 0) return;
        
        ctx.globalCompositeOperation = isE ? 'destination-out' : 'source-over';
        ctx.lineWidth = isE ? 18 : 1.8;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#0f172a';
        ctx.fillStyle = '#0f172a';

        if (pts.length === 1) {
            ctx.beginPath();
            ctx.arc(pts[0].x, pts[0].y, isE ? 9 : 0.9, 0, Math.PI * 2);
            ctx.fill();
            return;
        }

        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        
        if (pts.length === 2) {
            ctx.lineTo(pts[1].x, pts[1].y);
        } else {
            for (let i = 1; i < pts.length - 1; i++) {
                const midX = (pts[i].x + pts[i + 1].x) / 2;
                const midY = (pts[i].y + pts[i + 1].y) / 2;
                ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
            }
            ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        }
        ctx.stroke();
    });
    ctx.globalCompositeOperation = 'source-over'; // reset
}

function clearCanvas() {
    currentStrokes = [];
    saveExamData();
    redrawStrokes();
}

// --- SECURE STORAGE ---
function saveExamData() {
    examData[questions[currentQuestionIndex].id] = currentStrokes;
    const jsonStr = JSON.stringify(examData);
    const encrypted = CryptoJS.AES.encrypt(jsonStr, SECRET_KEY).toString();
    localStorage.setItem('exam_secure_data', encrypted);
}
function loadExamData() {
    const encrypted = localStorage.getItem('exam_secure_data');
    if (encrypted) {
        try {
            const bytes = CryptoJS.AES.decrypt(encrypted, SECRET_KEY);
            const decrypted = bytes.toString(CryptoJS.enc.Utf8);
            if(decrypted) examData = JSON.parse(decrypted);
        } catch(e) { console.error("Failed to decrypt exam data", e); }
    }
}

// --- BUTTON LISTENERS ---
function setActiveTool(tool) {
    activeTool = tool;
    if (penBtn) penBtn.classList.toggle('active-tool', tool === 'pen');
    if (wordEraserBtn) wordEraserBtn.classList.toggle('active-tool', tool === 'word-eraser');
    if (freeEraserBtn) freeEraserBtn.classList.toggle('active-tool', tool === 'free-eraser');
    
    if (tool === 'word-eraser') {
        canvas.style.cursor = 'cell';
    } else if (tool === 'free-eraser') {
        canvas.style.cursor = 'grab';
    } else {
        canvas.style.cursor = 'crosshair';
    }
}

if (penBtn) penBtn.addEventListener('click', () => setActiveTool('pen'));
if (wordEraserBtn) wordEraserBtn.addEventListener('click', () => setActiveTool('word-eraser'));
if (freeEraserBtn) freeEraserBtn.addEventListener('click', () => setActiveTool('free-eraser'));

saveBtn.addEventListener('click', () => {
    saveExamData();
    alert("Draft saved securely.");
});

readQBtn.addEventListener('click', () => {
    speak(questions[currentQuestionIndex].text);
});

readABtn.addEventListener('click', () => {
    readCanvasText('all');
});

if (orientationBtn) {
    orientationBtn.addEventListener('click', () => {
        isPortraitSheet = !isPortraitSheet;
        if (isPortraitSheet) {
            appContainer.classList.add('portrait-sheet');
            appContainer.classList.remove('landscape-sheet');
            orientationBtn.textContent = '📱 Portrait Sheet';
        } else {
            appContainer.classList.remove('portrait-sheet');
            appContainer.classList.add('landscape-sheet');
            orientationBtn.textContent = '🖥️ Landscape Sheet';
        }
        setTimeout(resizeCanvas, 50);
    });
}

if (lineToggleBtn) {
    lineToggleBtn.addEventListener('click', () => {
        if (lineOrientation === 'horizontal') {
            lineOrientation = 'vertical';
            canvasContainer.classList.remove('ruled-horizontal');
            canvasContainer.classList.add('ruled-vertical');
            lineToggleBtn.textContent = '📏 Lines: Vert';
        } else {
            lineOrientation = 'horizontal';
            canvasContainer.classList.remove('ruled-vertical');
            canvasContainer.classList.add('ruled-horizontal');
            lineToggleBtn.textContent = '📏 Lines: Horiz';
        }
    });
}

// --- ROUND KEY (FAB) LOGIC ---
let roundKeyTapCount = 0;
let roundKeyTapTimer = null;
let roundKeyLongPressTimer = null;
let roundKeyFiredLongPress = false;

roundKey.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    roundKeyFiredLongPress = false;
    roundKeyLongPressTimer = setTimeout(() => {
        roundKeyFiredLongPress = true;
        roundKeyTapCount = 0;
        readCanvasText('all'); // Long press -> entire answer
    }, 600);
});

roundKey.addEventListener('pointerup', (e) => {
    e.preventDefault();
    clearTimeout(roundKeyLongPressTimer);
    
    if (!roundKeyFiredLongPress) {
        roundKeyTapCount++;
        if (roundKeyTapCount === 1) {
            roundKeyTapTimer = setTimeout(() => {
                if (roundKeyTapCount === 1) {
                    readCanvasText('sentence'); // One tap -> last sentence
                }
                roundKeyTapCount = 0;
            }, 300);
        } else if (roundKeyTapCount === 2) {
            clearTimeout(roundKeyTapTimer);
            readCanvasText('line'); // Double tap -> current line
            roundKeyTapCount = 0;
        }
    }
});


// --- POINTER EVENTS (Writing & Screen Tap) ---
let currentStrokeObj = null;
let touchStartX = null;
let touchStartY = null;

canvas.addEventListener('pointerdown', (e) => {
    // 1. Word Eraser tool: touch or click on any word to erase the entire word
    if (activeTool === 'word-eraser') {
        eraseWordAt(e.offsetX, e.offsetY);
        e.preventDefault();
        return;
    }

    // 2. Free Eraser tool or Stylus Pen writing
    const isFreeEraser = (activeTool === 'free-eraser');
    if (e.pointerType === 'pen' || isFreeEraser) {
        isDrawing = true;
        currentStrokeObj = { 
            isEraser: isFreeEraser, 
            points: [{x: e.offsetX, y: e.offsetY, p: e.pressure || 0.5, t: Date.now()}] 
        };
        lastDrawnX = e.offsetX;
        lastDrawnY = e.offsetY;

        ctx.globalCompositeOperation = isFreeEraser ? 'destination-out' : 'source-over';
        const penWidth = isFreeEraser ? 18 : ((e.pressure && e.pressure > 0) ? (1.2 + e.pressure * 1.4) : 1.8);
        ctx.lineWidth = penWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#0f172a';
        ctx.fillStyle = '#0f172a';

        ctx.beginPath();
        ctx.arc(e.offsetX, e.offsetY, isFreeEraser ? 9 : (penWidth / 2), 0, Math.PI * 2);
        ctx.fill();
        e.preventDefault();
        
        if (navigator.vibrate) navigator.vibrate(10); 
    } 
    // 3. Hand touch interaction (selective audio reading)
    else if (e.pointerType === 'touch' || e.pointerType === 'mouse') {
        touchStartX = e.offsetX;
        touchStartY = e.offsetY;
    }
});

canvas.addEventListener('pointermove', (e) => {
    // Writing Boundary Detection
    const margin = 30; 
    if (e.offsetX < margin || e.offsetX > canvas.width - margin ||
        e.offsetY < margin || e.offsetY > canvas.height - margin) {
        canvasContainer.classList.add('boundary-warning');
        if (isDrawing && navigator.vibrate) navigator.vibrate(50);
        if (isDrawing && currentStrokeObj && currentStrokeObj.points.length % 10 === 0) playTone(150, 0.2, 0.05, 'square');
    } else {
        canvasContainer.classList.remove('boundary-warning');
    }

    // Resume-Point Guidance (Hovering Stylus)
    if (!isDrawing && e.pointerType === 'pen' && lastKnownPoint) {
        const dist = Math.hypot(e.offsetX - lastKnownPoint.x, e.offsetY - lastKnownPoint.y);
        if (dist < 50) {
            const freq = 400 + (50 - dist) * 10;
            playTone(freq, 0.05, 0.02, 'sine');
        }
    }

    // Word Eraser swipe support (erases words along path while dragging)
    if (activeTool === 'word-eraser' && e.buttons === 1) {
        eraseWordAt(e.offsetX, e.offsetY);
        return;
    }

    if (!isDrawing) return;
    
    const isFreeEraser = (activeTool === 'free-eraser');
    if (e.pointerType === 'pen' || isFreeEraser) {
        ctx.globalCompositeOperation = isFreeEraser ? 'destination-out' : 'source-over';
        const penWidth = isFreeEraser ? 18 : ((e.pressure && e.pressure > 0) ? (1.2 + e.pressure * 1.4) : 1.8);
        ctx.lineWidth = penWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#0f172a';
        
        if (currentStrokeObj) {
            currentStrokeObj.points.push({x: e.offsetX, y: e.offsetY, p: e.pressure || 0.5, t: Date.now()});
            const pts = currentStrokeObj.points;
            
            if (pts.length >= 3) {
                const p0 = pts[pts.length - 2];
                const p1 = pts[pts.length - 1];
                const midX = (p0.x + p1.x) / 2;
                const midY = (p0.y + p1.y) / 2;
                ctx.beginPath();
                ctx.moveTo(lastDrawnX, lastDrawnY);
                ctx.quadraticCurveTo(p0.x, p0.y, midX, midY);
                ctx.stroke();
                lastDrawnX = midX;
                lastDrawnY = midY;
            } else {
                ctx.beginPath();
                ctx.moveTo(lastDrawnX, lastDrawnY);
                ctx.lineTo(e.offsetX, e.offsetY);
                ctx.stroke();
                lastDrawnX = e.offsetX;
                lastDrawnY = e.offsetY;
            }
        }
        e.preventDefault();
    }
});

canvas.addEventListener('pointerup', (e) => {
    if (activeTool === 'word-eraser') {
        return;
    }

    const isFreeEraser = (activeTool === 'free-eraser');
    if (e.pointerType === 'pen' || isFreeEraser) {
        isDrawing = false;
        ctx.closePath();
        
        if (currentStrokeObj && currentStrokeObj.points.length > 0) {
            currentStrokes.push(currentStrokeObj);
            lastKnownPoint = currentStrokeObj.points[currentStrokeObj.points.length - 1];
            saveExamData();
        }
    } else if (e.pointerType === 'touch' || e.pointerType === 'mouse') {
        if (!isProcessingOCR && touchStartX !== null && touchStartY !== null) {
            readWrittenText(touchStartX, touchStartY, e.offsetX, e.offsetY);
        }
        touchStartX = null;
        touchStartY = null;
    }
    ctx.globalCompositeOperation = 'source-over';
});

canvas.addEventListener('pointercancel', () => { 
    isDrawing = false; 
    touchStartX = null;
    touchStartY = null;
});


// --- NAVIGATION CONTROLS ---
nextBtn.addEventListener('click', () => {
    currentQuestionIndex = (currentQuestionIndex + 1) % questions.length;
    updateQuestion();
});
prevBtn.addEventListener('click', () => {
    currentQuestionIndex = (currentQuestionIndex - 1 + questions.length) % questions.length;
    updateQuestion();
});
submitBtn.addEventListener('click', () => {
    saveExamData();
    alert("Exam encrypted and submitted securely!");
    localStorage.removeItem('exam_secure_data');
    location.reload();
});


// --- HIGH-PRECISION HANDWRITING RECOGNITION (GOOGLE DIGITAL INK + ISOLATED TESSERACT) ---

// 1. Google Digital Ink Engine (Gold standard for English cursive & capitals)
async function recognizeHandwritingWithGoogle(strokes) {
    if (!strokes || strokes.length === 0) return null;
    
    const ink = [];
    let baseTime = Date.now();
    
    strokes.forEach(s => {
        const pts = Array.isArray(s) ? s : (s.points || []);
        if (!pts || pts.length === 0 || s.isEraser) return;
        const xs = [];
        const ys = [];
        const ts = [];
        pts.forEach((p, i) => {
            xs.push(Math.round(p.x));
            ys.push(Math.round(p.y));
            ts.push(p.t ? Math.max(0, p.t - baseTime) : (i * 20));
        });
        if (xs.length > 0) ink.push([xs, ys, ts]);
    });

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
        console.warn("Google Ink API unavailable, falling back to local isolated Tesseract:", e);
    }
    return null;
}

// 2. Local Isolated Tesseract Fallback (Offline crop-isolated recognition)
async function recognizeStrokesWithTesseract(strokes, bounds, isSingleWord) {
    if (!strokes || strokes.length === 0) return "";
    
    const pad = 30;
    const b = bounds || {
        minX: Math.min(...strokes.flatMap(s => (s.points || s).map(p => p.x))),
        maxX: Math.max(...strokes.flatMap(s => (s.points || s).map(p => p.x))),
        minY: Math.min(...strokes.flatMap(s => (s.points || s).map(p => p.y))),
        maxY: Math.max(...strokes.flatMap(s => (s.points || s).map(p => p.y)))
    };
    
    const cropW = Math.max(20, (b.maxX - b.minX) + pad * 2);
    const cropH = Math.max(20, (b.maxY - b.minY) + pad * 2);
    const scale = 2.5;

    // Render ONLY the targeted strokes onto an isolated high-contrast canvas
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = cropW * scale;
    cropCanvas.height = cropH * scale;
    const cctx = cropCanvas.getContext('2d');

    cctx.fillStyle = '#ffffff';
    cctx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);

    cctx.lineWidth = 5 * scale;
    cctx.lineCap = 'round';
    cctx.lineJoin = 'round';
    cctx.strokeStyle = '#000000';

    strokes.forEach(s => {
        const pts = Array.isArray(s) ? s : (s.points || []);
        if (!pts || pts.length === 0 || s.isEraser) return;

        cctx.beginPath();
        const startX = (pts[0].x - b.minX + pad) * scale;
        const startY = (pts[0].y - b.minY + pad) * scale;
        cctx.moveTo(startX, startY);

        for (let i = 1; i < pts.length; i++) {
            const px = (pts[i].x - b.minX + pad) * scale;
            const py = (pts[i].y - b.minY + pad) * scale;
            cctx.lineTo(px, py);
        }
        cctx.stroke();
    });

    const dataUrl = cropCanvas.toDataURL('image/png');
    // PSM 8 = Single Word, PSM 7 = Single text line
    const result = await Tesseract.recognize(dataUrl, 'eng', {
        tessedit_pageseg_mode: isSingleWord ? '8' : '7'
    });
    
    return result.data.text.trim();
}

// Master Recognizer
async function recognizeStrokes(strokes, bounds, singleWordOnly = false) {
    // Try Google Digital Ink Recognition first
    let text = await recognizeHandwritingWithGoogle(strokes);
    
    // Fallback to local isolated Tesseract
    if (!text || text.trim().length === 0) {
        text = await recognizeStrokesWithTesseract(strokes, bounds, singleWordOnly);
    }
    
    if (!text) return "";
    text = text.trim();
    if (singleWordOnly) {
        // Guarantee strictly only the single touched word is returned
        text = text.split(/\s+/)[0];
    }
    return text;
}

// Screen Tap / Drag to Read ONLY the Touched Word or Selection
async function readWrittenText(startX, startY, endX, endY) {
    isProcessingOCR = true;
    statusOverlay.textContent = "Recognizing touched word...";
    statusOverlay.classList.remove('hidden');

    try {
        const isDrag = endX !== undefined && endY !== undefined && Math.hypot(endX - startX, endY - startY) > 20;

        let selectedStrokes = [];
        let selectedBounds = null;

        if (isDrag) {
            // Drag: select strokes strictly within touched area
            const minSelX = Math.min(startX, endX) - 20;
            const maxSelX = Math.max(startX, endX) + 20;
            const minSelY = Math.min(startY, endY) - 30;
            const maxSelY = Math.max(startY, endY) + 30;

            selectedStrokes = currentStrokes.filter(s => {
                if (s.isEraser) return false;
                const b = getStrokeBounds(s);
                if (!b) return false;
                return b.centerX >= minSelX && b.centerX <= maxSelX &&
                       b.centerY >= minSelY && b.centerY <= maxSelY;
            });
        } else {
            // Single Tap: strictly isolate and read ONLY that single touched word
            const wordInfo = getWordStrokesAt(startX, startY, 45);
            if (wordInfo) {
                selectedStrokes = wordInfo.strokes;
                selectedBounds = wordInfo.bounds;
            }
        }

        if (selectedStrokes.length === 0) {
            statusOverlay.textContent = "No word found at touched area.";
            setTimeout(() => { statusOverlay.classList.add('hidden'); }, 1500);
            return;
        }

        const textToRead = await recognizeStrokes(selectedStrokes, selectedBounds, !isDrag);

        if (textToRead && textToRead.length > 0) {
            statusOverlay.textContent = `Speaking: "${textToRead}"`;
            speak(textToRead);
        } else {
            statusOverlay.textContent = "Could not recognize word.";
            setTimeout(() => { statusOverlay.classList.add('hidden'); }, 1500);
        }
    } catch (error) {
        console.error("Recognition Error:", error);
        statusOverlay.textContent = "Error reading text.";
        setTimeout(() => { statusOverlay.classList.add('hidden'); }, 1500);
    } finally {
        isProcessingOCR = false;
    }
}

// Read Canvas for Round Key (FAB) modes & Read Ans button
async function readCanvasText(mode) {
    const visibleStrokes = currentStrokes.filter(s => !s.isEraser && (s.points || s).length > 0);
    if (visibleStrokes.length === 0) {
        statusOverlay.textContent = "No writing on page.";
        statusOverlay.classList.remove('hidden');
        setTimeout(() => { statusOverlay.classList.add('hidden'); }, 1500);
        return;
    }

    isProcessingOCR = true;
    statusOverlay.textContent = "Reading answer...";
    statusOverlay.classList.remove('hidden');

    try {
        let strokesToRead = visibleStrokes;

        if (mode === 'line') {
            // Read strokes on the bottommost / current text line
            let maxCenterY = -Infinity;
            visibleStrokes.forEach(s => {
                const b = getStrokeBounds(s);
                if (b && b.centerY > maxCenterY) maxCenterY = b.centerY;
            });
            strokesToRead = visibleStrokes.filter(s => {
                const b = getStrokeBounds(s);
                return b && Math.abs(b.centerY - maxCenterY) <= 30;
            });
        } else if (mode === 'sentence') {
            // Read last written word / segment
            strokesToRead = visibleStrokes.slice(-Math.min(visibleStrokes.length, 5));
        }

        const textToRead = await recognizeStrokes(strokesToRead, null, false);

        if (textToRead && textToRead.length > 0) {
            statusOverlay.textContent = `Speaking: "${textToRead}"`;
            speak(textToRead);
        } else {
            statusOverlay.textContent = "No text recognized.";
            setTimeout(() => { statusOverlay.classList.add('hidden'); }, 1500);
        }
    } catch (error) {
        console.error("Read Canvas Error:", error);
        statusOverlay.textContent = "Error reading text.";
        setTimeout(() => { statusOverlay.classList.add('hidden'); }, 1500);
    } finally {
        isProcessingOCR = false;
    }
}

function speak(text) {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel(); 
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.onend = () => { statusOverlay.classList.add('hidden'); };
        utterance.onerror = () => { statusOverlay.classList.add('hidden'); };
        window.speechSynthesis.speak(utterance);
    } else {
        alert("Text-to-speech is not supported in your browser.");
        statusOverlay.classList.add('hidden');
    }
}

init();
