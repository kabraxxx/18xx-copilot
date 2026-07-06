# 🚂 ChooChooCopilotBot — Asistente de Telegram para 18xx.games

Este bot de Telegram te ofrece consejos estratégicos en tiempo real para tus partidas en curso de **18xx.games** utilizando inteligencia artificial (Google Gemini).

## 🚀 Requisitos previos

1. **Node.js** instalado en tu sistema (versión 18 o superior recomendada).
2. Un token de bot de Telegram. Puedes crear uno de forma gratuita hablando con [@BotFather](https://t.me/BotFather) en Telegram.
3. Una API Key de **Google AI Studio** (Gemini API) si deseas usar tu clave propia, o puedes usar la clave por defecto preconfigurada.

---

## 🛠️ Configuración

1. Abre el archivo `.env` en este directorio con tu editor de texto preferido.
2. Agrega el Token que te dio `@BotFather` en la variable `TELEGRAM_BOT_TOKEN`:
   ```env
   TELEGRAM_BOT_TOKEN=tu_token_aqui_generado_por_botfather
   ```
3. *(Opcional)* Agrega tu propia API Key de Gemini en la variable `GEMINI_API_KEY`:
   ```env
   GEMINI_API_KEY=tu_clave_de_gemini_aqui
   ```

---

## 📥 Instalación y Ejecución

Abre tu terminal (PowerShell o Git Bash) en el directorio `telegram-bot` y ejecuta los siguientes comandos:

1. **Instalar las dependencias:**
   ```bash
   npm install
   ```

2. **Iniciar el bot:**
   ```bash
   npm start
   ```

Deberías ver el mensaje:
`🚀 ¡ChooChooCopilotBot está en marcha y listo para recibir partidas!`

---

## 🤖 Cómo usar el bot en Telegram

Busca tu bot en Telegram (por ejemplo, el bot que has creado) e inicia una conversación:

1. Escribe `/start` para recibir el saludo e instrucciones iniciales.
2. Vincula tu usuario de 18xx con el comando:
   ```text
   /username tu_nombre_en_18xx
   ```
3. Envía el enlace de cualquier partida pública de 18xx.games, por ejemplo:
   ```text
   https://18xx.games/game/254383
   ```
   *O alternativamente, solo el ID numérico de la partida:*
   ```text
   254383
   ```
4. El bot responderá en segundos con 3 sugerencias estratégicas personalizadas para ti.
