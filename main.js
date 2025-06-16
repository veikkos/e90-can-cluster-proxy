'use strict';

const udp = require("udp-hub");
const { SerialPort } = require("serialport");
const readline = require("readline");

const portName = process.argv[2] || "COM3";

const serialPort = new SerialPort({
    path: portName,
    baudRate: 115200
}, (err) => {
    if (err) {
        console.error("Failed to open serial port:", err.message);
        process.exit(1);
    }
    console.log(`Serial port ${portName} opened.`);
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

const pad = (value, length, decimals = 0) => {
    const num = (decimals > 0 ? value.toFixed(decimals) : Math.round(value)).toString();
    return num.padStart(length, '0');
};

const toTF = (bool) => (bool ? 'T' : 'F');

let fuelInjectionHistory = []; // {fuelPct, timestamp}
let lastFuelAmount = 0;
let lastFuelMeasurement = 0;

// Returns filtered value of fuel consumed per 100 ms in micro liters
function updateFuelInjection(data) {
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

        const tankLiters = 61;
        const fuelConsumedUl = (first.fuelPct - last.fuelPct) * tankLiters * 1e6;
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
        gearMode: String.fromCharCode(buff.readUInt8(96))
    };

    const formatTimestamp = () => {
        const now = new Date();
        const pad2 = (n) => n.toString().padStart(2, '0');

        return (
            now.getFullYear().toString() +
            pad2(now.getMonth() + 1) +
            pad2(now.getDate()) +
            pad2(now.getHours()) +
            pad2(now.getMinutes()) +
            pad2(now.getSeconds())
        );
    };

    const injectionValue = updateFuelInjection(data);

    const asciiMsg =
        'S' +
        formatTimestamp() +
        pad(data.rpm, 5) +
        pad(data.speed * 3.6 * 10, 4) +
        pad(data.gear, 1) +
        pad(data.engtemp, 3) +
        pad(data.fuel * 1000, 4) +
        toTF(data.showlights & (1 << 0)) +   // SHIFT
        toTF(data.showlights & (1 << 1)) +   // FULLBEAM
        toTF(data.showlights & (1 << 2)) +   // HANDBRAKE
        toTF(data.showlights & (1 << 4)) +   // TC
        toTF(data.showlights & (1 << 5)) +   // SIGNAL_L
        toTF(data.showlights & (1 << 6)) +   // SIGNAL_R
        toTF(data.showlights & (1 << 8)) +   // OILWARN
        toTF(data.showlights & (1 << 9)) +   // BATTERY
        toTF(data.showlights & (1 << 10)) +  // ABS
        toTF(data.engtemp > 105) +
        toTF(data.engtemp > 120) +
        pad(injectionValue, 4) +
        customLightNumber + (customLightState ? 'T' : 'F') +
        data.gearMode +
        toTF(data.showlights & (1 << 12)) +  // LOWBEAM
        toTF(data.showlights & (1 << 13)) +  // ESC
        toTF(data.showlights & (1 << 14)) +  // CHECKENGINE
        toTF(data.showlights & (1 << 15));   // CLUTCHTEMP

    // console.log(data);
    // console.log([...buff].map(b => b.toString(16).padStart(2, '0')).join(' '));

    if (serialPort.isOpen) {
        serialPort.write(asciiMsg + "\n");
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
