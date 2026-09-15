// Define the questions
const questions = [
    { id: 'q1', text: "Q1: Write the name of your favorite fruit." },
    { id: 'q2', text: "Q2: What is the capital city of your country?" },
    { id: 'q3', text: "Q3: Write a short welcome message." }
];
let currentQuestionIndex = 0;

// Secure Storage Configuration
const SECRET_KEY = "exam_secure_key_123"; 
let examData = { q1: [], q2: [], q3: [] }; // Stores strokes for each question
let currentStrokes = []; // Strokes for current active question

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

// State variables
let isDrawing = false;
let isProcessingOCR = false;
let lastKnownPoint = null; 

// Audio Context for feedback
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

// Security: Exam Integrity (Tamper Detection)
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
dismissTamperBtn.addEventListener('click', () => {
    tamperAlert.classList.add('hidden');
});

function logSecurityEvent(msg) {
    console.warn(`SECURITY EVENT: ${msg} at ${new Date().toISOString()}`);
    // In a real app, this is securely logged to the encrypted datastore
}

// Setup canvas size
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
    // Save current strokes before switching
    const qId = questions[currentQuestionIndex].id;
    questionText.textContent = questions[currentQuestionIndex].text;
    
    // Load strokes for new question
    currentStrokes = examData[qId] || [];
    redrawStrokes();
}

function redrawStrokes() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#000000';

    currentStrokes.forEach(stroke => {
        if (stroke.length === 0) return;
        ctx.beginPath();
        ctx.moveTo(stroke[0].x, stroke[0].y);
        for(let i = 1; i < stroke.length; i++) {
            ctx.lineTo(stroke[i].x, stroke[i].y);
        }
        ctx.stroke();
    });
}

function clearCanvas() {
    currentStrokes = [];
    examData[questions[currentQuestionIndex].id] = currentStrokes;
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
            if(decrypted) {
                examData = JSON.parse(decrypted);
            }
        } catch(e) {
            console.error("Failed to decrypt exam data", e);
        }
    }
}

// --- POINTER EVENTS (Writing, Boundaries, Resume Point) ---
let currentStroke = [];

canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'pen') {
        isDrawing = true;
        currentStroke = [{x: e.offsetX, y: e.offsetY, p: e.pressure, t: Date.now()}];
        ctx.beginPath();
        ctx.moveTo(e.offsetX, e.offsetY);
        e.preventDefault();
        
        // Confirmation cue for writing start
        if(navigator.vibrate) navigator.vibrate(10); 
    } 
    else if (e.pointerType === 'touch' || e.pointerType === 'mouse') {
        if (!isProcessingOCR) {
            readWrittenText();
        }
    }
});

canvas.addEventListener('pointermove', (e) => {
    // Feature: Boundary Detection
    const margin = 30; // pixels
    if (e.offsetX < margin || e.offsetX > canvas.width - margin ||
        e.offsetY < margin || e.offsetY > canvas.height - margin) {
        
        canvasContainer.classList.add('boundary-warning');
        if (isDrawing && navigator.vibrate) navigator.vibrate(50);
        // Play warning buzz once per stroke boundary breach
        if (isDrawing && currentStroke.length % 10 === 0) playTone(150, 0.2, 0.05, 'square');
    } else {
        canvasContainer.classList.remove('boundary-warning');
    }

    if (!isDrawing && e.pointerType === 'pen' && lastKnownPoint) {
        // Feature: Resume-Point Guidance (Hovering Pen)
        const dist = Math.hypot(e.offsetX - lastKnownPoint.x, e.offsetY - lastKnownPoint.y);
        if (dist < 50) {
            // Proximity audio feedback
            const freq = 400 + (50 - dist) * 10;
            playTone(freq, 0.05, 0.02, 'sine');
        }
    }

    if (!isDrawing) return;
    
    if (e.pointerType === 'pen') {
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#000000';
        
        ctx.lineTo(e.offsetX, e.offsetY);
        ctx.stroke();
        
        currentStroke.push({x: e.offsetX, y: e.offsetY, p: e.pressure, t: Date.now()});
        e.preventDefault();
    }
});

canvas.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'pen') {
        isDrawing = false;
        ctx.closePath();
        
        if (currentStroke.length > 0) {
            currentStrokes.push(currentStroke);
            lastKnownPoint = currentStroke[currentStroke.length - 1];
            saveExamData();
        }
    }
});

canvas.addEventListener('pointercancel', () => {
    isDrawing = false;
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
clearBtn.addEventListener('click', clearCanvas);
submitBtn.addEventListener('click', () => {
    saveExamData();
    alert("Exam encrypted and submitted securely!");
    localStorage.removeItem('exam_secure_data'); // Mock clear after sync
    location.reload();
});


// --- OCR (Handwriting to Text) AND TTS (Text to Speech) ---
async function readWrittenText() {
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
        const text = result.data.text.trim();
        
        if (text.length > 0) {
            statusOverlay.textContent = "Speaking...";
            speak(text);
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
