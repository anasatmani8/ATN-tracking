import { allowedUnits, recipeSnapshot, scaleNutrients, sumNutrients, type NutrientSnapshot, type NutrientTotals, type QtyUnit, type RecipeIngredient } from '@/domain/nutrition';
import type { LocalDate } from '@/domain/time';
import { BASELINE_FOODS, baselineFood, type FoodItem } from './catalog/foods';
import { AppError } from './training';
import { json, newId, type Row, type Store } from './store';

export type SourceKind = 'food' | 'recipe' | 'quick' | 'barcode';

export interface LogInput {
  name: string;
  sourceKind: SourceKind;
  sourceId: string | null;
  snapshot: NutrientSnapshot;
  qty: number;
  unit: QtyUnit;
}

export interface FoodLog {
  id: string; local_date: LocalDate; meal_slot: string; logged_at: number; tz: string; name: string; source_kind: SourceKind; source_id: string | null;
  qty: number; unit: QtyUnit; snapshot: string; kcal: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; planned_meal_id: string | null;
}

export interface PlannedMeal {
  id: string; local_date: LocalDate; meal_slot: string; name: string; source_kind: SourceKind; source_id: string | null; qty: number; unit: QtyUnit;
  snapshot: string; status: 'planned' | 'logged'; log_id: string | null;
}

export interface Recipe {
  id: string;
  name: string;
  servingsYield: number;
  ingredients: RecipeIngredient[];
}

export interface SavedMeal {
  id: string;
  name: string;
  items: LogInput[];
}

const mapFood = (r: Row): FoodItem => ({
  id: r.id as string, name: r.name as string, brand: r.brand as string | null, barcode: r.barcode as string | null, builtin: false,
  snapshot: {
    basis: r.basis as NutrientSnapshot['basis'], servingG: r.serving_g as number | null, servingMl: r.serving_ml as number | null, servingLabel: r.serving_label as string | null,
    kcal: r.kcal as number | null, proteinG: r.protein_g as number | null, carbsG: r.carbs_g as number | null, fatG: r.fat_g as number | null, source: r.source as string,
  },
});

