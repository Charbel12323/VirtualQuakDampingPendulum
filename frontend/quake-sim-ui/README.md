# Project Setup and Local Development

## Prerequisites
Before you begin, make sure you have the following installed:
- [Node.js](https://nodejs.org/) (v16 or later recommended)
- npm (comes bundled with Node.js)

## Installation

1. Clone or download this repository to your local machine.
2. Open a terminal in the project directory:
   ```bash
   cd path/to/your/project
   ```
3. Install all project dependencies:
   ```bash
   npm install
   ```

## Running the Development Server

To start the local development environment, run:
```bash
npm run dev
```

After the server starts, open your browser and visit:
👉 [http://localhost:3000](http://localhost:3000)

This will launch the project locally, allowing you to view and test your application in real-time.

---

**Tip:** If you encounter errors during installation or when running the development server, delete the `node_modules` folder and `package-lock.json` file, then reinstall:
```bash
rm -rf node_modules package-lock.json
npm install
```
