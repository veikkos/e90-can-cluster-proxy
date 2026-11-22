# BMW e90 CAN bus cluster proxy

This is a proxy between BeamNG or truck simulators (Euro Truck Simulator 2 or American Truck Simulator) and the BMW e90 CAN bus cluster. It receives the data from the game and sends it to the cluster via virtual serial port.

For BeamNG it creates an UDP server that listens for messages from the game. For the truck simulators [kniffen/TruckSim-Telemetry](https://github.com/kniffen/TruckSim-Telemetry) is used to receive the truck data.

See also https://github.com/veikkos/e90-can-cluster.

## Prerequisites 

- Node.js
- MSVC compiler
    - Needed for truck sims only
    - Possible to avoid by removing the `trucksim-telemetry` dependency and references to it in code if you only want BeamNG support

## Installation

```
npm install
```

## Run

```
npm run dev COM4 -- --beamng
```

or
```
 npm run dev COM4 -- --trucksim
```

Set the COM port number so that it matches your Arduino.

## Keys

Type in the terminal where the proxy runs:

- `12T` or `12F` and Enter: turn the custom warning symbol 12 on or off
- `B` and Enter: BC button (F-series)

## Binary serial protocol

The proxy sends the telemetry to the cluster firmware ([e90-can-cluster](https://github.com/veikkos/e90-can-cluster), [f02-can-cluster](https://github.com/veikkos/f02-can-cluster)) over a (virtual USB) serial port using a compact binary protocol. The baud rate is 921600 by default. If your Arduino has a software USB-serial, drop it to 115200 on both sides: `PC_SERIAL_BAUD` in the firmware and `baudRate` in `src/main.ts`.

Fields and bits marked F02 are used only by the F-series firmware.

### Frame Structure (Little Endian)

| Offset | Size | Field               | Description                          |
|--------|------|---------------------|--------------------------------------|
| 0      | 1    | `'S'`               | Start marker                         |
| 1      | 1    | `year`              | e.g., 25 = 2025                      |
| 2      | 1    | `month`             | 1–12                                 |
| 3      | 1    | `day`               | 1–31                                 |
| 4      | 1    | `hour`              | 0–23                                 |
| 5      | 1    | `minute`            | 0–59                                 |
| 6      | 1    | `second`            | 0–59                                 |
| 7      | 2    | `rpm`               | 0–65535                              |
| 9      | 2    | `speed`             | km/h × 10 (e.g. 853 = 85.3 km/h)     |
| 11     | 1    | `gear`              | 0 = R, 1 = N, 2+ = forward gears     |
| 12     | 1    | `water temp`        | °C                                   |
| 13     | 1    | `oil temp`          | °C                                   |
| 14     | 2    | `fuel`              | 0–1000 (% × 10)                      |
| 16     | 4    | `showlights`        | Bitfield of all light states (see tables below) |
| 20     | 1    | `showlights ext`    | Bitfield of extended light states (see tables below) |
| 21     | 2    | `fuel injection`    | microliters per 100 ms               |
| 23     | 2    | `custom light`      | Symbol ID (0–65535)                  |
| 25     | 1    | `custom light on`   | 1 = show, 0 = off                    |
| 26     | 1    | `gear extension`    | ASCII char: M = semi-automatic, S = sport mode, P = park, A = automatic, N = none |
| 27     | 2    | `cruise speed`      | km/h                                 |
| 29     | 1    | `cruise status`     | Bit 0: Active (1=on, 0=off), Bit 1: Vehicle ahead, Bit 2: Collision warning, Bits 3-5: Adaptive cruise following distance (1-4), Bit 6: Coasting (F02), Bit 7: BC button pressed (F02) |
| 30     | 1    | `ignition`          | 3 = starter, 2 = on, 1 = accessory only, 0 = off |
| 31     | 1    | `engine running`    | 1 = on, 0 = off                      |
| 32     | 2    | `ambient temp`      | Signed, °C × 10 (e.g. 215 = 21.5°C, -50 = -5.0°C) |
| 34     | 1    | `checksum`          | Additive checksum of all previous bytes excluding start marker |

### `showlights` Breakdown

```
Bit  0 : DL_SHIFT         (Shift light) UNUSED
Bit  1 : DL_FULLBEAM      (Full beam headlights)
Bit  2 : DL_HANDBRAKE     (Handbrake engaged)
Bit  3 : DL_DRIVEMODE_LO  (Drive mode, low bit) (F02)
Bit  4 : DL_TC            (Traction control active)
Bit  5 : DL_SIGNAL_L      (Left turn signal)
Bit  6 : DL_SIGNAL_R      (Right turn signal)
Bit  7 : DL_DRIVEMODE_HI  (Drive mode, high bit) (F02)
Bit  8 : DL_OILWARN       (Oil pressure warning)
Bit  9 : DL_BATTERY       (Battery warning) UNUSED
Bit 10 : DL_ABS           (ABS active/disabled) UNUSED
Bit 11 : DL_BEACON        (Truck beacon light is on)
Bit 12 : DL_LOWBEAM       (Low beam headlights)
Bit 13 : DL_ESC           (ESC active)
Bit 14 : DL_CHECKENGINE   (Check engine light)
Bit 15 : DL_CLUTCHTEMP    (Clutch temp warning)
Bit 16 : DL_FOGLIGHTS     (Fog lights on)
Bit 17 : DL_BRAKETEMP     (High brake temperature)
Bit 18 : DL_TIREFLAT_FL   (Front left tire deflated)
Bit 19 : DL_TIREFLAT_FR   (Front right tire deflated)
Bit 20 : DL_TIREFLAT_RL   (Rear left tire deflated)
Bit 21 : DL_TIREFLAT_RR   (Rear right tire deflated)
Bit 22 : DL_RADIATOR      (Radiator warning)
Bit 23 : DL_ENGINETEMP_Y  (Engine temp yellow)
Bit 24 : DL_ENGINETEMP_R  (Engine temp red)
Bit 25 : DL_DOOROPEN_FL   (Front left door open)
Bit 26 : DL_DOOROPEN_FR   (Front right door open)
Bit 27 : DL_DOOROPEN_RL   (Rear left door open)
Bit 28 : DL_DOOROPEN_RR   (Rear right door open)
Bit 29 : DL_TAILGATEOPEN  (Tailgate open)
Bit 30 : DL_TC_DISABLED   (Traction control disabled)
Bit 31 : DL_ESC_DISABLED  (ESC disabled)
```

Drive mode (F02): 0 = unknown, 1 = comfort, 2 = sport, 3 = sport+

### `showlights ext` Breakdown

```
Bit  0 : DL_EXT_YELLOW_TRIANGLE  (Generic warning, yellow)
Bit  1 : DL_EXT_RED_TRIANGLE     (Generic warning, red)
Bit  2 : DL_EXT_GEARBOX_ISSUE    (Gearbox issue)
Bit  3 : DL_EXT_EXCLAMATION_MARK (Generic exclamation mark)
Bit  4 : DL_EXT_ADBLUE_LOW       (AdBlue level low)
Bit  5 : DL_EXT_CHECKERED_FLAG   (Checkered flag, launch control)
Bit  6 : DL_EXT_LIMIT_YELLOW     (Speed limit, yellow)
Bit  7 : DL_EXT_LIMIT_RED        (Speed limit, red)
```
