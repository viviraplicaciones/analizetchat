/**
 * app.js
 * Lógica principal del Analizador de WhatsApp
 * Versión 3.1: Fix Share Target & Smart ZIP Detection
 */

// --- Core State ---
let currentMessages = [];
let mediaMap = {}; 
let filteredMessages = [];
let selectedIndices = new Set();
let participants = [];
let currentSlotId = null;
let deferredPrompt; 

// Charts references
let charts = { pie: null, temporal: null, search: null, manual: null, sentiment: null };
const DB_NAME = 'WAAnalyzerV4_Media'; 

// --- UI References ---
const ui = {
    uploadSection: document.getElementById('file-upload-section'),
    appContainer: document.getElementById('app-container'),
    progressBar: document.getElementById('progress-fill'),
    progressText: document.getElementById('progress-text'),
    loadingContainer: document.getElementById('loading-progress-container'),
    msgContainer: document.getElementById('messages-container'),
    stats: {
        total: document.getElementById('stat-total'),
        p1: document.getElementById('stat-p1'),
        p2: document.getElementById('stat-p2'),
        l1: document.getElementById('label-p1'),
        l2: document.getElementById('label-p2')
    },
    slotsContainer: document.getElementById('slots-container'),
    slotsUsed: document.getElementById('slots-used'),
    btnInstall: document.getElementById('btn-install')
};

// --- Initialization ---
window.addEventListener('DOMContentLoaded', () => {
    initTheme();
    handleSplashScreen();
    updateSlotsUI();
    checkSharedFile();
    
    const allDetails = document.querySelectorAll('details');
    allDetails.forEach(det => {
        det.addEventListener('click', function(e) {
            if (e.target.tagName === 'SUMMARY' || e.target.closest('summary')) {
                allDetails.forEach(other => {
                    if (other !== det) other.removeAttribute('open');
                });
            }
        });
    });
});

const fileInput = document.getElementById('fileInput');
fileInput.addEventListener('change', handleFileUpload);

// --- PWA INSTALLATION LOGIC ---
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    ui.btnInstall.style.display = 'flex';
});

ui.btnInstall.addEventListener('click', async () => {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') ui.btnInstall.style.display = 'none';
        deferredPrompt = null;
    }
});

// --- SHARE TARGET LOGIC ---
async function checkSharedFile() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') === 'share') {
        ui.loadingContainer.style.display = 'block';
        ui.progressText.innerText = "Recuperando archivo...";
        
        try {
            await new Promise(r => setTimeout(r, 500)); 
            const db = await getDB();
            const tx = db.transaction('shared_files', 'readonly');
            const store = tx.objectStore('shared_files');
            const req = store.get('latest'); 
            
            req.onsuccess = async (e) => {
                const file = e.target.result;
                if (file) {
                    await processImportedFile(file);
                    window.history.replaceState({}, document.title, window.location.pathname);
                } else {
                    ui.loadingContainer.style.display = 'none';
                }
            };
        } catch (e) {
            ui.loadingContainer.style.display = 'none';
        }
    }
}

// --- SMART FILE PROCESSING (FIXED) ---
async function processImportedFile(file) {
     try {
        let text = "";
        let extractedMedia = {};
        
        // 1. Detección Inteligente de ZIP
        // WhatsApp a veces envía archivos sin extensión .zip al compartir
        let isZip = false;
        try {
            // Intentamos leerlo como ZIP independientemente del nombre
            const zipTest = await JSZip.loadAsync(file);
            if (Object.keys(zipTest.files).length > 0) isZip = true;
        } catch (e) {
            isZip = false;
        }

        if (isZip) {
            ui.progressText.innerText = "Descomprimiendo...";
            const zip = await JSZip.loadAsync(file);
            
            // Buscar .txt
            const txtFile = Object.values(zip.files).find(f => f.name.endsWith('.txt') && !f.dir);
            if (!txtFile) throw new Error("El archivo compartido no contiene historial de chat (.txt)");
            
            text = await txtFile.async('string');
            
            ui.progressText.innerText = "Procesando Multimedia...";
            const mediaFiles = Object.values(zip.files).filter(f => !f.dir && !f.name.endsWith('.txt'));
            for (const f of mediaFiles) {
                const fileName = f.name.split('/').pop(); 
                const blob = await f.async('blob');
                extractedMedia[fileName] = blob; 
            }
        } else {
            // Si no es ZIP, asumimos texto plano
            text = await file.text();
        }
        
        // Validación básica
        if (!text || text.length < 10) {
             throw new Error("El archivo parece estar vacío o dañado.");
        }

        await parseMessagesAsync(text, extractedMedia, file.name);
        
    } catch (err) {
        console.error(err);
        alert("No se pudo leer el chat: " + err.message);
        ui.loadingContainer.style.display = 'none';
    }
}

