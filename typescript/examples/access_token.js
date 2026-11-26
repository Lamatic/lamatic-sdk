// This example shows how to use the Lamatic SDK with a token that expires, and how to update the access token.
import { Lamatic } from "lamatic";

const lamatic = new Lamatic({
  accessToken: "your-access-token",
  projectId: "your-project-id",
  endpoint: "your-endpoint",
});

async function flow() {
  const flowId = "your-flow-id";
  // sample payload
  const payload = {
    prompt: "hey, how are you?"
  }
  const response = await lamatic.executeFlow(flowId, payload);
    console.log(response);
}

async function agent() {
  const agentId = "your-agent-id";
  // sample payload
  const payload = {
    query: "generating a tweet for learning lamatic AI"
  }
  try {
    const response = await lamatic.executeAgent(agentId, payload);
    console.log(response);
  } catch (error) {
    console.error(error);
  }
}

flow();
agent();