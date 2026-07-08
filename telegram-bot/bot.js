import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import http from 'http';
import fs from 'fs';
import path from 'path';

// Helper para realizar peticiones HTTP con un límite de tiempo (timeout)
const fetchWithTimeout = async (url, options = {}, timeout = 8000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
};

// Cargar variables de entorno
dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DEFAULT_GEMINI_KEY = "AIzaSyBT62DXP6fb6tRZWu7waoS4Bkt4U_NQZHs";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || DEFAULT_GEMINI_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!BOT_TOKEN) {
  console.error("❌ ERROR: La variable de entorno TELEGRAM_BOT_TOKEN no está configurada en el archivo .env.");
  process.exit(1);
}

// Base de datos en archivo local para persistir el usuario de 18xx.games asociado a cada chat
const SESSIONS_FILE = path.join(process.cwd(), 'sessions.json');
let userSessions = new Map();

try {
  if (fs.existsSync(SESSIONS_FILE)) {
    const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    userSessions = new Map(Object.entries(data));
    console.log(`💾 Sesiones cargadas desde el disco: ${userSessions.size} usuarios.`);
  }
} catch (e) {
  console.warn("⚠️ No se pudieron cargar las sesiones desde el disco:", e.message);
}

function saveSessions() {
  try {
    const obj = Object.fromEntries(userSessions);
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) {
    console.warn("⚠️ No se pudieron guardar las sesiones en el disco:", e.message);
  }
}

function escapeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Convierte formateo Markdown simple a HTML seguro para Telegram
function formatMarkdownToHtml(text) {
  if (!text) return "";
  let safeText = escapeHtml(text);

  // 1. Primero ***negrita+cursiva*** (debe ir antes que ** y *)
  safeText = safeText.replace(/\*\*\*(.*?)\*\*\*/gs, '<b><i>$1</i></b>');
  // 2. Luego **negrita**
  safeText = safeText.replace(/\*\*(.*?)\*\*/gs, '<b>$1</b>');
  // 3. Luego *cursiva* o _cursiva_ (solo si no quedan asteriscos sueltos de lo anterior)
  safeText = safeText.replace(/\*(.*?)\*/gs, '<i>$1</i>');
  safeText = safeText.replace(/_(.*?)_/gs, '<i>$1</i>');
  // 4. `código`
  safeText = safeText.replace(/`(.*?)`/g, '<code>$1</code>');
  // 5. ### Encabezados → <b>
  safeText = safeText.replace(/^#{1,3}\s+(.*?)$/gm, '<b>$1</b>');

  return safeText;
}

// Formatea el nombre de la fase (Stock Round / Operating Round) incluyendo el turno y sub-turno
function formatRound(round, turn) {
  if (!round) return "";
  const roundLower = round.toLowerCase();
  
  if (roundLower.includes("stock")) {
    return `Stock Round ${turn}`;
  }
  
  if (roundLower.includes("operating")) {
    // Si contiene un número de OR, ej: "Operating Round 1" -> extraemos el 1
    const match = round.match(/\d+/);
    const orNum = match ? match[0] : "1";
    return `Operating Round ${turn}.${orNum}`;
  }
  
  return `${round} ${turn}`;
}

const bot = new Telegraf(BOT_TOKEN);

// Comando de inicio
bot.start((ctx) => {
  const username = ctx.from.first_name || "maquinista";
  ctx.reply(
    `🚂 <b>¡Hola, ${username}! Bienvenido a ChooChooCopilotBot.</b>\n\n` +
    `Soy tu asistente estratégico de IA para partidas de <b>18xx.games</b>.\n\n` +
    `<b>¿Cómo usarme?</b>\n` +
    `1. Envía el enlace de una partida en curso (ej: <code>https://18xx.games/game/254383</code>) o simplemente el ID numérico de la partida (ej: <code>254383</code>).\n` +
    `2. Si es una partida privada o el servidor de 18xx.games da timeout, puedes **descargar el JSON de la partida** (desde la pestaña 'Tools' en 18xx.games) y **subir el archivo .json** directamente a este chat.\n` +
    `3. Analizaré el estado actual y te daré 3 consejos estratégicos clave.\n\n` +
    `<b>Comandos útiles:</b>\n` +
    `• /username [tu_usuario] - Asocia tu nombre de 18xx.games para recibir consejos personalizados.\n` +
    `• /myusername - Consulta qué nombre de usuario tienes asociado.\n` +
    `• /clear - Elimina tu nombre de usuario asociado.\n` +
    `• /help - Muestra la ayuda y el funcionamiento.`,
    { parse_mode: 'HTML' }
  );
});

// Ayuda
bot.help((ctx) => {
  ctx.reply(
    `📖 <b>Ayuda de ChooChooCopilotBot</b>\n\n` +
    `• <b>Análisis de partida:</b> Envía un enlace de 18xx.games o un ID numérico de partida. El bot obtendrá los datos del juego de forma segura y consultará con Gemini.\n\n` +
    `• <b>Análisis por archivo JSON:</b> Si la partida es privada o hay problemas de conexión del servidor, descarga el JSON de la partida (pestaña 'Tools' en 18xx.games) y súbelo (.json) a este chat.\n\n` +
    `• <b>Asociar usuario:</b> Si usas <code>/username tu_usuario</code>, el bot sabrá quién eres. Así, cuando analice una partida:\n` +
    `   - Si es tu turno, te dará consejos directos para tu jugada.\n` +
    `   - Si no es tu turno, te dirá de quién es y te dará consejos de planificación para cuando te toque.\n\n` +
    `<b>Ejemplos de enlace de partida:</b>\n` +
    `• <code>https://18xx.games/game/254383</code>\n` +
    `• <code>254383</code>\n\n` +
    `💡 <i>Nota: Para que el análisis por enlace funcione, la partida debe ser pública. Para partidas privadas, usa la subida del archivo .json.</i>`,
    { parse_mode: 'HTML' }
  );
});

// Guardar nombre de usuario
bot.command('username', (ctx) => {
  const text = ctx.message.text;
  const args = text.split(/\s+/).slice(1);
  const targetUser = args.join(' ').trim();

  if (!targetUser) {
    return ctx.reply("⚠️ Por favor, especifica tu nombre de usuario de 18xx.games.\nEjemplo: /username Daniel");
  }

  const chatId = ctx.chat.id;
  userSessions.set(chatId.toString(), targetUser);
  saveSessions();
  ctx.reply(`✅ Guardado: Ahora te identificaré como *${targetUser}* en tus partidas analizadas.`);
});

// Ver nombre de usuario actual
bot.command('myusername', (ctx) => {
  const chatId = ctx.chat.id;
  const targetUser = userSessions.get(chatId.toString());

  if (targetUser) {
    ctx.reply(`Tu usuario asociado actual de 18xx.games es: ${targetUser}`);
  } else {
    ctx.reply("No tienes ningún usuario asociado. Usa /username tu_usuario para configurar uno.");
  }
});

// Limpiar nombre de usuario
bot.command('clear', (ctx) => {
  const chatId = ctx.chat.id;
  if (userSessions.has(chatId.toString())) {
    userSessions.delete(chatId.toString());
    saveSessions();
    ctx.reply("🧹 Se ha eliminado tu nombre de usuario asociado.");
  } else {
    ctx.reply("No tenías ningún usuario asociado.");
  }
});

// Obtener ID del chat
bot.command('mychatid', (ctx) => {
  ctx.reply(
    `ℹ️ <b>Tu ID de chat de Telegram es:</b> <code>${ctx.chat.id}</code>\n\n` +
    `Copia este número para configurar las notificaciones automáticas en 18xx.games.`,
    { parse_mode: 'HTML' }
  );
});

// Función para realizar el análisis estratégico de una partida y enviar el resultado a Telegram (descarga desde URL)
async function analyzeAndReply(gameId, chatId, targetMsgId = null, manualUsername = "") {
  const jsonUrl = `https://18xx.games/api/game/${gameId}`;
  console.log(`[Bot] Obteniendo JSON de la partida desde: ${jsonUrl}`);

  let response;
  try {
    response = await fetchWithTimeout(jsonUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    }, 10000); // 10 segundos de timeout
  } catch (fetchErr) {
    console.error(`[Bot] Error de red al consultar la API de 18xx.games:`, fetchErr);
    throw new Error(`Timeout o error de red al conectar con 18xx.games. El servidor de 18xx.games suele bloquear o dar timeout a servidores en la nube (como Render/AWS). Te sugerimos descargar el archivo .json de la partida y subirlo directamente a este chat.`);
  }

  if (!response.ok) {
    if (response.status === 404 || response.status === 403 || response.status === 401) {
      throw new Error(`No se pudo acceder a la partida (Código: ${response.status}). Asegúrate de que la partida sea pública. Si la partida es privada, descarga el archivo .json de la partida en tu navegador y súbelo a este chat.`);
    }
    throw new Error(`No se pudo obtener la partida (Código: ${response.status})`);
  }

  const gameData = await response.json();
  await analyzeGameDataAndReply(gameData, gameId, chatId, targetMsgId, manualUsername);
}

