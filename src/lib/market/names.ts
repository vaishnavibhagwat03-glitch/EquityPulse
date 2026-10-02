import type { Rng } from '@/lib/random';

/**
 * Synthetic company naming: Indian place, river, mountain and virtue names
 * combined with sector vocabulary, e.g. "Kaveri Infotech Ltd" → KAVERIINFO.
 */

const PREFIXES = [
  'Aarav',
  'Abhinav',
  'Aditya',
  'Agastya',
  'Ajanta',
  'Akshar',
  'Alaknanda',
  'Amara',
  'Ambika',
  'Anant',
  'Ananta',
  'Apex',
  'Aravalli',
  'Arihant',
  'Arjun',
  'Aryan',
  'Ashoka',
  'Avantika',
  'Banas',
  'Bhagirathi',
  'Bharat',
  'Bhavani',
  'Bhavya',
  'Bodhi',
  'Brahmaputra',
  'Cauvery',
  'Chambal',
  'Chandra',
  'Charan',
  'Chenab',
  'Chetan',
  'Chola',
  'Crescent',
  'Dakshin',
  'Damodar',
  'Deccan',
  'Devgiri',
  'Dhanlaxmi',
  'Dharma',
  'Dhruva',
  'Dwarka',
  'Eklavya',
  'Ekta',
  'Elphin',
  'Falgun',
  'Gagan',
  'Gandhar',
  'Ganga',
  'Garuda',
  'Gautam',
  'Girija',
  'Girnar',
  'Godavari',
  'Gokul',
  'Gomti',
  'Hampi',
  'Harsha',
  'Hemadri',
  'Himgiri',
  'Himalaya',
  'Hindustan',
  'Indra',
  'Indus',
  'Ishan',
  'Jagat',
  'Jalaram',
  'Janak',
  'Jayant',
  'Jhelum',
  'Kailash',
  'Kalinga',
  'Kalyan',
  'Kamakshi',
  'Kanak',
  'Kartik',
  'Kaveri',
  'Kesari',
  'Kiran',
  'Konark',
  'Konkan',
  'Krishna',
  'Kshitij',
  'Kumaon',
  'Lakshya',
  'Lotus',
  'Madhav',
  'Mahanadi',
  'Mahendra',
  'Malabar',
  'Malwa',
  'Manas',
  'Mandovi',
  'Matrix',
  'Meghna',
  'Meridian',
  'Mewar',
  'Mitra',
  'Nalanda',
  'Narmada',
  'Navbharat',
  'Neelkanth',
  'Nilgiri',
  'Nirmal',
  'Nucleus',
  'Ojas',
  'Orbit',
  'Pallav',
  'Panchal',
  'Paras',
  'Pinnacle',
  'Prabhat',
  'Pragati',
  'Prakash',
  'Pranav',
  'Prayag',
  'Purvi',
  'Radhika',
  'Raghav',
  'Rajputana',
  'Ratna',
  'Ravi',
  'Rohini',
  'Rudra',
  'Sabari',
  'Sahyadri',
  'Samarth',
  'Sanchi',
  'Sangam',
  'Saraswat',
  'Satluj',
  'Satpura',
  'Saurashtra',
  'Savitr',
  'Shakti',
  'Shivalik',
  'Shreyas',
  'Siddhi',
  'Sindhu',
  'Somnath',
  'Sterling',
  'Subhash',
  'Sudarshan',
  'Suryan',
  'Swastik',
  'Tapti',
  'Tejas',
  'Tirupati',
  'Trident',
  'Trishul',
  'Tungabhadra',
  'Udaan',
  'Ujjwal',
  'Unnati',
  'Upasana',
  'Utkal',
  'Utkarsh',
  'Vaibhav',
  'Vaishali',
  'Vardhman',
  'Varuna',
  'Vasudha',
  'Vayu',
  'Vedant',
  'Vidarbha',
  'Vijaya',
  'Vikram',
  'Vindhya',
  'Vishwa',
  'Yamuna',
  'Yashas',
  'Yukta',
  'Zenith',
] as const;

const SUFFIXES = [
  'Ltd',
  'Ltd',
  'Ltd',
  'Ltd',
  'Ltd',
  'India Ltd',
  'Industries Ltd',
  'Enterprises Ltd',
  'Corporation Ltd',
  'Global Ltd',
] as const;

export function makeCompanyName(rng: Rng, nameParts: readonly string[], used: Set<string>): string {
  for (let attempt = 0; attempt < 24; attempt++) {
    const name = `${rng.pick(PREFIXES)} ${rng.pick(nameParts)} ${rng.pick(SUFFIXES)}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  // Exhausted the space for this sector: disambiguate with a second prefix.
  let name = `${rng.pick(PREFIXES)} ${rng.pick(PREFIXES)} ${rng.pick(nameParts)} Ltd`;
  while (used.has(name))
    name = `${rng.pick(PREFIXES)} ${rng.pick(PREFIXES)} ${rng.pick(nameParts)} Ltd`;
  used.add(name);
  return name;
}

const STOP_WORDS = new Set([
  'LTD',
  'INDIA',
  'INDUSTRIES',
  'ENTERPRISES',
  'CORPORATION',
  'GLOBAL',
  'THE',
  'OF',
  'AND',
  '&',
]);

/** NSE-style ticker: up to 10 uppercase letters, unique within the universe. */
export function makeSymbol(name: string, used: Set<string>): string {
  const words = name
    .toUpperCase()
    .split(/\s+/)
    .map(w => w.replace(/[^A-Z]/g, ''))
    .filter(w => w && !STOP_WORDS.has(w));
  const first = words[0] ?? 'EQ';
  const rest = words.slice(1).join('');
  const candidates = [
    (first.slice(0, 6) + rest.slice(0, 4)).slice(0, 10),
    (first + rest).slice(0, 10),
    (first.slice(0, 5) + rest.slice(0, 5)).slice(0, 10),
    (first.slice(0, 4) + rest.slice(0, 6)).slice(0, 10),
    (first.slice(0, 7) + rest.slice(0, 3)).slice(0, 10),
    (first.slice(0, 3) + rest.slice(0, 7)).slice(0, 10),
  ];
  for (const c of candidates) {
    if (c.length >= 3 && !used.has(c)) {
      used.add(c);
      return c;
    }
  }
  const base = candidates[0]!.slice(0, 9);
  for (let i = 0; i < 26; i++) {
    const c = base + String.fromCharCode(65 + i);
    if (!used.has(c)) {
      used.add(c);
      return c;
    }
  }
  let n = 2;
  while (used.has(`${base.slice(0, 8)}${n}`)) n++;
  const fallback = `${base.slice(0, 8)}${n}`;
  used.add(fallback);
  return fallback;
}

/** ISIN check digit (ISO 6166): letters expand to two digits, then Luhn. */
export function isinCheckDigit(body: string): number {
  let digits = '';
  for (const ch of body) {
    const code = ch.charCodeAt(0);
    digits += code >= 65 && code <= 90 ? String(code - 55) : ch;
  }
  let sum = 0;
  let double = true;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return (10 - (sum % 10)) % 10;
}

const ISSUER_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Indian equity ISIN: INE + 3-digit issuer + letter + "01" + serial + check. */
export function makeIsin(index: number): string {
  const issuer = String(100 + ((index * 7919) % 900)).padStart(3, '0');
  const letter = ISSUER_LETTERS[Math.floor(index / 900) % ISSUER_LETTERS.length];
  const body = `INE${issuer}${letter}01${String(10 + (index % 90)).padStart(2, '0')}`;
  return body + isinCheckDigit(body);
}
