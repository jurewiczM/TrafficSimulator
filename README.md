# Intersection & Roundabout Incident Simulator
> A React Native JS application designed to simulate, analyze, and visualize traffic incidents using AI agent behavior and environmental variables.

---

## The Big Picture
The app operates in two distinct phases:
* **Build Mode:** Draw custom intersections on a 29×29 grid using a variety of road and infrastructure tools.
* **Simulate Mode:** AI agents traverse your layout for a simulated week. Incidents are recorded based on personality traits, weather, and traffic density.

The entire system is contained within a single React component utilizing an optimized HTML5 Canvas for rendering and a state-driven control panel.

---

## 1. Constants & Data Definitions
The "Game Rules" are defined by four core data structures:

| Category | Details |
| :--- | :--- |
| **TOOLS** | 14 brushes (Roads 1-3 lanes, Roundabouts S/M/L, Crossings, Infrastructure, and Eraser). |
| **AGENT_PROFILES** | 8 archetypes (e.g., Motorbike: Fast/Aggressive vs. Bus: Slow/Cautious). |
| **INCIDENT_TYPES** | 5 severity levels ranging from Near Miss (38% probability) to Pile-up (5%). |
| **WEATHER_OPTS** | 7 types affecting risk. Ice increases risk by 2.5x, while Fog reduces visibility. |

---

## 2. The Grid Data Model
The layout is managed via two parallel 2D arrays (580px ÷ 20px cells):
1.  **grid[r][c]**: Stores road types (e.g., road_h2, roundabout_m).
2.  **infraGrid[r][c]**: Stores overlays like traffic_light or speed_bump.

> **Logic:** Helper functions like baseType() and laneCount() parse these strings dynamically to calculate traffic flow properties on the fly.

---

## 3. The Simulation Engine (runSimulation)
The core engine executes in three distinct stages:

### Stage A: Graph Construction
buildGraph() scans the grid to create nodes. 
* **Roads:** Connect linearly (Horizontal/Vertical).
* **Roundabouts:** Connect in 8 directions (including diagonals) to simulate circular flow.
* **Crossings:** Connect in 4 directions.

### Stage B: Pathfinding
findPath() utilizes a Breadth-First Search (BFS) from random edge nodes (entry/exit points). Neighbor ordering is randomized to ensure varied traffic patterns.

### Stage C: 7-Day Time Leap
The simulation iterates through every hour of a full week:
* **Traffic Volume:** Follows a Gaussian curve with peaks at 8:00 AM, 12:30 PM, and 5:30 PM.
* **Occupancy Map:** Tracks which agents occupy which nodes simultaneously.

### The Risk Equation
At the heart of every conflict is a multi-factor probability calculation:
$$prob = 0.06 \times speed \times caution \times (1 + aggr) \times weather \times infraMod ...$$

* **Infrastructure Impact:** A working traffic light reduces risk by 60% (0.4 multiplier).
* **Failure States:** If a light fails (based on lightFailRate), risk spikes to 2.2x, flagging the incident as lightFailed: true.

---

## 4. Canvas Renderer
The renderer uses high-DPI scaling for crisp visuals. The draw order ensures a layered depth:
1.  **Base:** Green grass background + subtle dot grid.
2.  **Roads:** Roundabouts (filled circles), Crossings (gold-dashed squares), Roads (lane dividers).
3.  **Infrastructure:** Traffic lights (tri-color circles), speed bumps (orange/white bars).
4.  **Heatmap:** Radial gradients scaled by cumulative incident severity.
5.  **Markers:** Glowing halos at incident coordinates.

---

## 5. Seeded RNG & State
* **Deterministic Logic:** Uses a Linear Congruential Generator. The same seed always produces the exact same crash results, allowing for scientific A/B testing of road layouts.
* **State Management:** ~15 state variables manage the UI tabs (Config/Weather/Agents) and real-time analytics.
* **Performance:** Analytics are wrapped in useMemo hooks, ensuring the UI remains fluid even with thousands of recorded incidents.

---

## Getting Started
1. Select a Road Tool and draw your intersection.
2. Add Infrastructure (Speed bumps/Lights) to high-risk areas.
3. Adjust Weather and Agent Density.
4. Click Simulate to generate the 7-day report and Heatmap.
