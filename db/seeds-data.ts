/**
 * YABUZ OIL & GAS — seed data extracted from the real company Excel files:
 *  - "YABUZ OIL AND GAS POLAR OIL PRICE LIST.xlsx" (BATCH A / old prices)
 *  - "POLAR OIL PUBLIC PRICE LIST FOR YABUZ OIL.xlsx" (current prices + stock)
 * Current price = new public list where present, else the BATCH A price.
 */
export interface SeedProduct {
  cat: string; catName: string; name: string;
  packType: "CARTON" | "KEG" | "DRUM" | "RUBBER" | "CUP" | "UNIT";
  unitsPerPack: number; unitLabel: string; volumePerUnit: number | null;
  qty: number; pc: number; pu: number; mc: number; mu: number; oldPrice: number | null;
}

export const SEED_PRODUCTS: SeedProduct[] = [
  { cat: "A", catName: "POLAR ALVA 5000 XP", name: "ALVA 5000 XP 1LTS (12 GALLONS)", packType: "CARTON", unitsPerPack: 12, unitLabel: "GALLON", volumePerUnit: 1.0, qty: 31.0, pc: 41200.0, pu: 3433.33, mc: 45000.0, mu: 3750.0, oldPrice: 39500.0 },
  { cat: "A", catName: "POLAR ALVA 5000 XP", name: "ALVA 5000 XP 4LTS(4 GALLONS)", packType: "CARTON", unitsPerPack: 4, unitLabel: "GALLON", volumePerUnit: 4.0, qty: 51.0, pc: 51200.0, pu: 12800.0, mc: 55000.0, mu: 13750.0, oldPrice: 48600.0 },
  { cat: "A", catName: "POLAR ALVA 5000 XP", name: "ALVA 5000 XP 5LTS(4 GALLONS)", packType: "CARTON", unitsPerPack: 4, unitLabel: "GALLON", volumePerUnit: 5.0, qty: 19.0, pc: 63000.0, pu: 15750.0, mc: 69000.0, mu: 17250.0, oldPrice: 59800.0 },
  { cat: "A", catName: "POLAR ALVA 5000 XP", name: "ALVA 5000 XP 225LTS(1 DRUM)", packType: "DRUM", unitsPerPack: 1, unitLabel: "DRUM", volumePerUnit: 225.0, qty: 0.0, pc: 635000.0, pu: 635000.0, mc: 635200.0, mu: 635200.0, oldPrice: 635200.0 },
  { cat: "B", catName: "POLAR SUPREME", name: "POLAR SUPREME 1LTS (12 GALLONS)", packType: "CARTON", unitsPerPack: 12, unitLabel: "GALLON", volumePerUnit: 1.0, qty: 0.0, pc: 38600.0, pu: 3216.67, mc: 38800.0, mu: 3233.33, oldPrice: 38800.0 },
  { cat: "B", catName: "POLAR SUPREME", name: "POLAR SUPREME 4LTS(4 GALLONS)", packType: "CARTON", unitsPerPack: 4, unitLabel: "GALLON", volumePerUnit: 4.0, qty: 0.0, pc: 47900.0, pu: 11975.0, mc: 48100.0, mu: 12025.0, oldPrice: 48100.0 },
  { cat: "B", catName: "POLAR SUPREME", name: "POLAR SUPREME 5LTS(4 GALLONS)", packType: "CARTON", unitsPerPack: 4, unitLabel: "GALLON", volumePerUnit: 5.0, qty: 0.0, pc: 59100.0, pu: 14775.0, mc: 59300.0, mu: 14825.0, oldPrice: 59300.0 },
  { cat: "B", catName: "POLAR SUPREME", name: "POLAR SUPREME 225LTS(1 DRUM)", packType: "DRUM", unitsPerPack: 1, unitLabel: "DRUM", volumePerUnit: 225.0, qty: 0.0, pc: 591000.0, pu: 591000.0, mc: 591200.0, mu: 591200.0, oldPrice: 591200.0 },
  { cat: "C", catName: "POLAR ELITE", name: "POLAR ELITE 1LTS (12 GALLONS)", packType: "CARTON", unitsPerPack: 12, unitLabel: "GALLON", volumePerUnit: 1.0, qty: 79.0, pc: 40700.0, pu: 3391.67, mc: 44000.0, mu: 3666.67, oldPrice: 38100.0 },
  { cat: "C", catName: "POLAR ELITE", name: "POLAR ELITE 4LTS(4 GALLONS)", packType: "CARTON", unitsPerPack: 4, unitLabel: "GALLON", volumePerUnit: 4.0, qty: 30.0, pc: 50700.0, pu: 12675.0, mc: 54000.0, mu: 13500.0, oldPrice: 47100.0 },
  { cat: "C", catName: "POLAR ELITE", name: "POLAR ELITE 5LTS(4 GALLONS)", packType: "CARTON", unitsPerPack: 4, unitLabel: "GALLON", volumePerUnit: 5.0, qty: 30.0, pc: 62000.0, pu: 15500.0, mc: 68000.0, mu: 17000.0, oldPrice: 57900.0 },
  { cat: "D", catName: "POLAR ROLAM \"X\" DIESEL ENGINE", name: "POLAR ROLAM X 4LTS (12 GALLONS)", packType: "CARTON", unitsPerPack: 12, unitLabel: "GALLON", volumePerUnit: 4.0, qty: 20.0, pc: 50000.0, pu: 4166.67, mc: 53500.0, mu: 4458.33, oldPrice: 47900.0 },
  { cat: "D", catName: "POLAR ROLAM \"X\" DIESEL ENGINE", name: "POLAR ROLAM X 5LTS(4 GALLONS)", packType: "CARTON", unitsPerPack: 4, unitLabel: "GALLON", volumePerUnit: 5.0, qty: 10.0, pc: 61500.0, pu: 15375.0, mc: 64500.0, mu: 16125.0, oldPrice: 58900.0 },
  { cat: "D", catName: "POLAR ROLAM \"X\" DIESEL ENGINE", name: "POLAR ROLAM X 10LTS(1 KEG)", packType: "KEG", unitsPerPack: 1, unitLabel: "KEG", volumePerUnit: 10.0, qty: 10.0, pc: 31400.0, pu: 31400.0, mc: 34400.0, mu: 34400.0, oldPrice: 30600.0 },
  { cat: "D", catName: "POLAR ROLAM \"X\" DIESEL ENGINE", name: "POLAR ROLAM X 25LTS(1 KEGS)", packType: "KEG", unitsPerPack: 1, unitLabel: "KEG", volumePerUnit: 25.0, qty: 20.0, pc: 75700.0, pu: 75700.0, mc: 83000.0, mu: 83000.0, oldPrice: 72200.0 },
  { cat: "D", catName: "POLAR ROLAM \"X\" DIESEL ENGINE", name: "POLAR ROLAM X 225LTS(1 DRUM)", packType: "DRUM", unitsPerPack: 1, unitLabel: "DRUM", volumePerUnit: 225.0, qty: 0.0, pc: 627000.0, pu: 627000.0, mc: 627200.0, mu: 627200.0, oldPrice: 627200.0 },
  { cat: "E", catName: "POLAR POLGEAR EP 140", name: "POLAR ROLAM X 1LTS (12 GALLONS)", packType: "CARTON", unitsPerPack: 12, unitLabel: "GALLON", volumePerUnit: 1.0, qty: 0.0, pc: 38800.0, pu: 3233.33, mc: 39000.0, mu: 3250.0, oldPrice: 39000.0 },
  { cat: "E", catName: "POLAR POLGEAR EP 140", name: "POLAR ROLAM X 4LTS(4 GALLONS)", packType: "CARTON", unitsPerPack: 4, unitLabel: "GALLON", volumePerUnit: 4.0, qty: 30.0, pc: 48200.0, pu: 12050.0, mc: 54000.0, mu: 13500.0, oldPrice: 48400.0 },
  { cat: "F", catName: "POLAR POLGREASE LITHIUM", name: "POLGREASE LITHIUM 0.2KG (12 CUPS)", packType: "CARTON", unitsPerPack: 12, unitLabel: "CUP", volumePerUnit: 0.2, qty: 250.0, pc: 9250.0, pu: 770.83, mc: 11000.0, mu: 916.67, oldPrice: 11700.0 },
  { cat: "F", catName: "POLAR POLGREASE LITHIUM", name: "POLGREASE LITHIUM 0.4KG(24 CUPS)", packType: "CARTON", unitsPerPack: 24, unitLabel: "CUP", volumePerUnit: 0.4, qty: 85.0, pc: 31000.0, pu: 1291.67, mc: 36000.0, mu: 1500.0, oldPrice: 41800.0 },
  { cat: "F", catName: "POLAR POLGREASE LITHIUM", name: "POLGREASE LITHIUM 4KG(4 RUBBERS)", packType: "CARTON", unitsPerPack: 4, unitLabel: "RUBBER", volumePerUnit: 4.0, qty: 0.0, pc: 64000.0, pu: 16000.0, mc: 64200.0, mu: 16050.0, oldPrice: 64200.0 },
  { cat: "F", catName: "POLAR POLGREASE LITHIUM", name: "POLGREASE LITHIUM 20KG(1 RUBBER)", packType: "RUBBER", unitsPerPack: 1, unitLabel: "RUBBER", volumePerUnit: 20.0, qty: 0.0, pc: 79000.0, pu: 79000.0, mc: 79200.0, mu: 79200.0, oldPrice: 79200.0 },
  { cat: "G", catName: "POLAR POLGREASE SODIUM", name: "POLGREASE SODIUM 200G (12 CUPS)", packType: "CARTON", unitsPerPack: 12, unitLabel: "CUP", volumePerUnit: 200.0, qty: 0.0, pc: 9500.0, pu: 791.67, mc: 9700.0, mu: 808.33, oldPrice: 9700.0 },
  { cat: "G", catName: "POLAR POLGREASE SODIUM", name: "POLGREASE SODIUM 400G(24 CUPS)", packType: "CARTON", unitsPerPack: 24, unitLabel: "CUP", volumePerUnit: 400.0, qty: 0.0, pc: 32000.0, pu: 1333.33, mc: 32200.0, mu: 1341.67, oldPrice: 32200.0 },
  { cat: "G", catName: "POLAR POLGREASE SODIUM", name: "POLGREASE SODIUM 4KG(4 RUBBERS)", packType: "CARTON", unitsPerPack: 4, unitLabel: "RUBBER", volumePerUnit: 4.0, qty: 0.0, pc: 50700.0, pu: 12675.0, mc: 50900.0, mu: 12725.0, oldPrice: 50900.0 },
  { cat: "G", catName: "POLAR POLGREASE SODIUM", name: "POLGREASE SODIUM 20KG(1 RUBBER)", packType: "RUBBER", unitsPerPack: 1, unitLabel: "RUBBER", volumePerUnit: 20.0, qty: 0.0, pc: 63400.0, pu: 63400.0, mc: 63600.0, mu: 63600.0, oldPrice: 63600.0 },
  { cat: "H", catName: "POLAR SAE 40", name: "SAE 40 225LTRS (1 DRUM)", packType: "DRUM", unitsPerPack: 1, unitLabel: "DRUM", volumePerUnit: 225.0, qty: 0.0, pc: 490000.0, pu: 490000.0, mc: 490200.0, mu: 490200.0, oldPrice: 490200.0 },
  { cat: "H", catName: "POLAR SAE 40", name: "SAE 40 225LTRS (WITHOUT DRUM)", packType: "DRUM", unitsPerPack: 1, unitLabel: "UNIT", volumePerUnit: 225.0, qty: 0.0, pc: 460000.0, pu: 460000.0, mc: 460200.0, mu: 460200.0, oldPrice: 460200.0 },
  { cat: "I", catName: "POLAR HAZE 2T", name: "HAZE 2T 1LTR (12 GALLONS)", packType: "CARTON", unitsPerPack: 12, unitLabel: "GALLON", volumePerUnit: 1.0, qty: 0.0, pc: 35200.0, pu: 2933.33, mc: 35400.0, mu: 2950.0, oldPrice: 35400.0 },
  { cat: "I", catName: "POLAR HAZE 2T", name: "HAZE 2T 4LTR (4 GALLONS)", packType: "CARTON", unitsPerPack: 4, unitLabel: "GALLON", volumePerUnit: 4.0, qty: 0.0, pc: 43200.0, pu: 10800.0, mc: 43400.0, mu: 10850.0, oldPrice: 43400.0 },
];
