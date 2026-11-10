/**
 * Crée (ou affiche) l'abonnement webhook Strava de l'application. À lancer une fois, l'app déployée :
 *
 *   npm run strava:subscribe -- https://<ton-domaine>/api/strava/webhook
 *
 * Lit STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET et STRAVA_WEBHOOK_VERIFY_TOKEN dans .env.local.
 * Strava appelle aussitôt l'URL pour la valider : la version déployée doit connaître le même jeton.
 */
const [callbackUrl] = process.argv.slice(2);
const { STRAVA_CLIENT_ID: id, STRAVA_CLIENT_SECRET: secret, STRAVA_WEBHOOK_VERIFY_TOKEN: verify } = process.env;
if (!id || !secret || !verify) throw new Error("Variables Strava manquantes dans .env.local");

const API = "https://www.strava.com/api/v3/push_subscriptions";
const existing = await fetch(`${API}?client_id=${id}&client_secret=${secret}`).then((r) => r.json());
if (Array.isArray(existing) && existing.length) {
  console.log("Abonnement existant :", existing);
  console.log("Ajoute STRAVA_SUBSCRIPTION_ID =", existing[0].id, "aux variables Vercel.");
  process.exit(0);
}
if (!callbackUrl) throw new Error("URL du webhook attendue en argument");

const body = new URLSearchParams({ client_id: id, client_secret: secret, callback_url: callbackUrl, verify_token: verify });
const res = await fetch(API, { method: "POST", body });
const json = await res.json();
if (!res.ok) throw new Error(`Strava ${res.status} : ${JSON.stringify(json)}`);
console.log("Abonnement créé :", json);
console.log("Ajoute STRAVA_SUBSCRIPTION_ID =", json.id, "aux variables Vercel.");
