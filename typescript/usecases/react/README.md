# Lamatic SDK React Starter

This repository provides a **React-based starter project** for integrating with the **Lamatic SDK**. It allows developers to authenticate, configure, and execute flows/agents using Lamatic's AI-powered automation.

## 🚀 Features
- Authenticate using API Key or Access Token
- Validate and manage authentication tokens
- Configure Lamatic SDK with user inputs
- Execute AI-powered flows and/or agents
- Handle response statuses and errors gracefully

---

## 📦 Installation

First, clone this repository:

```sh
git clone https://github.com/your-username/lamatic-sdk-ts
cd lamatic-sdk-ts/examples/react
```

Then, install dependencies:

```sh
npm install
```

---

## 🏃 Running the Project

Start the development server with:

```sh
npm run dev
```

The app should now be running at `http://localhost:5173` (or another available port).

---

## 🔑 Authentication

The app supports two authentication methods:

1. **Access Token**
2. **API Key**

Users must provide valid credentials via the UI before making requests.

### Token Expiry Handling
If the **Access Token** is expired, the app will prompt the user to enter a new token before making API requests.

---

## ⚙️ Configuration

Before executing a flow, ensure the following configurations are set:

- **Project ID** (Required)
- **Endpoint** (Required)
- **Flow ID** (Optional)
- **Agent ID** (Optional)
- **Authentication** (Access Token or API Key)

Once configured, click **"Configure Client"** to initialize the Lamatic SDK instance.

---

## 📡 Executing a Flow/Agent

1. Input key-value pairs for your request.
2. Click **"Submit"** to execute the selected flow.
3. The response and status code will be displayed in the UI.

---

## 🛠 Environment Variables (Optional)
You can set environment variables in a `.env` file:

```ini
VITE_LAMATIC_PROJECT_ID=your_project_id
VITE_LAMATIC_ENDPOINT=https://api.lamatic.ai
VITE_LAMATIC_FLOW_ID=your_flow_id
VITE_LAMATIC_AGENT_ID=your_agent_id
```

---

## 📝 Notes
- This project uses **Vite** for fast development.
- Uses **jwt-decode** to handle token validation.
- Designed for **React 18+** with TypeScript support.

---

## 🤝 Contributing
Contributions are welcome! Feel free to submit issues or pull requests.

---

## 📄 License
MIT License © 2025 Lamatic AI