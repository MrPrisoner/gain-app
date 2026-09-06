import { describe, expect, it } from "vitest";
import { layoutBarChart, layoutLineChart } from "../../src/lib/progress/chart-geometry";

describe("layoutLineChart", () => {
  it("maps two points to the plot's corners", () => {
    const { plotted, path } = layoutLineChart(
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      300,
      100,
      10,
    );
    expect(plotted[0]!).toMatchObject({ cx: 10, cy: 90 });
    expect(plotted[1]!).toMatchObject({ cx: 290, cy: 10 });
    expect(path).toBe("M 10.0 90.0 L 290.0 10.0");
  });

  it("centers a single point horizontally rather than dividing by a zero span", () => {
    const { plotted } = layoutLineChart([{ x: 5, y: 5 }], 300, 100, 10);
    expect(plotted[0]!.cx).toBe(150);
  });

  it("returns no plotted points and an empty path for no data", () => {
    expect(layoutLineChart([], 300, 100, 10)).toEqual({ plotted: [], path: "" });
  });

  it("carries the label through to the plotted point", () => {
    const { plotted } = layoutLineChart([{ x: 0, y: 0, label: "12" }], 300, 100, 10);
    expect(plotted[0]!.label).toBe("12");
  });

  it("tiles hit bands edge to edge, splitting each gap between neighbours", () => {
    const { plotted } = layoutLineChart(
      [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
        { x: 10, y: 10 },
      ],
      300,
      100,
      10,
    );
    // Centres at 10, 150 and 290: the interior edges land midway, at 80 and 220.
    expect(plotted.map((p) => [p.bandX, p.bandWidth])).toEqual([
      [0, 80],
      [80, 140],
      [220, 80],
    ]);
    // No dead zone anywhere in the chart: every tap belongs to exactly one mark.
    expect(plotted.at(-1)!.bandX + plotted.at(-1)!.bandWidth).toBe(300);
  });

  it("gives a single point the whole chart as its hit band", () => {
    const { plotted } = layoutLineChart([{ x: 5, y: 5 }], 300, 100, 10);
    expect(plotted[0]!).toMatchObject({ bandX: 0, bandWidth: 300 });
  });
});

describe("layoutLineChart with an explicit y-domain", () => {
  const points = [
    { x: 0, y: 2 },
    { x: 1, y: 3 },
  ];

  it("scales against the given domain, not the data's own range", () => {
    // Domain 0-10 in a 120-tall chart with 20 padding: the plot area is 80 tall, so
    // y=2 sits 16px up from the baseline (100) and y=3 sits 24px up.
    const { plotted } = layoutLineChart(points, 320, 120, 20, [0, 10]);
    expect(plotted[0]?.cy).toBeCloseTo(84);
    expect(plotted[1]?.cy).toBeCloseTo(76);
  });

  it("auto-scales exactly as before when the domain is omitted", () => {
    const { plotted } = layoutLineChart(points, 320, 120, 20);
    expect(plotted[0]?.cy).toBeCloseTo(100);
    expect(plotted[1]?.cy).toBeCloseTo(20);
  });

  it("keeps a flat series on the baseline rather than dividing by zero", () => {
    const { plotted } = layoutLineChart([{ x: 0, y: 5 }], 320, 120, 20, [5, 5]);
    expect(Number.isFinite(plotted[0]?.cy ?? NaN)).toBe(true);
  });
});

describe("layoutBarChart", () => {
  it("sizes each bar relative to the tallest value", () => {
    const bars = layoutBarChart([{ value: 10 }, { value: 20 }, { value: 5 }], 100, 50, 5, 2);
    expect(bars[0]!).toMatchObject({ x: 5, y: 25, barHeight: 20 });
    expect(bars[1]!).toMatchObject({ y: 5, barHeight: 40 });
    expect(bars[2]!).toMatchObject({ y: 35, barHeight: 10 });
    expect(bars[0]!.barWidth).toBeCloseTo((90 - 4) / 3, 4);
  });

  it("returns an empty array for no data", () => {
    expect(layoutBarChart([], 100, 50, 5, 2)).toEqual([]);
  });

  it("treats an all-zero dataset as a flat baseline rather than dividing by zero", () => {
    const bars = layoutBarChart([{ value: 0 }, { value: 0 }], 100, 50, 5, 2);
    expect(bars[0]!.barHeight).toBe(0);
  });

  it("keeps every bar drawable however many there are, by yielding the gap first", () => {
    // The hub's own geometry: 320 wide, 20 padding, 4 gap. At the requested gap the bar
    // width hits zero at 71 bars and goes negative past it, and an SVG rect with a
    // non-positive width renders nothing — the chart would empty out in silence rather
    // than look cramped. 200 bars is well past anything a real log produces.
    for (const n of [26, 52, 71, 104, 200]) {
      const bars = layoutBarChart(
        Array.from({ length: n }, () => ({ value: 1 })),
        320,
        120,
        20,
        4,
      );
      expect(bars).toHaveLength(n);
      for (const bar of bars) expect(bar.barWidth).toBeGreaterThan(0);
      // Still inside the plot: the last bar's right edge lands on the padding, not past it.
      expect(bars.at(-1)!.x + bars.at(-1)!.barWidth).toBeLessThanOrEqual(300 + 1e-9);
    }
  });

  it("leaves the requested gap alone at the bar counts callers actually render", () => {
    // The clamp is a floor, not a redesign — three bars must lay out exactly as before.
    const bars = layoutBarChart([{ value: 10 }, { value: 20 }, { value: 5 }], 100, 50, 5, 2);
    expect(bars[1]!.x - bars[0]!.x).toBeCloseTo(bars[0]!.barWidth + 2, 6);
  });

  it("gives a zero-height bar a full-height hit band anyway", () => {
    const bars = layoutBarChart([{ value: 0 }, { value: 10 }], 100, 50, 5, 2);
    expect(bars[0]!.barHeight).toBe(0);
    expect(bars[0]!.bandWidth).toBeGreaterThan(bars[0]!.barWidth);
    expect(bars.at(-1)!.bandX + bars.at(-1)!.bandWidth).toBe(100);
  });
});
