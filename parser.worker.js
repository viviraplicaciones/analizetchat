/**
 * parser.worker.js
 * * Este Web Worker se encarga de la tarea pesada de procesar
 * el archivo de chat. Al hacerlo en un hilo separado, la interfaz
 * de usuario principal permanece fluida y sin bloqueos.
 */

function parseMessages(text) {
    const messages = [];
    const lines = text.split('\n');
    // Expresión regular para capturar la estructura de un mensaje de WhatsApp
    const regex = /^(\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}),\s*(\d{1,2}:\d{2})\s*([ap]\.\s*m\.\s*)?\s*-\s*([^:]+):\s*(.*)/i;
    let currentMessage = null;

    lines.forEach(line => {
        const match = line.match(regex);
        if (match) {
            if (currentMessage) {
                messages.push(currentMessage);
            }
            const [, dateStr, timeStr, ampmStr, author, text] = match;
            const [day, month, year] = dateStr.replace(/[\.-]/g, '/').split('/');
            const fullYear = year.length === 2 ? `20${year}` : year;

            let [hours, minutes] = timeStr.split(':').map(Number);
            if (ampmStr) {
                if (ampmStr.toLowerCase().includes('p.m.') && hours < 12) {
                    hours += 12;
                } else if (ampmStr.toLowerCase().includes('a.m.') && hours === 12) {
                    hours = 0;
                }
            }
            const timestamp = new Date(fullYear, month - 1, day, hours, minutes);
            
            const messageText = text.trim().toLowerCase() === '<multimedia omitido>' ? 'Multimedia omitido' : text.trim();

            currentMessage = {
                date: dateStr,
                time: timeStr + (ampmStr ? ` ${ampmStr.trim()}` : ''),
                author: author.trim(),
                text: messageText,
                timestamp: timestamp.toISOString() // Se envía como string para ser serializable
            };
        } else if (currentMessage) {
            // Esto concatena mensajes multilínea
            currentMessage.text += '\n' + line.trim();
        }
    });

    if (currentMessage) {
        messages.push(currentMessage);
    }

    return messages;
}


// El worker escucha mensajes desde el hilo principal
self.onmessage = function(e) {
    const fileContent = e.data;
    if (fileContent) {
        const messages = parseMessages(fileContent);
        // Devuelve el resultado al hilo principal
        self.postMessage(messages);
    }
};
