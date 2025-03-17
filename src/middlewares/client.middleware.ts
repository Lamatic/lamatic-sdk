import Auth from "./auth.middleware";
import {handleError}  from "../utils/utils"

class LamaticClient {
  endpoint : string;
  apiKey : string | null | undefined;
  accessToken : string | null | undefined;
  projectID : string | null | undefined;
  auth : Auth | null | undefined;

  // Constructor to initialize the LamaticClient with an API key
  constructor(
    apiKey : string | null | undefined, 
    endpoint : string | null | undefined, 
    projectID : string | null | undefined, 
    accessToken : string | null | undefined
  ) {

    // API Key or Access Token Initialization
    if (!apiKey && !accessToken) throw new Error("API key or Access Token is required for the Lamatic Client");
    if(apiKey && accessToken) throw new Error("API key and Access Token cannot be used together, use either");

    if(apiKey){
      this.apiKey = apiKey;
    }
    
    if(accessToken){
      this.accessToken = accessToken;
    }

    // Endpoint URL Initialization
    if (!endpoint) throw new Error("Endpoint URL is required for the Lamatic Client");
    this.endpoint = endpoint;

    // Project ID Initialization
    if(!projectID && !accessToken) throw new Error("Project ID is required for the Lamatic Client or use Access Token");
    if(projectID && accessToken) throw new Error("Project ID and Access Token cannot be used together, use either");

    if(projectID){
      this.projectID = projectID;
    }

    // Authorization Initialization
    if(this.apiKey){
      this.auth = new Auth(this.apiKey ?? null, this.projectID ?? null, null);
    }

    if(this.accessToken){
      this.auth = new Auth(null, null, this.accessToken ?? null);
    }
  }

  // Flow Request with GraphQL
  async executeFlowRequest(flowId : string, payload : Object) {
    try {

      const graphqlQuery = {
        query: `query ExecuteWorkflow(
                $workflowId: String!  
                $payload: JSON!
              ) 
              {   
                executeWorkflow( 
                  workflowId: $workflowId   
                  payload: $payload
                ) 
                {  
                  status       
                  result   
                } 
              }`,
        variables: {
          workflowId: flowId,
          payload : payload,
        },
      };

      const options = {
        method: "POST",
        headers: await this.auth?.getHeaders(),
        body: JSON.stringify(graphqlQuery),
      };
      
      const response = await fetch(this.endpoint, options);
      const responseText = await response.text();

      let responseData = JSON.parse(responseText);
    
      if (!response.ok) {
        throw new Error(
          `API Error: ${response.status} ${response.statusText} - ${responseText}`
        );
      }

      return responseData;

    } catch (error : Error | any) {
      handleError(error);
    }
  }

  // Agent Request with GraphQL
  async executeAgentRequest(agentId : string, payload : Object) {
    try {

      const graphqlQuery = {
        query: `query ExecuteAgent(
                $agentId: String!  
                $payload: JSON!
              ) 
              {   
                executeAgent( 
                  agentId: $agentId   
                  payload: $payload
                ) 
                {  
                  status       
                  result   
                } 
              }`,
        variables: {
          agentId: agentId,
          payload : payload,
        },
      };

      const options = {
        method: "POST",
        headers: await this.auth?.getHeaders(),
        body: JSON.stringify(graphqlQuery),
      };
      
      const response = await fetch(this.endpoint, options);
      const responseText = await response.text();

      let responseData = JSON.parse(responseText);
    
      if (!response.ok) {
        throw new Error(
          `API Error: ${response.status} ${response.statusText} - ${responseText}`
        );
      }

      return responseData;

    } catch (error : Error | any) {
      handleError(error);
    }
  }

  // Execute a flow with the GraphQL API
  async executeFlow(flowId : string, data : Object) {
    if (!flowId) throw new Error("The Flow ID is required");
    if (!data) throw new Error("The payload is required");

    return await this.executeFlowRequest(flowId, data);
  }

  async executeAgent(agentId : string, data : Object) {
    if (!agentId) throw new Error("The Agent ID is required");
    if (!data) throw new Error("The payload is required");

    return await this.executeAgentRequest(agentId, data);
  }

}

export default LamaticClient;