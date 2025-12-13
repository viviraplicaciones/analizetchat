/**
 * parser.worker.js - Versión 4.1: Nuclear Regex (Soporta formatos rotos)
 */

self.onmessage = function(e) {
    const { text, attachmentNames } = e.data;
    if (!text) { self.postMessage({ error: "No text content" }); return; }

    const lines = text.split('\n');
    const totalLines = lines.length;
    const parsed = [];
    
    // --- REGEX PERMISIVOS (Anti-Error Android) ---
    // 1. iOS: [DD/MM/YY, HH:MM:SS] Nombre: Mensaje
    const regexIOS = /^\[(\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}),?\s*(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*([ap]\.?\s*m\.?))?\]\s*(.*?)(?::\s*|$)(.*)/i;
    
    // 2. Android Flexible:
    // - Soporta coma o NO coma después de la fecha.
    // - Soporta espacios invisibles (\u00A0, \u202F).
    // - Soporta guion corto (-) y largo (—).
    // - Soporta "p.m.", "pm", "PM", etc.
    const regexAndroid = /^(\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4})[,\s\u00A0\u202F]*(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*([ap]\.?\s*m\.?))?[\s\u00A0\u202F]*[-—][\s\u00A0\u202F]*(.*?)(?::\s*|$)(.*)/i;

    const positiveWords = new Set(['jaja', 'jeje', 'gracias', 'amor', 'lindo', 'bien', 'bueno', 'excelente', 'genial', 'feliz', 'te amo', 'beso', 'abrazo', 'ok', 'vale', 'sii', 'si', 'gusta', 'risas', 'adoro', 'tqm', 'super', 'felicidad']);
    const negativeWords = new Set(['no', 'mal', 'odio', 'triste', 'feo', 'error', 'nunca', 'jamás', 'dolor', 'miedo', 'aburrido', 'pelea', 'molesto', 'horrible', 'asco', 'rabia', 'puta', 'mierda', 'imbecil', 'stupid', 'muerte', 'llorar', 'fatul', 'mierda']);

    const emojiCounts = {}; const responseTimes = {}; const sentimentScore = {}; 
    let currentMsg = null; let lastMsg = null;
    const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;

    for (let i = 0; i < totalLines; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        if (i % 5000 === 0) self.postMessage({ type: 'progress', percent: Math.round((i / totalLines) * 100) });

        let match = line.match(regexIOS) || line.match(regexAndroid);

        if (match) {
            if (currentMsg) { processStats(currentMsg); parsed.push(currentMsg); lastMsg = currentMsg; }
            
            const [_, dateStr, timeStr, ampmStr, authorRaw, textRaw] = match;
            
            const [day, month, year] = dateStr.replace(/[\.-]/g, '/').split('/');
            const fullYear = year.length === 2 ? `20${year}` : year;
            let [hours, minutes] = timeStr.split(':').map(Number);
            if (ampmStr) {
                const ampm = ampmStr.toLowerCase().replace(/\./g, '').trim();
                if ((ampm === 'pm' || ampm === 'p m') && hours < 12) hours += 12;
                if ((ampm === 'am' || ampm === 'a m') && hours === 12) hours = 0;
            }
            const timestampObj = new Date(fullYear, month - 1, day, hours, minutes);

            let attachment = null; let contentTrimmed = textRaw ? textRaw.trim() : "";
            if (attachmentNames && attachmentNames.length > 0) {
                for (let j = 0; j < attachmentNames.length; j++) { if (contentTrimmed.includes(attachmentNames[j])) { attachment = attachmentNames[j]; break; } }
            }

            let finalAuthor = authorRaw.trim().replace(/[\u200E\u200F\u202A-\u202E]/g, '');
            if (!contentTrimmed && finalAuthor) { contentTrimmed = finalAuthor; finalAuthor = "Sistema"; }

            currentMsg = { id: parsed.length, dateStr: dateStr, timeStr: timeStr + (ampmStr || ''), timestamp: timestampObj.toISOString(), timestampObj: timestampObj, author: finalAuthor, content: contentTrimmed, attachment: attachment };

            if (lastMsg && lastMsg.author !== "Sistema" && currentMsg.author !== "Sistema" && lastMsg.author !== currentMsg.author) {
                const diffMs = currentMsg.timestampObj - lastMsg.timestampObj;
                if (diffMs > 0 && diffMs < 86400000) { if (!responseTimes[currentMsg.author]) responseTimes[currentMsg.author] = []; responseTimes[currentMsg.author].push(diffMs / 1000); }
            }
        } else if (currentMsg) { currentMsg.content += '\n' + line; }
    }
    if (currentMsg) { processStats(currentMsg); parsed.push(currentMsg); }

    function processStats(msg) {
        if (msg.author === "Sistema") return;
        const emojisFound = msg.content.match(emojiRegex);
        if (emojisFound) { emojisFound.forEach(emoji => { if (!emojiCounts[msg.author]) emojiCounts[msg.author] = {}; emojiCounts[msg.author][emoji] = (emojiCounts[msg.author][emoji] || 0) + 1; }); }
        const words = msg.content.toLowerCase().split(/\W+/);
        let score = 0; words.forEach(w => { if (positiveWords.has(w)) score++; if (negativeWords.has(w)) score--; });
        if (!sentimentScore[msg.author]) sentimentScore[msg.author] = 0; sentimentScore[msg.author] += score;
    }

    const topEmojis = {}; for (const author in emojiCounts) { topEmojis[author] = Object.entries(emojiCounts[author]).sort((a, b) => b[1] - a[1]).slice(0, 5); }
    const avgResponseTime = {}; for (const author in responseTimes) { const times = responseTimes[author]; avgResponseTime[author] = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0; }
    parsed.forEach(m => delete m.timestampObj);

    self.postMessage({ type: 'complete', data: parsed, analytics: { topEmojis, avgResponseTime, sentimentScore } });
};