const form = document.querySelector("#chat-form");
const input = document.querySelector("#message-input");
const sendButton = document.querySelector("#send-button");
const messages = document.querySelector("#messages");
const suggestions = document.querySelectorAll(".suggestion");
const attachmentInput = document.querySelector("#attachment-input");
const attachmentPreview = document.querySelector("#attachment-preview");
const attachmentStatus = document.querySelector("#attachment-status");

const maxAttachmentBytes = 5 * 1024 * 1024;
const allowedFileTypes = new Map([
  ["application/pdf", [".pdf"]],
  ["image/gif", [".gif"]],
  ["image/jpeg", [".jpg", ".jpeg"]],
  ["image/png", [".png"]],
  ["image/webp", [".webp"]],
]);

let conversationId = null;
let isSending = false;
let selectedFile = null;

function appendMessage(text, sender) {
  const row = document.createElement("div");
  row.className = `message-row ${sender}-row`;

  const bubble = document.createElement("div");
  bubble.className = `message-bubble ${sender}-bubble`;
  bubble.textContent = text;

  row.append(bubble);
  messages.append(row);
  messages.scrollTop = messages.scrollHeight;
  return row;
}

function updateSendButtonState() {
  sendButton.disabled = isSending || input.value.trim().length === 0;
}

function renderAttachment() {
  attachmentPreview.replaceChildren();
  attachmentPreview.hidden = selectedFile === null;

  if (!selectedFile) {
    return;
  }

  const name = document.createElement("span");
  name.className = "attachment-name";
  name.textContent = selectedFile.file.name;

  const removeButton = document.createElement("button");
  removeButton.className = "remove-attachment";
  removeButton.type = "button";
  removeButton.textContent = "Quitar";
  removeButton.setAttribute(
    "aria-label",
    `Quitar archivo ${selectedFile.file.name}`,
  );
  removeButton.addEventListener("click", () => {
    selectedFile = null;
    attachmentInput.value = "";
    attachmentStatus.textContent = "Se quitó el archivo adjunto.";
    renderAttachment();
    updateSendButtonState();
  });

  attachmentPreview.append(name, removeButton);
}

function getFileMimeType(file) {
  const type = file.type.toLowerCase();
  if (allowedFileTypes.has(type)) {
    return type;
  }

  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  for (const [mimeType, extensions] of allowedFileTypes) {
    if (extensions.includes(extension)) {
      return mimeType;
    }
  }
  return null;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") {
        reject(new Error("No fue posible leer el archivo seleccionado."));
        return;
      }
      resolve(reader.result);
    });
    reader.addEventListener("error", () => {
      reject(new Error("No fue posible leer el archivo seleccionado."));
    });
    reader.readAsDataURL(file);
  });
}

async function sendMessage(message, fileToSend = selectedFile) {
  const trimmedMessage = message.trim();
  if (isSending || trimmedMessage.length === 0) {
    return;
  }

  isSending = true;
  appendMessage(
    fileToSend
      ? `${trimmedMessage}\n📎 ${fileToSend.file.name}`
      : trimmedMessage,
    "user",
  );
  const typingRow = appendMessage("Escribiendo…", "assistant");
  typingRow.querySelector(".message-bubble").classList.add("typing-bubble");
  input.disabled = true;
  attachmentInput.disabled = true;
  updateSendButtonState();

  try {
    const body = {
      message: trimmedMessage,
      ...(conversationId ? { conversation_id: conversationId } : {}),
      ...(fileToSend
        ? {
            attachment: {
              name: fileToSend.file.name,
              mime_type: fileToSend.mimeType,
              data: await readFileAsDataUrl(fileToSend.file),
            },
          }
        : {}),
    };
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        typeof result.error === "string"
          ? result.error
          : "No fue posible enviar tu mensaje.",
      );
    }
    if (
      typeof result.answer !== "string" ||
      typeof result.conversation_id !== "string"
    ) {
      throw new Error("El servidor devolvió una respuesta no válida.");
    }

    conversationId = result.conversation_id;
    typingRow.remove();
    appendMessage(result.answer, "assistant");
    if (fileToSend && selectedFile === fileToSend) {
      selectedFile = null;
      attachmentInput.value = "";
      renderAttachment();
    }
    input.value = "";
    attachmentStatus.textContent = "El archivo se envió para su análisis.";
  } catch (error) {
    typingRow.remove();
    appendMessage(
      error instanceof Error
        ? error.message
        : "No fue posible conectar con el asistente. Intenta de nuevo.",
      "assistant",
    );
  } finally {
    isSending = false;
    input.disabled = false;
    attachmentInput.disabled = false;
    updateSendButtonState();
    input.focus();
  }
}

attachmentInput.addEventListener("change", () => {
  const [file] = attachmentInput.files ?? [];
  if (!file) {
    return;
  }

  const mimeType = getFileMimeType(file);
  if (!mimeType) {
    selectedFile = null;
    attachmentInput.value = "";
    attachmentStatus.textContent =
      "Formato no permitido. Selecciona un PDF, JPG, PNG, GIF o WEBP.";
    renderAttachment();
    updateSendButtonState();
    return;
  }

  if (file.size === 0 || file.size > maxAttachmentBytes) {
    selectedFile = null;
    attachmentInput.value = "";
    attachmentStatus.textContent =
      "El archivo debe tener un tamaño mayor que 0 y máximo de 5 MB.";
    renderAttachment();
    updateSendButtonState();
    return;
  }

  selectedFile = { file, mimeType };
  attachmentStatus.textContent = `${file.name} está listo para enviarse con tu mensaje.`;
  renderAttachment();
  updateSendButtonState();
});

input.addEventListener("input", updateSendButtonState);

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void sendMessage(input.value);
});

suggestions.forEach((button) => {
  button.addEventListener("click", () => {
    void sendMessage(button.dataset.message ?? "");
  });
});

updateSendButtonState();
