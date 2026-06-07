/**
 * A worldwide catalogue of real cars for the fleet — brand, model, country of
 * origin, and body type — with filter/sort helpers. Vehicles keep the arrow
 * marker; this just labels them (and powers the car picker).
 */
export type CarType = "sedan" | "SUV" | "sports" | "EV" | "truck" | "hatchback" | "coupe";

export interface Car {
  brand: string;
  model: string;
  country: string;
  type: CarType;
}

const FLAGS: Record<string, string> = {
  Japan: "🇯🇵",
  USA: "🇺🇸",
  Germany: "🇩🇪",
  Italy: "🇮🇹",
  UK: "🇬🇧",
  "South Korea": "🇰🇷",
  Sweden: "🇸🇪",
  France: "🇫🇷",
  India: "🇮🇳",
  China: "🇨🇳",
  Spain: "🇪🇸",
  Czechia: "🇨🇿",
};

export function flag(country: string): string {
  return FLAGS[country] ?? "🏳️";
}
export function carLabel(c: Car): string {
  return `${c.brand} ${c.model}`;
}
export function carDisplay(c: Car): string {
  return `${flag(c.country)} ${c.brand} ${c.model}`;
}

export const CARS: Car[] = [
  { brand: "Toyota", model: "Corolla", country: "Japan", type: "sedan" },
  { brand: "Toyota", model: "Hilux", country: "Japan", type: "truck" },
  { brand: "Toyota", model: "Supra", country: "Japan", type: "sports" },
  { brand: "Honda", model: "Civic", country: "Japan", type: "sedan" },
  { brand: "Honda", model: "NSX", country: "Japan", type: "sports" },
  { brand: "Nissan", model: "GT-R", country: "Japan", type: "sports" },
  { brand: "Nissan", model: "Leaf", country: "Japan", type: "EV" },
  { brand: "Mazda", model: "MX-5", country: "Japan", type: "sports" },
  { brand: "Subaru", model: "Impreza", country: "Japan", type: "sedan" },
  { brand: "Lexus", model: "LC 500", country: "Japan", type: "coupe" },
  { brand: "Mitsubishi", model: "Lancer Evo", country: "Japan", type: "sedan" },
  { brand: "Tesla", model: "Model 3", country: "USA", type: "EV" },
  { brand: "Tesla", model: "Model S", country: "USA", type: "EV" },
  { brand: "Ford", model: "Mustang", country: "USA", type: "sports" },
  { brand: "Ford", model: "F-150", country: "USA", type: "truck" },
  { brand: "Chevrolet", model: "Corvette", country: "USA", type: "sports" },
  { brand: "Jeep", model: "Wrangler", country: "USA", type: "SUV" },
  { brand: "Cadillac", model: "Escalade", country: "USA", type: "SUV" },
  { brand: "Dodge", model: "Challenger", country: "USA", type: "sports" },
  { brand: "BMW", model: "M3", country: "Germany", type: "sports" },
  { brand: "BMW", model: "iX", country: "Germany", type: "EV" },
  { brand: "Mercedes-Benz", model: "S-Class", country: "Germany", type: "sedan" },
  { brand: "Mercedes-AMG", model: "GT", country: "Germany", type: "sports" },
  { brand: "Audi", model: "R8", country: "Germany", type: "sports" },
  { brand: "Audi", model: "Q7", country: "Germany", type: "SUV" },
  { brand: "Porsche", model: "911", country: "Germany", type: "sports" },
  { brand: "Volkswagen", model: "Golf GTI", country: "Germany", type: "hatchback" },
  { brand: "Volkswagen", model: "ID.4", country: "Germany", type: "EV" },
  { brand: "Ferrari", model: "F8 Tributo", country: "Italy", type: "sports" },
  { brand: "Lamborghini", model: "Huracán", country: "Italy", type: "sports" },
  { brand: "Maserati", model: "MC20", country: "Italy", type: "sports" },
  { brand: "Alfa Romeo", model: "Giulia", country: "Italy", type: "sedan" },
  { brand: "Fiat", model: "500", country: "Italy", type: "hatchback" },
  { brand: "McLaren", model: "720S", country: "UK", type: "sports" },
  { brand: "Aston Martin", model: "DB11", country: "UK", type: "coupe" },
  { brand: "Jaguar", model: "F-Type", country: "UK", type: "sports" },
  { brand: "Land Rover", model: "Defender", country: "UK", type: "SUV" },
  { brand: "Mini", model: "Cooper", country: "UK", type: "hatchback" },
  { brand: "Bentley", model: "Continental GT", country: "UK", type: "coupe" },
  { brand: "Rolls-Royce", model: "Phantom", country: "UK", type: "sedan" },
  { brand: "Lotus", model: "Emira", country: "UK", type: "sports" },
  { brand: "Hyundai", model: "Ioniq 5", country: "South Korea", type: "EV" },
  { brand: "Kia", model: "EV6", country: "South Korea", type: "EV" },
  { brand: "Genesis", model: "G70", country: "South Korea", type: "sedan" },
  { brand: "Volvo", model: "XC90", country: "Sweden", type: "SUV" },
  { brand: "Koenigsegg", model: "Jesko", country: "Sweden", type: "sports" },
  { brand: "Polestar", model: "2", country: "Sweden", type: "EV" },
  { brand: "Renault", model: "Clio", country: "France", type: "hatchback" },
  { brand: "Peugeot", model: "208", country: "France", type: "hatchback" },
  { brand: "Bugatti", model: "Chiron", country: "France", type: "sports" },
  { brand: "DS", model: "7 Crossback", country: "France", type: "SUV" },
  { brand: "Tata", model: "Nexon EV", country: "India", type: "EV" },
  { brand: "Mahindra", model: "Thar", country: "India", type: "SUV" },
  { brand: "Maruti Suzuki", model: "Swift", country: "India", type: "hatchback" },
  { brand: "BYD", model: "Atto 3", country: "China", type: "EV" },
  { brand: "NIO", model: "ET7", country: "China", type: "EV" },
  { brand: "SEAT", model: "Ibiza", country: "Spain", type: "hatchback" },
  { brand: "Škoda", model: "Octavia", country: "Czechia", type: "sedan" },
];

export function brands(): string[] {
  return [...new Set(CARS.map((c) => c.brand))].sort();
}
export function countries(): string[] {
  return [...new Set(CARS.map((c) => c.country))].sort();
}
export function types(): CarType[] {
  return [...new Set(CARS.map((c) => c.type))];
}

export interface CarFilter {
  brand?: string;
  country?: string;
  type?: string;
  q?: string;
}

export function filterCars(f: CarFilter): Car[] {
  const q = (f.q ?? "").trim().toLowerCase();
  return CARS.filter(
    (c) =>
      (!f.brand || c.brand === f.brand) &&
      (!f.country || c.country === f.country) &&
      (!f.type || c.type === f.type) &&
      (!q || `${c.brand} ${c.model}`.toLowerCase().includes(q)),
  ).sort((a, b) => a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model));
}

export function randomCar(): Car {
  return CARS[Math.floor(Math.random() * CARS.length)];
}
