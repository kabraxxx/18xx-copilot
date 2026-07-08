// content.js
// Escucha los mensajes que le envía el popup de la extensión
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getGameData") {
        console.log("ContentScript: Mensaje 'getGameData' recibido. Extrayendo del DOM...");
        
        // Buscamos y parseamos el JSON de la partida desde el DOM
        (async () => {
            try {
                const anchors = Array.from(document.querySelectorAll('a'));
                
                // Busca cualquier enlace que tenga "download" o "descargar" en el texto o atributo download,
                // y que tenga una URL de tipo data: o blob:
                let downloadLink = anchors.find(el => {
                    const text = el.textContent.trim().toLowerCase();
                    const href = el.getAttribute('href') || '';
                    const hasDownloadAttr = el.hasAttribute('download');
                    const isDataOrBlob = href.startsWith('data:') || href.startsWith('blob:');
                    
                    return isDataOrBlob && (hasDownloadAttr || text.includes('download') || text.includes('descargar') || text.includes('json'));
                });

                if (!downloadLink) {
                    // Intento secundario: buscar cualquier enlace con data:text/plain que contenga id de partida
                    downloadLink = anchors.find(el => {
                        const href = el.getAttribute('href') || '';
                        return href.startsWith('data:text/plain') && (href.includes('%22id%22') || href.includes('id'));
                    });
                }

                if (downloadLink) {
                    console.log("ContentScript: Enlace de descarga encontrado:", downloadLink);
                    const href = downloadLink.getAttribute('href');
                    
                    let gameData;
                    if (href.startsWith('data:')) {
                        // Procesar data URL localmente para evitar cualquier bloqueo CSP de red
                        const commaIndex = href.indexOf(',');
                        if (commaIndex !== -1) {
                            const dataPart = href.substring(commaIndex + 1);
                            const decodedData = decodeURIComponent(dataPart);
                            gameData = JSON.parse(decodedData);
                        } else {
                            throw new Error("Data URL malformado.");
                        }
                    } else {
                        // Si es un blob URL, usamos fetch (los blob URLs locales no suelen tener bloqueos CSP tan restrictivos)
                        const res = await fetch(href);
                        gameData = await res.json();
                    }
                    
                    console.log("ContentScript: JSON de partida extraído y parseado con éxito.");
                    sendResponse({ success: true, gameData: gameData });
                } else {
                    console.error("ContentScript: No se encontró ningún enlace de descarga de JSON en el DOM.");
                    sendResponse({ 
                        success: false, 
                        error: "No se encontró el botón de descarga en la página (asegúrate de estar en la pestaña 'Tools' si es una partida hotseat/offline)."
                    });
                }
            } catch (err) {
                console.error("ContentScript: Error en extracción del DOM:", err);
                sendResponse({ success: false, error: err.message });
            }
        })();

        return true; // Mantiene el canal de comunicación abierto para la respuesta asíncrona
    }
});