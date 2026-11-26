import React from "react";

const Page = () => {
  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-4">Generate JWT Token for Lamatic API</h1>
      <p className="text-gray-700 mb-4">
        Run the following code on your backend to generate a JWT token. Pass the generated token to the frontend to authenticate with the Lamatic API.
      </p>
      <pre className="bg-gray-100 p-4 rounded-md text-sm overflow-x-auto">
        {`/* 
** Generate JWT Token **
Run this code on your backend with your credentials and pass the generated token to the frontend. 
You can use this token to authenticate the frontend with the Lamatic API.
*/

import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

// You can set the secret key as an environment variable
const secretKey = process.env.LAMATIC_SECRET_KEY || 'LamaticSecretKey';

export const access_token = jwt.sign({ project_id: 'your-project-id' }, secretKey , {
    algorithm: 'HS256',
    expiresIn: '1h', // You can set the expiration time as per your requirement
});`}
      </pre>
      <p className="text-gray-700 mt-4">
        Make sure to replace <code>your-project-id</code> with your actual Lamatic project ID. Set your secret key as an environment variable for security purposes.
      </p>
    </div>
  );
};

export default Page;