function triggerFileUpload() {
     closeModal('chat-manager-modal');
     fileInput.click();
}

async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    ui.loadingContainer.style.display = 'block';
    await processImportedFile(file);
    e.target.value = ''; 
}

// --- WORKER CONNECTION ---
function parseMessagesAsync(text, extractedMedia, filename) {
    return new Promise((resolve, reject) => {
        ui.progressText.innerText = "Analizando chat...";
        
        const worker = new Worker('parser.worker.js');
        const attachmentNames = extractedMedia ? Object.keys(extractedMedia) : [];

        worker.postMessage({
            text: text,
            attachmentNames: attachmentNames
        });

        worker.onmessage = async (e) => {
            const msg = e.data;

            if (msg.type === 'progress') {
                ui.progressBar.style.width = `${msg.percent}%`;
            } 
            else if (msg.type === 'complete') {
                const { data: parsed, analytics } = msg; 
                worker.terminate();

                if (parsed.length === 0) {
                    reject(new Error("Chat vacío o formato desconocido."));
                    return;
                }

                try {
                    ui.progressText.innerText = "Finalizando...";
                    parsed.forEach(m => m.timestamp = new Date(m.timestamp));

                    const authors = {};
                    parsed.forEach(m => authors[m.author] = (authors[m.author] || 0) + 1);
                    const sortedAuthors = Object.keys(authors).sort((a,b) => authors[b] - authors[a]);
                    
                    const slotId = Date.now().toString();
                    const chatData = {
                        id: slotId,
                        name: sortedAuthors.slice(0,2).join(' & '),
                        date: new Date().toLocaleDateString(),
                        msgs: parsed,
                        participants: sortedAuthors,
                        media: extractedMedia,
                        analytics: analytics
                    };
                    
                    await saveSlot(chatData);
                    loadChat(chatData);
                    resolve();
                } catch (err) { reject(err); }
            }
            else if (msg.error) {
                worker.terminate();
                reject(new Error(msg.error));
            }
        };
        worker.onerror = (err) => { worker.terminate(); reject(err); };
    });
}

// --- VISUAL HELPERS ---
function formatTime(seconds) {
    if (!seconds) return 'N/A';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const min = Math.floor(seconds / 60);
    if (min < 60) return `${min} min`;
    const hr = Math.floor(min / 60);
    return `${hr}h ${min % 60}m`;
}

function renderSentimentMeter(containerId, participant, score) {
    let percent = 50 + (score * 2); 
    if (percent < 0) percent = 0;
    if (percent > 100) percent = 100;

    let emoji = "😐";
    if (percent > 60) emoji = "🙂";
    if (percent > 80) emoji = "😍";
    if (percent < 40) emoji = "😒";
    if (percent < 20) emoji = "😡";

    return `
        <div class="meter-label">
            <span>${participant}</span>
            <span>${score > 0 ? '+' + score : score} (${emoji})</span>
        </div>
        <div class="meter-track">
            <div class="meter-indicator" style="left: ${percent}%;"></div>
        </div>
        <div class="sentiment-emojis">
            <span>😡</span><span>😐</span><span>🥰</span>
        </div>
    `;
}

