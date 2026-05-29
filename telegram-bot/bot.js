import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import http from 'http';

// Cargar variables de entorno
dotenv.config();


const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DEFAULT_GEMINI_KEY = "AIzaSyBT62DXP6fb6tRZWu7waoS4Bkt4U_NQZHs";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || DEFAULT_GEMINI_KEY;

if (!BOT_TOKEN) {
  console.error("❌ ERROR: La variable de entorno TELEGRAM_BOT_TOKEN no está configurada en el archivo .env.");
  process.exit(1);
}

// Base de datos en memoria para guardar el usuario de 18xx.games asociado a cada chat de Telegram
const userSessions = new Map();

const bot = new Telegraf(BOT_TOKEN);

// Comando de inicio
bot.start((ctx) => {
  const username = ctx.from.first_name || "maquinista";
  ctx.reply(
    `🚂 ¡Hola, ${username}! Bienvenido a *ChooChooCopilotBot*.\n\n` +
    `Soy tu asistente estratégico de IA para partidas de *18xx.games*.\n\n` +
    `*¿Cómo usarme?*\n` +
    `1. Envía el enlace de una partida en curso (ej: \`https://18xx.games/game/254383\`) o simplemente el ID numérico de la partida (ej: \`254383\`).\n` +
    `2. Analizaré el estado actual y te daré 3 consejos estratégicos clave.\n\n` +
    `*Comandos útiles:*\n` +
    `• /username <tu_usuario> - Asocia tu nombre de 18xx.games para recibir consejos personalizados.\n` +
    `• /myusername - Consulta qué nombre de usuario tienes asociado.\n` +
    `• /clear - Elimina tu nombre de usuario asociado.\n` +
    `• /help - Muestra la ayuda y el funcionamiento.`,
    { parse_mode: 'Markdown' }
  );
});

// Ayuda
bot.help((ctx) => {
  ctx.reply(
    `📖 *Ayuda de ChooChooCopilotBot*\n\n` +
    `• *Análisis de partida:* Envía un enlace de 18xx.games o un ID numérico de partida. El bot obtendrá los datos del juego de forma segura y consultará con Gemini.\n\n` +
    `• *Asociar usuario:* Si usas \`/username tu_usuario\`, el bot sabrá quién eres. Así, cuando analice una partida:\n` +
    `   - Si es tu turno, te dará consejos directos para tu jugada.\n` +
    `   - Si no es tu turno, te dirá de quién es y te dará consejos de planificación para cuando te toque.\n\n` +
    `*Ejemplos de enlace de partida:*\n` +
    `• \`https://18xx.games/game/254383\`\n` +
    `• \`254383\`\n\n` +
    `💡 _Nota: Para que el análisis funcione, la partida debe ser pública en 18xx.games._`,
    { parse_mode: 'Markdown' }
  );
});

// Guardar nombre de usuario
bot.command('username', (ctx) => {
  const text = ctx.message.text;
  const args = text.split(/\s+/).slice(1);
  const targetUser = args.join(' ').trim();

  if (!targetUser) {
    return ctx.reply("⚠️ Por favor, especifica tu nombre de usuario de 18xx.games.\nEjemplo: `/username Daniel`", { parse_mode: 'Markdown' });
  }

  const chatId = ctx.chat.id;
  userSessions.set(chatId, targetUser);
  ctx.reply(`✅ Guardado: Ahora te identificaré como *${targetUser}* en tus partidas analizadas.`, { parse_mode: 'Markdown' });
});

// Ver nombre de usuario actual
bot.command('myusername', (ctx) => {
  const chatId = ctx.chat.id;
  const targetUser = userSessions.get(chatId);

  if (targetUser) {
    ctx.reply(`Tu usuario asociado actual de 18xx.games es: *${targetUser}*`, { parse_mode: 'Markdown' });
  } else {
    ctx.reply("No tienes ningún usuario asociado. Usa `/username tu_usuario` para configurar uno.");
  }
});

// Limpiar nombre de usuario
bot.command('clear', (ctx) => {
  const chatId = ctx.chat.id;
  if (userSessions.has(chatId)) {
    userSessions.delete(chatId);
    ctx.reply("🧹 Se ha eliminado tu nombre de usuario asociado.");
  } else {
    ctx.reply("No tenías ningún usuario asociado.");
  }
});

