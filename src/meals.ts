import { canteens } from "./data/canteens";
import { offcampus } from "./data/offcampus";
import { mealComments } from "./data/comments";

export type MealPick = {
  location: string;
  meal: string;
  comment: string;
};

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function hashDay(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function pickMeal(dateSeed: string, isClearLike: boolean): MealPick {
  const useOffCampus = isClearLike && Math.random() < 0.1;

  const pool = useOffCampus ? offcampus : canteens;
  const locationNames = Object.keys(pool);
  const location = pickRandom(locationNames);
  const meal = pickRandom(pool[location]);

  const idx = hashDay(`${dateSeed}:${location}:${meal}`) % mealComments.length;
  const comment = mealComments[idx];

  return { location, meal, comment };
}

export function pickLunch(dateSeed: string, isClearLike: boolean): MealPick {
  return pickMeal(`lunch:${dateSeed}`, isClearLike);
}

export function pickDinner(dateSeed: string, isClearLike: boolean): MealPick {
  return pickMeal(`dinner:${dateSeed}`, isClearLike);
}
