/**
 * HitBack extension smoke test
 *
 * HOW TO TEST ADS
 * 1. HitBack 0.5.14+ installed, window reloaded
 * 2. Signed in: Ctrl+Shift+P → "HitBack: Sign in"
 * 3. Quick check: Ctrl+Shift+P → "HitBack: Test Ad"
 * 4. Agent check: select the TODO block below → ask agent to implement it
 * 5. Watch for white "Sponsored" panel while agent edits this file
 * 6. Logs: View → Output → "HitBack"
 */

function assertFiniteNumber(value: number, name: string): void {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
}

export function add(a: number, b: number): number {
  assertFiniteNumber(a, "a");
  assertFiniteNumber(b, "b");
  return a + b;
}

export function multiply(a: number, b: number): number {
  assertFiniteNumber(a, "a");
  assertFiniteNumber(b, "b");
  return a * b;
}

export function divide(a: number, b: number): number {
  assertFiniteNumber(a, "a");
  assertFiniteNumber(b, "b");
  if (b === 0) {
    throw new RangeError("b must not be zero");
  }
  return a / b;
}

export function subtract(a: number, b: number): number {
  assertFiniteNumber(a, "a");
  assertFiniteNumber(b, "b");
  return a - b;
}

export function greet(name: string): string {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new TypeError("name must be a non-empty string");
  }
  return `Hello, ${name.trim()}`;
}

export function average(values: number[]): number {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError("values must be a non-empty array");
  }
  let sum = 0;
  for (const value of values) {
    assertFiniteNumber(value, "value");
    sum += value;
  }
  return sum / values.length;
}

export function clamp(value: number, min: number, max: number): number {
  assertFiniteNumber(value, "value");
  assertFiniteNumber(min, "min");
  assertFiniteNumber(max, "max");
  if (min > max) {
    throw new RangeError("min must not be greater than max");
  }
  return Math.min(max, Math.max(min, value));
}

export interface Point {
  x: number;
  y: number;
}