function updateAdvancedStats(analytics, participants) {
    if (!analytics) return;

    // 1. Emojis
    const emojiContainer = document.getElementById('emojis-container');
    emojiContainer.innerHTML = '';
    
    participants.forEach(p => {
        if (analytics.topEmojis[p] && analytics.topEmojis[p].length > 0) {
            const row = document.createElement('div');
            row.className = 'emoji-row';
            row.innerHTML = `<div style="font-size:0.8rem; font-weight:bold; width:30%; text-align:left; color:var(--color-secondary); overflow:hidden; text-overflow:ellipsis;">${p}</div>`;
            
            const emojisDiv = document.createElement('div');
            emojisDiv.style.display = 'flex';
            emojisDiv.style.gap = '8px';
            emojisDiv.style.flex = '1';
            emojisDiv.style.justifyContent = 'flex-end';
            
            analytics.topEmojis[p].forEach(item => {
                emojisDiv.innerHTML += `
                    <div class="emoji-item">
                        <span>${item[0]}</span>
                        <span class="emoji-count">${item[1]}</span>
                    </div>
                `;
            });
            row.appendChild(emojisDiv);
            emojiContainer.appendChild(row);
        }
    });

    // 2. Tiempo de Respuesta
    const p1 = participants[0];
    const p2 = participants[1];
    if (analytics.avgResponseTime) {
        const t1 = analytics.avgResponseTime[p1] ? formatTime(analytics.avgResponseTime[p1]) : 'N/A';
        const t2 = analytics.avgResponseTime[p2] ? formatTime(analytics.avgResponseTime[p2]) : 'N/A';
        
        document.getElementById('resp-time-p1').innerText = `${p1}: ${t1}`;
        document.getElementById('resp-time-p2').innerText = `${p2}: ${t2}`;
    }

    // 3. Sentimiento Visual
    const visualContainer = document.getElementById('sentiment-visual-container');
    visualContainer.innerHTML = '';
    
    const s1 = analytics.sentimentScore ? (analytics.sentimentScore[p1] || 0) : 0;
    const s2 = analytics.sentimentScore ? (analytics.sentimentScore[p2] || 0) : 0;

    const div1 = document.createElement('div');
    div1.className = 'sentiment-meter-container';
    div1.innerHTML = renderSentimentMeter('meter1', p1, s1);
    
    const div2 = document.createElement('div');
    div2.className = 'sentiment-meter-container';
    div2.innerHTML = renderSentimentMeter('meter2', p2, s2);

    visualContainer.appendChild(div1);
    visualContainer.appendChild(div2);
}

// --- APP LOGIC ---
const originalLoadChat = loadChat; 
function loadChat(chatData) {
    currentSlotId = chatData.id;
    currentMessages = chatData.msgs; 
    
    if(currentMessages.length > 0 && typeof currentMessages[0].timestamp === 'string') {
        currentMessages.forEach(m => m.timestamp = new Date(m.timestamp));
    }

    participants = chatData.participants;
    filteredMessages = [...currentMessages];
    selectedIndices.clear();
    
    mediaMap = {};
    if (chatData.media) {
        for (const [name, blob] of Object.entries(chatData.media)) {
            mediaMap[name] = URL.createObjectURL(blob);
        }
    }

    ui.uploadSection.style.display = 'none';
    ui.appContainer.style.display = 'flex';
    ui.loadingContainer.style.display = 'none';
    closeModal('chat-manager-modal');

    updateHeader();
    renderMessages();
    updateDashboard();

    if (chatData.analytics) {
        updateAdvancedStats(chatData.analytics, chatData.participants);
        document.getElementById('details-emojis').style.display = 'block';
        document.getElementById('details-advanced').style.display = 'block';
    } else {
        document.getElementById('details-emojis').style.display = 'none';
        document.getElementById('details-advanced').style.display = 'none';
    }
}

function closeChat() {
    for (const url of Object.values(mediaMap)) { URL.revokeObjectURL(url); }
    mediaMap = {};
    currentMessages = [];
    currentSlotId = null;
    ui.appContainer.style.display = 'none';
    ui.uploadSection.style.display = 'flex';
    updateSlotsUI();
}

function updateHeader() {
    const p1 = participants[0] || "?";
    const p2 = participants[1] || "?";
    const displayText = participants.length > 2 ? `${p1}, ${p2}...` : `${p1} y ${p2}`;
    document.getElementById('interlocutor-names').innerText = displayText;
    document.getElementById('header-stats-preview').innerText = `${currentMessages.length} mensajes`;
}