// Analizar un objeto de datos de partida (JSON) ya obtenido y responder
async function analyzeGameDataAndReply(gameData, gameId, chatId, targetMsgId = null, manualUsername = "") {
  let targetInstructions = '';
  const targetUsername = manualUsername || userSessions.get(chatId.toString());

  const generalInstructions = `
Calcula y muestra el dinero (Cash) y el valor neto (Worth) estimado de cada uno de los jugadores (incluyendo el orden de mayor a menor valor de Worth) al inicio de tu respuesta en una sección estructurada.`;

  if (targetUsername) {
    targetInstructions = `El usuario al que debes ayudar es "${targetUsername}". Identifica cuál es su ID en la lista de jugadores ("players") y analiza su situación actual en la partida.${generalInstructions}
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
    targetInstructions = `Determina de qué jugador es el turno actual (campo "acting" y las últimas acciones).${generalInstructions}
- Identifica el tipo de ronda actual ("round").
- Recomienda las 3 mejores opciones o movimientos para el jugador activo, justificando cuál de ellas es la mejor decisión estratégica inmediata (acciones a realizar en la ronda actual).`;
  }

  // Limitar y limpiar el historial de acciones (máximo 100) para optimizar el contexto en modelos gratuitos
  const prunedGameData = { ...gameData };
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

  let aiText = "";

  if (OPENROUTER_API_KEY) {
    // Llamar a OpenRouter API (modelo free)
    const openRouterUrl = "https://openrouter.ai/api/v1/chat/completions";
    console.log("[Bot] Enviando petición a OpenRouter (openrouter/free)...");
    
    const apiResponse = await fetch(openRouterUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`
      },
      body: JSON.stringify({
        model: "openrouter/free",
        messages: [
          { role: "user", content: promptText }
        ]
      })
    });

    if (!apiResponse.ok) {
      const errText = await apiResponse.text();
      throw new Error(`OpenRouter Error: ${errText || apiResponse.status}`);
    }

    const resJson = await apiResponse.json();
    if (!resJson.choices || resJson.choices.length === 0) {
      throw new Error("No choices returned from OpenRouter.");
    }
    const choice = resJson.choices[0];
    if (choice.message && choice.message.refusal) {
      throw new Error(choice.message.refusal);
    }
    aiText = choice.message?.content || "";
    console.log("[Bot] Análisis completado con éxito desde OpenRouter.");

  } else {
    // Llamar a Gemini API directo (gemini-2.0-flash)
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
    console.log("[Bot] Enviando petición a Gemini API...");
    
    const apiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: promptText }]
        }]
      })
    });

    if (!apiResponse.ok) {
      let detailedError = "";
      try {
        const errorJson = await apiResponse.json();
        detailedError = errorJson.error?.message || JSON.stringify(errorJson);
      } catch (_) {
        detailedError = apiResponse.statusText || `Código de estado: ${apiResponse.status}`;
      }
      throw new Error(`Gemini Error: ${detailedError}`);
    }

    const resJson = await apiResponse.json();
    if (!resJson.candidates || resJson.candidates.length === 0) {
      throw new Error("No se recibió respuesta del análisis de Gemini.");
    }
    aiText = resJson.candidates[0].content?.parts?.[0]?.text || "";
    console.log("[Bot] Análisis completado con éxito desde Gemini directo.");
  }

  const gameTitle = gameData.title || "18xx";
  const gameDesc = gameData.description || "";
  const formattedRound = formatRound(gameData.round, gameData.turn);
  const formattedAiText = formatMarkdownToHtml(aiText);

  let finalMessage = `📋 <b>Análisis Estratégico [${gameTitle}]</b>\n` +
                       `🎮 <i>${gameDesc}</i>\n` +
                       `📅 <b>Fase:</b> ${formattedRound}\n`;
  if (gameId) {
    finalMessage += `🔗 <a href="https://18xx.games/game/${gameId}">Abrir partida #${gameId}</a>\n\n`;
  } else {
    finalMessage += `🔗 <i>Partida cargada localmente por archivo</i>\n\n`;
  }
  finalMessage += `${formattedAiText}`;

  if (targetMsgId) {
    await bot.telegram.editMessageText(
      chatId,
      targetMsgId,
      null,
      finalMessage,
      { parse_mode: 'HTML', disable_web_page_preview: true }
    );
  } else {
    await bot.telegram.sendMessage(
      chatId,
      finalMessage,
      { parse_mode: 'HTML', disable_web_page_preview: true }
    );
  }
}

