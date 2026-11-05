// Sunrise and sunset worked out on the server (the "sunrise equation", as on Wikipedia), so routines can run at
// sunset with no internet look-up. Accurate to a minute or two, which is plenty for lights.
const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2440587.5;
const J2000 = 2451545;

/**
 * Sunrise and sunset (ms timestamps) on a calendar day ('YYYY-MM-DD') at a place.
 * rise / set are null when the sun stays up (or down) all day — not a worry in the UK.
 */
export function times(day, lat, lon) {
  const noonUtc = Date.parse(`${day}T12:00:00Z`);
  const n = Math.round(noonUtc / DAY_MS + J1970 - J2000 - 0.0008);
  const jStar = n - lon / 360; // mean solar noon (longitude east positive)
  const m = (357.5291 + 0.98560028 * jStar) % 360;
  const c = 1.9148 * Math.sin(m * RAD) + 0.02 * Math.sin(2 * m * RAD) + 0.0003 * Math.sin(3 * m * RAD);
  const lambda = (m + c + 180 + 102.9372) % 360;
  const transit = J2000 + jStar + 0.0053 * Math.sin(m * RAD) - 0.0069 * Math.sin(2 * lambda * RAD);
  const sinDec = Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosW = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * sinDec) / (Math.cos(lat * RAD) * cosDec);
  const toMs = (j) => Math.round((j - J1970) * DAY_MS);
  if (cosW > 1 || cosW < -1) return { rise: null, set: null, noon: toMs(transit), up: cosW < -1 };
  const w = Math.acos(cosW) / RAD;
  return { rise: toMs(transit - w / 360), set: toMs(transit + w / 360), noon: toMs(transit) };
}

/** Is it dark (between sunset and the next sunrise) at this moment? day is the local 'YYYY-MM-DD'. */
export function isDark(now, day, lat, lon) {
  const t = times(day, lat, lon);
  if (t.rise == null) return !t.up;
  return now < t.rise || now >= t.set;
}
