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

  it("gives a zero-height bar a full-height hit band anyway", () => {
    const bars = layoutBarChart([{ value: 0 }, { value: 10 }], 100, 50, 5, 2);
    expect(bars[0]!.barHeight).toBe(0);
    expect(bars[0]!.bandWidth).toBeGreaterThan(bars[0]!.barWidth);
    expect(bars.at(-1)!.bandX + bars.at(-1)!.bandWidth).toBe(100);
  });
});
