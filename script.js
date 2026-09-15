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

// New UI Elements
const eraserBtn = document.getElementById('eraser-btn');
const saveBtn = document.getElementById('save-btn');
const readQBtn = document.getElementById('read-q-btn');
const readABtn = document.getElementById('read-a-btn');
const roundKey = document.getElementById('round-key');

// State variables
let isDrawing = false;
let isProcessingOCR = false;
let lastKnownPoint = null; 
let isEraserMode = false;

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

function redrawStrokes() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    currentStrokes.forEach(strokeData => {
        let pts, isE = false;
        // Migrate old arrays dynamically
        if (Array.isArray(strokeData)) { pts = strokeData; }
        else if (strokeData.points) { pts = strokeData.points; isE = strokeData.isEraser; }
        
        if (!pts || pts.length === 0) return;
        
        ctx.globalCompositeOperation = isE ? 'destination-out' : 'source-over';
        ctx.lineWidth = isE ? 20 : 4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#000000';

        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for(let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i].x, pts[i].y);
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
eraserBtn.addEventListener('click', () => {
    isEraserMode = !isEraserMode;
    eraserBtn.textContent = isEraserMode ? '🧹 Eraser: ON' : '✏️ Eraser: OFF';
    eraserBtn.style.backgroundColor = isEraserMode ? '#f39c12' : '';
});

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

canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'pen') {
        isDrawing = true;
        currentStrokeObj = { isEraser: isEraserMode, points: [{x: e.offsetX, y: e.offsetY}] };
        ctx.beginPath();
        ctx.moveTo(e.offsetX, e.offsetY);
        e.preventDefault();
        
        if(navigator.vibrate) navigator.vibrate(10); 
    } 
    else if (e.pointerType === 'touch' || e.pointerType === 'mouse') {
        if (!isProcessingOCR) {
            readWrittenText(e.offsetX, e.offsetY);
        }
    }
});

canvas.addEventListener('pointermove', (e) => {
    const margin = 30; 
    if (e.offsetX < margin || e.offsetX > canvas.width - margin ||
        e.offsetY < margin || e.offsetY > canvas.height - margin) {
        canvasContainer.classList.add('boundary-warning');
        if (isDrawing && navigator.vibrate) navigator.vibrate(50);
        if (isDrawing && currentStrokeObj.points.length % 10 === 0) playTone(150, 0.2, 0.05, 'square');
    } else {
        canvasContainer.classList.remove('boundary-warning');
    }

    if (!isDrawing && e.pointerType === 'pen' && lastKnownPoint) {
        const dist = Math.hypot(e.offsetX - lastKnownPoint.x, e.offsetY - lastKnownPoint.y);
        if (dist < 50) {
            const freq = 400 + (50 - dist) * 10;
            playTone(freq, 0.05, 0.02, 'sine');
        }
    }

    if (!isDrawing) return;
    
    if (e.pointerType === 'pen') {
        ctx.globalCompositeOperation = isEraserMode ? 'destination-out' : 'source-over';
        ctx.lineWidth = isEraserMode ? 20 : 4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#000000';
        
        ctx.lineTo(e.offsetX, e.offsetY);
        ctx.stroke();
        
        currentStrokeObj.points.push({x: e.offsetX, y: e.offsetY});
        e.preventDefault();
    }
});

canvas.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'pen') {
        isDrawing = false;
        ctx.closePath();
        
        if (currentStrokeObj && currentStrokeObj.points.length > 0) {
            currentStrokes.push(currentStrokeObj);
            lastKnownPoint = currentStrokeObj.points[currentStrokeObj.points.length - 1];
            saveExamData();
        }
    }
    ctx.globalCompositeOperation = 'source-over';
});

canvas.addEventListener('pointercancel', () => { isDrawing = false; });


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


// --- OCR (Handwriting to Text) AND TTS (Text to Speech) ---

