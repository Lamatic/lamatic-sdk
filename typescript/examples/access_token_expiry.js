// This example shows how to use the Lamatic SDK with a token that expires, and how to update the access token.
import { Lamatic } from "lamatic";

const lamatic = new Lamatic({
  accessToken: "your-access-token",
  projectId: "your-project-id",
  endpoint: "your-endpoint",
});

async function getAccessToken() {
  const response = await fetch("your-server-endpoint/get-access-token", {
    method: "GET",
  });
  const data = await response.json();
  return data.accessToken;
}

async function flow() {
  const flowId = "your-flow-id";
  // sample payload
  const payload = {
    prompt: "hey, how are you?"
  }
  const response = await lamatic.executeFlow(flowId, payload);
  console.log(response);
  if (response.statusCode === 403) {

    // Get the new access token
    const accessToken = await getAccessToken();
    // Update the access token for the Lamatic SDK
    lamatic.updateAccessToken(accessToken);

    // Execute the flow again
    const response = await lamatic.executeFlow(flowId, payload);
    console.log(response);
  }
}

async function agent() {
  const agentId = "your-agent-id";
  // sample payload
  const payload = {
    query: "generate a tweet for learning lamatic AI"
  }
  const response = await lamatic.executeAgent(agentId, payload);
  console.log(response);
  if (response.statusCode === 403) {

    // Get the new access token
    const accessToken = await getAccessToken();
    // Update the access token for the Lamatic SDK
    lamatic.updateAccessToken(accessToken);

    // Execute the agent again
    const response = await lamatic.executeAgent(agentId, payload);
    console.log(response);
  }
}

flow();
agent();