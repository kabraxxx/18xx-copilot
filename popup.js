// popup.js
const DEFAULT_GEMINI_KEY = "AIzaSyBT62DXP6fb6tRZWu7waoS4Bkt4U_NQZHs";

// Elementos de la interfaz
const settingsToggle = document.getElementById('settings-toggle');
const settingsPanel = document.getElementById('settings-panel');
const providerSelect = document.getElementById('provider-select');
const keyLabel = document.getElementById('key-label');
const apiKeyInput = document.getElementById('api-key-input');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const getKeyLink = document.getElementById('get-key-link');
const settingsStatus = document.getElementById('settings-status');
const analyzeBtn = document.getElementById('analyze-btn');
const outputDiv = document.getElementById('output');
const usernameInput = document.getElementById('username-input');

// Configuración de textos según proveedor
const configText = {
    openrouter: {
        label: "Tu API Key de OpenRouter:",
        placeholder: "Pega tu clave sk-or-... aquí",
        link: "https://openrouter.ai/keys"
    },
    gemini: {
        label: "Tu API Key de Gemini:",
        placeholder: "Pega tu clave AIzaSy... aquí",
        link: "https://aistudio.google.com/app/apikey"
    }
};

// Funciones seguras para renderizar contenido en el DOM evitando XSS
function showError(prefix, message) {
    outputDiv.innerHTML = '';
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error';
    
    const strong = document.createElement('strong');
    strong.textContent = prefix;
    errorDiv.appendChild(strong);
    
    errorDiv.appendChild(document.createTextNode(' ' + message));
    outputDiv.appendChild(errorDiv);
}

function showAnalysis(text) {
    outputDiv.innerHTML = '';
    const analysisDiv = document.createElement('div');
    analysisDiv.className = 'analysis';
    
    const lines = text.split('\n');
    lines.forEach((line, index) => {
        analysisDiv.appendChild(document.createTextNode(line));
        if (index < lines.length - 1) {
            analysisDiv.appendChild(document.createElement('br'));
        }
    });
    outputDiv.appendChild(analysisDiv);
}

// Actualizar textos en la UI según proveedor seleccionado
function updateUiForProvider(provider) {
    if (provider !== 'openrouter' && provider !== 'gemini') return;
    const cfg = provider === 'openrouter' ? configText.openrouter : configText.gemini;
    keyLabel.textContent = cfg.label;
    apiKeyInput.placeholder = cfg.placeholder;
    getKeyLink.href = cfg.link;
}

// Cargar la configuración guardada al iniciar el popup
document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get(['provider', 'geminiApiKey', 'openrouterApiKey', 'targetUsername'], (result) => {
        const provider = result.provider || 'openrouter';
        providerSelect.value = provider;
        updateUiForProvider(provider);

        // Rellenar la clave correspondiente
        if (provider === 'openrouter' && result.openrouterApiKey) {
            apiKeyInput.value = result.openrouterApiKey;
        } else if (provider === 'gemini' && result.geminiApiKey) {
            apiKeyInput.value = result.geminiApiKey;
        }

        // Rellenar el nombre de usuario
        if (result.targetUsername) {
            usernameInput.value = result.targetUsername;
        }
        console.log(`Copilot: Configuración inicial cargada. Proveedor activo: ${provider}`);
    });
});

// Guardar el nombre de usuario dinámicamente cuando cambia
usernameInput.addEventListener('input', () => {
    chrome.storage.local.set({ targetUsername: usernameInput.value.trim() });
});

// Alternar visibilidad del panel de configuración
settingsToggle.addEventListener('click', () => {
    settingsPanel.classList.toggle('hidden');
});

// Cambiar de proveedor en caliente
providerSelect.addEventListener('change', () => {
    const provider = providerSelect.value;
    updateUiForProvider(provider);
    
    // Cargar clave guardada para este proveedor
    chrome.storage.local.get(['geminiApiKey', 'openrouterApiKey'], (result) => {
        if (provider === 'openrouter') {
            apiKeyInput.value = result.openrouterApiKey || '';
        } else {
            apiKeyInput.value = result.geminiApiKey || '';
        }
    });
});

