'use strict';

const udp = require("udp-hub");
const { SerialPort } = require("serialport");  // ✅ FIXED import

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

    let lines = rxBuffer.split(/\r?\n/);
    rxBuffer = lines.pop();

    for (let line of lines) {
        if (line.trim().length > 0) {
            console.log(`[MBED] ${line.trim()}`);
        }
    }
});

const pad = (value, length, decimals = 0) => {
    const num = (decimals > 0 ? value.toFixed(decimals) : Math.round(value)).toString();
    return num.padStart(length, '0');
};

const toTF = (bool) => (bool ? 'T' : 'F');

let fuelInjectionTotal = 0;
let fuelInjectionHistory = [];

let lastFuelAmount = 0;
let lastFuelMeasurement = 0;

function updateFuelInjection(data) {
    const now = Date.now();

    if (lastFuelMeasurement !== 0 && data.fuel < lastFuelAmount) {
        const deltaFuel = lastFuelAmount - data.fuel;
        const deltaTimeMin = (now - lastFuelMeasurement) / 60000;

        if (deltaTimeMin > 0 && deltaTimeMin < 5) {
            const estimatedFuelTankL = 60
            const litersUsed = deltaFuel * estimatedFuelTankL;
            const ulUsed = litersUsed * 1000000;

            fuelInjectionHistory.push(ulUsed);
            if (fuelInjectionHistory.length > 10) {
                fuelInjectionHistory.shift();
            }

            const avgUlUsed = fuelInjectionHistory.reduce((a, b) => a + b, 0) / fuelInjectionHistory.length;
            const cylinders = 6;
            const combustionEventsPerMin = data.rpm;

            // Total time interval in minutes
            const totalTimeMin = deltaTimeMin * fuelInjectionHistory.length;

            // Total combustion events over all those intervals
            const totalCombustions = combustionEventsPerMin * totalTimeMin;

            if (totalCombustions > 0) {
                const avgUlPerCycle = (avgUlUsed * cylinders) / totalCombustions;

                // Add per-cycle injection to cumulative counter
                fuelInjectionTotal = (fuelInjectionTotal + Math.round(avgUlPerCycle)) & 0xFFFF;
            }
        }
    }

    lastFuelAmount = data.fuel;
    lastFuelMeasurement = now;

    return fuelInjectionTotal;
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
        clutch: buff.readFloatLE(56)
    };

    console.log(data);

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

    const injectionCounter = updateFuelInjection(data);

    const asciiMsg =
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
        pad(injectionCounter, 5)

    if (serialPort.isOpen) {
        serialPort.write(asciiMsg + "\n");
    }
});

server.bind(4444);
console.log("UDP server listening on port 4444.");
