# BMW e90 CAN bus cluster proxy

This is a proxy between BeamNG or truck simulators (Euro Truck Simulator 2 or American Truck Simulator) and the BMW e90 CAN bus cluster. It receives the data from the game and sends it to the cluster via virtual serial port.

For BeamNG it creates an UDP server that listens for messages from the game. For the truck simulators [kniffen/TruckSim-Telemetry](https://github.com/kniffen/TruckSim-Telemetry) is used to receive the truck data.

See also https://github.com/veikkos/e90-can-cluster.
