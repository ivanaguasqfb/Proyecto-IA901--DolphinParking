import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";

const projectEndpoint = process.env.FOUNDRY_PROJECT_ENDPOINT?.trim();
const agentName = process.env.FOUNDRY_AGENT_NAME?.trim();
const model = process.env.FOUNDRY_MODEL_DEPLOYMENT?.trim();
const instructions = process.env.FOUNDRY_AGENT_INSTRUCTIONS?.trim();

if (!projectEndpoint || !agentName || !model || !instructions) {
  console.error(
    "Configura FOUNDRY_PROJECT_ENDPOINT, FOUNDRY_AGENT_NAME, FOUNDRY_MODEL_DEPLOYMENT y FOUNDRY_AGENT_INSTRUCTIONS.",
  );
  process.exitCode = 1;
} else {
  const projectClient = new AIProjectClient(
    projectEndpoint,
    new DefaultAzureCredential(),
  );

  try {
    await projectClient.agents.get(agentName);
    console.log(`El agente "${agentName}" ya existe; no se realizaron cambios.`);
  } catch (error) {
    if (error?.statusCode !== 404) {
      console.error(
        "No se pudo verificar el agente. Revisa las credenciales y el acceso al proyecto.",
      );
      process.exitCode = 1;
    } else {
      try {
        const agent = await projectClient.agents.createVersion(agentName, {
          kind: "prompt",
          model,
          instructions,
        });
        console.log(
          `Agente "${agent.name}" creado en la versión ${agent.version}.`,
        );
      } catch {
        console.error(
          "No se pudo crear el agente. Revisa las credenciales, el acceso al proyecto y el deployment del modelo.",
        );
        process.exitCode = 1;
      }
    }
  }
}