// Guardar la configuración
saveSettingsBtn.addEventListener('click', () => {
    const provider = providerSelect.value;
    const key = apiKeyInput.value.trim();
    
    const dataToSave = { provider: provider };
    if (provider === 'openrouter') {
        dataToSave.openrouterApiKey = key;
    } else {
        dataToSave.geminiApiKey = key;
    }

    chrome.storage.local.set(dataToSave, () => {
        settingsStatus.style.color = 'var(--success-color)';
        settingsStatus.textContent = "¡Configuración guardada!";
        console.log(`Copilot: Configuración guardada para ${provider}.`);
        setTimeout(() => {
            settingsStatus.textContent = "";
        }, 3000);
    });
});

// Lógica de análisis principal
analyzeBtn.addEventListener('click', async () => {
    outputDiv.innerHTML = '<div class="loading">Conectando con la partida y analizando...</div>';
    console.log("Copilot: Botón clickeado. Obteniendo pestaña activa...");

    try {
        // 1. Pedir los datos de la partida al Content Script
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (!tab || !tab.id) {
            console.warn("Copilot: No se detectó ninguna pestaña activa.");
            outputDiv.innerHTML = '<div class="error">No se detectó ninguna pestaña activa. Por favor, asegúrate de estar en la página de la partida.</div>';
            return;
        }

        console.log(`Copilot: Enviando mensaje 'getGameData' a la pestaña ID ${tab.id}...`);

        let response;
        try {
            response = await chrome.tabs.sendMessage(tab.id, { action: "getGameData" });
        } catch (msgError) {
            console.error("Copilot: Error de conexión al content script:", msgError);
            outputDiv.innerHTML = '<div class="error"><strong>Error de conexión:</strong> Por favor, <strong>recarga la pestaña de la partida</strong> en 18xx.games y vuelve a intentarlo para activar el Copilot.</div>';
            return;
        }

        console.log("Copilot: Respuesta recibida del content script:", response);

        if (!response || !response.success) {
            const errMsg = response?.error || "Asegúrate de estar en una pestaña activa de partida de 18xx.games.";
            console.warn("Copilot: Error en respuesta de datos:", errMsg);
            showError("Error al obtener datos:", errMsg);
            return;
        }

        // Limitar y limpiar el historial de acciones (máximo 100) para optimizar el contexto en modelos gratuitos
        const prunedGameData = { ...response.gameData };
        if (Array.isArray(prunedGameData.actions)) {
            prunedGameData.actions = prunedGameData.actions.map(act => {
                const cleanAct = { ...act };
                delete cleanAct.created_at;
                delete cleanAct.user;
                if (Array.isArray(cleanAct.auto_actions)) {
                    cleanAct.auto_actions = cleanAct.auto_actions.map(autoAct => {
                        const cleanAuto = { ...autoAct };
                        delete cleanAuto.created_at;
                        delete cleanAuto.user;
                        return cleanAuto;
                    });
                }
                return cleanAct;
            }).slice(-100);
        }

        // Obtener la clave de API activa y proveedor
        const result = await chrome.storage.local.get(['provider', 'geminiApiKey', 'openrouterApiKey', 'targetUsername']);
        const provider = result.provider || 'openrouter';
        const targetUsername = result.targetUsername ? result.targetUsername.trim() : '';

        let targetInstructions = '';
        if (targetUsername) {
            targetInstructions = `El usuario al que debes ayudar es "${targetUsername}". Identifica cuál es su ID en la lista de jugadores ("players") y analiza su situación actual en la partida.
- Identifica el tipo de ronda actual ("round" puede ser SR/Stock Round o OR/Operating Round).
- Si es su turno (está en "acting"):
  1. Predice y recomienda la MEJOR acción inmediata a realizar (ej. comprar/vender acciones específicas en SR, o pagar/retener dividendos, comprar un tren específico en OR).
  2. Ofrece una justificación táctica de por qué esa es la mejor opción.
  3. Da 2 consejos estratégicos alternativos o secundarios.
- Si NO es su turno:
  1. Identifica de quién es el turno.
  2. Predice qué querrá hacer el jugador activo y cómo afecta al usuario "${targetUsername}".
  3. Recomienda 3 acciones de preparación para el turno del usuario (ej. ahorrar dinero para un tren, preparar compra de acciones de una empresa específica).`;
        } else {
            targetInstructions = `Determina de qué jugador es el turno actual (campo "acting" y las últimas acciones).
- Identifica el tipo de ronda actual ("round").
- Recomienda las 3 mejores opciones o movimientos para el jugador activo, justificando cuál de ellas es la mejor decisión estratégica inmediata (acciones a realizar en la ronda actual).`;
        }
        
        const promptText = `Eres un experto jugador y analista estratégico de juegos de mesa de la serie 18xx. Analiza el siguiente JSON con los datos generales y las últimas acciones de una partida en curso en 18xx.games.

${targetInstructions}

PAUTAS DE ANÁLISIS ESTRATÉGICO:
1. Diferencia estrictamente las dinámicas: en Stock Round (SR) analiza el flujo de acciones, control de empresas presididas y el orden de turno. En Operating Round (OR) analiza los trenes disponibles, el dinero en tesorería de cada corporación, si necesitan retener para evitar una compra obligatoria de tren (y posible bancarrota), y la rentabilidad de las rutas.
2. Identifica riesgos inminentes de "Train Rush" (compra acelerada de trenes) o de quedar desprovisto de trenes (rusting).
3. Sé directo, táctico y fundamenta tus sugerencias en los datos reales del JSON.

REGLAS DE FORMATO:
- Sé muy conciso, directo y estructurado en español.
- NO des respuestas matemáticas genéricas, NO uses fórmulas LaTeX, ni bloques como \\boxed{}.
- Escribe una respuesta textual clara y legible.

JSON de la partida (resumido):
${JSON.stringify(prunedGameData)}`;

        if (provider === 'openrouter') {
            const key = result.openrouterApiKey;
            if (!key) {
                outputDiv.innerHTML = '<div class="error"><strong>Falta API Key:</strong> Por favor, configura y guarda tu API Key de OpenRouter haciendo clic en el engranaje (⚙️) antes de continuar. ¡Es 100% gratis!</div>';
                return;
            }

            // Petición a OpenRouter usando el modelo Gemini 2.5 Flash gratuito
            const url = "https://openrouter.ai/api/v1/chat/completions";
            console.log("Copilot: Enviando consulta a OpenRouter (openrouter/free)...");
            const apiResponse = await fetch(url, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${key}`
                },
                body: JSON.stringify({
                    model: "openrouter/free",
                    messages: [
                        { role: "user", content: promptText }
                    ]
                })
            });

            console.log(`Copilot: Respuesta de OpenRouter recibida con estado ${apiResponse.status}`);

            if (!apiResponse.ok) {
                const errText = await apiResponse.text();
                throw new Error(errText || `Código de estado: ${apiResponse.status}`);
            }

            const json = await apiResponse.json();
            if (!json.choices || json.choices.length === 0) {
                throw new Error("No choices returned from OpenRouter.");
            }
            const choice = json.choices[0];
            if (choice.message && choice.message.refusal) {
                throw new Error(choice.message.refusal);
            }
            const aiText = choice.message?.content || "";
            console.log("Copilot: Análisis completado con éxito de OpenRouter.");
            showAnalysis(aiText);

        } else {
            // Proveedor: Google AI Studio directo
            const activeKey = result.geminiApiKey || DEFAULT_GEMINI_KEY;
            const isCustomKey = !!result.geminiApiKey;
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${activeKey}`;

            console.log(`Copilot: Realizando fetch a Gemini API directo...`);
            const apiResponse = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [{ text: promptText }]
                    }]
                })
            });

            console.log(`Copilot: Respuesta de Gemini recibida con estado ${apiResponse.status}`);

            if (!apiResponse.ok) {
                let detailedError = "";
                try {
                    const errorJson = await apiResponse.json();
                    detailedError = errorJson.error?.message || JSON.stringify(errorJson);
                } catch (_) {
                    detailedError = apiResponse.statusText || `Código de estado: ${apiResponse.status}`;
                }
                if ((apiResponse.status === 429 || apiResponse.status === 400 || detailedError.includes("quota")) && !isCustomKey) {
                    detailedError += "\n\n💡 Consejo: La API Key por defecto ha agotado su cuota gratuita. Te recomendamos cambiar de proveedor a OpenRouter (⚙️) para usar su versión gratuita ilimitada.";
                }
                throw new Error(detailedError);
            }

            const resJson = await apiResponse.json();
            if (!resJson.candidates || resJson.candidates.length === 0) {
                throw new Error("No candidates returned from Gemini API.");
            }
            const aiText = resJson.candidates[0].content?.parts?.[0]?.text || "";
            console.log("Copilot: Análisis completado con éxito de Gemini directo.");
            showAnalysis(aiText);
        }
    } catch (e) {
        console.error("Copilot: Excepción capturada en click handler:", e);
        showError("Error:", e.message);
    }
});