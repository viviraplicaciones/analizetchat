/**
 * parser.worker.js
 * Versión 3.0 - Soporte Multi-Plataforma (iOS/Android) y Multimedia
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
    
    // --- EXPRESIONES REGULARES INTELIGENTES ---
    
    // 1. Formato iOS (iPhone): [DD/MM/YY, HH:MM:SS] Nombre: Mensaje
    // Captura: [1]Fecha, [2]Hora, [3]AM/PM (opc), [4]Autor, [5]Mensaje
    const regexIOS = /^\[(\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}),?\s*(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*([ap]\.?\s*m\.?))?\]\s*(.*?)(?::\s*|$)(.*)/i;
    
    // 2. Formato Android: DD/MM/YY, HH:MM - Nombre: Mensaje
    // Captura: [1]Fecha, [2]Hora, [3]AM/PM (opc), [4]Autor, [5]Mensaje
    const regexAndroid = /^(\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}),?\s*(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*([ap]\.?\s*m\.?))?\s*-\s*(.*?)(?::\s*|$)(.*)/i;

    let currentMsg = null;

    for (let i = 0; i < totalLines; i++) {
        const line = lines[i].trim();
        if (!line) continue; // Saltar líneas vacías puras

        // Reportar progreso
        if (i % 5000 === 0) {
            self.postMessage({ type: 'progress', percent: Math.round((i / totalLines) * 100) });
        }

        // Intentar detectar formato
        let match = line.match(regexIOS) || line.match(regexAndroid);

        if (match) {
            // ¡Nueva línea de mensaje detectada! Guardamos el anterior si existe
            if (currentMsg) parsed.push(currentMsg);
            
            const [_, dateStr, timeStr, ampmStr, authorRaw, textRaw] = match;
            
            // --- Normalización de Fecha y Hora ---
            const [day, month, year] = dateStr.replace(/[\.-]/g, '/').split('/');
            const fullYear = year.length === 2 ? `20${year}` : year;
            
            // Limpiar hora (quitar segundos si existen para simplificar, o usarlos)
            let [hours, minutes] = timeStr.split(':').map(Number);
            
            if (ampmStr) {
                const ampm = ampmStr.toLowerCase().replace(/\./g, '').trim();
                if ((ampm === 'pm' || ampm === 'p. m.') && hours < 12) hours += 12;
                if ((ampm === 'am' || ampm === 'a. m.') && hours === 12) hours = 0;
            }

            // --- Lógica de Adjuntos ---
            let attachment = null;
            let contentTrimmed = textRaw ? textRaw.trim() : "";
            
            // Si el mensaje está vacío pero hay autor, a veces el autor es el sistema
            // Ej: "Los mensajes están cifrados" -> El regex puede capturarlo como Autor si no hay dos puntos
            
            if (attachmentNames && attachmentNames.length > 0) {
                for (let j = 0; j < attachmentNames.length; j++) {
                    if (contentTrimmed.includes(attachmentNames[j])) {
                        attachment = attachmentNames[j];
                        break;
                    }
                }
            }
            
            // Manejo de mensajes de sistema (sin "Autor:")
            // Si el regex capturó texto en el grupo de Autor pero el mensaje está vacío,
            // probablemente era un mensaje de sistema (ej: "Añadiste a Juan").
            let finalAuthor = authorRaw.trim();
            let finalContent = contentTrimmed;

            if (!finalContent && finalAuthor) {
                // Re-check: Era un mensaje de sistema?
                // En esos casos el regex de Android suele poner todo en el grupo 'author' porque no encuentra los dos puntos
                finalContent = finalAuthor;
                finalAuthor = "Sistema";
            }

            currentMsg = {
                id: parsed.length,
                dateStr: dateStr,
                timeStr: timeStr + (ampmStr || ''),
                timestamp: new Date(fullYear, month - 1, day, hours, minutes).toISOString(),
                author: finalAuthor,
                content: finalContent,
                attachment: attachment
            };

        } else if (currentMsg) {
            // Si no coincide con ninguna fecha, es parte del mensaje anterior (multilínea)
            currentMsg.content += '\n' + line;
        }
    }

    if (currentMsg) parsed.push(currentMsg);

    self.postMessage({ type: 'complete', data: parsed });
};