import type { NutrientSnapshot } from '@/domain/nutrition';

export interface FoodItem {
  id: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  builtin: boolean;
  snapshot: NutrientSnapshot;
}

export const BASELINE_SOURCE = 'USDA FoodData Central (public domain), values rounded';
export const BASELINE_ATTRIBUTION =
  'Baseline staple foods are generic values rounded from U.S. Department of Agriculture, Agricultural Research Service, FoodData Central (fdc.nal.usda.gov), which is in the public domain. Values are approximate and vary by product and preparation.';

// [id, name, kcal, protein, carbs, fat] per 100 g (or per 100 mL when ml = true), optional serving [label, grams|mL]
type F = [string, string, number, number, number, number, ([string, number] | null)?, boolean?];
const RAW: F[] = [
  ['f_chicken_breast', 'Chicken breast, cooked', 165, 31, 0, 3.6],
  ['f_chicken_thigh', 'Chicken thigh, cooked', 209, 26, 0, 10.9],
  ['f_beef_mince_lean', 'Beef mince, lean, cooked', 217, 26, 0, 12],
  ['f_salmon', 'Salmon, cooked', 206, 22, 0, 12],
  ['f_tuna_canned', 'Tuna, canned in water', 116, 26, 0, 1],
  ['f_egg', 'Egg, whole', 143, 12.6, 0.7, 9.5, ['1 large egg', 50]],
  ['f_egg_white', 'Egg white', 52, 10.9, 0.7, 0.2],
  ['f_tofu', 'Tofu, firm', 144, 17, 3, 9],
  ['f_lentils', 'Lentils, cooked', 116, 9, 20, 0.4],
  ['f_chickpeas', 'Chickpeas, cooked', 164, 8.9, 27, 2.6],
  ['f_black_beans', 'Black beans, cooked', 132, 8.9, 24, 0.5],
  ['f_greek_yogurt', 'Greek yogurt, plain, nonfat', 59, 10, 3.6, 0.4],
  ['f_cottage_cheese', 'Cottage cheese, low fat', 82, 11, 4.3, 2.3],
  ['f_cheddar', 'Cheddar cheese', 403, 23, 3.4, 33],
  ['f_milk_whole', 'Milk, whole', 61, 3.2, 4.8, 3.3, ['1 cup', 240], true],
  ['f_milk_skim', 'Milk, skim', 34, 3.4, 5, 0.1, ['1 cup', 240], true],
  ['f_oats', 'Oats, rolled, dry', 379, 13, 68, 6.5],
  ['f_rice_white', 'White rice, cooked', 130, 2.7, 28, 0.3],
  ['f_rice_brown', 'Brown rice, cooked', 123, 2.7, 26, 1],
  ['f_pasta', 'Pasta, cooked', 158, 5.8, 31, 0.9],
  ['f_quinoa', 'Quinoa, cooked', 120, 4.4, 21, 1.9],
  ['f_bread_whole', 'Bread, whole wheat', 252, 12, 43, 3.5, ['1 slice', 32]],
  ['f_bread_white', 'Bread, white', 266, 8.9, 49, 3.3, ['1 slice', 28]],
  ['f_tortilla', 'Flour tortilla', 304, 8, 50, 8, ['1 tortilla', 45]],
  ['f_potato', 'Potato, boiled', 87, 1.9, 20, 0.1],
  ['f_sweet_potato', 'Sweet potato, baked', 90, 2, 21, 0.2],
  ['f_banana', 'Banana', 89, 1.1, 23, 0.3, ['1 medium', 118]],
  ['f_apple', 'Apple', 52, 0.3, 14, 0.2, ['1 medium', 182]],
  ['f_orange', 'Orange', 47, 0.9, 12, 0.1, ['1 medium', 131]],
  ['f_blueberries', 'Blueberries', 57, 0.7, 14, 0.3],
  ['f_strawberries', 'Strawberries', 32, 0.7, 7.7, 0.3],
  ['f_broccoli', 'Broccoli, cooked', 35, 2.4, 7.2, 0.4],
  ['f_spinach', 'Spinach, raw', 23, 2.9, 3.6, 0.4],
  ['f_carrot', 'Carrot, raw', 41, 0.9, 10, 0.2],
  ['f_tomato', 'Tomato', 18, 0.9, 3.9, 0.2],
  ['f_cucumber', 'Cucumber', 15, 0.7, 3.6, 0.1],
  ['f_bell_pepper', 'Bell pepper', 26, 1, 6, 0.3],
  ['f_avocado', 'Avocado', 160, 2, 8.5, 14.7],
  ['f_olive_oil', 'Olive oil', 884, 0, 0, 100, ['1 tbsp', 13.5]],
  ['f_butter', 'Butter', 717, 0.9, 0.1, 81, ['1 tbsp', 14]],
  ['f_peanut_butter', 'Peanut butter', 588, 25, 20, 50, ['1 tbsp', 16]],
  ['f_almonds', 'Almonds', 579, 21, 22, 50],
  ['f_walnuts', 'Walnuts', 654, 15, 14, 65],
  ['f_honey', 'Honey', 304, 0.3, 82, 0, ['1 tbsp', 21]],
  ['f_dark_chocolate', 'Dark chocolate, 70–85%', 598, 7.8, 46, 43],
  ['f_whey', 'Whey protein powder', 400, 80, 8, 6],
  ['f_hummus', 'Hummus', 166, 7.9, 14, 9.6],
  ['f_orange_juice', 'Orange juice', 45, 0.7, 10, 0.2, ['1 cup', 240], true],
  ['f_cola', 'Cola', 42, 0, 10.6, 0, ['1 can', 355], true],
  ['f_coffee', 'Coffee, black', 1, 0.1, 0, 0, ['1 cup', 240], true],
];

export const BASELINE_FOODS: FoodItem[] = RAW.map(([id, name, kcal, proteinG, carbsG, fatG, serving, ml]) => ({
  id, name, brand: null, barcode: null, builtin: true,
  snapshot: {
    basis: ml ? 'per_100ml' : 'per_100g',
    servingG: !ml && serving ? serving[1] : null,
    servingMl: ml && serving ? serving[1] : null,
    servingLabel: serving ? serving[0] : null,
    kcal, proteinG, carbsG, fatG, source: BASELINE_SOURCE,
  },
}));

const byId = new Map(BASELINE_FOODS.map((f) => [f.id, f]));
export const baselineFood = (id: string) => byId.get(id) ?? null;