// Escuchar mensajes de texto para detectar enlaces o IDs de partidas
bot.on('text', async (ctx) => {
  const messageText = ctx.message.text.trim();

  // Expresiones regulares para detectar URLs de 18xx.games o IDs numéricos de 5 a 8 dígitos
  const urlRegex = /18xx\.games\/game\/(\d+)/i;
  const idRegex = /(?:^|\s)(\d{5,8})(?:\s|$)/;

  let gameId = null;
  let manualUsername = "";

  const urlMatch = messageText.match(urlRegex);
  if (urlMatch) {
    gameId = urlMatch[1];
    // Intentar extraer el nombre de usuario de lo restante del mensaje
    manualUsername = messageText.replace(urlMatch[0], '').replace(/https?:\/\//gi, '').replace(/\s+/g, ' ').trim();
  } else {
    const idMatch = messageText.match(idRegex);
    if (idMatch) {
      gameId = idMatch[1];
      manualUsername = messageText.replace(idMatch[1], '').replace(/\s+/g, ' ').trim();
    }
  }

  // Si no coincide con un patrón de partida, no hacemos nada (permitimos flujo normal)
  if (!gameId) {
    return;
  }

  // Enviar mensaje de "cargando"
  const statusMsg = await ctx.reply("🔌 Conectando con 18xx.games y analizando la partida...");

  try {
    await analyzeAndReply(gameId, ctx.chat.id, statusMsg.message_id, manualUsername);
    console.log(`[Bot] Análisis completado con éxito para la partida #${gameId}.`);
  } catch (err) {
    console.error(`[Bot] Error procesando partida:`, err);
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      null,
      `❌ Error al analizar la partida: ${err.message}`
    );
  }
});

// Escuchar cuando el usuario sube un archivo (para analizar partidas privadas vía JSON descargado)
bot.on('document', async (ctx) => {
  const doc = ctx.message.document;
  
  if (!doc.file_name || !doc.file_name.toLowerCase().endsWith('.json')) {
    // Si no es un JSON, ignoramos para no interferir con otros archivos
    return;
  }

  const statusMsg = await ctx.reply("📥 Procesando archivo JSON y analizando partida...");

  try {
    const fileId = doc.file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId);
    
    const res = await fetch(fileLink.href);
    if (!res.ok) {
      throw new Error(`Error al descargar el archivo desde Telegram (Status: ${res.status})`);
    }
    
    const gameData = await res.json();
    
    // Verificar si tiene estructura mínima de partida de 18xx
    if (!gameData || (!gameData.id && !gameData.players)) {
      throw new Error("El archivo JSON no parece ser una partida válida de 18xx.games (falta ID o jugadores).");
    }

    const gameId = gameData.id || null;
    
    await analyzeGameDataAndReply(gameData, gameId, ctx.chat.id, statusMsg.message_id);
    console.log(`[Bot] Análisis completado con éxito mediante archivo JSON para la partida ${gameId || 'Local'}.`);
  } catch (err) {
    console.error(`[Bot] Error procesando archivo JSON:`, err);
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      null,
      `❌ Error al procesar el archivo JSON: ${err.message}\n\n💡 Asegúrate de que el archivo JSON haya sido descargado directamente de la pestaña 'Tools' de tu partida en 18xx.games.`
    );
  }
});

