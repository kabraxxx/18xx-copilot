// content.js
// Escucha los mensajes que le envía el popup de la extensión
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getGameData") {
        console.log("ContentScript: Mensaje 'getGameData' recibido.");
        const currentUrl = window.location.href;
        const match = window.location.pathname.match(/\/game\/(\d+)/);

        if (!match) {
            console.warn("ContentScript: URL no corresponde a un ID de partida válido.");
            sendResponse({ success: false, error: "No se detectó un ID de partida válido en la URL actual." });
            return;
        }

        const gameId = match[1];
        const apiUrl = `${window.location.origin}/api/game/${gameId}`;
        console.log(`ContentScript: ID de partida detectado: ${gameId}. Consultando API: ${apiUrl}`);

        // Intentamos obtener el JSON oficial de la API de 18xx.games
        fetch(apiUrl)
            .then(response => {
                console.log(`ContentScript: API respondió con status ${response.status}`);
                if (!response.ok) {
                    throw new Error(`API HTTP Error: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                console.log("ContentScript: JSON de partida obtenido y parseado con éxito de la API.");
                sendResponse({ success: true, gameData: data });
            })
            .catch(apiError => {
                console.warn("ContentScript: Falló el fetch a la API, intentando extraer del DOM:", apiError);
                
                // Fallback: Si la API falla, intentamos extraer los datos del botón 'Download' en el DOM
                try {
                    const anchors = Array.from(document.querySelectorAll('a'));
                    let downloadLink = anchors.find(el => {
                        const text = el.textContent.trim().toLowerCase();
                        const href = el.getAttribute('href') || '';
                        return text === 'download' && href.startsWith('data:');
                    });

                    if (!downloadLink) {
                        downloadLink = anchors.find(el => {
                            const href = el.getAttribute('href') || '';
                            return href.startsWith('data:text/plain') && (href.includes('%22id%22') || href.includes('id'));
                        });
                    }

                    if (downloadLink) {
                        console.log("ContentScript: Enlace 'Download' encontrado en el DOM del fallback.");
                        const href = downloadLink.getAttribute('href');
                        const commaIndex = href.indexOf(',');
                        if (commaIndex !== -1) {
                            const encodedData = href.substring(commaIndex + 1);
                            const decodedData = decodeURIComponent(encodedData);
                            const gameData = JSON.parse(decodedData);
                            
                            console.log("ContentScript: JSON de partida extraído y parseado del DOM con éxito.");
                            sendResponse({ success: true, gameData: gameData });
                            return;
                        }
                    }

                    console.error("ContentScript: No se encontró el enlace de 'Download' en el DOM.");
                    sendResponse({ 
                        success: false, 
                        error: `No se pudo conectar a la API (${apiError.message}) y tampoco se encontró el botón de 'Download' en el DOM. Asegúrate de estar en la pestaña 'Tools' si estás desconectado.` 
                    });
                } catch (domError) {
                    console.error("ContentScript: Error crítico en fallback del DOM:", domError);
                    sendResponse({ 
                        success: false, 
                        error: `Error al conectar a la API (${apiError.message}) y error al parsear el DOM (${domError.message})` 
                    });
                }
            });

        return true; // Mantiene el canal de comunicación abierto para la respuesta asíncrona de fetch
    }
});