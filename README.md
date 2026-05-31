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
