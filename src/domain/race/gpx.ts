/**
 * Lecture d'un fichier GPX et profil du parcours : distance, dénivelé réel (avec seuil anti-bruit GPS),
 * profil rééchantillonné, reliefs significatifs. Fonctions pures, sans DOM (testables).
 */

export type GpxPoint = { lat: number; lon: number; ele: number | null };

export function parseGpx(text: string): GpxPoint[] {
  const points: GpxPoint[] = [];
  const re = /<(trkpt|rtept)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g;
  for (const m of text.matchAll(re)) {
    const attrs = m[2];
    const lat = Number(/\blat\s*=\s*["']([^"']+)["']/.exec(attrs)?.[1]);
    const lon = Number(/\blon\s*=\s*["']([^"']+)["']/.exec(attrs)?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const ele = m[4] ? Number(/<ele>\s*([^<]+?)\s*<\/ele>/.exec(m[4])?.[1]) : NaN;
    points.push({ lat, lon, ele: Number.isFinite(ele) ? ele : null });
  }
  return points;
}

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversine(a: GpxPoint, b: GpxPoint): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Dénivelé avec hystérésis : un changement d'altitude ne compte qu'une fois dépassé le seuil depuis le
 * dernier point retenu. Sans ce seuil, le bruit GPS gonfle le D+ de 20 à 50 %.
 */
export function elevationGain(eles: number[], threshold = 5) {
  let gain = 0;
  let loss = 0;
  if (!eles.length) return { gain, loss };
  let anchor = eles[0];
  for (const e of eles) {
    const d = e - anchor;
    if (d >= threshold) { gain += d; anchor = e; }
    else if (d <= -threshold) { loss -= d; anchor = e; }
  }
  return { gain: Math.round(gain), loss: Math.round(loss) };
}

export type Climb = { start_m: number; end_m: number; gain_m: number; grade_pct: number };

export type CourseProfile = {
  distance_m: number;
  gain_m: number;
  loss_m: number;
  min_ele: number | null;
  max_ele: number | null;
  /** Altitude lissée tous les `step_m` mètres. */
  step_m: number;
  samples: { d: number; ele: number }[];
  climbs: Climb[];
  has_elevation: boolean;
};

export type ProfileOptions = { step_m?: number; noise_m?: number; minClimbGain_m?: number; minClimbLength_m?: number };

/** Profil complet : cumul des distances, lissage, rééchantillonnage, dénivelé, montées notables. */
export function courseProfile(points: GpxPoint[], opts: ProfileOptions = {}): CourseProfile {
  const step = opts.step_m ?? 100;
  const noise = opts.noise_m ?? 5;
  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + haversine(points[i - 1], points[i]));
  const distance = cum.at(-1) ?? 0;
  const withEle = points.map((p, i) => ({ d: cum[i], ele: p.ele })).filter((p): p is { d: number; ele: number } => p.ele != null);
  const hasEle = withEle.length >= 2;

  // Lissage par moyenne glissante sur ~50 m de part et d'autre, puis rééchantillonnage régulier.
  const smooth = withEle.map((p, i) => {
    let s = 0, n = 0;
    for (let j = i; j >= 0 && p.d - withEle[j].d <= 50; j--) { s += withEle[j].ele; n++; }
    for (let j = i + 1; j < withEle.length && withEle[j].d - p.d <= 50; j++) { s += withEle[j].ele; n++; }
    return { d: p.d, ele: s / n };
  });
  const samples: { d: number; ele: number }[] = [];
  if (hasEle) {
    let k = 0;
    for (let d = 0; d <= distance + 1e-6; d += step) {
      while (k < smooth.length - 2 && smooth[k + 1].d < d) k++;
      const a = smooth[k], b = smooth[Math.min(k + 1, smooth.length - 1)];
      const t = b.d > a.d ? Math.min(1, Math.max(0, (d - a.d) / (b.d - a.d))) : 0;
      samples.push({ d: Math.round(d), ele: Math.round((a.ele + t * (b.ele - a.ele)) * 10) / 10 });
    }
    if (samples.at(-1)!.d < distance - 1) samples.push({ d: Math.round(distance), ele: Math.round(smooth.at(-1)!.ele * 10) / 10 });
  }

  const { gain, loss } = elevationGain(smooth.map((p) => p.ele), noise);
  return {
    distance_m: Math.round(distance),
    gain_m: gain,
    loss_m: loss,
    min_ele: hasEle ? Math.round(Math.min(...samples.map((s) => s.ele))) : null,
    max_ele: hasEle ? Math.round(Math.max(...samples.map((s) => s.ele))) : null,
    step_m: step,
    samples,
    climbs: hasEle ? findClimbs(samples, opts.minClimbGain_m ?? 30, opts.minClimbLength_m ?? 400) : [],
    has_elevation: hasEle,
  };
}

/** Montées notables : d'un creux à un sommet (hystérésis de 10 m), avec un gain et une longueur minimum. */
export function findClimbs(samples: { d: number; ele: number }[], minGain: number, minLength: number): Climb[] {
  const climbs: Climb[] = [];
  if (samples.length < 2) return climbs;
  let low = samples[0];
  let high = samples[0];
  let rising = false;
  const close = () => {
    const g = high.ele - low.ele;
    if (g >= minGain && high.d - low.d >= minLength) {
      climbs.push({ start_m: low.d, end_m: high.d, gain_m: Math.round(g), grade_pct: Math.round((g / (high.d - low.d)) * 1000) / 10 });
    }
  };
  for (const s of samples) {
    if (rising) {
      if (s.ele > high.ele) high = s;
      else if (high.ele - s.ele >= 10) { close(); rising = false; low = s; high = s; }
    } else {
      // « <= » : sur un plat, le creux avance avec nous, la montée commence au pied de la côte.
      if (s.ele <= low.ele) { low = s; high = s; }
      else if (s.ele - low.ele >= 10) { rising = true; high = s; }
    }
  }
  if (rising) close();
  return climbs;
}

/** Parcours sans GPX : plat, de la distance de la course. */
export function flatProfile(distance_m: number, step_m = 100): CourseProfile {
  return {
    distance_m, gain_m: 0, loss_m: 0, min_ele: null, max_ele: null, step_m, samples: [], climbs: [], has_elevation: false,
  };
}
