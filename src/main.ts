'use strict';

const udp = require("udp-hub");
const { SerialPort } = require("serialport");
const readline = require("readline");

const portName = process.argv[2] || "COM3";

const serialPort = new SerialPort({
    path: portName,
    baudRate: 921600
}, (err) => {
    if (err) {
        tryConnectSerialPort()
    } else {
        console.log(`[SERIAL] Serial port ${portName} opened.`);
    }
});

let rxBuffer = '';

serialPort.on("data", (data) => {
    rxBuffer += data.toString();
    const lines = rxBuffer.split(/\r?\n/);
    rxBuffer = lines.pop();

    for (let line of lines) {
        if (line.trim().length > 0) {
            console.log(`[MBED] ${line.trim()}`);
        }
    }
});

let reconnectInterval = null;

function tryConnectSerialPort() {
    if (serialPort.isOpen || reconnectInterval) return;

    console.log("[SERIAL] Attempting to open port.");

    reconnectInterval = setInterval(() => {
        if (serialPort.isOpen) {
            clearInterval(reconnectInterval);
            reconnectInterval = null;
            return;
        }

        serialPort.open((err) => {
            if (!err) {
                console.log("[SERIAL] Port successfully opened.");
                clearInterval(reconnectInterval);
                reconnectInterval = null;
            }
        });
    }, 2000);
}

serialPort.on("close", () => {
    console.warn("[SERIAL] Port closed.");
    tryConnectSerialPort();
});

serialPort.on("error", (err) => {
    console.error(`[SERIAL ERROR] ${err.message}`);
});

let customLightNumber = '0000';
let customLightState = false;
let lightLoopTimer;
let lightLoopIndex = 400;

/*
lightLoopTimer = setInterval(() => {
    // Turn off the previous light
    customLightNumber = (lightLoopIndex - 1 <= 0 ? 99999 : lightLoopIndex - 1).toString().padStart(4, '0');
    customLightState = false;

    // Emit OFF first
    sendLoopState();

    // Then turn on the next light
    setTimeout(() => {
        customLightNumber = lightLoopIndex.toString().padStart(4, '0');
        customLightState = true;
        sendLoopState();

        lightLoopIndex = (lightLoopIndex % 99999) + 1;
    }, 500);
}, 4000);

function sendLoopState() {
    // optional: show to user
    console.log(`[LOOP] Light ${customLightNumber} = ${customLightState ? 'T' : 'F'}`);
}*/

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.on("line", (input) => {
    input = input.trim().toUpperCase();
    const match = input.match(/^(\d{1,4})([TF])$/);
    if (match) {
        customLightNumber = match[1].padStart(4, '0');
        customLightState = match[2] === 'T';
        console.log(`[INPUT] Set custom light ${customLightNumber} = ${customLightState ? 'ON' : 'OFF'}`);
    } else {
        console.log(`[INPUT] Invalid format. Use e.g. 5T or 12F`);
    }
});

let fuelInjectionHistory = []; // {fuelPct, timestamp}
let lastFuelAmount = 0;
let lastFuelMeasurement = 0;

// Returns filtered value of fuel consumed per 100 ms in micro liters
function updateFuelInjection(data, fuelCapacity) {
    const now = Date.now();
    const deltaFuel = lastFuelAmount - data.fuel;
    const deltaTimeMin = (now - lastFuelMeasurement) / 60000;

    lastFuelAmount = data.fuel;
    lastFuelMeasurement = now;

    if (deltaFuel > 0 && deltaTimeMin > 0 && deltaTimeMin < 5) {
        fuelInjectionHistory.push({
            fuelPct: data.fuel,
            timestamp: now
        });

        while (fuelInjectionHistory.length > 10) fuelInjectionHistory.shift();
        if (fuelInjectionHistory.length < 2) return 0;

        const first = fuelInjectionHistory[0];
        const last = fuelInjectionHistory[fuelInjectionHistory.length - 1];

        const fuelConsumedUl = (first.fuelPct - last.fuelPct) * fuelCapacity * 1e6;
        const durationMs = last.timestamp - first.timestamp;
        const cycles = durationMs / 100;

        if (fuelConsumedUl > 0 && cycles > 0) {
            return Math.round(fuelConsumedUl / cycles);
        }
    }

    return 0;
}

