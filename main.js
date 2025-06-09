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

const server = udp.createServer(function (buff) {
    const data = {
        car: buff.toString('ascii', 4, 8),
        flags: buff.readUInt8(9),
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

    const asciiMsg =
        pad(data.rpm, 5) +
        pad(data.speed * 3.6 * 10, 4) +
        pad(data.gear, 1) +
        pad(data.engtemp, 3) +
        pad(data.fuel * 1000, 4) +
        toTF(data.throttle > 0.5) +
        toTF(data.brake > 0.5) +
        toTF(data.clutch > 0.5);

    if (serialPort.isOpen) {
        serialPort.write(asciiMsg + "\n");
    }
});

server.bind(4444);
console.log("UDP server listening on port 4444.");
