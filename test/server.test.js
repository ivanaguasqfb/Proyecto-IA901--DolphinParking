import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApp } from "../server.js";

async function withServer(app, callback) {
  const server = app.listen(0);
  await once(server, "listening");

  try {
    const address = server.address();
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function createFakeOpenAI() {
  const calls = [];
  let conversationCount = 0;
  return {
    calls,
    conversations: {
      async create() {
        conversationCount += 1;
        return { id: "conversation-test" };
      },
    },
    responses: {
      async create(request, agent) {
        calls.push({ request, agent });
        return { output_text: `Respuesta a: ${request.input}` };
      },
    },
    get conversationCount() {
      return conversationCount;
    },
  };
}

test("GET /health y los archivos del frontend se sirven correctamente", async () => {
  const app = createApp({ openai: createFakeOpenAI(), agentName: "test-agent" });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });

    const pageResponse = await fetch(baseUrl);
    assert.equal(pageResponse.status, 200);
    const page = await pageResponse.text();
    assert.match(page, /Estacionamiento <strong>Dolphin<\/strong>/);
    assert.match(page, /accept="\.pdf,application\/pdf/);
    assert.match(page, /se enviará a Microsoft Foundry para su análisis/i);
    assert.match(page, /maps\.google\.com\/maps\?q=19\.0489902%2C-98\.2052981/);
    assert.match(page, /title="Mapa de Google Maps: Av\. 2 Pte 911 A, Centro, Heroica Puebla de Zaragoza"/);
    assert.match(page, /maps\/place\/Av\+2\+Pte\+911\+A/);
    assert.match(page, /Abrir en Google Maps/);

    const scriptResponse = await fetch(`${baseUrl}/app.js`);
    assert.equal(scriptResponse.status, 200);
    assert.match(await scriptResponse.text(), /textContent/);

    for (const image of [
      "cathedral.jpg",
      "centre.jpg",
      "images.jpg",
      "parkking.jpg",
      "dolphin-parking.svg",
      "dolphin-vehicles.svg",
    ]) {
      const imageResponse = await fetch(`${baseUrl}/images/${image}`);
      assert.equal(imageResponse.status, 200);
      assert.match(imageResponse.headers.get("content-type"), /^image\//);
      assert.ok((await imageResponse.arrayBuffer()).byteLength > 0);
    }
  });
});

test("POST /api/chat rechaza mensajes vacíos y demasiado largos", async () => {
  const openai = createFakeOpenAI();
  const app = createApp({ openai, agentName: "test-agent" });

  await withServer(app, async (baseUrl) => {
    for (const message of ["   ", "a".repeat(2001)]) {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      assert.equal(response.status, 422);
    }
    assert.equal(openai.calls.length, 0);
  });
});

test("POST /api/chat conserva la conversación entre pregunta y seguimiento", async () => {
  const openai = createFakeOpenAI();
  const app = createApp({ openai, agentName: "dolphin-agent" });

  await withServer(app, async (baseUrl) => {
    const firstResponse = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "¿Cuál es el horario?" }),
    });
    const firstResult = await firstResponse.json();
    assert.equal(firstResponse.status, 200);
    assert.equal(firstResult.conversation_id, "conversation-test");

    const followUpResponse = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "¿Y cuál es la dirección?",
        conversation_id: firstResult.conversation_id,
      }),
    });
    const followUpResult = await followUpResponse.json();
    assert.equal(followUpResponse.status, 200);
    assert.equal(followUpResult.conversation_id, firstResult.conversation_id);
    assert.equal(openai.conversationCount, 1);
    assert.deepEqual(
      openai.calls.map(({ request }) => request.conversation),
      ["conversation-test", "conversation-test"],
    );
    assert.deepEqual(openai.calls[0].agent, {
      body: {
        agent_reference: {
          name: "dolphin-agent",
          type: "agent_reference",
        },
      },
    });
  });
});

