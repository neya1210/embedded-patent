// Define the questions
const questions = [
    "Q1: Write the name of your favorite fruit.",
    "Q2: What is the capital city of your country?",
    "Q3: Write a short welcome message."
];
let currentQuestionIndex = 0;

// UI Elements
const canvas = document.getElementById('drawing-canvas');
const ctx = canvas.getContext('2d');
const questionText = document.getElementById('question-text');
const statusOverlay = document.getElementById('status-overlay');
const nextBtn = document.getElementById('next-btn');
const clearBtn = document.getElementById('clear-btn');

// State variables
let isDrawing = false;
let isProcessingOCR = false;

// Setup canvas size to match the container perfectly
function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    clearCanvas();
}

// Ensure canvas resizes if the window is resized
window.addEventListener('resize', resizeCanvas);

function init() {
    resizeCanvas();
    updateQuestion();
}

function updateQuestion() {
    questionText.textContent = questions[currentQuestionIndex];
    clearCanvas();
}

function clearCanvas() {
    // Clear the canvas to be transparent so the CSS ruled lines show through
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// --- POINTER EVENTS CORE LOGIC ---

canvas.addEventListener('pointerdown', (e) => {
    // 1. Check if the input is a Stylus (Pen)
    if (e.pointerType === 'pen') {
        isDrawing = true;
        ctx.beginPath();
        ctx.moveTo(e.offsetX, e.offsetY);
        e.preventDefault(); // Prevent default browser actions
    } 
    // 2. Check if the input is a Hand Touch
    // (Also allowing 'mouse' just so you can test it on a regular PC without touch)
    else if (e.pointerType === 'touch' || e.pointerType === 'mouse') {
        if (!isProcessingOCR) {
            readWrittenText();
        }
    }
});

canvas.addEventListener('pointermove', (e) => {
    if (!isDrawing) return;
    
    // Only draw if it's the pen moving
    if (e.pointerType === 'pen') {
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#000000'; // Pure black for better OCR
        
        ctx.lineTo(e.offsetX, e.offsetY);
        ctx.stroke();
        e.preventDefault();
    }
});

canvas.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'pen') {
        isDrawing = false;
        ctx.closePath();
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

clearBtn.addEventListener('click', clearCanvas);


// --- OCR (Handwriting to Text) AND TTS (Text to Speech) ---

async function readWrittenText() {
    isProcessingOCR = true;
    statusOverlay.textContent = "Reading handwriting...";
    statusOverlay.classList.remove('hidden');
    
    try {
        // Create a temporary canvas to add a white background
        // (Tesseract needs a solid white background, but our UI canvas is transparent)
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.fillStyle = 'white';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        tempCtx.drawImage(canvas, 0, 0);

        // Extract the drawing from the temporary canvas as a base64 image
        const dataUrl = tempCanvas.toDataURL('image/png');
        
        // Pass the image to Tesseract.js to recognize English ('eng') text
        const result = await Tesseract.recognize(dataUrl, 'eng', {
            logger: m => console.log(m) // logs progress to console
        });
        
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
    // Check if the browser supports Web Speech API
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel(); // Stop any current speech
        
        const utterance = new SpeechSynthesisUtterance(text);
        
        // Hide overlay when speaking finishes
        utterance.onend = () => { statusOverlay.classList.add('hidden'); };
        utterance.onerror = () => { statusOverlay.classList.add('hidden'); };
        
        window.speechSynthesis.speak(utterance);
    } else {
        alert("Text-to-speech is not supported in your browser.");
        statusOverlay.classList.add('hidden');
    }
}

// Start the app
init();
