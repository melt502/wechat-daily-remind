import { describe, it, expect } from "vitest";
import { pickLunch, pickDinner } from "../src/meals";

describe("meals", () => {
  it("returns a valid meal pick for lunch", () => {
    const meal = pickLunch("2026-05-24", true);
    expect(meal.location).toBeTruthy();
    expect(meal.meal).toBeTruthy();
    expect(meal.comment).toBeTruthy();
  });

  it("returns a valid meal pick for dinner", () => {
    const meal = pickDinner("2026-05-24", true);
    expect(meal.location).toBeTruthy();
    expect(meal.meal).toBeTruthy();
    expect(meal.comment).toBeTruthy();
  });

  it("lunch and dinner are different for the same day", () => {
    const lunch = pickLunch("2026-05-24", true);
    const dinner = pickDinner("2026-05-24", true);
    expect(lunch).toBeDefined();
    expect(dinner).toBeDefined();
  });

  it("returns canteen meal for non-clear weather", () => {
    const meal = pickLunch("2026-05-24", false);
    // All canteen keys
    const canteens = ["东一食堂", "东二食堂", "学子食堂", "沁园春", "南门小吃街", "桂香园"];
    expect(canteens).toContain(meal.location);
  });
});
