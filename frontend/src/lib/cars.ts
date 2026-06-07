/**
 * A worldwide catalogue of real cars for the fleet — brand, model, country of
 * origin, and body type — with filter/sort helpers. Vehicles keep the arrow
 * marker; this just labels them (and powers the car picker).
 */
export type Domain = "road" | "sea" | "air" | "underwater";
export type CarType =
  | "sedan"
  | "SUV"
  | "sports"
  | "EV"
  | "truck"
  | "hatchback"
  | "coupe"
  | "ship"
  | "cruise"
  | "ferry"
  | "yacht"
  | "speedboat"
  | "sailboat"
  | "airliner"
  | "jet"
  | "helicopter"
  | "balloon"
  | "submarine";

export interface Car {
  brand: string;
  model: string;
  country: string;
  type: CarType;
  domain?: Domain; // defaults to "road"
  icon?: string; // emoji marker; defaults by domain
}

const DOMAIN_ICON: Record<Domain, string> = { road: "🚗", sea: "🚢", air: "✈️", underwater: "🤿" };
export function domainOf(c: Car): Domain {
  return c.domain ?? "road";
}
export function iconOf(c: Car): string {
  return c.icon ?? DOMAIN_ICON[domainOf(c)];
}
export function domains(): Domain[] {
  return ["road", "sea", "air", "underwater"];
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
  Denmark: "🇩🇰",
  Canada: "🇨🇦",
  Netherlands: "🇳🇱",
  Russia: "🇷🇺",
  Norway: "🇳🇴",
  UAE: "🇦🇪",
  Switzerland: "🇨🇭",
  Finland: "🇫🇮",
};

export function flag(country: string): string {
  return FLAGS[country] ?? "🏳️";
}
export function carLabel(c: Car): string {
  return `${c.brand} ${c.model}`;
}
export function carDisplay(c: Car): string {
  return `${iconOf(c)} ${c.brand} ${c.model}`;
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

  // --- sea (big → small) ------------------------------------------------- //
  { brand: "Maersk", model: "Triple-E Megaship", country: "Denmark", type: "ship", domain: "sea", icon: "🚢" },
  { brand: "Seawise", model: "ULCC Supertanker", country: "Japan", type: "ship", domain: "sea", icon: "🚢" },
  { brand: "Royal Caribbean", model: "Wonder of the Seas", country: "USA", type: "cruise", domain: "sea", icon: "🛳️" },
  { brand: "Carnival", model: "Mardi Gras", country: "USA", type: "cruise", domain: "sea", icon: "🛳️" },
  { brand: "Stena Line", model: "Superfast Ferry", country: "Sweden", type: "ferry", domain: "sea", icon: "⛴️" },
  { brand: "Lürssen", model: "Azzam Superyacht", country: "UAE", type: "yacht", domain: "sea", icon: "🛥️" },
  { brand: "Azimut", model: "Grande Yacht", country: "Italy", type: "yacht", domain: "sea", icon: "🛥️" },
  { brand: "Cigarette", model: "Racing Speedboat", country: "USA", type: "speedboat", domain: "sea", icon: "🚤" },
  { brand: "Sea-Doo", model: "RXP-X Jet Ski", country: "Canada", type: "speedboat", domain: "sea", icon: "🚤" },
  { brand: "Beneteau", model: "Oceanis Sailboat", country: "France", type: "sailboat", domain: "sea", icon: "⛵" },
  { brand: "Damen", model: "Harbour Tugboat", country: "Netherlands", type: "ship", domain: "sea", icon: "🚢" },
  { brand: "Viking", model: "Trawler", country: "Norway", type: "speedboat", domain: "sea", icon: "🚤" },

  // --- air (public → private) ------------------------------------------- //
  { brand: "Airbus", model: "A380", country: "France", type: "airliner", domain: "air", icon: "✈️" },
  { brand: "Boeing", model: "747-8", country: "USA", type: "airliner", domain: "air", icon: "✈️" },
  { brand: "Boeing", model: "787 Dreamliner", country: "USA", type: "airliner", domain: "air", icon: "✈️" },
  { brand: "Airbus", model: "A320neo", country: "France", type: "airliner", domain: "air", icon: "✈️" },
  { brand: "Concorde", model: "Supersonic", country: "UK", type: "airliner", domain: "air", icon: "✈️" },
  { brand: "Gulfstream", model: "G650 Private Jet", country: "USA", type: "jet", domain: "air", icon: "🛩️" },
  { brand: "Bombardier", model: "Global 7500", country: "Canada", type: "jet", domain: "air", icon: "🛩️" },
  { brand: "Cessna", model: "172 Skyhawk", country: "USA", type: "jet", domain: "air", icon: "🛩️" },
  { brand: "Pilatus", model: "PC-12", country: "Switzerland", type: "jet", domain: "air", icon: "🛩️" },
  { brand: "Robinson", model: "R44 Helicopter", country: "USA", type: "helicopter", domain: "air", icon: "🚁" },
  { brand: "Airbus", model: "H160 Helicopter", country: "France", type: "helicopter", domain: "air", icon: "🚁" },
  { brand: "Cameron", model: "Hot-Air Balloon", country: "UK", type: "balloon", domain: "air", icon: "🎈" },

  // --- underwater -------------------------------------------------------- //
  { brand: "Typhoon", model: "Ballistic Submarine", country: "Russia", type: "submarine", domain: "underwater", icon: "🤿" },
  { brand: "Virginia", model: "Attack Submarine", country: "USA", type: "submarine", domain: "underwater", icon: "🤿" },
  { brand: "Triton", model: "Deep-Sea Submersible", country: "USA", type: "submarine", domain: "underwater", icon: "🤿" },
  { brand: "DeepFlight", model: "Personal Submarine", country: "USA", type: "submarine", domain: "underwater", icon: "🤿" },
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
  domain?: string;
  brand?: string;
  country?: string;
  type?: string;
  q?: string;
}

export function filterCars(f: CarFilter): Car[] {
  const q = (f.q ?? "").trim().toLowerCase();
  return CARS.filter(
    (c) =>
      (!f.domain || domainOf(c) === f.domain) &&
      (!f.brand || c.brand === f.brand) &&
      (!f.country || c.country === f.country) &&
      (!f.type || c.type === f.type) &&
      (!q || `${c.brand} ${c.model}`.toLowerCase().includes(q)),
  ).sort((a, b) => a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model));
}

export function randomCar(): Car {
  return CARS[Math.floor(Math.random() * CARS.length)];
}

const BY_DOMAIN: Record<Domain, Car[]> = {
  road: CARS.filter((c) => domainOf(c) === "road"),
  sea: CARS.filter((c) => domainOf(c) === "sea"),
  air: CARS.filter((c) => domainOf(c) === "air"),
  underwater: CARS.filter((c) => domainOf(c) === "underwater"),
};
export function randomCarOf(domain: Domain): Car {
  const list = BY_DOMAIN[domain];
  return list[Math.floor(Math.random() * list.length)] ?? randomCar();
}
