import type { BallSpec, TableConfig, TableOrientation, TableStatus } from "../types";

export function getBalls(table: TableConfig, status: TableStatus): BallSpec[] {
  if (status === "available") {
    if (table.game === "snooker") return snookerRack();
    return poolRack(table.orientation);
  }

  if (table.game === "snooker") return snookerBreak(table.id);
  return poolBreak(table.orientation, table.id);
}

function snookerRack(): BallSpec[] {
  const balls: BallSpec[] = [];
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col <= row; col += 1) {
      balls.push({
        id: `red-${row}-${col}`,
        x: 50 + (col - row / 2) * 4.1,
        y: 36 - row * 2.6,
        color: "#c9302c",
        size: "small"
      });
    }
  }

  return [
    { id: "black", x: 50, y: 13, color: "#111111" },
    ...balls,
    { id: "pink", x: 50, y: 42, color: "#d47aa4" },
    { id: "blue", x: 50, y: 50, color: "#2c64c7" },
    { id: "brown", x: 50, y: 73, color: "#8b5531" },
    { id: "yellow", x: 65, y: 73, color: "#e5c33b" },
    { id: "green", x: 35, y: 73, color: "#1f8a4c" },
    { id: "cue", x: 50, y: 78, color: "#f6f1df" }
  ];
}

function poolRack(orientation: TableOrientation): BallSpec[] {
  const rackOrder = [1, 10, 3, 15, 8, 2, 6, 11, 4, 14, 5, 13, 9, 7, 12];
  const rack: BallSpec[] = [];

  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col <= row; col += 1) {
      const index = rack.length;
      const position =
        orientation === "landscape"
          ? { x: 69 + row * 3.4, y: 50 + (col - row / 2) * 5.8 }
          : { x: 50 + (col - row / 2) * 5.1, y: 68 + row * 3.5 };
      rack.push({ id: `rack-${index}`, ...position, ...poolBall(rackOrder[index]), size: "normal" });
    }
  }

  const cue = orientation === "landscape" ? { x: 25, y: 50 } : { x: 50, y: 27 };
  return [{ id: "cue", ...cue, color: "#f6f1df", kind: "cue" }, ...rack];
}

function snookerBreak(seed: string): BallSpec[] {
  const offset = seedOffset(seed) * 0.5;
  // Mid-frame spread: reds fanned across the upper two-thirds, colours sitting
  // near their spots but nudged, cue loose in the baulk half.
  const reds = [
    [47, 44],
    [56, 46],
    [50, 52],
    [59, 40],
    [43, 49],
    [31, 24],
    [64, 21],
    [72, 34],
    [35, 62],
    [67, 58]
  ].map(([x, y], index) => ({
    id: `red-break-${index}`,
    x: x + (index % 2 === 0 ? offset : -offset),
    y,
    color: "#c9302c",
    size: "small" as const
  }));

  return [
    { id: "black", x: 50, y: 13, color: "#111111" },
    { id: "pink", x: 52, y: 39, color: "#d47aa4" },
    ...reds,
    { id: "blue", x: 47, y: 50, color: "#2c64c7" },
    { id: "brown", x: 50, y: 69, color: "#8b5531" },
    { id: "yellow", x: 64, y: 72, color: "#e5c33b" },
    { id: "green", x: 36, y: 72, color: "#1f8a4c" },
    { id: "cue", x: 42, y: 80, color: "#f6f1df" }
  ];
}

function poolBreak(orientation: TableOrientation, seed: string): BallSpec[] {
  const offset = seedOffset(seed);
  const points =
    orientation === "landscape"
      ? [
          [24, 49],
          [38, 34],
          [48, 56],
          [57, 43],
          [66, 64],
          [73, 30],
          [81, 51],
          [61, 24],
          [35, 67],
          [87, 70]
        ]
      : [
          [50, 24],
          [36, 38],
          [58, 45],
          [43, 54],
          [64, 62],
          [32, 70],
          [52, 76],
          [70, 82],
          [39, 88],
          [61, 32]
        ];
  const order = [0, 1, 9, 3, 11, 5, 13, 8, 7, 15];

  return points.map(([x, y], index) => ({
    id: `pool-break-${index}`,
    x: x + (index % 2 === 0 ? offset : -offset),
    y,
    ...(order[index] === 0 ? { color: "#f6f1df", kind: "cue" as const } : poolBall(order[index])),
    size: "normal"
  }));
}

function poolBall(number: number): Pick<BallSpec, "color" | "stripeColor" | "label" | "kind"> {
  const solidColors: Record<number, string> = {
    1: "#f2c230",
    2: "#2358b8",
    3: "#bf2f2c",
    4: "#6d3c91",
    5: "#e16f26",
    6: "#1d7d4c",
    7: "#7a2d28",
    8: "#111111"
  };

  if (number <= 8) {
    return {
      color: solidColors[number],
      label: String(number),
      kind: "solid"
    };
  }

  return {
    color: "#f8f3e5",
    stripeColor: solidColors[number - 8],
    label: String(number),
    kind: "stripe"
  };
}

function seedOffset(seed: string) {
  return ((seed.charCodeAt(seed.length - 1) || 0) % 13) - 6;
}