// Escuchar mensajes de texto para detectar enlaces o IDs de partidas
bot.on('text', async (ctx) => {
  const messageText = ctx.message.text.trim();

  // Expresiones regulares para detectar URLs de 18xx.games o IDs numéricos de 5 a 8 dígitos
  const urlRegex = /18xx\.games\/game\/(\d+)/i;
  const idRegex = /^\d{5,8}$/;

  let gameId = null;

  const urlMatch = messageText.match(urlRegex);
  if (urlMatch) {
    gameId = urlMatch[1];
  } else if (idRegex.test(messageText)) {
    gameId = messageText;
  }

  // Si no coincide con un patrón de partida, no hacemos nada (permitimos flujo normal)
  if (!gameId) {
    return;
  }

  // Enviar mensaje de "cargando"
  const statusMsg = await ctx.reply("🔌 Conectando con 18xx.games y analizando la partida con Gemini...");

  try {
    const jsonUrl = `https://18xx.games/game/${gameId}/json`;
    console.log(`[Bot] Obteniendo JSON de la partida desde: ${jsonUrl}`);

    const response = await fetch(jsonUrl);
    if (!response.ok) {
      throw new Error(`No se pudo obtener la partida (Código: ${response.status})`);
    }

    const gameData = await response.json();

    // Limitar el historial de acciones a las últimas 30 para optimizar el contexto
    const prunedGameData = { ...gameData };
    if (Array.isArray(prunedGameData.actions)) {
      prunedGameData.actions = prunedGameData.actions.slice(-30);
    }

    // Obtener configuración de usuario para este chat
    const chatId = ctx.chat.id;
    const targetUsername = userSessions.get(chatId);

    let targetInstructions = '';
    if (targetUsername) {
      targetInstructions = `El usuario al que debes ayudar es "${targetUsername}". Identifica cuál es su ID en la lista de jugadores ("players") y analiza su situación actual en la partida.
- Si actualmente es su turno (está en la lista "acting"), dale 3 consejos estratégicos prioritarios en español para su jugada.
- Si NO es su turno, indícale de quién es el turno actual y dale 3 consejos estratégicos de planificación y preparación para cuando le vuelva a tocar el turno, considerando las acciones recientes y su posición de cara al futuro.`;
    } else {
      targetInstructions = `Determina de qué jugador es el turno actual (campo "acting" y las últimas acciones) y dale 3 consejos estratégicos clave en español para su próximo movimiento (ya sea en Ronda de Acciones o de Operaciones).`;
    }

    const promptText = `Eres un experto jugador de juegos de mesa de la serie 18xx. Analiza el siguiente JSON con los datos generales y las últimas acciones de una partida en curso en 18xx.games.
${targetInstructions}

REGLAS DE FORMATO:
- Sé muy conciso, directo y estructurado en español.
- NO des respuestas matemáticas genéricas, NO uses fórmulas LaTeX, ni bloques como \\boxed{}.
- Escribe una respuesta textual clara y legible.

JSON de la partida (resumido):
${JSON.stringify(prunedGameData)}`;

    // Llamar a Gemini API (gemini-2.0-flash)
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
      throw new Error(detailedError);
    }

    const resJson = await apiResponse.json();
    if (!resJson.candidates || resJson.candidates.length === 0) {
      throw new Error("No se recibió respuesta del análisis de Gemini.");
    }

    const aiText = resJson.candidates[0].content?.parts?.[0]?.text || "";
    
    // Editar mensaje de estado con el veredicto final
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      null,
      `📋 *Análisis Estratégico (Partida #${gameId})*\n\n${aiText}`,
      { parse_mode: 'Markdown' }
    );

    console.log(`[Bot] Análisis completado con éxito para la partida #${gameId}.`);
  } catch (err) {
    console.error(`[Bot] Error procesando partida:`, err);
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      null,
      `❌ *Error al analizar la partida:* ${err.message}\n\n💡 _Asegúrate de que el enlace o ID sea correcto y que la partida sea pública._`,
      { parse_mode: 'Markdown' }
    );
  }
});

// Servidor HTTP simple para responder a los pings de Render (y así poder usar el plan gratuito Web Service)
const PORT = process.env.PORT || 8080;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ChooChooCopilotBot is running!\n');
});
server.listen(PORT, () => {
  console.log(`📡 Servidor de salud (ping) escuchando en el puerto ${PORT}`);
});

// Lanzar el bot
bot.launch().then(() => {
  console.log("🚀 ¡ChooChooCopilotBot está en marcha y listo para recibir partidas!");
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

