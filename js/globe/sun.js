/* Where the sun is overhead right now: the subsolar point, from the UTC time.
   The short formula of the Astronomical Almanac, good to about a tenth of a
   degree — far more than a terminator on a globe needs. */

const RAD = Math.PI / 180;

export function subsolar(date = new Date()) {
  const d = date.getTime() / 86400000 - 10957.5;               // days since J2000
  const g = (357.529 + 0.98560028 * d) * RAD;                    // mean anomaly
  const q = 280.459 + 0.98564736 * d;                            // mean longitude
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;                     // obliquity
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / RAD;
  const dec = Math.asin(Math.sin(e) * Math.sin(L)) / RAD;
  const gmst = 18.697374558 + 24.06570982441908 * d;             // hours
  const lon = ((ra - gmst * 15) % 360 + 540) % 360 - 180;
  return [dec, lon];
}