test("POST /api/chat envía PDF e imágenes al agente en la conversación", async () => {
  const openai = createFakeOpenAI();
  const app = createApp({ openai, agentName: "dolphin-agent" });
  const pngSignature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const attachments = [
    {
      name: "recibo.pdf",
      mime_type: "application/pdf",
      data: `data:application/pdf;base64,${Buffer.from("%PDF-1.7").toString("base64")}`,
      contentType: "input_file",
    },
    {
      name: "vehiculo.png",
      mime_type: "image/png",
      data: `data:image/png;base64,${pngSignature.toString("base64")}`,
      contentType: "input_image",
    },
  ];

  await withServer(app, async (baseUrl) => {
    let conversationId;
    for (const attachment of attachments) {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Analiza este archivo.",
          ...(conversationId ? { conversation_id: conversationId } : {}),
          attachment: {
            name: attachment.name,
            mime_type: attachment.mime_type,
            data: attachment.data,
          },
        }),
      });
      const result = await response.json();
      assert.equal(response.status, 200);
      conversationId = result.conversation_id;

      const request = openai.calls.at(-1).request;
      assert.equal(request.conversation, conversationId);
      assert.equal(request.input[0].role, "user");
      assert.equal(request.input[0].content[0].text, "Analiza este archivo.");
      assert.equal(request.input[0].content[1].type, attachment.contentType);
      if (attachment.contentType === "input_file") {
        assert.equal(request.input[0].content[1].filename, attachment.name);
        assert.equal(request.input[0].content[1].file_data, attachment.data);
      } else {
        assert.equal(request.input[0].content[1].image_url, attachment.data);
      }
    }

    assert.equal(openai.conversationCount, 1);
    assert.equal(openai.calls.length, 2);
  });
});

test("POST /api/chat rechaza archivos inválidos o mayores de 5 MB", async () => {
  const openai = createFakeOpenAI();
  const app = createApp({ openai, agentName: "test-agent" });
  const invalidAttachment = {
    name: "recibo.pdf",
    mime_type: "application/pdf",
    data: "data:application/pdf;base64,SGVsbG8=",
  };
  const validPdf = {
    name: "recibo.pdf",
    mime_type: "application/pdf",
    data: `data:application/pdf;base64,${Buffer.from("%PDF-1.7").toString("base64")}`,
  };
  const maxSizePdf = Buffer.alloc(5 * 1024 * 1024);
  Buffer.from("%PDF-").copy(maxSizePdf);
  const oversizedPdf = Buffer.alloc(5 * 1024 * 1024 + 1);
  Buffer.from("%PDF-").copy(oversizedPdf);

  await withServer(app, async (baseUrl) => {
    const invalidResponse = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Revisa este archivo.", attachment: invalidAttachment }),
    });
    assert.equal(invalidResponse.status, 422);

    const emptyMessageResponse = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: " ", attachment: validPdf }),
    });
    assert.equal(emptyMessageResponse.status, 422);

    const maxSizeResponse = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Revisa este archivo.",
        attachment: {
          name: "limite.pdf",
          mime_type: "application/pdf",
          data: `data:application/pdf;base64,${maxSizePdf.toString("base64")}`,
        },
      }),
    });
    assert.equal(maxSizeResponse.status, 200);
    assert.equal(openai.calls.length, 1);

    const oversizedResponse = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Revisa este archivo.",
        attachment: {
          name: "grande.pdf",
          mime_type: "application/pdf",
          data: `data:application/pdf;base64,${oversizedPdf.toString("base64")}`,
        },
      }),
    });
    assert.equal(oversizedResponse.status, 422);
    assert.equal(openai.calls.length, 1);
  });
});

test("POST /api/chat oculta los errores de Foundry y responde 502", async () => {
  const openai = createFakeOpenAI();
  openai.responses.create = async () => {
    throw new Error("private provider details");
  };
  const app = createApp({ openai, agentName: "test-agent" });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Necesito ayuda con mi reclamo." }),
    });
    const result = await response.json();
    assert.equal(response.status, 502);
    assert.equal(
      result.error,
      "No fue posible procesar tu mensaje en este momento.",
    );
    assert.equal(JSON.stringify(result).includes("private provider details"), false);
  });
});