const server = udp.createServer(function (buff) {
    const data = {
        car: buff.toString('ascii', 4, 8),
        flags: buff.readUInt16LE(8),
        gear: buff.readUInt8(10),
        plid: buff.readUInt8(11),
        speed: buff.readFloatLE(12),
        rpm: buff.readFloatLE(16),
        turbo: buff.readFloatLE(20),
        engtemp: buff.readFloatLE(24),
        fuel: buff.readFloatLE(28),
        oilpressure: buff.readFloatLE(32),
        oiltemp: buff.readFloatLE(36),
        dashlights: buff.readInt32LE(40),
        showlights: buff.readInt32LE(44),
        throttle: buff.readFloatLE(48),
        brake: buff.readFloatLE(52),
        clutch: buff.readFloatLE(56),
        gearMode: String.fromCharCode(buff.readUInt8(96)),
        cruiseSpeed: buff.readFloatLE(100),
        cruiseMode: buff.readUInt32LE(104),
        fuelCapacity: buff.readFloatLE(108),
        ignitionState: buff.readUInt16LE(112),
        engineState: buff.readUInt16LE(114),
    };

    const injectionValue = updateFuelInjection(data, data.fuelCapacity);

    const buffer = Buffer.alloc(32); // 29 + checksum + 2 markers
    let offset = 0;

    buffer.writeUInt8('S'.charCodeAt(0), offset++); // Start marker

    const now = new Date();
    buffer.writeUInt8(now.getFullYear() % 2000, offset++);
    buffer.writeUInt8(now.getMonth() + 1, offset++);
    buffer.writeUInt8(now.getDate(), offset++);
    buffer.writeUInt8(now.getHours(), offset++);
    buffer.writeUInt8(now.getMinutes(), offset++);
    buffer.writeUInt8(now.getSeconds(), offset++);

    buffer.writeUInt16LE(Math.max(0, Math.min(65535, Math.round(data.rpm))), offset); offset += 2;
    buffer.writeUInt16LE(Math.round(data.speed * 3.6 * 10), offset); offset += 2;  // speed x10
    buffer.writeUInt8(data.gear, offset++);
    buffer.writeUInt8(Math.round(data.engtemp), offset++);
    buffer.writeUInt16LE(Math.round(data.fuel * 1000), offset); offset += 2;

    buffer.writeInt32LE(data.showlights, offset); offset += 4;

    buffer.writeUInt16LE(Math.min(injectionValue, 9999), offset); offset += 2;
    buffer.writeUInt16LE(parseInt(customLightNumber), offset); offset += 2;
    buffer.writeUInt8(customLightState ? 1 : 0, offset++);
    buffer.writeUInt8(data.gearMode.charCodeAt(0), offset++);
    buffer.writeUInt16LE(Math.round(data.cruiseSpeed * 3.6 * 10), offset); offset += 2;
    buffer.writeUInt8(data.cruiseMode, offset++);
    buffer.writeUInt8(data.ignitionState, offset++);
    buffer.writeUInt8(data.engineState, offset++);

    let checksum = 0;
    for (let i = 1; i < offset; i++) {
        checksum = (checksum + buffer[i]) & 0xFF;
    }

    buffer.writeUInt8(checksum, offset++);
    buffer.writeUInt8('E'.charCodeAt(0), offset++); // End marker

    //console.log(data);
    //console.log([...buff].map(b => b.toString(16).padStart(2, '0')).join(' '));
    //console.log(asciiMsg);

    if (serialPort.isOpen) {
        serialPort.write(buffer);
    }
});

server.bind(4568);
console.log("UDP server listening on port 4568.");
console.log("Type a custom light command like '12T' or '5F' and press Enter.");

// Graceful shutdown
process.on("SIGINT", () => {
    console.log("\nExiting...");
    if (lightLoopTimer) {
        clearInterval(lightLoopTimer);
    }
    rl.close();
    serialPort.close(() => process.exit(0));
});
