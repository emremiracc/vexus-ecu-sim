# VEXUS

Vehicle EXecution & Understanding System is a beginner-friendly automotive software project that simulates a simple ECU data path:

`Sensor -> Processing -> Output`

## Stack

- Backend: Node.js + `ws`
- Frontend: Vanilla HTML/CSS/JS + Chart.js CDN
- Transport: WebSocket on `ws://localhost:8080`

## Run

```bash
npm install
npm start
```

Then open [frontend/index.html](/Users/emremiraccakir/vexus/frontend/index.html) in a browser.

## Features

- Simulated vehicle plant model with driving modes
- Realtime broadcast every 500 ms
- OBD-II inspired engine condition evaluation
- Live dashboard with sensor cards and history charts
- Manual mode switching and auto-reconnect
