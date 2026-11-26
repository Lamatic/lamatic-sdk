/* 
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
})