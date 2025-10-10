import { Lamatic } from "../dist/index.js";

// Lamatic Class Tests
describe("Lamatic", () => {
  const mockConfig = {
    endpoint: "https://api.example.com",
    projectId: "test-project",
    apiKey: "test-key"
  };

  test("should be a class", () => {
    expect(typeof Lamatic).toBe("function");
  });

  test("should have a name property set to 'Lamatic SDK'", () => {
    const lamatic = new Lamatic(mockConfig);
    expect(lamatic.name).toBe("Lamatic SDK");
  });

  test("should have methods executeFlow, executeAgent, and checkStatus", () => {
    const lamatic = new Lamatic(mockConfig);
    expect(typeof lamatic.executeFlow).toBe("function");
    expect(typeof lamatic.executeAgent).toBe("function");
    expect(typeof lamatic.checkStatus).toBe("function");
  });
});