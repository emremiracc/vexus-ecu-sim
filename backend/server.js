const WebSocket = require('ws');

const PORT = 8080;
const LOOP_INTERVAL_MS = 500;
const VALID_MODES = ['idle', 'accelerate', 'cruise', 'decelerate', 'redline'];

class VehiclePhysics {
  constructor() {
    // Base idle state for a warmed-up engine sitting still.
    this.rpm = 800;
    this.speed = 0;
    this.temp = 60;
    this.throttle = 0;
    this.gear = 1;
    this.mode = 'idle';
  }

  getModeTargets() {
    // Each mode represents a high-level driver intent that the plant model chases.
    return {
      idle: { rpm: 800, speed: 0, throttle: 5, temp: 72 },
      accelerate: { rpm: 4500, speed: 130, throttle: 85, temp: 95 },
      cruise: { rpm: 2800, speed: 100, throttle: 35, temp: 87 },
      decelerate: { rpm: 1200, speed: 15, throttle: 3, temp: 78 },
      redline: { rpm: 7200, speed: 180, throttle: 100, temp: 108 },
    };
  }

  lerp(current, target, factor) {
    // Lerp simulates physical inertia: real vehicle signals do not jump instantly,
    // they move gradually toward a target based on system response time.
    return current + (target - current) * factor;
  }

  noise(magnitude) {
    // Small random variation makes the simulated sensor stream feel more like a real ECU.
    return (Math.random() - 0.5) * 2 * magnitude;
  }

  estimateGear() {
    // Simple gear estimation based on road speed, similar to inferring transmission state
    // from vehicle speed when a real gearbox model is not present.
    if (this.speed < 20) return 1;
    if (this.speed < 40) return 2;
    if (this.speed < 65) return 3;
    if (this.speed < 90) return 4;
    if (this.speed < 120) return 5;
    return 6;
  }

  getTempTarget() {
    // Coolant temperature target depends on operating mode and engine load.
    return this.getModeTargets()[this.mode].temp;
  }

  tick() {
    const targets = this.getModeTargets()[this.mode];

    // Throttle is the fastest-moving signal because it represents direct driver demand.
    this.throttle = this.lerp(this.throttle, targets.throttle, 0.12);

    // Engine RPM responds quickly to throttle changes, but still with some delay.
    this.rpm = this.lerp(this.rpm, targets.rpm, 0.08);

    // Vehicle speed changes more slowly because the full vehicle mass must accelerate.
    this.speed = this.lerp(this.speed, targets.speed, 0.04);

    // Coolant temperature is slowest because thermal systems have large time constants.
    this.temp = this.lerp(this.temp, this.getTempTarget(), 0.015);

    // Add sensor-like noise after the plant update to imitate measurement variation.
    this.throttle += this.noise(3);
    this.rpm += this.noise(100);
    this.speed += this.noise(2);
    this.temp += this.noise(0.5);

    // Clamp values to realistic operating ranges so the simulated ECU stays sane.
    this.throttle = clamp(this.throttle, 0, 100);
    this.rpm = clamp(this.rpm, 600, 8000);
    this.speed = clamp(this.speed, 0, 250);

    // Gear is derived from speed after the plant settles for this control-loop step.
    this.gear = this.estimateGear();

    return {
      timestamp: Date.now(),
      rpm: Math.round(this.rpm),
      speed: Math.round(this.speed),
      temp: Number(this.temp.toFixed(1)),
      throttle: Math.round(this.throttle),
      gear: this.gear,
      mode: this.mode,
    };
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function evaluateEngineCondition(data) {
  // This mirrors OBD-II style diagnostic logic: sensor values are checked against
  // thresholds and escalated into status codes the dashboard can display.
  if (data.temp > 105 && data.rpm > 7000) {
    return {
      status: 'CRITICAL',
      code: 'P0217',
      message: 'Engine overheat + high RPM',
    };
  }

  if (data.temp > 105) {
    return {
      status: 'CRITICAL',
      code: 'P0217',
      message: 'Engine coolant overtemperature',
    };
  }

  if (data.rpm > 7200) {
    return {
      status: 'CRITICAL',
      code: 'P0219',
      message: 'Engine overspeed detected',
    };
  }

  if (data.rpm > 5500 && data.temp > 95) {
    return {
      status: 'WARNING',
      code: 'P0218',
      message: 'High RPM with elevated temperature',
    };
  }

  if (data.temp > 100) {
    return {
      status: 'WARNING',
      code: 'P0217',
      message: 'Engine temperature approaching critical',
    };
  }

  if (data.rpm > 6000) {
    return {
      status: 'WARNING',
      code: 'P0219',
      message: 'Extended high-RPM operation',
    };
  }

  return {
    status: 'HEALTHY',
    code: null,
    message: 'All parameters nominal',
  };
}

const simulation = new VehiclePhysics();
const wss = new WebSocket.Server({ port: PORT });

wss.on('connection', (socket, request) => {
  const source = request.socket.remoteAddress || 'unknown-client';
  console.log(`[WS] Client connected: ${source}`);

  socket.on('message', (messageBuffer) => {
    try {
      const message = JSON.parse(messageBuffer.toString());

      if (message.type === 'SET_MODE') {
        if (!VALID_MODES.includes(message.mode)) {
          console.warn(`[WS] Ignored invalid mode request: ${message.mode}`);
          return;
        }

        simulation.mode = message.mode;
        console.log(`[SIM] Mode changed to: ${message.mode}`);
      }
    } catch (error) {
      console.warn('[WS] Failed to parse client message:', error.message);
    }
  });

  socket.on('close', () => {
    console.log(`[WS] Client disconnected: ${source}`);
  });
});

wss.on('listening', () => {
  console.log(`[WS] VEXUS backend listening on ws://localhost:${PORT}`);
});

wss.on('error', (error) => {
  console.error(`[WS] Failed to start backend on port ${PORT}: ${error.message}`);
});

// 500 ms is our simplified ECU loop period: read plant, evaluate condition, broadcast frame.
setInterval(() => {
  const frame = simulation.tick();
  frame.condition = evaluateEngineCondition(frame);

  const payload = JSON.stringify(frame);

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}, LOOP_INTERVAL_MS);
