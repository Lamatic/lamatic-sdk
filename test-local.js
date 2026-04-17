import { Lamatic } from "./dist/index.js";

// Configuration - Replace with your actual values
const config = {
  endpoint: "your-endpoint-url", // e.g., "https://api.lamatic.ai/graphql"
  projectId: "your-project-id",
  apiKey: "your-api-key", // or use accessToken instead
  // accessToken: "your-access-token" // alternative to apiKey
};

async function testSDK() {
  console.log("🚀 Starting Lamatic SDK Local Tests\n");

  // Initialize the SDK
  let lamatic;
  try {
    lamatic = new Lamatic(config);
    console.log("✅ SDK initialized successfully");
    console.log(`   Endpoint: ${lamatic.endpoint}`);
    console.log(`   Project ID: ${lamatic.projectId}`);
    console.log(`   Auth Method: ${lamatic.apiKey ? 'API Key' : 'Access Token'}\n`);
  } catch (error) {
    console.error("❌ Failed to initialize SDK:", error.message);
    return;
  }

  // Test 1: Execute Flow (sync)
  console.log("📋 Test 1: executeFlow (sync)");
  try {
    const flowId = "your-flow-id";
    const payload = { question: "Hello, this is a test message for flow execution" };

    console.log(`   Flow ID: ${flowId}`);
    console.log(`   Payload:`, payload);

    const flowResponse = await lamatic.executeFlow(flowId, payload);
    console.log("✅ Flow executed successfully:");
    console.log("   Response:", JSON.stringify(flowResponse, null, 2));
  } catch (error) {
    console.error("❌ Flow execution failed:", error.message);
  }
  console.log("");

  // Test 2: executeFlowStream (streaming — default recommended method)
  console.log("🌊 Test 2: executeFlowStream (streaming)");
  try {
    const flowId = "your-flow-id";
    const payload = { question: "Stream a short story about a robot learning to cook" };

    console.log(`   Flow ID: ${flowId}`);
    console.log(`   Payload:`, payload);
    console.log("   Streaming chunks:");

    for await (const chunk of lamatic.executeFlowStream(flowId, payload)) {
      if (chunk.event === "error") {
        console.error("   ❌ Stream error:", chunk.message);
        break;
      }
      if (chunk.event === "done") {
        console.log("   ✅ Stream complete");
        break;
      }
      process.stdout.write(`   chunk: ${JSON.stringify(chunk)}\n`);
    }
  } catch (error) {
    console.error("❌ Flow stream failed:", error.message);
  }
  console.log("");

  // Test 3: executeFlowPoll (native polling — for async long-running workflows)
  console.log("⏳ Test 3: executeFlowPoll (native polling)");
  try {
    const flowId = "your-flow-id";
    const payload = { question: "Run a long data processing task" };

    console.log(`   Flow ID: ${flowId}`);
    console.log(`   Poll interval: 10s | Timeout: 120s`);

    const pollResponse = await lamatic.executeFlowPoll(flowId, payload, {
      interval: 10,
      timeout: 120,
    });
    console.log("✅ Flow poll completed:");
    console.log("   Response:", JSON.stringify(pollResponse, null, 2));
  } catch (error) {
    console.error("❌ Flow poll failed:", error.message);
  }
  console.log("");

  // Test 4: checkStatus (manual polling with a known requestId)
  console.log("🔍 Test 4: checkStatus (manual)");
  try {
    const requestId = "your-request-id";

    console.log(`   Request ID: ${requestId}`);
    console.log("   Using default polling (15s interval, 900s timeout)");

    const statusResponse = await lamatic.checkStatus(requestId);
    console.log("✅ Status check completed:");
    console.log("   Response:", JSON.stringify(statusResponse, null, 2));
  } catch (error) {
    console.error("❌ Status check failed:", error.message);
  }
  console.log("");

  // Test 5: Update Access Token
  console.log("🔄 Test 5: updateAccessToken");
  try {
    const newToken = "new-access-token";
    lamatic.updateAccessToken(newToken);
    console.log("✅ Access token updated successfully");
    console.log(`   New token: ${newToken.substring(0, 10)}...`);
  } catch (error) {
    console.error("❌ Access token update failed:", error.message);
  }
  console.log("");

  console.log("🏁 All tests completed!");
}

// Run the tests
testSDK().catch(console.error);
