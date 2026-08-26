/**
 * A worldwide catalogue of real cars for the fleet — brand, model, country of
 * origin, and body type — with filter/sort helpers. Vehicles keep the arrow
 * marker; this just labels them (and powers the car picker).
 */
export type Domain = "road" | "rail" | "sea" | "air" | "underwater";

export type CarType =
  // road · passenger
  | "sedan"
  | "SUV"
  | "sports"
  | "EV"
  | "hatchback"
  | "coupe"
  | "offroad"
  // road · two-wheeler
  | "motorcycle"
  | "scooter"
  // road · commercial
  | "truck"
  | "semi"
  | "tanker"
  | "pickup"
  | "van"
  | "dumper"
  | "mixer"
  // road · public + emergency
  | "bus"
  | "coach"
  | "ambulance"
  | "firetruck"
  | "police"
  // rail
  | "highspeed"
  | "freighttrain"
  | "metro"
  | "tram"
  // sea
  | "ship"
  | "cruise"
  | "ferry"
  | "container"
  | "seatanker"
  | "tug"
  | "fishing"
  | "icebreaker"
  | "yacht"
  | "speedboat"
  | "sailboat"
  // air
  | "airliner"
  | "jet"
  | "cargoplane"
  | "seaplane"
  | "helicopter"
  | "drone"
  | "balloon"
  // underwater
  | "submarine"
  | "submersible"
  | "rov";

/**
 * The coarse grouping the picker filters on. `CarType` is the precise body type
 * (there are 40+); a category is the bucket a person actually thinks in — "show
 * me trucks" rather than "show me semis, tankers, dumpers and mixers".
 */
export type Category =
  | "car"
  | "bike"
  | "truck"
  | "bus"
  | "emergency"
  | "train"
  | "ship"
  | "boat"
  | "aircraft"
  | "submarine";

export interface Car {
  brand: string;
  model: string;
  country: string;
  type: CarType;
  domain?: Domain; // defaults to "road"
  icon?: string; // emoji marker; defaults by domain
}

const DOMAIN_ICON: Record<Domain, string> = {
  road: "🚗",
  rail: "🚆",
  sea: "🚢",
  air: "✈️",
  underwater: "🤿",
};

/** Every CarType maps to exactly one Category. */
const TYPE_CATEGORY: Record<CarType, Category> = {
  sedan: "car", SUV: "car", sports: "car", EV: "car", hatchback: "car", coupe: "car", offroad: "car",
  motorcycle: "bike", scooter: "bike",
  truck: "truck", semi: "truck", tanker: "truck", pickup: "truck", van: "truck", dumper: "truck", mixer: "truck",
  bus: "bus", coach: "bus",
  ambulance: "emergency", firetruck: "emergency", police: "emergency",
  highspeed: "train", freighttrain: "train", metro: "train", tram: "train",
  ship: "ship", cruise: "ship", ferry: "ship", container: "ship", seatanker: "ship", tug: "ship",
  fishing: "ship", icebreaker: "ship",
  yacht: "boat", speedboat: "boat", sailboat: "boat",
  airliner: "aircraft", jet: "aircraft", cargoplane: "aircraft", seaplane: "aircraft",
  helicopter: "aircraft", drone: "aircraft", balloon: "aircraft",
  submarine: "submarine", submersible: "submarine", rov: "submarine",
};

const CATEGORY_LABEL: Record<Category, string> = {
  car: "🚗 Cars",
  bike: "🏍️ Motorcycles",
  truck: "🚛 Trucks & Freight",
  bus: "🚌 Buses",
  emergency: "🚑 Emergency",
  train: "🚆 Trains",
  ship: "🚢 Ships",
  boat: "🛥️ Boats",
  aircraft: "✈️ Aircraft",
  submarine: "🤿 Underwater",
};