function renderMessages(msgs = currentMessages) {
    ui.msgContainer.innerHTML = '';
    const fragment = document.createDocumentFragment();
    const LIMIT = 3000;
    const renderSet = msgs.length > LIMIT ? msgs.slice(-LIMIT) : msgs;

    if(msgs.length > LIMIT) {
         const warning = document.createElement('div');
         warning.innerHTML = "<small style='display:block;text-align:center;padding:10px;color:#888'>Mostrando los últimos 3000 mensajes (Optimización)</small>";
         fragment.appendChild(warning);
    }

    renderSet.forEach(msg => {
        const isSender = msg.author === participants[0];
        const div = document.createElement('div');
        div.className = `whatsapp-message ${isSender ? 'sender' : 'recipient'}`;
        if(selectedIndices.has(msg.id)) div.classList.add('selected');
        
        div.onclick = (e) => {
            if(e.target.tagName === 'AUDIO' || e.target.tagName === 'VIDEO') return;
            toggleSelection(msg.id, div);
        };
        
        let contentHtml = "";
        if (msg.attachment && mediaMap[msg.attachment]) {
            const url = mediaMap[msg.attachment];
            const ext = msg.attachment.split('.').pop().toLowerCase();
            if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
                const style = ext === 'webp' ? 'max-width: 150px;' : '';
                contentHtml += `<img src="${url}" class="msg-media" style="${style}" loading="lazy">`;
            } else if (['mp4', 'mov', 'mkv'].includes(ext)) {
                contentHtml += `<video src="${url}" class="msg-video" controls loading="lazy"></video>`;
            } else if (['mp3', 'opus', 'ogg', 'wav', 'm4a'].includes(ext)) {
                contentHtml += `<audio src="${url}" class="msg-audio" controls></audio>`;
            } else {
                contentHtml += `<div class="system-msg">📄 ${msg.attachment}</div>`;
            }
            const caption = msg.content.replace(msg.attachment, '').replace('(archivo adjunto)', '').trim();
            if(caption) contentHtml += `<div>${caption.replace(/\n/g, '<br>')}</div>`;
        } else {
            const lower = msg.content.toLowerCase();
            if (lower.includes('eliminó este mensaje') || lower.includes('multimedia omitido')) {
                 contentHtml = `<div class="system-msg"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg> ${msg.content}</div>`;
            } else {
                contentHtml = msg.content.replace(/\n/g, '<br>');
            }
        }

        div.innerHTML = `
            <div class="msg-author">${msg.author}</div>
            ${contentHtml}
            <div class="msg-meta"><span>${msg.dateStr} ${msg.timeStr}</span></div>
        `;
        fragment.appendChild(div);
    });
    ui.msgContainer.appendChild(fragment);
    ui.msgContainer.scrollTop = ui.msgContainer.scrollHeight;
}

function toggleSelection(id, divElement) {
    if (selectedIndices.has(id)) {
        selectedIndices.delete(id);
        divElement.classList.remove('selected');
    } else {
        selectedIndices.add(id);
        divElement.classList.add('selected');
    }
    updateManualStats();
    if(selectedIndices.size > 0) document.getElementById('manual-analysis-details').open = true;
}

function clearSelection() {
    selectedIndices.clear();
    document.querySelectorAll('.whatsapp-message.selected').forEach(el => el.classList.remove('selected'));
    updateManualStats();
}