export function distance(a: Point, b: Point): number {
  assertFiniteNumber(a.x, "a.x");
  assertFiniteNumber(a.y, "a.y");
  assertFiniteNumber(b.x, "b.x");
  assertFiniteNumber(b.y, "b.y");
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function midpoint(a: Point, b: Point): Point {
  assertFiniteNumber(a.x, "a.x");
  assertFiniteNumber(a.y, "a.y");
  assertFiniteNumber(b.x, "b.x");
  assertFiniteNumber(b.y, "b.y");
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function inCircle(point: Point, center: Point, radius: number): boolean {
  assertFiniteNumber(radius, "radius");
  if (radius < 0) {
    throw new RangeError("radius must not be negative");
  }
  return distance(point, center) <= radius;
}

export interface OrderLine {
  sku: string;
  quantity: number;
  unitPriceCents: number;
}

export function lineTotalCents(line: OrderLine): number {
  assertFiniteNumber(line.quantity, "quantity");
  assertFiniteNumber(line.unitPriceCents, "unitPriceCents");
  if (line.quantity < 0 || line.unitPriceCents < 0) {
    throw new RangeError("quantity and unitPriceCents must not be negative");
  }
  return line.quantity * line.unitPriceCents;
}

export function orderSubtotalCents(lines: OrderLine[]): number {
  if (!Array.isArray(lines)) {
    throw new TypeError("lines must be an array");
  }
  return lines.reduce((sum, line) => sum + lineTotalCents(line), 0);
}

export function skusOverQuantity(lines: OrderLine[], minQty: number): string[] {
  assertFiniteNumber(minQty, "minQty");
  if (!Array.isArray(lines)) {
    throw new TypeError("lines must be an array");
  }
  return lines
    .filter((line) => line.quantity >= minQty)
    .map((line) => line.sku)
    .sort();
}

// --- AGENT TODO: select from here to "end agent TODO" and ask Cursor to implement ---

export interface TemperatureReading {
  celsius: number;
  recordedAt: string;
}

/**
 * TODO(agent): Implement these temperature helpers.
 *
 * - toFahrenheit(celsius): (c * 9/5) + 32
 * - averageCelsius(readings): mean celsius (empty array throws)
 * - hottest(readings): reading with highest celsius (empty array throws)
 */
export function toFahrenheit(_celsius: number): number {
  throw new Error("TODO: implement toFahrenheit");
}

export function averageCelsius(_readings: TemperatureReading[]): number {
  throw new Error("TODO: implement averageCelsius");
}

export function hottest(_readings: TemperatureReading[]): TemperatureReading {
  throw new Error("TODO: implement hottest");
}

// --- end agent TODO ---

function runTests(): void {
  const ok = (cond: boolean, label: string): void => {
    if (!cond) {
      throw new Error(`FAIL: ${label}`);
    }
    console.log(`ok ${label}`);
  };

  const throws = (fn: () => void, label: string): void => {
    try {
      fn();
      throw new Error(`FAIL: ${label} (expected throw)`);
    } catch {
      console.log(`ok ${label}`);
    }
  };

  ok(add(2, 3) === 5, "add");
  ok(subtract(10, 4) === 6, "subtract");
  ok(multiply(3, 4) === 12, "multiply");
  ok(divide(10, 2) === 5, "divide");
  ok(greet("Ada") === "Hello, Ada", "greet");
  ok(average([2, 4, 6]) === 4, "average");
  ok(clamp(15, 0, 10) === 10, "clamp high");
  ok(clamp(-3, 0, 10) === 0, "clamp low");
  ok(clamp(7, 0, 10) === 7, "clamp inside");

  ok(distance({ x: 0, y: 0 }, { x: 3, y: 4 }) === 5, "distance");
  ok(midpoint({ x: 0, y: 0 }, { x: 4, y: 6 }).x === 2, "midpoint x");
  ok(midpoint({ x: 0, y: 0 }, { x: 4, y: 6 }).y === 3, "midpoint y");
  ok(inCircle({ x: 1, y: 0 }, { x: 0, y: 0 }, 2), "inCircle inside");
  ok(!inCircle({ x: 3, y: 0 }, { x: 0, y: 0 }, 2), "inCircle outside");

  ok(lineTotalCents({ sku: "A", quantity: 2, unitPriceCents: 150 }) === 300, "lineTotalCents");
  ok(
    orderSubtotalCents([
      { sku: "A", quantity: 1, unitPriceCents: 100 },
      { sku: "B", quantity: 2, unitPriceCents: 50 },
    ]) === 200,
    "orderSubtotalCents"
  );
  ok(
    skusOverQuantity(
      [
        { sku: "Z", quantity: 1, unitPriceCents: 10 },
        { sku: "A", quantity: 5, unitPriceCents: 10 },
      ],
      3
    ).join(","),
    "A",
    "skusOverQuantity"
  );

  throws(() => add(Number.NaN, 1), "add rejects NaN");
  throws(() => divide(1, 0), "divide rejects zero");
  throws(() => greet("   "), "greet rejects empty");
  throws(() => average([]), "average rejects empty");

  // Temperature TODO tests — uncomment after agent implements the block above
  // ok(toFahrenheit(0) === 32, "toFahrenheit freezing");
  // ok(toFahrenheit(100) === 212, "toFahrenheit boiling");
  // ok(averageCelsius([
  //   { celsius: 10, recordedAt: "a" },
  //   { celsius: 20, recordedAt: "b" },
  // ]) === 15, "averageCelsius");
  // ok(hottest([
  //   { celsius: 10, recordedAt: "a" },
  //   { celsius: 25, recordedAt: "b" },
  // ]).celsius === 25, "hottest");

  console.log("\nAll hitback-agent-test checks passed.");
}

const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1]?.replace(/\\/g, "/").endsWith("hitback-agent-test.ts");

if (isDirectRun) {
  runTests();
}
