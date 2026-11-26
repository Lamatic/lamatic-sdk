import { Lamatic } from 'lamatic'

export const lamaticClient = new Lamatic({
    projectId: process.env.LAMATIC_PROJECT_ID,
    apiKey: process.env.LAMATIC_API_KEY,
  })