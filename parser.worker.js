/**
 * parser.worker.js
 * Versión 4.0 - Analytics Avanzados (Emojis, Tiempos, Sentimientos)
 * Se ejecuta en un hilo secundario para máximo rendimiento.
 */

self.onmessage = function(e) {
    const { text, attachmentNames } = e.data;
    
    if (!text) {
        self.postMessage({ error: "No text content" });
        return;
    }

    const lines = text.split('\n');
    const totalLines = lines.length;
    const parsed = [];
    
    // --- EXPRESIONES REGULARES ---
    // 1. Formato iOS (iPhone): [DD/MM/YY, HH:MM:SS] Nombre: Mensaje
    const regexIOS = /^\[(\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}),?\s*(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*([ap]\.?\s*m\.?))?\]\s*(.*?)(?::\s*|$)(.*)/i;
    
    // 2. Formato Android: DD/MM/YY, HH:MM - Nombre: Mensaje
    const regexAndroid = /^(\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}),?\s*(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*([ap]\.?\s*m\.?))?\s*-\s*(.*?)(?::\s*|$)(.*)/i;

    // --- DICCIONARIOS PARA SENTIMIENTOS (Básico) ---
    // Palabras clave para detectar tono positivo o negativo
    const positiveWords = new Set(['jaja', 'jeje', 'gracias', 'amor', 'lindo', 'bien', 'bueno', 'excelente', 'genial', 'feliz', 'te amo', 'beso', 'abrazo', 'ok', 'vale', 'sii', 'si', 'gusta', 'risas', 'adoro']);
    const negativeWords = new Set(['no', 'mal', 'odio', 'triste', 'feo', 'error', 'nunca', 'jamás', 'dolor', 'miedo', 'aburrido', 'pelea', 'molesto', 'horrible', 'asco', 'rabia', 'puta', 'mierda', 'imbecil']);

    // --- VARIABLES DE ANÁLISIS ---
    const emojiCounts = {};
    const responseTimes = {}; // Guardará tiempos en segundos por autor
    const sentimentScore = {}; // Puntuación acumulada por autor

    let currentMsg = null;
    let lastMsg = null;

    // Regex para capturar Emojis (Rango Unicode estándar)
    const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;

    // --- BUCLE PRINCIPAL DE PROCESAMIENTO ---
    for (let i = 0; i < totalLines; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Reportar progreso cada 5000 líneas
        if (i % 5000 === 0) {
            self.postMessage({ type: 'progress', percent: Math.round((i / totalLines) * 100) });
        }

        // Detectar si es una línea de inicio de mensaje
        let match = line.match(regexIOS) || line.match(regexAndroid);

        if (match) {
            // Si ya teníamos un mensaje procesándose, lo guardamos y analizamos
            if (currentMsg) {
                processMessageStats(currentMsg); 
                parsed.push(currentMsg);
                lastMsg = currentMsg; // Actualizamos el "último mensaje" para calcular tiempos de respuesta
            }
            
            const [_, dateStr, timeStr, ampmStr, authorRaw, textRaw] = match;
            
            // Reconstrucción de fecha y hora
            const [day, month, year] = dateStr.replace(/[\.-]/g, '/').split('/');
            const fullYear = year.length === 2 ? `20${year}` : year;
            let [hours, minutes] = timeStr.split(':').map(Number);
            if (ampmStr) {
                const ampm = ampmStr.toLowerCase().replace(/\./g, '').trim();
                if ((ampm === 'pm' || ampm === 'p. m.') && hours < 12) hours += 12;
                if ((ampm === 'am' || ampm === 'a. m.') && hours === 12) hours = 0;
            }
            const timestampObj = new Date(fullYear, month - 1, day, hours, minutes);

            // Detección de adjuntos multimedia
            let attachment = null;
            let contentTrimmed = textRaw ? textRaw.trim() : "";
            if (attachmentNames && attachmentNames.length > 0) {
                for (let j = 0; j < attachmentNames.length; j++) {
                    if (contentTrimmed.includes(attachmentNames[j])) {
                        attachment = attachmentNames[j];
                        break;
                    }
                }
            }

            // Detección de mensajes de sistema (sin autor claro o autor en el texto)
            let finalAuthor = authorRaw.trim();
            if (!contentTrimmed && finalAuthor) {
                // Caso común en Android donde el sistema es detectado como autor
                contentTrimmed = finalAuthor;
                finalAuthor = "Sistema";
            }

            currentMsg = {
                id: parsed.length,
                dateStr: dateStr,
                timeStr: timeStr + (ampmStr || ''),
                timestamp: timestampObj.toISOString(),
                timestampObj: timestampObj, // Objeto temporal para cálculos internos (no se envía al final)
                author: finalAuthor,
                content: contentTrimmed,
                attachment: attachment
            };

            // --- LÓGICA DE TIEMPO DE RESPUESTA ---
            // Si hay un mensaje previo, no es del sistema, y el autor cambió...
            if (lastMsg && lastMsg.author !== "Sistema" && currentMsg.author !== "Sistema" && lastMsg.author !== currentMsg.author) {
                const diffMs = currentMsg.timestampObj - lastMsg.timestampObj;
                // Filtramos respuestas mayores a 24h (86400000 ms) para no ensuciar el promedio con chats inactivos
                if (diffMs > 0 && diffMs < 86400000) {
                    if (!responseTimes[currentMsg.author]) responseTimes[currentMsg.author] = [];
                    responseTimes[currentMsg.author].push(diffMs / 1000); // Guardamos en segundos
                }
            }

        } else if (currentMsg) {
            // Mensaje multilínea: agregar contenido al mensaje actual
            currentMsg.content += '\n' + line;
        }
    }

    // No olvidar procesar el último mensaje del loop
    if (currentMsg) {
        processMessageStats(currentMsg);
        parsed.push(currentMsg);
    }

    // --- FUNCIÓN HELPER INTERNA ---
    function processMessageStats(msg) {
        if (msg.author === "Sistema") return;

        // 1. Contar Emojis
        const emojisFound = msg.content.match(emojiRegex);
        if (emojisFound) {
            emojisFound.forEach(emoji => {
                if (!emojiCounts[msg.author]) emojiCounts[msg.author] = {};
                emojiCounts[msg.author][emoji] = (emojiCounts[msg.author][emoji] || 0) + 1;
            });
        }

        // 2. Calcular Sentimiento
        const words = msg.content.toLowerCase().split(/\W+/); // Dividir por palabras
        let score = 0;
        words.forEach(w => {
            if (positiveWords.has(w)) score++;
            if (negativeWords.has(w)) score--;
        });
        
        if (!sentimentScore[msg.author]) sentimentScore[msg.author] = 0;
        sentimentScore[msg.author] += score;
    }

    // --- PREPARAR RESULTADOS FINALES ---
    
    // Top 5 Emojis por autor
    const topEmojis = {};
    for (const author in emojiCounts) {
        const sorted = Object.entries(emojiCounts[author])
            .sort((a, b) => b[1] - a[1]) // Ordenar descendente
            .slice(0, 5); // Tomar top 5
        topEmojis[author] = sorted;
    }

    // Promedio de tiempo de respuesta
    const avgResponseTime = {};
    for (const author in responseTimes) {
        const times = responseTimes[author];
        const sum = times.reduce((a, b) => a + b, 0);
        avgResponseTime[author] = times.length ? Math.round(sum / times.length) : 0;
    }

    // Limpieza final de objetos temporales
    parsed.forEach(m => delete m.timestampObj);

    // ENVIAR TODO DE VUELTA AL HILO PRINCIPAL
    self.postMessage({ 
        type: 'complete', 
        data: parsed,
        analytics: {
            topEmojis,
            avgResponseTime,
            sentimentScore
        }
    });
};