// Screen Tap to Read from Word
async function readWrittenText(touchX, touchY) {
    isProcessingOCR = true;
    statusOverlay.textContent = "Reconstructing text...";
    statusOverlay.classList.remove('hidden');
    
    try {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.fillStyle = 'white';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        tempCtx.drawImage(canvas, 0, 0);

        const dataUrl = tempCanvas.toDataURL('image/png');
        const result = await Tesseract.recognize(dataUrl, 'eng');
        const words = result.data.words;
        
        let textToRead = "";

        if (words && words.length > 0) {
            let startIndex = 0;
            if (touchX !== undefined && touchY !== undefined) {
                let minDistance = Infinity;
                words.forEach((word, index) => {
                    const rect = word.bbox; 
                    if (touchX >= rect.x0 && touchX <= rect.x1 && touchY >= rect.y0 && touchY <= rect.y1) {
                        startIndex = index;
                        minDistance = -1; 
                    } else if (minDistance !== -1) {
                        const centerX = rect.x0 + (rect.x1 - rect.x0) / 2;
                        const centerY = rect.y0 + (rect.y1 - rect.y0) / 2;
                        const dist = Math.hypot(centerX - touchX, centerY - touchY);
                        if (dist < minDistance) { minDistance = dist; startIndex = index; }
                    }
                });
                
                if (minDistance > 150 && minDistance !== -1) {
                    textToRead = "";
                } else {
                    textToRead = words.slice(startIndex).map(w => w.text).join(' ').trim();
                }
            } else {
                textToRead = result.data.text.trim();
            }
        }
        
        if (textToRead.length > 0) {
            statusOverlay.textContent = "Speaking...";
            speak(textToRead);
        } else {
            statusOverlay.textContent = "No writing detected nearby.";
            setTimeout(() => { statusOverlay.classList.add('hidden'); }, 2000);
        }
    } catch (error) {
        console.error("OCR Error:", error);
        statusOverlay.textContent = "Error reading text.";
        setTimeout(() => { statusOverlay.classList.add('hidden'); }, 2000);
    } finally {
        isProcessingOCR = false;
    }
}

// Read whole canvas for Round Key modes
async function readCanvasText(mode) {
    isProcessingOCR = true;
    statusOverlay.textContent = "Analyzing canvas...";
    statusOverlay.classList.remove('hidden');
    
    try {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.fillStyle = 'white';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        tempCtx.drawImage(canvas, 0, 0);

        const dataUrl = tempCanvas.toDataURL('image/png');
        const result = await Tesseract.recognize(dataUrl, 'eng');
        
        let textToRead = "";
        const fullText = result.data.text.trim();

        if (mode === 'all') {
            textToRead = fullText;
        } else if (mode === 'line') {
            if (result.data.lines && result.data.lines.length > 0) {
                textToRead = result.data.lines[result.data.lines.length - 1].text.trim();
            }
        } else if (mode === 'sentence') {
            const sentences = fullText.split(/(?<=[.!?])\s+/);
            if (sentences.length > 0) {
                textToRead = sentences[sentences.length - 1].trim();
                if (!textToRead && result.data.lines) {
                    textToRead = result.data.lines[result.data.lines.length - 1].text.trim();
                }
            }
        }
        
        if (textToRead.length > 0) {
            statusOverlay.textContent = "Speaking...";
            speak(textToRead);
        } else {
            statusOverlay.textContent = "No writing detected.";
            setTimeout(() => { statusOverlay.classList.add('hidden'); }, 2000);
        }
    } catch (error) {
        console.error("OCR Error:", error);
        statusOverlay.textContent = "Error reading text.";
        setTimeout(() => { statusOverlay.classList.add('hidden'); }, 2000);
    } finally {
        isProcessingOCR = false;
    }
}

function speak(text) {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel(); 
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.onend = () => { statusOverlay.classList.add('hidden'); };
        utterance.onerror = () => { statusOverlay.classList.add('hidden'); };
        window.speechSynthesis.speak(utterance);
    } else {
        alert("Text-to-speech is not supported in your browser.");
        statusOverlay.classList.add('hidden');
    }
}

init();
