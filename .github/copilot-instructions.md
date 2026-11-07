# Instrucciones del proyecto: Chatbot Parking Dolphin en App Service

## Qué es este proyecto
Página web de una sola vista con un chatbot con IA. El frontend (HTML, CSS y JS sin frameworks) llama a un backennd node.js con Express y el backend conversa con un agente de Micrsoft Foundry. Se despliega en Azure App Services (Linux, Node 24 LTS)


## Diseño principal
  # Estacionamiento Dolphin
  Bienvenido a la página de Estacionamiento Dolphin. Somos un estacionamiento seguro y confiable, comprometido con brindar un servicio de calidad a nuestros clientes. Nuestro objetivo es ofrecer una experiencia de estacionamiento sin complicaciones, asegurando la comodidad y seguridad de su vehículo.
  Nuestro chatbot de IA está diseñado para ayudarlo a encontrar información sobre nuestros servicios, tarifas, horarios.
  ## Tarifas
 | Vehículo                     | Tarifa   |
 |:------------------------------|:-----------:|
 | Motocicleta                   | $15 pesos | 
 | Automóvil                     | $20 pesos | 
 | Camioneta                     | $25 pesos | 
 | Camioneta grande              | $40 pesos |
  ## Horario
 Lunes a sábado de 8:00 a 20:00 hrs. Domingos y días: festivos de 10:00 a 18:00 hrs.
  ## Ubicación
 Calle 2 poniente numero 911, Colonia Centro, Ciudad de Puebla C.P. 72000.

 ![Imagen de referencia de IA](https://www.instagram.com/popular/car-aesthetic-wallpaper-pinterest/)

## Entorno de desarrollo
- Windows 11 con PowerShell 7.
- Node.js 24 LTS y npm. Nada de Typescript ni buildders.

## Stack y versiones
- Express 5, ES Modules (`"type": "module"`), `async/await`.
- SDK de Foundry: `@azure/ai-projects` 2.x (API "Foundry projects (new)").
 No uses `@azure/ai-agents` ni la API 1.x.
- Autenticación: `DefaultAzureCredential` de `@azure/identity`.
- Variables de entorno en local con `node --env-file-if-exists=.env` (sin dotenv).

## Arquitectura (no la cambies sin preguntar)
- `server.js`: sirve `public/` en `/`, expone `POST /api/chat` y `GET /health`.
- El navegador NUNCA habla directo con Foundry. Solo el backend.
- Conversación multi-turno: `openai.conversations.create()` y
 `openai.responses.create({ conversation, input }, agentRef)`, donde
 `agentRef = { body: { agent_reference: { name, type: "agent_reference" } } }`.
 El `conversation_id` viaja entre frontend y backend en el JSON.
- El chat puede enviar un archivo PDF o una imagen compatible junto con el mensaje.
 El backend lo valida y lo envía a Microsoft Foundry para su análisis; no se guarda
 en una base de datos propia de Dolphin.
- El servidor escucha en `process.env.PORT` (App Service lo define).

## Seguridad
- Nunca escribas llaves, tokens ni endpoints reales en el código.
 Todo sale de variables de entorno: `FOUNDRY_PROJECT_ENDPOINT`, `FOUNDRY_AGENT_NAME`.
- En Azure se usa identidad administrada (managed identity), no API keys.
- Valida la entrada (1 a 2000 caracteres) y responde 422 si no cumple.
- Acepta únicamente PDF, JPEG, PNG, GIF o WEBP de hasta 5 MB; valida tipo y firma
 del contenido en el servidor.
- Si Foundry falla, responde 502 con un mensaje genérico; no filtres trazas.
## Estilo de código
- Comentarios en español neutro; nombres de variables en inglés.
- Cambios mínimos y enfocados: no reescribas archivos completos si basta editar.
## Cómo validar
- Local: `npm run dev` y abrir http://localhost:3000
- Salud: `Invoke-RestMethod http://localhost:3000/health` debe devolver `status: ok`
- Antes de desplegar, confirma que `package.json` incluye todo lo que se importa
 y que el script `start` es `node server.js`.