import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";
import express from "express";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const agentReference = (agentName) => ({
  body: {
    agent_reference: {
      name: agentName,
      type: "agent_reference",
    },
  },
});

const maxAttachmentBytes = 5 * 1024 * 1024;
const allowedAttachmentTypes = new Set([
  "application/pdf",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const allowedExtensionsByType = {
  "application/pdf": [".pdf"],
  "image/gif": [".gif"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
};

function isSupportedFileContent(buffer, mimeType) {
  switch (mimeType) {
    case "application/pdf":
      return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
    case "image/gif": {
      const signature = buffer.subarray(0, 6).toString("ascii");
      return signature === "GIF87a" || signature === "GIF89a";
    }
    case "image/jpeg":
      return (
        buffer.length >= 3 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff
      );
    case "image/png":
      return buffer.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
    case "image/webp":
      return (
        buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
        buffer.subarray(8, 12).toString("ascii") === "WEBP"
      );
    default:
      return false;
  }
}

function validateAttachment(attachment) {
  if (
    !attachment ||
    typeof attachment !== "object" ||
    typeof attachment.name !== "string" ||
    typeof attachment.mime_type !== "string" ||
    typeof attachment.data !== "string"
  ) {
    return { error: "El archivo adjunto no es válido." };
  }

  const filename = attachment.name
    .replace(/[\\/\u0000-\u001f\u007f]/g, "_")
    .trim()
    .slice(0, 255);
  const mimeType = attachment.mime_type.toLowerCase();
  const extension = extname(filename).toLowerCase();
  const dataUrlPrefix = `data:${mimeType};base64,`;

  if (
    filename.length === 0 ||
    !allowedAttachmentTypes.has(mimeType) ||
    !allowedExtensionsByType[mimeType].includes(extension) ||
    !attachment.data.startsWith(dataUrlPrefix)
  ) {
    return { error: "Solo se permiten archivos PDF o imágenes compatibles." };
  }

  const base64 = attachment.data.slice(dataUrlPrefix.length);
  const paddingStart = base64.indexOf("=");
  const hasValidPadding =
    paddingStart === -1 ||
    (paddingStart >= base64.length - 2 &&
      /^=+$/.test(base64.slice(paddingStart)));
  if (
    base64.length === 0 ||
    base64.length > Math.ceil(maxAttachmentBytes / 3) * 4 ||
    base64.length % 4 !== 0 ||
    !hasValidPadding ||
    /[^A-Za-z0-9+/=]/.test(base64)
  ) {
    return { error: "El archivo debe tener un tamaño máximo de 5 MB." };
  }

  const fileBuffer = Buffer.from(base64, "base64");
  if (fileBuffer.length === 0 || fileBuffer.length > maxAttachmentBytes) {
    return { error: "El archivo debe tener un tamaño máximo de 5 MB." };
  }
  if (!isSupportedFileContent(fileBuffer, mimeType)) {
    return { error: "El contenido del archivo no coincide con su formato." };
  }

  return {
    value: {
      filename,
      mimeType,
      dataUrl: attachment.data,
    },
  };
}

export function createApp({ openai, agentName }) {
  if (!openai || !agentName) {
    throw new Error("Se requieren un cliente de Foundry y el nombre del agente.");
  }

  const app = express();
  const smallJsonParser = express.json({ limit: "16kb" });
  app.use((request, response, next) => {
    if (request.path === "/api/chat") {
      next();
      return;
    }
    smallJsonParser(request, response, next);
  });
  app.use(express.static(resolve(import.meta.dirname, "public")));

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.post(
    "/api/chat",
    express.json({ limit: "7mb" }),
    async (request, response) => {
      const {
        message: suppliedMessage,
        conversation_id: suppliedConversationId,
        attachment: suppliedAttachment,
      } = request.body ?? {};

      if (
        typeof suppliedMessage !== "string" ||
        suppliedMessage.trim().length === 0 ||
        suppliedMessage.length > 2000
      ) {
        response.status(422).json({
          error: "El mensaje debe tener entre 1 y 2000 caracteres.",
        });
        return;
      }

      const message = suppliedMessage.trim();

      if (
        suppliedConversationId !== undefined &&
        (typeof suppliedConversationId !== "string" ||
          suppliedConversationId.trim().length === 0)
      ) {
        response.status(422).json({ error: "La conversación no es válida." });
        return;
      }

      let attachment;
      if (suppliedAttachment !== undefined) {
        const validatedAttachment = validateAttachment(suppliedAttachment);
        if (validatedAttachment.error) {
          response.status(422).json({ error: validatedAttachment.error });
          return;
        }
        attachment = validatedAttachment.value;
      }

      try {
        const conversationId =
          suppliedConversationId ??
          (await openai.conversations.create()).id;
        const input = attachment
          ? [
              {
                role: "user",
                content: [
                  {
                    type: "input_text",
                    text: message,
                  },
                  attachment.mimeType === "application/pdf"
                    ? {
                        type: "input_file",
                        filename: attachment.filename,
                        file_data: attachment.dataUrl,
                      }
                    : {
                        type: "input_image",
                        image_url: attachment.dataUrl,
                        detail: "auto",
                      },
                ],
              },
            ]
          : message;
        const result = await openai.responses.create(
          { conversation: conversationId, input },
          agentReference(agentName),
        );

        if (typeof result.output_text !== "string") {
          throw new Error("Foundry devolvió una respuesta sin texto.");
        }

        response.json({
          answer: result.output_text,
          conversation_id: conversationId,
        });
      } catch (error) {
        console.error(
          "No se pudo completar la solicitud de Foundry:",
          error?.name ?? "Error",
        );
        response.status(502).json({
          error: "No fue posible procesar tu mensaje en este momento.",
        });
      }
    },
  );

  app.use((error, _request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    if (error?.type === "entity.too.large") {
      response.status(413).json({
        error: "La solicitud o el archivo supera el límite permitido de 5 MB.",
      });
      return;
    }

    if (error instanceof SyntaxError && "body" in error) {
      response
        .status(400)
        .json({ error: "La solicitud no tiene un formato válido." });
      return;
    }

    next(error);
  });

  return app;
}

async function startServer() {
  const projectEndpoint = process.env.FOUNDRY_PROJECT_ENDPOINT?.trim();
  const agentName = process.env.FOUNDRY_AGENT_NAME?.trim();

  if (!projectEndpoint || !agentName) {
    throw new Error(
      "Configura FOUNDRY_PROJECT_ENDPOINT y FOUNDRY_AGENT_NAME antes de iniciar el servidor.",
    );
  }

  const projectClient = new AIProjectClient(
    projectEndpoint,
    new DefaultAzureCredential(),
  );
  const openai = projectClient.getOpenAIClient();
  const app = createApp({ openai, agentName });
  const port = process.env.PORT || 3000;

  app.listen(port, () => {
    console.log(`Servidor listo en el puerto ${port}.`);
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await startServer();
}