// Servidor HTTP simple para responder a los pings de Render y recibir Webhooks de 18xx.games
const PORT = process.env.PORT || 8080;
const server = http.createServer((req, res) => {
  console.log(`[HTTP] Petición recibida: ${req.method} ${req.url}`);
  const cleanUrl = req.url.split('?')[0].replace(/\/$/, '');
  if (req.method === 'POST' && cleanUrl === '/webhook') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        console.log("[Webhook] Petición recibida de 18xx.games:", payload);
        
        // El payload de 18xx es { text: "<@UserWebhookId> Mensaje..." }
        const text = payload.text || "";
        const chatMatch = text.match(/<@(\d+)>/);
        const gameMatch = text.match(/game\/(\d+)/i) || text.match(/#(\d+)/);
        
        if (chatMatch) {
          const chatId = chatMatch[1];
          if (gameMatch) {
            const gameId = gameMatch[1];
            console.log(`[Webhook] Notificación de turno para el chat ${chatId} en la partida #${gameId}`);
            
            // Pre-obtener los metadatos de la partida (título y descripción) para la notificación inicial
            let gameTitle = "18xx";
            let gameDesc = "";
            
            // Intentar parsear el título y la descripción directamente del texto del webhook
            // Soporta múltiples formatos de 18xx.games (con comillas, "game #ID" y paréntesis)
            const webhookText = text.trim();
            const turnMatch = webhookText.match(/your\s+turn\s+in\s+(.+)/i);
            if (turnMatch) {
              const line = turnMatch[1].split('\n')[0].trim();
              
              const quoteMatch = line.match(/^([^"]+)"([^"]+)"/);
              if (quoteMatch) {
                gameTitle = quoteMatch[1].trim();
                gameDesc = quoteMatch[2].trim();
                
                const extraMatch = line.match(/\(([^)]+)\)\s*$/);
                if (extraMatch) {
                  gameDesc += ` (${extraMatch[1].trim()})`;
                }
              } else {
                const gameRegexMatch = line.match(/^(.+?)\s+game\s+#\d+/i);
                if (gameRegexMatch) {
                  gameTitle = gameRegexMatch[1].trim();
                  
                  const parenMatch = line.match(/\(([^)]+)\)\s*$/);
                  if (parenMatch) {
                    gameDesc = parenMatch[1].trim();
                  }
                } else {
                  gameTitle = line;
                }
              }
            }

            try {
              const res = await fetchWithTimeout(`https://18xx.games/api/game/${gameId}`, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                  'Accept': 'application/json'
                }
              }, 5000); // 5 segundos de timeout
              if (res.ok) {
                const data = await res.json();
                gameTitle = data.title || gameTitle;
                gameDesc = data.description || gameDesc;
              }
            } catch (err) {
              console.warn("⚠️ No se pudo pre-obtener datos de la partida:", err.message);
            }

            // Enviar alerta inicial al chat con un botón en línea para analizar a demanda (no automático)
            await bot.telegram.sendMessage(
              chatId, 
              `🔔 <b>¡Es tu turno en 18xx.games!</b>\n` +
              `🎮 <b>Partida:</b> [${gameTitle}] ${gameDesc ? `<i>${gameDesc}</i>` : ''}\n` +
              `🔗 <a href="https://18xx.games/game/${gameId}">Abrir partida #${gameId}</a>`, 
              { 
                parse_mode: 'HTML', 
                disable_web_page_preview: true,
                reply_markup: {
                  inline_keyboard: [
                    [
                      { text: "📊 Analizar partida con IA", callback_data: `analyze:${gameId}` }
                    ]
                  ]
                }
              }
            );
          } else {
            console.log(`[Webhook] Notificación de prueba recibida para el chat ${chatId}`);
            await bot.telegram.sendMessage(
              chatId,
              `🔔 <b>¡Conexión exitosa!</b> Has recibido una notificación de prueba de 18xx.games. Tu webhook y Chat ID están correctamente vinculados.`,
              { parse_mode: 'HTML' }
            );
          }
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        console.error("[Webhook] Error al procesar webhook:", err);
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Error processing webhook payload\n');
      }
    });
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ChooChooCopilotBot is running!\n');
  }
});
server.listen(PORT, () => {
  console.log(`📡 Servidor de salud y webhooks escuchando en el puerto ${PORT}`);
});

// Manejar la acción del botón inline para analizar la partida a demanda
bot.action(/^analyze:(\d+)$/, async (ctx) => {
  const gameId = ctx.match[1];
  const chatId = ctx.chat.id;

  try {
    // Editar el mensaje original para quitar el botón y evitar pulsaciones múltiples
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    
    // Avisar que se inicia el análisis
    const statusMsg = await ctx.reply("⏳ Analizando tablero para sugerirte movimientos...");
    
    // Ejecutar análisis estratégico
    await analyzeAndReply(gameId, chatId, statusMsg.message_id);
    
    // Confirmar callback de Telegram
    await ctx.answerCbQuery("Análisis completado");
  } catch (err) {
    console.error("[Bot] Error en callback de análisis:", err);
    await ctx.reply(`❌ Error en el análisis de tu turno: ${err.message}`);
    await ctx.answerCbQuery("Error al analizar");
  }
});

// Lanzar el bot
bot.launch().then(() => {
  console.log("🚀 ¡ChooChooCopilotBot está en marcha y listo para recibir partidas y webhooks!");
}).catch((err) => {
  console.error("❌ Fallo al iniciar el bot de Telegram:", err);
});

// Manejo seguro del apagado del bot
process.once('SIGINT', () => {
  server.close();
  bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
  server.close();
  bot.stop('SIGTERM');
});
