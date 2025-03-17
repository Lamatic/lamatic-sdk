import LamaticClient  from "./middlewares/client.middleware"
import { config } from "./types/index.types";

class Lamatic {
  name : string;
  endpoint : string | null | undefined;
  apiKey? : string| null | undefined;
  projectID? : string | null | undefined;
  accessToken? : string | null | undefined;
  client : LamaticClient | null | undefined;
  /**
   * Constructor to initialize the Lamatic SDK with configuration options
   * @param {Object} config - Configuration object
   * @param {string} [config.endpoint] - The endpoint URL for the Lamatic API
   * @param {string} [config.apiKey] - The API key for the Lamatic API (or use config.api)
   * @param {string} [config.api] - The API key for the Lamatic API (or use config.apiKey)
   * @param {string} [config.projectID] - The project ID for the Lamatic API
   * @param {string} [config.accessToken] - The access token for the Lamatic API
   */

  constructor(config : config) {
    this.name = "Lamatic SDK";

    if (!config) {
      throw new Error('Configuration object is required');
    }

    if(!config.endpoint) {
      throw new Error('Endpoint URL is required');
    }
    this.endpoint = config.endpoint;

    if((config.apiKey || config.api) && config.accessToken) {
      throw new Error('API key and Access Token cannot be used together, use either');
    }

    if(!(config.apiKey || config.api) && !config.accessToken) {
      throw new Error('API key or Access Token is required');
    }

    if(config.apiKey || config.api) {
      this.apiKey = config.apiKey || config.api;
    }

    if(config.projectID && config.accessToken) {
      throw new Error('Project ID and Access Token cannot be used together, use either');
    }

    if(!config.projectID && !config.accessToken) {
      throw new Error('Project ID is required for the Lamatic API or use Access Token');
    }

    if(config.projectID) {
      this.projectID = config.projectID;
    }

    if(config.apiKey) {
      this.client = new LamaticClient(this.apiKey, this.endpoint, this.projectID, null);
    }

    if(config.accessToken) {
      this.client = new LamaticClient(null, this.endpoint, null, config.accessToken);
    }
  }

  /**
   * Returns the name of the SDK.
   * @returns {string} The name of the SDK.
   */

  getName(): string {
    return this.name;
  }

  async executeFlow(flowID : string, payload : Object) {
    return await this.client?.executeFlow(flowID, payload);
  }

  async executeAgent(agentID : string,payload : Object){
    return await this.client?.executeAgent(agentID,payload)
  }

  init() {
    console.log("Lamatic SDK initialized");
  }
}

export default Lamatic;