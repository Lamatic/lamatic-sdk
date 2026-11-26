import { lamaticClient } from './utils'

function Page() {
  const executeFlow = async () => {
    const response = await lamaticClient.executeFlow(process.env.LAMATIC_FLOW_ID!, {
      prompt: 'hello',
    })
    console.log(response)
  }

  const checkStatus = async () => {
    // In case of async flow, executeFlow will return a requestId.
    // Use checkStatus to poll for the result.
    // 15 is the polling interval in seconds
    // 900 is the timeout duration in seconds (15 minutes)
    const response = await lamaticClient.checkStatus("your-request-id", 15, 900)
    console.log(response)
  }

  return (
    <div>
      <button onClick={executeFlow}>Execute Flow</button>
      <button onClick={checkStatus}>Check Status</button>
    </div>
  )
}
export default Page