function updateManualStats() {
    const manualContainer = document.getElementById('manual-stats');
    const placeholder = document.getElementById('manual-placeholder');
    if (selectedIndices.size === 0) {
        manualContainer.style.display = 'none';
        placeholder.style.display = 'block';
        return;
    }
    manualContainer.style.display = 'block';
    placeholder.style.display = 'none';
    document.getElementById('manual-total').innerText = selectedIndices.size;
    const subset = currentMessages.filter(m => selectedIndices.has(m.id));
    const p1 = participants[0];
    const p2 = participants[1];
    const c1 = subset.filter(m => m.author === p1).length;
    const c2 = subset.filter(m => m.author === p2).length;

    if (charts.manual) charts.manual.destroy();
    charts.manual = new Chart(document.getElementById('chart-manual'), {
        type: 'pie',
        data: { labels: [p1, p2], datasets: [{ data: [c1, c2], backgroundColor: ['#075e54', '#1976d2'] }] },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

function applyFilter() {
    const term = document.getElementById('search-input').value.toLowerCase();
    if(!term) return;
    filteredMessages = currentMessages.filter(m => m.content.toLowerCase().includes(term));
    document.getElementById('search-stats').style.display = 'block';
    document.getElementById('search-chart-wrapper').style.display = 'block';
    document.getElementById('filter-total').innerText = filteredMessages.length;
    const p1 = participants[0];
    const p2 = participants[1];
    const c1 = filteredMessages.filter(m => m.author === p1).length;
    const c2 = filteredMessages.filter(m => m.author === p2).length;
    document.getElementById('filter-label-p1').innerText = p1;
    document.getElementById('filter-p1').innerText = c1;
    document.getElementById('filter-label-p2').innerText = p2;
    document.getElementById('filter-p2').innerText = c2;

    if(charts.search) charts.search.destroy();
    charts.search = new Chart(document.getElementById('chart-search'), {
        type: 'bar',
        data: { labels: [p1, p2], datasets: [{ label: 'Resultados', data: [c1, c2], backgroundColor: ['#075e54', '#1976d2'] }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
    });
    renderMessages(filteredMessages);
}

function resetFilter() {
    document.getElementById('search-input').value = '';
    filteredMessages = [...currentMessages];
    document.getElementById('search-stats').style.display = 'none';
    document.getElementById('search-chart-wrapper').style.display = 'none';
    renderMessages(currentMessages);
}

function updateTemporalChart() {
    const type = document.getElementById('timeframe-select').value;
    const ctx = document.getElementById('chart-temporal');
    let labels = [], data = [];
    
    if (type === 'hour') {
        labels = Array.from({length: 24}, (_, i) => `${i}:00`);
        const hours = new Array(24).fill(0);
        currentMessages.forEach(m => hours[m.timestamp.getHours()]++);
        data = hours;
    } else if (type === 'day') {
        labels = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
        const days = new Array(7).fill(0);
        currentMessages.forEach(m => days[m.timestamp.getDay()]++);
        data = days;
    } else if (type === 'month') {
        const groups = {};
        currentMessages.forEach(m => {
            const k = `${m.timestamp.getMonth()+1}/${m.timestamp.getFullYear().toString().slice(2)}`;
            groups[k] = (groups[k] || 0) + 1;
        });
        labels = Object.keys(groups);
        data = Object.values(groups);
    }

    if(charts.temporal) charts.temporal.destroy();
    charts.temporal = new Chart(ctx, {
        type: 'line',
        data: { labels: labels, datasets: [{ label: 'Actividad', data: data, borderColor: '#25d366', backgroundColor: 'rgba(37, 211, 102, 0.2)', fill: true, tension: 0.3 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
    });
}

function updateDashboard() {
    const p1 = participants[0];
    const p2 = participants[1];
    const c1 = currentMessages.filter(m => m.author === p1).length;
    const c2 = currentMessages.filter(m => m.author === p2).length;
    ui.stats.total.innerText = currentMessages.length;
    ui.stats.l1.innerText = p1;
    ui.stats.p1.innerText = c1;
    ui.stats.l2.innerText = p2;
    ui.stats.p2.innerText = c2;
    if(charts.pie) charts.pie.destroy();
    charts.pie = new Chart(document.getElementById('chart-pie'), {
        type: 'doughnut',
        data: { labels: [p1, p2], datasets: [{ data: [c1, c2], backgroundColor: ['#075e54', '#1976d2'] }] },
        options: { responsive: true, maintainAspectRatio: false }
    });
    updateTemporalChart();
}

function shareAppAction() {
    if(navigator.share) {
        navigator.share({ title: 'Analizador de Chats', text: 'Analiza tus chats localmente.', url: window.location.href });
    } else { alert('Función no soportada en este navegador.'); }
}

function sendBugEmail() {
    const description = document.getElementById('bug-description').value;
    const subject = encodeURIComponent("Reporte - Analizador WA");
    const body = encodeURIComponent(`Fallo:\n${description}\n\nUA: ${navigator.userAgent}`);
    window.location.href = `mailto:vivirapp2020@gmail.com?subject=${subject}&body=${body}`;
    closeModal('bug-report-modal');
}

// --- RICH PDF GENERATOR ---
async function getGeneratedDoc() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 20;

    const centerText = (text, yPos) => {
        const textWidth = doc.getStringUnitWidth(text) * doc.internal.getFontSize() / doc.internal.scaleFactor;
        doc.text(text, (pageWidth - textWidth) / 2, yPos);
    };

    doc.setFontSize(22); doc.setTextColor(7, 94, 84);
    centerText("Reporte de Chat", y); y += 15;

    doc.setFontSize(12); doc.setTextColor(0, 0, 0);
    doc.text(`Conversación: ${participants.join(' & ')}`, 14, y); y += 7;
    doc.text(`Total Mensajes: ${currentMessages.length}`, 14, y); y += 7;
    doc.text(`Fecha del Informe: ${new Date().toLocaleDateString()}`, 14, y); y += 15;
    
    // 1. Resumen General
    doc.setFontSize(14); doc.setTextColor(7, 94, 84);
    doc.text("Resumen de Mensajes", 14, y); y += 8;
    doc.setFontSize(11); doc.setTextColor(50, 50, 50);
    doc.text(`• ${participants[0]}: ${document.getElementById('stat-p1').innerText} mensajes`, 20, y); y += 6;
    doc.text(`• ${participants[1]}: ${document.getElementById('stat-p2').innerText} mensajes`, 20, y); y += 15;

    // 2. Tiempo de Respuesta
    const t1 = document.getElementById('resp-time-p1').innerText;
    const t2 = document.getElementById('resp-time-p2').innerText;
    if (t1 && t2 && t1 !== '...') {
        doc.setFontSize(14); doc.setTextColor(7, 94, 84);
        doc.text("Tiempo de Respuesta Promedio", 14, y); y += 8;
        doc.setFontSize(11); doc.setTextColor(50, 50, 50);
        doc.text(`• ${t1}`, 20, y); y += 6;
        doc.text(`• ${t2}`, 20, y); y += 15;
    }

    // 4. Gráficos (Screenshots)
    const addChart = (canvasId, title) => {
        try {
            const canvas = document.getElementById(canvasId);
            if (canvas) {
                if (y > 230) { doc.addPage(); y = 20; }
                doc.setFontSize(14); doc.setTextColor(7, 94, 84);
                doc.text(title, 14, y); y += 10;
                const imgData = canvas.toDataURL('image/png');
                doc.addImage(imgData, 'PNG', 14, y, 180, 90);
                y += 100;
            }
        } catch(e) {}
    };

    addChart('chart-pie', 'Distribución de Mensajes');
    addChart('chart-temporal', 'Actividad en el Tiempo');
    
    doc.setFontSize(8); doc.setTextColor(150);
    doc.text("Generado con Analizador WA - Local & Seguro", 14, 285);

    return doc;
}

function getSmartFilename() {
    let filename = "Reporte.pdf";
    if (participants.length >= 2) {
        const n1 = participants[0].split(' ')[0].replace(/[^a-z0-9]/gi, '');
        const n2 = participants[1].split(' ')[0].replace(/[^a-z0-9]/gi, '');
        filename = `${n1}_y_${n2}.pdf`;
    }
    return filename;
}

async function downloadReport() {
    try {
        const doc = await getGeneratedDoc();
        doc.save(getSmartFilename());
    } catch(e) { alert("Error al generar PDF: " + e.message); }
}

async function shareReport() {
    if (!navigator.canShare) { alert("Usa 'Descargar PDF'. Tu navegador no comparte archivos."); return; }
    try {
        const doc = await getGeneratedDoc();
        const pdfBlob = doc.output('blob');
        const file = new File([pdfBlob], getSmartFilename(), { type: "application/pdf" });
        if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: 'Reporte Chat', text: 'Adjunto reporte.' });
        } else { throw new Error("No soportado"); }
    } catch (err) { if(err.name !== 'AbortError') alert("Error compartiendo."); }
}

// --- DB ---
function getDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 4);
        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('slots')) db.createObjectStore('slots', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('shared_files')) db.createObjectStore('shared_files');
        };
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = e => reject(e);
    });
}
async function saveSlot(data) {
    const db = await getDB();
    const tx = db.transaction('slots', 'readwrite');
    tx.objectStore('slots').put(data);
    updateSlotsUI();
}
async function getAllSlots() {
    const db = await getDB();
    return new Promise(r => { 
        db.transaction('slots', 'readonly').objectStore('slots').getAll().onsuccess = e => r(e.target.result || []); 
    });
}
async function deleteSlot(id) {
    const db = await getDB();
    const tx = db.transaction('slots', 'readwrite');
    tx.objectStore('slots').delete(id);
    tx.oncomplete = () => updateSlotsUI();
}
async function updateSlotsUI() {
    const slots = await getAllSlots();
    ui.slotsUsed.innerText = slots.length;
    ui.slotsContainer.innerHTML = '';
    if(slots.length === 0) ui.slotsContainer.innerHTML = '<p style="text-align:center;font-size:0.8rem;padding:20px;">Sin chats guardados.</p>';
    slots.forEach(slot => {
        const div = document.createElement('div');
        div.className = 'slot-item';
        div.innerHTML = `
            <div class="slot-info"><h4>${slot.name}</h4><p>${slot.date} • ${slot.msgs.length} msgs</p></div>
            <div class="slot-actions">
                <button class="primary-btn" style="padding:6px 12px;font-size:0.75rem;" onclick="loadSlot('${slot.id}')">Abrir</button>
                <button class="secondary-btn" style="padding:6px 10px;font-size:0.75rem;border-color:#e57373;color:#e57373;" onclick="deleteSlot('${slot.id}')">✕</button>
            </div>`;
        ui.slotsContainer.appendChild(div);
    });
}
async function loadSlot(id) {
    const slots = await getAllSlots();
    const slot = slots.find(s => s.id === id);
    if(slot) loadChat(slot);
}

