'use strict';

const udp = require("udp-hub");
const tst = require("trucksim-telemetry")
const { SerialPort } = require("serialport");
const readline = require("readline");

const args = process.argv.slice(2);
const isBeamngMode = args.includes("--beamng");
const isTruckSimMode = args.includes("--trucksim");
const portName = process.argv[2];

if (!portName) {
    console.log(`Usage e.g. 'COM1 -- --beamng' or 'COM1 -- --trucksim'`);
    process.exit()
}

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
function updateFuelInjection(fuel, fuelCapacity) {
    const now = Date.now();
    const deltaFuel = lastFuelAmount - fuel;
    const deltaTimeMin = (now - lastFuelMeasurement) / 60000;

    lastFuelAmount = fuel;
    lastFuelMeasurement = now;

    if (deltaFuel > 0 && deltaTimeMin > 0 && deltaTimeMin < 5) {
        fuelInjectionHistory.push({
            fuelPct: fuel,
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

function encodeCarData(params: {
    now: Date;
    rpm: number;
    speed: number;
    gear: number;
    waterTemp: number;
    oilTemp: number;
    fuel: number;
    showlights: number;
    showlightsExt: number;
    injectionValue: number;
    customLightNumber: string;
    customLightState: boolean;
    gearMode: string;
    cruiseSpeed: number;
    cruiseMode: number;
    ignitionState: number;
    engineState: number;
}): Buffer {
    const buffer = Buffer.alloc(33); // 30 + checksum + marker
    let offset = 0;

    buffer.writeUInt8('S'.charCodeAt(0), offset++); // Start marker

    buffer.writeUInt8(params.now.getFullYear() % 2000, offset++);
    buffer.writeUInt8(params.now.getMonth() + 1, offset++);
    buffer.writeUInt8(params.now.getDate(), offset++);
    buffer.writeUInt8(params.now.getHours(), offset++);
    buffer.writeUInt8(params.now.getMinutes(), offset++);
    buffer.writeUInt8(params.now.getSeconds(), offset++);

    buffer.writeUInt16LE(Math.max(0, Math.min(65535, Math.round(params.rpm))), offset); offset += 2;
    buffer.writeUInt16LE(Math.round(params.speed * 3.6 * 10), offset); offset += 2;  // speed x10
    buffer.writeUInt8(params.gear, offset++);
    buffer.writeUInt8(Math.round(params.waterTemp) & 0xFF, offset++);
    buffer.writeUInt8(Math.round(params.oilTemp) & 0xFF, offset++);
    buffer.writeUInt16LE(Math.round(params.fuel * 1000), offset); offset += 2;

    buffer.writeInt32LE(params.showlights, offset); offset += 4;
    buffer.writeUInt8(params.showlightsExt, offset++);

    buffer.writeUInt16LE(Math.min(params.injectionValue, 9999), offset); offset += 2;
    buffer.writeUInt16LE(parseInt(params.customLightNumber), offset); offset += 2;
    buffer.writeUInt8(params.customLightState ? 1 : 0, offset++);
    buffer.writeUInt8(params.gearMode.charCodeAt(0), offset++);
    buffer.writeUInt16LE(Math.round(params.cruiseSpeed * 3.6 * 10), offset); offset += 2;
    buffer.writeUInt8(params.cruiseMode, offset++);
    buffer.writeUInt8(params.ignitionState, offset++);
    buffer.writeUInt8(params.engineState, offset++);

    let checksum = 0;
    for (let i = 1; i < offset; i++) {
        checksum = (checksum + buffer[i]) & 0xFF;
    }

    buffer.writeUInt8(checksum, offset++);

    return buffer;
}

if (isBeamngMode) {
    const server = udp.createServer(function (buff) {
        const data = {
            car: buff.toString('ascii', 4, 8),
            flags: buff.readUInt16LE(8),
            gear: buff.readUInt8(10),
            plid: buff.readUInt8(11),
            speed: buff.readFloatLE(12),
            rpm: buff.readFloatLE(16),
            turbo: buff.readFloatLE(20),
            waterTemp: buff.readFloatLE(24),
            fuel: buff.readFloatLE(28),
            oilpressure: buff.readFloatLE(32),
            oilTemp: buff.readFloatLE(36),
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

        const buffer = encodeCarData({
            now: new Date(),
            rpm: data.rpm,
            speed: data.speed,
            gear: data.gear,
            waterTemp: data.waterTemp,
            oilTemp: data.oilTemp,
            fuel: data.fuel,
            showlights: data.showlights,
            showlightsExt: 0,
            injectionValue: updateFuelInjection(data.fuel, data.fuelCapacity),
            customLightNumber: customLightNumber,
            customLightState: customLightState,
            gearMode: data.gearMode,
            cruiseSpeed: data.cruiseSpeed,
            cruiseMode: data.cruiseMode,
            ignitionState: data.ignitionState,
            engineState: data.engineState
        });

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
} else if (isTruckSimMode) {
    const telemetry = tst()

    function computeDashlights(truck: any): number {
        const DL_SHIFT        = 1 << 0;
        const DL_FULLBEAM     = 1 << 1;
        const DL_HANDBRAKE    = 1 << 2;
        const DL_TC           = 1 << 4;
        const DL_SIGNAL_L     = 1 << 5;
        const DL_SIGNAL_R     = 1 << 6;
        const DL_OILWARN      = 1 << 8;
        const DL_BATTERY      = 1 << 9;
        const DL_ABS          = 1 << 10;
        const DL_BEACON       = 1 << 11;
        const DL_LOWBEAM      = 1 << 12;
        const DL_ESC          = 1 << 13;
        const DL_CHECKENGINE  = 1 << 14;
        const DL_CLUTCHTEMP   = 1 << 15;
        const DL_FOGLIGHTS    = 1 << 16;

        return (
            (truck.lights.beamHigh.enabled ? DL_FULLBEAM : 0) |
            (truck.lights.beamLow.enabled || truck.lights.parking.enabled ? DL_LOWBEAM : 0) |
            (truck.lights.blinker.left.enabled || truck.lights.hazard.enabled ? DL_SIGNAL_L : 0) |
            (truck.lights.blinker.right.enabled || truck.lights.hazard.enabled ? DL_SIGNAL_R : 0) |
            (truck.brakes.parking.enabled ? DL_HANDBRAKE : 0) |
            (truck.engine.oilPressure.warning.enabled ? DL_OILWARN : 0) |
            (truck.engine.batteryVoltage.warning.enabled ? DL_BATTERY : 0) |
            (truck.engine.damage >= 0.2 ? DL_CHECKENGINE : 0) |
            (truck.lights.beacon.enabled ? DL_BEACON : 0)
        );
    }

    function computeDashlightsExt(truck: any): number {
        const DL_EXT_YELLOWTRIANGLE     = 1 << 0;
        const DL_EXT_REDTRIANGLE        = 1 << 1;
        const DL_EXT_GEARBOX_ISSUE      = 1 << 2;
        const DL_EXT_BRAKERED           = 1 << 3;

        return (
            (truck.transmission.damage > 0.1 ? DL_EXT_GEARBOX_ISSUE : 0) |
            (truck.brakes.airPressure.warning.enabled && !truck.brakes.airPressure.emergency.enabled ? DL_EXT_YELLOWTRIANGLE : 0) |
            (truck.brakes.airPressure.emergency.enabled ? DL_EXT_REDTRIANGLE : 0) |
            (truck.brakes.retarder.steps && truck.brakes.retarder.level ? DL_EXT_BRAKERED : 0)
        );
    }

    function getGameClockTime(minutesSinceMidnight: number): Date {
        const now = new Date();
        const hours = Math.floor(minutesSinceMidnight / 60) % 24;
        const minutes = minutesSinceMidnight % 60;

        const gameDate = new Date(now);
        gameDate.setHours(hours, minutes, 0, 0);

        return gameDate;
    }

    function update(data: any) {
        const truck = data.truck;

        const rpm = truck.engine.rpm.value ?? 0;
        const speed = data.game.paused ? 0 : Math.abs(truck.speed.value ?? 0);

        const gearDisplayed = truck.transmission.gear.displayed ?? 0;

        const gear = Math.max(0, gearDisplayed + 1);
        const gearMode =
            gear >= 1 ? "A" :
            gearDisplayed < 0 ? "R" : "N";

        const cruiseSpeed = truck.cruiseControl.kph ?? 0;
        const cruiseMode = truck.cruiseControl.enabled ? 1 : 0;

        const waterTemp = Math.round(truck.engine.waterTemperature?.value ?? 0);
        const oilTemp = Math.round(truck.engine.oilTemperature?.value ?? 0);
        const fuelPct = truck.fuel.value / (truck.fuel.capacity || 1);

        const buffer = encodeCarData({
            now: getGameClockTime(data.game.time.value),
            rpm: rpm,
            speed: speed,
            gear: gear,
            waterTemp: waterTemp,
            oilTemp: oilTemp,
            fuel: Math.min(Math.max(fuelPct, 0), 1),
            showlights: computeDashlights(truck),
            showlightsExt: computeDashlightsExt(truck),
            injectionValue: 0,
            customLightNumber: customLightNumber,
            customLightState: customLightState,
            gearMode: gearMode,
            cruiseSpeed: cruiseSpeed / 3.6,
            cruiseMode: cruiseMode,
            ignitionState: truck.electric.enabled ? 2 : 0,
            engineState: truck.engine.enabled ? 1 : 0
        });

        if (serialPort.isOpen) {
            serialPort.write(buffer);
        }
    }

    telemetry.watch({interval: 50}, update)
    console.log("Started truck simulator proxy.");
} else {
    console.log("Use '--beamng' or '--trucksim' to enable the proxy.");
    process.exit()
}

// Graceful shutdown
process.on("SIGINT", () => {
    console.log("\nExiting...");
    if (lightLoopTimer) {
        clearInterval(lightLoopTimer);
    }
    rl.close();
    serialPort.close(() => process.exit(0));
});
