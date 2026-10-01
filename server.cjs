// Startup file for hosts that launch Node apps through Phusion Passenger, such as cPanel's
// "Setup Node.js App" (set "Application startup file" to server.cjs). It serves the production
// build (`npm run build` first) exactly like `next start`, loading the same .env files.
// CommonJS (.cjs) because Passenger require()s the startup file and package.json sets "type": "module".
// Elsewhere, use `npm run start` (or the standalone output for Docker).
const { createServer } = require('node:http');
const next = require('next');

// Passenger gives the app its port through PORT (and also accepts any port it intercepts).
const port = Number.parseInt(process.env.PORT || '3000', 10);
const app = next({ dev: false, dir: __dirname });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    createServer((request, response) => handle(request, response)).listen(port, () => {
      console.log(`Daybook is listening on port ${port}`);
    });
  })
  .catch((error) => {
    console.error('Daybook could not start:', error);
    process.exit(1);
  });