// --- Helpers ---
function openModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }
window.switchMobileTab = (tab) => {
    document.querySelectorAll('.nav-item').forEach(t => t.classList.remove('active'));
    if (tab === 'chat') {
        document.querySelector('.nav-item:first-child').classList.add('active');
        ui.msgContainer.classList.remove('hidden');
        document.getElementById('dashboard-container').classList.remove('active');
    } else {
        document.querySelector('.nav-item:last-child').classList.add('active');
        ui.msgContainer.classList.add('hidden');
        document.getElementById('dashboard-container').classList.add('active');
    }
};
window.toggleIncognito = () => document.body.classList.toggle('incognito-mode');
window.toggleTheme = () => {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light');
};
function initTheme() { if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark-mode'); }
function handleSplashScreen() {
    const splash = document.getElementById('splash-screen');
    if (localStorage.getItem('hideSplash') === 'true') { splash.style.display = 'none'; } 
    else { setTimeout(() => { splash.style.opacity = '0'; setTimeout(() => splash.style.display = 'none', 500); }, 1500); }
    document.getElementById('no-splash').addEventListener('change', (e) => localStorage.setItem('hideSplash', e.target.checked));
}

// SW Update
let newWorker;
function showUpdateToast(worker) { newWorker = worker; document.getElementById('update-toast').classList.add('show'); }
function dismissUpdate() { document.getElementById('update-toast').classList.remove('show'); }
window.applyUpdate = () => { if (newWorker) newWorker.postMessage({ type: 'SKIP_WAITING' }); dismissUpdate(); };

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('service-worker.js').then(reg => {
            if (reg.waiting) showUpdateToast(reg.waiting);
            reg.addEventListener('updatefound', () => {
                const newSw = reg.installing;
                newSw.addEventListener('statechange', () => { if (newSw.state === 'installed' && navigator.serviceWorker.controller) showUpdateToast(newSw); });
            });
        });
        let refreshing;
        navigator.serviceWorker.addEventListener('controllerchange', () => { if (refreshing) return; window.location.reload(); refreshing = true; });
    });
}