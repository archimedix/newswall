/* Where each country's screens hang: the capital, or the city its newsrooms
   work from when that is another one (Dubai, São Paulo, Karachi, New York…).
   [lat, lon] in degrees. A country missing here simply has no screen. */

export const ANCHOR = {
  AE: [25.20, 55.27],   // Dubai
  AF: [34.53, 69.17],
  AL: [41.33, 19.82],
  AM: [40.18, 44.51],
  AR: [-34.60, -58.38],
  AT: [48.21, 16.37],
  AU: [-33.87, 151.21], // Sydney
  BA: [43.86, 18.41],
  BE: [50.85, 4.35],
  BH: [26.23, 50.59],
  BR: [-23.55, -46.63], // São Paulo
  BY: [53.90, 27.56],
  CA: [43.65, -79.38],  // Toronto
  CD: [-4.44, 15.27],   // Kinshasa
  CH: [46.95, 7.45],
  CM: [3.87, 11.52],
  CN: [39.90, 116.40],
  CO: [4.71, -74.07],
  CU: [23.11, -82.37],
  CZ: [50.08, 14.44],
  DE: [52.52, 13.40],
  DZ: [36.75, 3.06],
  EG: [30.04, 31.24],
  ER: [15.33, 38.93],   // Asmara
  ES: [40.42, -3.70],
  FI: [60.17, 24.94],
  FR: [48.86, 2.35],
  GB: [51.51, -0.13],
  GR: [37.98, 23.73],
  GT: [14.63, -90.51],
  ID: [-6.21, 106.85],
  IE: [53.35, -6.26],
  IL: [32.08, 34.78],   // Tel Aviv
  IN: [28.61, 77.21],
  IQ: [33.31, 44.36],
  IR: [35.69, 51.39],
  IS: [64.15, -21.94],
  IT: [41.90, 12.50],
  JO: [31.95, 35.93],
  JP: [35.68, 139.69],
  KE: [-1.29, 36.82],
  KH: [11.55, 104.92],  // Phnom Penh
  KP: [39.02, 125.75],  // Pyongyang
  KR: [37.57, 126.98],
  KW: [29.38, 47.99],
  KZ: [51.17, 71.45],
  LB: [33.89, 35.50],
  LY: [32.83, 13.12],   // Tripoli
  MA: [34.02, -6.84],
  MM: [16.84, 96.17],   // Yangon
  MN: [47.89, 106.91],
  MZ: [-25.97, 32.58],  // Maputo
  MX: [19.43, -99.13],
  NE: [13.51, 2.11],    // Niamey
  NG: [6.52, 3.38],     // Lagos
  NL: [52.37, 4.90],
  NP: [27.71, 85.32],   // Kathmandu
  OM: [23.59, 58.41],
  PE: [-12.05, -77.04],
  PH: [14.60, 120.98],
  PK: [24.86, 67.01],   // Karachi
  PL: [52.23, 21.01],
  PS: [31.90, 35.20],   // Ramallah
  PT: [38.72, -9.14],
  QA: [25.29, 51.53],
  RO: [44.43, 26.10],
  RU: [55.76, 37.62],
  SA: [24.71, 46.68],
  SD: [15.50, 32.56],   // Khartoum
  SE: [59.33, 18.07],
  SG: [1.35, 103.82],
  SM: [43.94, 12.45],
  SY: [33.51, 36.29],
  TG: [6.13, 1.22],
  TH: [13.76, 100.50],
  TN: [36.80, 10.18],   // Tunis
  TR: [41.01, 28.98],   // Istanbul
  UA: [50.45, 30.52],
  US: [40.71, -74.01],  // New York
  VE: [10.48, -66.90],
  VN: [21.03, 105.85],  // Hanoi
  YE: [15.37, 44.19],
  ZA: [-26.20, 28.05],  // Johannesburg
};

const RAD = Math.PI / 180;

/* Unit vector for a point on the globe, in the frame of three's SphereGeometry
   with an equirectangular texture: lon 0 at +x, north at +y. */
export function toVec(lat, lon, out) {
  const c = Math.cos(lat * RAD);
  return out.set(c * Math.cos(lon * RAD), Math.sin(lat * RAD), -c * Math.sin(lon * RAD));
}

export function toLatLon(v) {
  const n = v.clone().normalize();
  return [Math.asin(n.y) / RAD, Math.atan2(-n.z, n.x) / RAD];
}