export const logNutrients = (l: Pick<FoodLog, 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g'>) => ({ kcal: l.kcal, proteinG: l.protein_g, carbsG: l.carbs_g, fatG: l.fat_g });

function validate(i: LogInput) {
  if (!i.name.trim()) throw new AppError('name_required');
  if (!(i.qty > 0) || i.qty > 100000) throw new AppError('invalid_quantity');
  if (!allowedUnits(i.snapshot).includes(i.unit)) throw new AppError('unit_not_convertible');
  for (const v of [i.snapshot.kcal, i.snapshot.proteinG, i.snapshot.carbsG, i.snapshot.fatG]) if (v != null && (!Number.isFinite(v) || v < 0)) throw new AppError('invalid_value');
}

export class Nutrition {
  constructor(private store: Store) {}
  private get db() {
    return this.store.db;
  }

  // ───────── foods ─────────
  async searchFoods(query: string, limit = 40): Promise<FoodItem[]> {
    const q = query.trim().toLowerCase();
    const like = `%${q.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
    const mine = (await this.db.all<Row>(`SELECT * FROM foods WHERE deleted_at IS NULL AND (lower(name) LIKE ? ESCAPE '\\' OR lower(ifnull(brand,'')) LIKE ? ESCAPE '\\') ORDER BY name LIMIT ?`, [like, like, limit])).map(mapFood);
    const base = BASELINE_FOODS.filter((f) => f.name.toLowerCase().includes(q));
    return [...mine, ...base].slice(0, limit);
  }

  async getFood(id: string): Promise<FoodItem | null> {
    const b = baselineFood(id);
    if (b) return b;
    const r = await this.db.first<Row>('SELECT * FROM foods WHERE id = ? AND deleted_at IS NULL', [id]);
    return r ? mapFood(r) : null;
  }

  async findByBarcode(code: string): Promise<FoodItem | null> {
    const r = await this.db.first<Row>('SELECT * FROM foods WHERE barcode = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1', [code]);
    return r ? mapFood(r) : null;
  }

  /** Editing a food changes future logs only; existing entries keep their own snapshot. */
  async saveFood(f: { id?: string; name: string; brand?: string | null; barcode?: string | null; snapshot: NutrientSnapshot }): Promise<string> {
    if (!f.name.trim()) throw new AppError('name_required');
    const s = f.snapshot;
    for (const v of [s.kcal, s.proteinG, s.carbsG, s.fatG, s.servingG, s.servingMl]) if (v != null && (!Number.isFinite(v) || v < 0)) throw new AppError('invalid_value');
    const id = f.id ?? newId();
    await this.store.put('foods', {
      id, name: f.name.trim(), brand: f.brand ?? null, barcode: f.barcode ?? null, source: s.source, basis: s.basis, serving_g: s.servingG, serving_ml: s.servingMl,
      serving_label: s.servingLabel, kcal: s.kcal, protein_g: s.proteinG, carbs_g: s.carbsG, fat_g: s.fatG,
    });
    return id;
  }

  deleteFood(id: string) {
    return this.store.remove('foods', id);
  }

  /** Most recently logged distinct items. */
  async recentItems(limit = 15): Promise<LogInput[]> {
    const rows = await this.db.all<FoodLog>(`SELECT * FROM food_logs WHERE deleted_at IS NULL AND source_kind != 'quick' ORDER BY logged_at DESC LIMIT 300`);
    const seen = new Set<string>();
    const out: LogInput[] = [];
    for (const r of rows) {
      const key = `${r.source_kind}:${r.source_id ?? r.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: r.name, sourceKind: r.source_kind, sourceId: r.source_id, snapshot: json<NutrientSnapshot>(r.snapshot, null as never), qty: r.qty, unit: r.unit });
      if (out.length >= limit) break;
    }
    return out;
  }

  // ───────── recipes & saved meals ─────────
  async listRecipes(): Promise<Recipe[]> {
    return (await this.db.all<Row>('SELECT * FROM recipes WHERE deleted_at IS NULL ORDER BY name')).map((r) => ({
      id: r.id as string, name: r.name as string, servingsYield: r.servings_yield as number, ingredients: json<RecipeIngredient[]>(r.ingredients, []),
    }));
  }

  async getRecipe(id: string): Promise<Recipe | null> {
    return (await this.listRecipes()).find((r) => r.id === id) ?? null;
  }

  async saveRecipe(r: { id?: string; name: string; servingsYield: number; ingredients: RecipeIngredient[] }): Promise<string> {
    if (!r.name.trim()) throw new AppError('name_required');
    if (!(r.servingsYield > 0)) throw new AppError('invalid_yield');
    if (!recipeSnapshot(r.ingredients, r.servingsYield, r.name)) throw new AppError('invalid_ingredients');
    const id = r.id ?? newId();
    await this.store.put('recipes', { id, name: r.name.trim(), servings_yield: r.servingsYield, ingredients: JSON.stringify(r.ingredients) });
    return id;
  }

  deleteRecipe(id: string) {
    return this.store.remove('recipes', id);
  }

  recipeAsInput(r: Recipe, servings = 1): LogInput {
    const snapshot = recipeSnapshot(r.ingredients, r.servingsYield, r.name);
    if (!snapshot) throw new AppError('invalid_ingredients');
    return { name: r.name, sourceKind: 'recipe', sourceId: r.id, snapshot, qty: servings, unit: 'serving' };
  }

  async listSavedMeals(): Promise<SavedMeal[]> {
    return (await this.db.all<Row>('SELECT * FROM saved_meals WHERE deleted_at IS NULL ORDER BY name')).map((r) => ({ id: r.id as string, name: r.name as string, items: json<LogInput[]>(r.items, []) }));
  }

  async saveMeal(name: string, items: LogInput[], id?: string): Promise<string> {
    if (!name.trim()) throw new AppError('name_required');
    if (items.length === 0) throw new AppError('empty_meal');
    const mid = id ?? newId();
    await this.store.put('saved_meals', { id: mid, name: name.trim(), items: JSON.stringify(items) });
    return mid;
  }

  deleteSavedMeal(id: string) {
    return this.store.remove('saved_meals', id);
  }

  // ───────── diary ─────────
  listLogs(from: LocalDate, to: LocalDate = from): Promise<FoodLog[]> {
    return this.db.all<FoodLog>('SELECT * FROM food_logs WHERE deleted_at IS NULL AND local_date BETWEEN ? AND ? ORDER BY local_date, logged_at', [from, to]);
  }

  getLog(id: string): Promise<FoodLog | null> {
    return this.db.first<FoodLog>('SELECT * FROM food_logs WHERE id = ? AND deleted_at IS NULL', [id]);
  }

  private logRow(id: string, date: LocalDate, slot: string, i: LogInput, now: number, tz: string, plannedId: string | null): Row & { id: string } {
    validate(i);
    const n = scaleNutrients(i.snapshot, i.qty, i.unit);
    if (!n) throw new AppError('unit_not_convertible');
    return {
      id, local_date: date, meal_slot: slot, logged_at: now, tz, name: i.name.trim(), source_kind: i.sourceKind, source_id: i.sourceId, qty: i.qty, unit: i.unit,
      snapshot: JSON.stringify(i.snapshot), kcal: n.kcal, protein_g: n.proteinG, carbs_g: n.carbsG, fat_g: n.fatG, planned_meal_id: plannedId,
    };
  }

  /** Log an entry. `id` makes the write idempotent for double taps and scanner repeats. */
  async log(date: LocalDate, slot: string, i: LogInput, now: number, tz: string, id: string = newId()): Promise<string> {
    await this.store.put('food_logs', this.logRow(id, date, slot, i, now, tz, null));
    return id;
  }

  /** Change the portion (or slot/date) of an existing entry. Nutrients are rescaled from the entry's own snapshot. */
  async editLog(id: string, patch: { qty?: number; unit?: QtyUnit; mealSlot?: string; localDate?: LocalDate }): Promise<void> {
    const l = await this.getLog(id);
    if (!l) throw new AppError('entry_missing');
    const snapshot = json<NutrientSnapshot>(l.snapshot, null as never);
    const input: LogInput = { name: l.name, sourceKind: l.source_kind, sourceId: l.source_id, snapshot, qty: patch.qty ?? l.qty, unit: patch.unit ?? l.unit };
    const row = this.logRow(id, patch.localDate ?? l.local_date, patch.mealSlot ?? l.meal_slot, input, l.logged_at, l.tz, l.planned_meal_id);
    await this.store.put('food_logs', row);
  }

  async deleteLog(id: string): Promise<void> {
    await this.store.tx(async () => {
      const l = await this.getLog(id);
      if (!l) return;
      await this.store.remove('food_logs', id);
      if (l.planned_meal_id) await this.store.patch('planned_meals', l.planned_meal_id, { status: 'planned', log_id: null });
    });
  }

  /** Copies create new, independently editable entries. */
  async copyDay(from: LocalDate, to: LocalDate, now: number, tz: string, slot?: string): Promise<number> {
    return this.store.tx(async () => {
      const src = (await this.listLogs(from)).filter((l) => !slot || l.meal_slot === slot);
      for (const [i, l] of src.entries()) {
        const { rev: _rev, created_at: _c, updated_at: _u, deleted_at: _d, ...rest } = l as FoodLog & Row;
        await this.store.put('food_logs', { ...rest, id: newId(), local_date: to, logged_at: now + i, tz, planned_meal_id: null });
      }
      return src.length;
    });
  }

  async dayTotals(date: LocalDate): Promise<NutrientTotals> {
    return sumNutrients((await this.listLogs(date)).map(logNutrients));
  }

  // ───────── meal plan ─────────
  listPlanned(from: LocalDate, to: LocalDate): Promise<PlannedMeal[]> {
    return this.db.all<PlannedMeal>('SELECT * FROM planned_meals WHERE deleted_at IS NULL AND local_date BETWEEN ? AND ? ORDER BY local_date, created_at', [from, to]);
  }

  /** A planned meal is intent only: it adds nothing to intake until it is logged. */
  async plan(date: LocalDate, slot: string, i: LogInput): Promise<string> {
    validate(i);
    const id = newId();
    await this.store.put('planned_meals', {
      id, local_date: date, meal_slot: slot, name: i.name.trim(), source_kind: i.sourceKind, source_id: i.sourceId, qty: i.qty, unit: i.unit,
      snapshot: JSON.stringify(i.snapshot), status: 'planned', log_id: null,
    });
    return id;
  }

  deletePlanned(id: string) {
    return this.store.remove('planned_meals', id);
  }

  /** Turn a planned meal into a diary entry, optionally with a changed portion. Idempotent. */
  async logPlanned(id: string, now: number, tz: string, portion?: { qty: number; unit: QtyUnit }, date?: LocalDate): Promise<string> {
    return this.store.tx(async () => {
      const p = await this.db.first<PlannedMeal>('SELECT * FROM planned_meals WHERE id = ? AND deleted_at IS NULL', [id]);
      if (!p) throw new AppError('entry_missing');
      if (p.status === 'logged' && p.log_id) return p.log_id;
      const input: LogInput = { name: p.name, sourceKind: p.source_kind, sourceId: p.source_id, snapshot: json<NutrientSnapshot>(p.snapshot, null as never), qty: portion?.qty ?? p.qty, unit: portion?.unit ?? p.unit };
      const logId = newId();
      await this.store.put('food_logs', this.logRow(logId, date ?? p.local_date, p.meal_slot, input, now, tz, id));
      await this.store.patch('planned_meals', id, { status: 'logged', log_id: logId });
      return logId;
    });
  }
}