export function domainOf(c: Car): Domain {
  return c.domain ?? "road";
}
export function iconOf(c: Car): string {
  return c.icon ?? DOMAIN_ICON[domainOf(c)];
}
export function domains(): Domain[] {
  return ["road", "rail", "sea", "air", "underwater"];
}
export function categoryOf(c: Car): Category {
  return TYPE_CATEGORY[c.type];
}
export function categoryLabel(c: Category): string {
  return CATEGORY_LABEL[c];
}
/** Categories actually present in the catalogue, in display order. */
export function categories(): Category[] {
  const present = new Set(CARS.map(categoryOf));
  return (Object.keys(CATEGORY_LABEL) as Category[]).filter((c) => present.has(c));
}
/** Types belonging to one category (or all types when no category is given). */
export function typesIn(category?: string): CarType[] {
  const all = [...new Set(CARS.map((c) => c.type))];
  if (!category) return all;
  return all.filter((t) => TYPE_CATEGORY[t] === category);
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
  { brand: "Alvin", model: "DSV Submersible", country: "USA", type: "submersible", domain: "underwater", icon: "🔱" },
  { brand: "Saab", model: "Seaeye ROV", country: "Sweden", type: "rov", domain: "underwater", icon: "🛰️" },

  // --- road · trucks & freight ------------------------------------------- //
  { brand: "Volvo", model: "FH16 Semi", country: "Sweden", type: "semi", domain: "road", icon: "🚛" },
  { brand: "Scania", model: "R730 Hauler", country: "Sweden", type: "semi", domain: "road", icon: "🚛" },
  { brand: "Mercedes-Benz", model: "Actros Long-Haul", country: "Germany", type: "semi", domain: "road", icon: "🚛" },
  { brand: "MAN", model: "TGX Freight", country: "Germany", type: "semi", domain: "road", icon: "🚛" },
  { brand: "Peterbilt", model: "579 Sleeper", country: "USA", type: "semi", domain: "road", icon: "🚛" },
  { brand: "Kenworth", model: "W990", country: "USA", type: "semi", domain: "road", icon: "🚛" },
  { brand: "Freightliner", model: "Cascadia", country: "USA", type: "semi", domain: "road", icon: "🚛" },
  { brand: "Tesla", model: "Semi (Electric)", country: "USA", type: "semi", domain: "road", icon: "🚛" },
  { brand: "Tata", model: "Prima Hauler", country: "India", type: "truck", domain: "road", icon: "🚚" },
  { brand: "Ashok Leyland", model: "Boss Cargo", country: "India", type: "truck", domain: "road", icon: "🚚" },
  { brand: "Isuzu", model: "N-Series Box", country: "Japan", type: "truck", domain: "road", icon: "🚚" },
  { brand: "Hino", model: "500 Series", country: "Japan", type: "truck", domain: "road", icon: "🚚" },
  { brand: "Shell", model: "Fuel Tanker", country: "UK", type: "tanker", domain: "road", icon: "🛢️" },
  { brand: "Bharat Petroleum", model: "LPG Tanker", country: "India", type: "tanker", domain: "road", icon: "🛢️" },
  { brand: "Ford", model: "F-150 Lightning", country: "USA", type: "pickup", domain: "road", icon: "🛻" },
  { brand: "Toyota", model: "Hilux", country: "Japan", type: "pickup", domain: "road", icon: "🛻" },
  { brand: "RAM", model: "1500 TRX", country: "USA", type: "pickup", domain: "road", icon: "🛻" },
  { brand: "Rivian", model: "R1T", country: "USA", type: "pickup", domain: "road", icon: "🛻" },
  { brand: "Mercedes-Benz", model: "Sprinter Van", country: "Germany", type: "van", domain: "road", icon: "🚐" },
  { brand: "Ford", model: "Transit Courier", country: "USA", type: "van", domain: "road", icon: "🚐" },
  { brand: "Caterpillar", model: "777 Dump Truck", country: "USA", type: "dumper", domain: "road", icon: "🚜" },
  { brand: "Komatsu", model: "HD785 Dumper", country: "Japan", type: "dumper", domain: "road", icon: "🚜" },
  { brand: "Schwing", model: "Concrete Mixer", country: "Germany", type: "mixer", domain: "road", icon: "🚧" },

  // --- road · buses ------------------------------------------------------- //
  { brand: "Mercedes-Benz", model: "Citaro City Bus", country: "Germany", type: "bus", domain: "road", icon: "🚌" },
  { brand: "Volvo", model: "7900 Electric Bus", country: "Sweden", type: "bus", domain: "road", icon: "🚌" },
  { brand: "BYD", model: "K9 Electric Bus", country: "China", type: "bus", domain: "road", icon: "🚌" },
  { brand: "Tata", model: "Starbus City", country: "India", type: "bus", domain: "road", icon: "🚌" },
  { brand: "Setra", model: "S 531 DT Coach", country: "Germany", type: "coach", domain: "road", icon: "🚍" },
  { brand: "Volvo", model: "9700 Intercity Coach", country: "Sweden", type: "coach", domain: "road", icon: "🚍" },

  // --- road · emergency --------------------------------------------------- //
  { brand: "Mercedes-Benz", model: "Sprinter Ambulance", country: "Germany", type: "ambulance", domain: "road", icon: "🚑" },
  { brand: "Ford", model: "E-450 Ambulance", country: "USA", type: "ambulance", domain: "road", icon: "🚑" },
  { brand: "Rosenbauer", model: "Panther Fire Truck", country: "Austria", type: "firetruck", domain: "road", icon: "🚒" },
  { brand: "Pierce", model: "Enforcer Pumper", country: "USA", type: "firetruck", domain: "road", icon: "🚒" },
  { brand: "Ford", model: "Police Interceptor", country: "USA", type: "police", domain: "road", icon: "🚓" },
  { brand: "BMW", model: "5 Series Polizei", country: "Germany", type: "police", domain: "road", icon: "🚓" },

  // --- road · two-wheelers ------------------------------------------------ //
  { brand: "Ducati", model: "Panigale V4", country: "Italy", type: "motorcycle", domain: "road", icon: "🏍️" },
  { brand: "Harley-Davidson", model: "Road Glide", country: "USA", type: "motorcycle", domain: "road", icon: "🏍️" },
  { brand: "Royal Enfield", model: "Himalayan", country: "India", type: "motorcycle", domain: "road", icon: "🏍️" },
  { brand: "Kawasaki", model: "Ninja H2", country: "Japan", type: "motorcycle", domain: "road", icon: "🏍️" },
  { brand: "BMW", model: "R 1250 GS", country: "Germany", type: "motorcycle", domain: "road", icon: "🏍️" },
  { brand: "Vespa", model: "GTS 300", country: "Italy", type: "scooter", domain: "road", icon: "🛵" },
  { brand: "Honda", model: "Activa", country: "Japan", type: "scooter", domain: "road", icon: "🛵" },

  // --- road · off-road ---------------------------------------------------- //
  { brand: "Jeep", model: "Wrangler Rubicon", country: "USA", type: "offroad", domain: "road", icon: "🚙" },
  { brand: "Land Rover", model: "Defender 110", country: "UK", type: "offroad", domain: "road", icon: "🚙" },
  { brand: "Mahindra", model: "Thar", country: "India", type: "offroad", domain: "road", icon: "🚙" },

  // --- rail --------------------------------------------------------------- //
  { brand: "JR Central", model: "N700S Shinkansen", country: "Japan", type: "highspeed", domain: "rail", icon: "🚅" },
  { brand: "SNCF", model: "TGV InOui", country: "France", type: "highspeed", domain: "rail", icon: "🚅" },
  { brand: "Deutsche Bahn", model: "ICE 4", country: "Germany", type: "highspeed", domain: "rail", icon: "🚅" },
  { brand: "CRRC", model: "Fuxing CR400AF", country: "China", type: "highspeed", domain: "rail", icon: "🚅" },
  { brand: "Indian Railways", model: "Vande Bharat", country: "India", type: "highspeed", domain: "rail", icon: "🚅" },
  { brand: "Renfe", model: "AVE S-103", country: "Spain", type: "highspeed", domain: "rail", icon: "🚅" },
  { brand: "Union Pacific", model: "Big Boy Freight", country: "USA", type: "freighttrain", domain: "rail", icon: "🚂" },
  { brand: "BNSF", model: "Intermodal Freight", country: "USA", type: "freighttrain", domain: "rail", icon: "🚂" },
  { brand: "DB Cargo", model: "Vectron Freight", country: "Germany", type: "freighttrain", domain: "rail", icon: "🚂" },
  { brand: "London Underground", model: "2024 Stock", country: "UK", type: "metro", domain: "rail", icon: "🚇" },
  { brand: "Delhi Metro", model: "Movia Rapid", country: "India", type: "metro", domain: "rail", icon: "🚇" },
  { brand: "Alstom", model: "Citadis Tram", country: "France", type: "tram", domain: "rail", icon: "🚊" },

  // --- sea · commercial --------------------------------------------------- //
  { brand: "MSC", model: "Irina Container Ship", country: "Italy", type: "container", domain: "sea", icon: "🚢" },
  { brand: "Evergreen", model: "Ever Ace", country: "China", type: "container", domain: "sea", icon: "🚢" },
  { brand: "CMA CGM", model: "Jacques Saadé", country: "France", type: "container", domain: "sea", icon: "🚢" },
  { brand: "Frontline", model: "VLCC Crude Tanker", country: "Norway", type: "seatanker", domain: "sea", icon: "🛢️" },
  { brand: "QatarEnergy", model: "Q-Max LNG Carrier", country: "Qatar", type: "seatanker", domain: "sea", icon: "🛢️" },
  { brand: "Damen", model: "ASD Harbour Tug", country: "Netherlands", type: "tug", domain: "sea", icon: "🛟" },
  { brand: "Nordic", model: "Deep-Sea Trawler", country: "Norway", type: "fishing", domain: "sea", icon: "🎣" },
  { brand: "Rosatom", model: "Arktika Icebreaker", country: "Russia", type: "icebreaker", domain: "sea", icon: "🧊" },

  // --- air · cargo & utility ---------------------------------------------- //
  { brand: "Boeing", model: "747-8 Freighter", country: "USA", type: "cargoplane", domain: "air", icon: "🛫" },
  { brand: "Antonov", model: "An-124 Ruslan", country: "Ukraine", type: "cargoplane", domain: "air", icon: "🛫" },
  { brand: "Airbus", model: "BelugaXL", country: "France", type: "cargoplane", domain: "air", icon: "🛫" },
  { brand: "de Havilland", model: "Twin Otter Seaplane", country: "Canada", type: "seaplane", domain: "air", icon: "🛩️" },
  { brand: "ICON", model: "A5 Amphibian", country: "USA", type: "seaplane", domain: "air", icon: "🛩️" },
  { brand: "DJI", model: "Matrice Cargo Drone", country: "China", type: "drone", domain: "air", icon: "🛸" },
  { brand: "Zipline", model: "Delivery Drone", country: "USA", type: "drone", domain: "air", icon: "🛸" },
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
  category?: string;
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
      (!f.category || categoryOf(c) === f.category) &&
      (!f.brand || c.brand === f.brand) &&
      (!f.country || c.country === f.country) &&
      (!f.type || c.type === f.type) &&
      (!q || `${c.brand} ${c.model} ${c.type}`.toLowerCase().includes(q)),
  ).sort((a, b) => a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model));
}

export function randomCar(): Car {
  return CARS[Math.floor(Math.random() * CARS.length)];
}

const BY_DOMAIN: Record<Domain, Car[]> = {
  road: CARS.filter((c) => domainOf(c) === "road"),
  rail: CARS.filter((c) => domainOf(c) === "rail"),
  sea: CARS.filter((c) => domainOf(c) === "sea"),
  air: CARS.filter((c) => domainOf(c) === "air"),
  underwater: CARS.filter((c) => domainOf(c) === "underwater"),
};
export function randomCarOf(domain: Domain): Car {
  const list = BY_DOMAIN[domain];
  return list[Math.floor(Math.random() * list.length)] ?? randomCar();
}

/**
 * A random road vehicle from one category — how a YOLO detection becomes a real
 * fleet vehicle: YOLO says "bus", this returns an actual bus from the catalogue.
 */
export function randomCarOfCategory(category: string): Car {
  const list = CARS.filter((c) => domainOf(c) === "road" && categoryOf(c) === category);
  return list.length ? list[Math.floor(Math.random() * list.length)] : randomCarOf("road");
}
